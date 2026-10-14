import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type CheckoutItem = {
  variant_id: string
  qty: number
}

type CheckoutPayload = {
  items: CheckoutItem[]
  delivery_type?: 'office' | 'pvz' | 'pickup' | 'courier'
  delivery_address?: string
  phone?: string
  comment?: string
  is_remote?: boolean
  country?: string
}

const MAX_UNIQUE_PRODUCTS = 3

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

    const body = (await request.json()) as CheckoutPayload

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(
        { error: 'Корзина пустая' },
        { status: 400 }
      )
    }

    const items = body.items.map((item) => ({
      variant_id: item.variant_id,
      qty: Number(item.qty),
    }))

    const hasInvalidItem = items.some(
      (item) =>
        !item.variant_id ||
        !Number.isFinite(item.qty) ||
        item.qty <= 0
    )

    if (hasInvalidItem) {
      return NextResponse.json(
        { error: 'В корзине есть некорректные позиции' },
        { status: 400 }
      )
    }

    if (items.some((item) => item.qty !== 1)) {
      return NextResponse.json(
        { error: 'one_unit_per_product_only' },
        { status: 400 }
      )
    }

    const { data: accessRows, error: accessError } = await supabase.rpc(
      'get_employee_merch_access',
      { p_email: user.email ?? '' }
    )

    if (accessError) {
      return NextResponse.json({ error: accessError.message }, { status: 400 })
    }

    const access = Array.isArray(accessRows) ? accessRows[0] : null

    if (!access?.is_allowed) {
      return NextResponse.json(
        { error: access?.reason ?? 'employee_not_allowed' },
        { status: 403 }
      )
    }

    const variantIds = items.map((item) => item.variant_id)
    const { data: variants, error: variantsError } = await supabase
      .from('product_variants')
      .select('id, product_id')
      .in('id', variantIds)

    if (variantsError) {
      return NextResponse.json({ error: variantsError.message }, { status: 400 })
    }

    if ((variants ?? []).length !== variantIds.length) {
      return NextResponse.json({ error: 'product_is_not_available' }, { status: 400 })
    }

    const uniqueProductIds = new Set((variants ?? []).map((variant) => variant.product_id))

    if (uniqueProductIds.size > MAX_UNIQUE_PRODUCTS) {
      return NextResponse.json({ error: 'max_unique_products_exceeded' }, { status: 400 })
    }

    if (uniqueProductIds.size !== items.length) {
      return NextResponse.json({ error: 'one_variant_per_product_only' }, { status: 400 })
    }

    const isRemote = body.is_remote === true
    const country = isRemote ? (body.country?.trim() || null) : null

    const { data, error } = await supabase.rpc('create_merch_order', {
      p_items: items,
      p_delivery_type: 'office',
      p_delivery_address: body.delivery_address ?? null,
      p_phone: body.phone ?? null,
      p_comment: body.comment ?? null,
      p_is_remote: isRemote,
      p_country: country,
    })

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    return NextResponse.json({
      ok: true,
      order: data,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Неизвестная ошибка'

    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
