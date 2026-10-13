import { createClient } from '@/lib/supabase/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const origin = requestUrl.origin

  const code = requestUrl.searchParams.get('code')
  const tokenHash = requestUrl.searchParams.get('token_hash')
  const type = (requestUrl.searchParams.get('type') ?? 'email') as EmailOtpType

  const nextParam = requestUrl.searchParams.get('next') ?? '/catalog'
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') && !nextParam.includes('\\')
    ? nextParam
    : '/catalog'

  const supabase = await createClient()

  let authError: string | null = null

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      authError = error.message
      console.error('Supabase exchangeCodeForSession error:', error.message)
    }
  } else if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    })

    if (error) {
      authError = error.message
      console.error('Supabase verifyOtp error:', error.message)
    }
  } else {
    const hashCallbackUrl = new URL('/auth/hash-callback', origin)
    hashCallbackUrl.searchParams.set('next', next)
    return new NextResponse(
      `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Завершаем вход</title>
  </head>
  <body>
    <script>
      var target = ${JSON.stringify(hashCallbackUrl.toString())};
      window.location.replace(target + window.location.hash);
    </script>
  </body>
</html>`,
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      }
    )
  }

  if (!authError) {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      const { data: employee } = await supabase
        .from('employees')
        .select('password_set_at')
        .eq('id', user.id)
        .maybeSingle()

      if (!employee?.password_set_at) {
        return NextResponse.redirect(new URL('/set-password', origin))
      }
    }

    return NextResponse.redirect(new URL(next, origin))
  }

  const loginUrl = new URL('/login', origin)
  loginUrl.searchParams.set('error', 'auth_failed')
  loginUrl.searchParams.set('description', authError)

  return NextResponse.redirect(loginUrl)
}
