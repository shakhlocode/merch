import { publicError } from '@/lib/security/public-error.mjs'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

import { normalizeProductImage, MAX_IMAGE_BYTES } from '@/lib/security/image.mjs'

export const runtime = 'nodejs'

const BUCKET_NAME = 'merch-products'

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

    const { error: employeeError } = await supabase
      .from('employees')
      .select('id, is_admin')
      .eq('id', user.id)
      .maybeSingle()

    if (employeeError) {
      return NextResponse.json(
        { error: publicError(employeeError) },
        { status: 400 }
      )
    }

    if (!(await supabase.rpc('is_admin', {})).data) {
      return NextResponse.json(
        { error: 'Загружать изображения может только администратор' },
        { status: 403 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file')
    const productId = formData.get('productId')

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'Файл не передан' },
        { status: 400 }
      )
    }

    if (file.size > MAX_IMAGE_BYTES || file.size === 0) {
      return NextResponse.json({ error: 'Изображение должно быть непустым и не больше 5 МБ.' }, { status: 400 })
    }
    let normalized
    try {
      normalized = await normalizeProductImage(new Uint8Array(await file.arrayBuffer()))
    } catch {
      return NextResponse.json({ error: 'Не удалось прочитать изображение. Загрузите исправный JPG, PNG, WEBP или GIF до 5 МБ.' }, { status: 400 })
    }
    const safeProductFolder = typeof productId === 'string' && /^[a-f0-9-]{36}$/i.test(productId) ? productId : 'new-product'
    const { data: unitId } = await supabase.rpc('current_unit_id', {})
    if (!unitId) return NextResponse.json({error:'Магазин не выбран'},{status:403})
    const filePath = `${unitId}/products/${safeProductFolder}/${crypto.randomUUID()}.${normalized.extension}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, normalized.bytes, {
        contentType: normalized.contentType,
        upsert: false,
      })

    if (uploadError) {
      return NextResponse.json(
        { error: publicError(uploadError) },
        { status: 400 }
      )
    }

    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filePath)

    return NextResponse.json({
      ok: true,
      path: filePath,
      url: publicUrlData.publicUrl,
    })
  } catch (error) {
    const message =
      error instanceof Error ? publicError(error) : 'Неизвестная ошибка'

    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
