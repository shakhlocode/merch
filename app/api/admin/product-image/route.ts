import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const BUCKET_NAME = 'merch-products'

const allowedMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]

const maxFileSizeBytes = 5 * 1024 * 1024

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
        { error: employeeError.message },
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

    if (!allowedMimeTypes.includes(file.type)) {
      return NextResponse.json(
        {
          error:
            'Неверный формат файла. Разрешены только JPG, PNG, WEBP и GIF.',
        },
        { status: 400 }
      )
    }

    if (file.size > maxFileSizeBytes) {
      return NextResponse.json(
        { error: 'Файл слишком большой. Максимум 5 MB.' },
        { status: 400 }
      )
    }

    const extension = getExtension(file.name, file.type)
    const safeProductFolder =
      typeof productId === 'string' && productId.trim()
        ? productId.trim()
        : 'new-product'

    const { data: unitId } = await supabase.rpc('current_unit_id', {})
    if (!unitId) return NextResponse.json({error:'Магазин не выбран'},{status:403})
    const filePath = `${unitId}/products/${safeProductFolder}/${crypto.randomUUID()}.${extension}`

    const arrayBuffer = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, bytes, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      return NextResponse.json(
        { error: uploadError.message },
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
      error instanceof Error ? error.message : 'Неизвестная ошибка'

    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}

function getExtension(fileName: string, mimeType: string) {
  const nameExtension = fileName.split('.').pop()?.toLowerCase()

  if (nameExtension && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(nameExtension)) {
    return nameExtension === 'jpeg' ? 'jpg' : nameExtension
  }

  if (mimeType === 'image/jpeg') {
    return 'jpg'
  }

  if (mimeType === 'image/png') {
    return 'png'
  }

  if (mimeType === 'image/webp') {
    return 'webp'
  }

  if (mimeType === 'image/gif') {
    return 'gif'
  }

  return 'jpg'
}