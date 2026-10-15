import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type AdminProductAction =
  | 'archive_product'
  | 'create_product'
  | 'update_product'
  | 'create_variant'
  | 'update_variant'
  | 'add_stock'

type Payload = {
  action?: AdminProductAction

  product_id?: string
  variant_id?: string

  name?: string
  description?: string | null
  placement?: string
  variants?: { size: string; color: string; qty: number }[]
  material?: string | null
  category_id?: string | null
  image_url?: string | null
  is_active?: boolean

  size?: string | null
  color?: string | null
  sku?: string | null
  initial_qty?: number
  low_stock_threshold?: number
  qty?: number
  comment?: string | null
  movement_type?: 'income' | 'adjustment'
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Необходимо войти в систему' },
        { status: 401 }
      )
    }

    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select('id, is_admin, is_active')
      .eq('id', user.id)
      .maybeSingle()

    if (employeeError) {
      return NextResponse.json(
        { error: employeeError.message },
        { status: 400 }
      )
    }

    if (!(await supabase.rpc('is_admin', {})).data || !employee || !employee.is_active) {
      return NextResponse.json(
        { error: 'Доступ разрешён только администратору' },
        { status: 403 }
      )
    }

    const body = (await request.json()) as Payload

    if (!body.action) {
      return NextResponse.json(
        { error: 'Не передано действие' },
        { status: 400 }
      )
    }

    if (body.action === 'archive_product') {
      if (!body.product_id || typeof body.is_active !== 'boolean') return NextResponse.json({ error: 'Укажите товар и действие архива' }, { status: 400 })
      const { error } = await supabase.from('products').update({ is_active: body.is_active }).eq('id', body.product_id).select('id').single()
      return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true })
    }

    if (body.action === 'create_product') {
      const name = body.name?.trim()

      if (!name) {
        return NextResponse.json(
          { error: 'Название товара обязательно' },
          { status: 400 }
        )
      }

      if (!['catalog', 'welcome', 'both'].includes(body.placement ?? '') || !Array.isArray(body.variants)) {
        return NextResponse.json({ error: 'Укажите раздел, размеры и начальные остатки' }, { status: 400 })
      }
      const { data, error } = await supabase.rpc('admin_create_product', {
        p_name: name,
        p_description: cleanText(body.description),
        p_image_url: cleanText(body.image_url),
        p_placement: body.placement!,
        p_variants: body.variants,
      })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      return NextResponse.json({ ok: true, product: data })
    }

    if (body.action === 'update_product') {
      if (!body.product_id) {
        return NextResponse.json(
          { error: 'Не передан product_id' },
          { status: 400 }
        )
      }

      const name = body.name?.trim()

      if (!name) {
        return NextResponse.json(
          { error: 'Название товара обязательно' },
          { status: 400 }
        )
      }

      if (body.placement !== undefined && !['catalog', 'welcome', 'both'].includes(body.placement)) {
        return NextResponse.json({ error: 'Выберите раздел для товара' }, { status: 400 })
      }
      const imageUrl = cleanText(body.image_url)

      const { data, error } = await supabase
        .from('products')
        .update({
          name,
          description: cleanText(body.description),
          ...(body.material !== undefined ? { material: cleanText(body.material) } : {}),
          ...(body.category_id !== undefined ? { category_id: cleanText(body.category_id) } : {}),
          ...(body.placement !== undefined ? { placement: body.placement } : {}),
          image_url: imageUrl,
          images: imageUrl ? [imageUrl] : [],
          is_active: body.is_active ?? true,
        })
        .eq('id', body.product_id)
        .select('id')
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      return NextResponse.json({ ok: true, product: data })
    }

    if (body.action === 'create_variant') {
      if (!body.product_id) {
        return NextResponse.json(
          { error: 'Не передан product_id' },
          { status: 400 }
        )
      }

      const sku = body.sku?.trim()

      if (!sku) {
        return NextResponse.json(
          { error: 'SKU обязателен' },
          { status: 400 }
        )
      }

      const initialQty = Number(body.initial_qty ?? 0)

      if (!Number.isInteger(initialQty) || initialQty < 0) {
        return NextResponse.json({ error: 'Начальный остаток должен быть целым неотрицательным числом' }, { status: 400 })
      }

      const { data: variant, error: variantError } = await supabase
        .from('product_variants')
        .insert({
          product_id: body.product_id,
          size: cleanText(body.size),
          color: cleanText(body.color),
          sku,
          total_qty: 0,
          reserved_qty: 0,
          is_active: body.is_active ?? true,
        })
        .select('id')
        .single()

      if (variantError) {
        return NextResponse.json(
          { error: variantError.message },
          { status: 400 }
        )
      }

      if (initialQty > 0) {
        const { error: stockError } = await supabase
          .from('stock_movements')
          .insert({
            variant_id: variant.id,
            movement_type: 'income',
            qty: initialQty,
            comment: 'Первичное поступление при создании варианта',
            created_by: user.id,
          })

        if (stockError) {
          return NextResponse.json(
            { error: stockError.message },
            { status: 400 }
          )
        }
      }

      return NextResponse.json({ ok: true, variant })
    }

    if (body.action === 'update_variant') {
      if (body.low_stock_threshold !== undefined && (!Number.isInteger(body.low_stock_threshold) || body.low_stock_threshold < 0 || body.low_stock_threshold > 1000000)) {
        return NextResponse.json({error:'Порог должен быть целым числом от 0 до 1000000.'},{status:400})
      }
      if (!body.variant_id) {
        return NextResponse.json(
          { error: 'Не передан variant_id' },
          { status: 400 }
        )
      }

      const sku = body.sku?.trim()

      if (!sku) {
        return NextResponse.json(
          { error: 'SKU обязателен' },
          { status: 400 }
        )
      }

      const { data, error } = await supabase
        .from('product_variants')
        .update({
          size: cleanText(body.size),
          color: cleanText(body.color),
          sku,
          is_active: body.is_active ?? true,
          ...(body.low_stock_threshold !== undefined ? {low_stock_threshold:body.low_stock_threshold} : {}),
        })
        .eq('id', body.variant_id)
        .select('id')
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      return NextResponse.json({ ok: true, variant: data })
    }

    if (body.action === 'add_stock') {
      if (!body.variant_id) {
        return NextResponse.json(
          { error: 'Не передан variant_id' },
          { status: 400 }
        )
      }

      const qty = Number(body.qty)

      if (!Number.isInteger(qty) || qty === 0) {
        return NextResponse.json(
          { error: 'Количество должно быть не равно 0' },
          { status: 400 }
        )
      }

      const movementType = body.movement_type ?? 'income'

      if (movementType === 'income' && qty <= 0) {
        return NextResponse.json(
          { error: 'Поступление должно быть положительным числом' },
          { status: 400 }
        )
      }

      if (!['income','adjustment'].includes(movementType) || (movementType === 'income' && qty < 0)) {
        return NextResponse.json({ error: 'Некорректное движение остатков' }, { status: 400 })
      }
      if (movementType === 'adjustment' && !cleanText(body.comment)) {
        return NextResponse.json({ error: 'Укажите причину корректировки остатка' }, { status: 400 })
      }
      const { data, error } = await supabase
        .from('stock_movements')
        .insert({
          variant_id: body.variant_id,
          movement_type: movementType,
          qty,
          comment:
            cleanText(body.comment) ??
            (movementType === 'income'
              ? 'Поступление через админку'
              : 'Ручная корректировка через админку'),
          created_by: user.id,
        })
        .select('id')
        .single()

      if (error) {
        return NextResponse.json({ error: 'Нельзя убрать зарезервированные единицы или сделать остаток отрицательным. Проверьте доступное количество.' }, { status: 400 })
      }

      return NextResponse.json({ ok: true, movement: data })
    }

    return NextResponse.json(
      { error: 'Неизвестное действие' },
      { status: 400 }
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Неизвестная ошибка'

    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function cleanText(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  return trimmed.length > 0 ? trimmed : null
}
