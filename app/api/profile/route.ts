import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type ProfilePayload = {
  full_name?: string
  phone?: string
  department?: string
  position?: string
  city?: string
  office?: string
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

    const { data: allowed, error: accessError } = await supabase.rpc('has_system_access', {})
    if (accessError || !allowed) return NextResponse.json({ error: 'Доступ к магазину закрыт' }, { status: 403 })

    const body = (await request.json()) as ProfilePayload

    const fullName = body.full_name?.trim()

    if (!fullName) {
      return NextResponse.json(
        { error: 'ФИО обязательно для заполнения' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase.rpc('update_my_profile', {
      p_full_name: fullName,
      p_phone: body.phone ?? null,
      p_department: body.department ?? null,
      p_position: body.position ?? null,
      p_city: body.city ?? null,
      p_office: body.office ?? null,
    })

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    return NextResponse.json({
      ok: true,
      profile: data,
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