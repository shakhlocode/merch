import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type PasswordPayload = {
  password?: string
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

    if (user.email?.endsWith('@guest.merch.invalid')) return NextResponse.json({ error: 'Для личного приглашения пароль не используется. Вход сохраняется в этом браузере.' }, { status: 403 })
    const body = (await request.json()) as PasswordPayload
    const password = body.password ?? ''

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Пароль должен быть не короче 8 символов' },
        { status: 400 }
      )
    }

    const { error: passwordError } = await supabase.auth.updateUser({
      password,
    })

    if (passwordError) {
      return NextResponse.json(
        { error: passwordError.message },
        { status: 400 }
      )
    }

    const { error: markError } = await supabase.rpc('mark_password_set')

    if (markError) {
      return NextResponse.json(
        { error: markError.message },
        { status: 400 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Неизвестная ошибка'

    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
