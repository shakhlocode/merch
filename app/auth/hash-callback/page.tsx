'use client'

import { createClient } from '@/lib/supabase/client'
import type { EmailOtpType } from '@supabase/supabase-js'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo } from 'react'

export default function HashCallbackPage() {
  return (
    <Suspense>
      <HashCallbackContent />
    </Suspense>
  )
}

function HashCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  const message = 'Завершаем вход...'

  useEffect(() => {
    async function finishSignIn() {
      const callbackParams = getCallbackParams(searchParams)
      const next = callbackParams.next

      try {
        const hashParams = new URLSearchParams(window.location.hash.slice(1))
        const hashError =
          hashParams.get('error_description') || hashParams.get('error')

        if (hashError) {
          throw new Error(hashError)
        }

        const accessToken = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')
        const tokenHash = callbackParams.tokenHash ?? hashParams.get('token_hash')
        const code = searchParams.get('code')

        if (code) {
          // The browser SDK exchanges PKCE codes during initialization.
          // Wait for that result instead of consuming the same code twice.
          const { error } = await supabase.auth.initialize()

          if (error) {
            throw error
          }
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })

          if (error) {
            throw error
          }
        } else if (tokenHash) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: callbackParams.type,
          })

          if (error) {
            throw error
          }
        }

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (userError || !user) {
          throw userError ?? new Error('Не удалось получить пользователя')
        }

        const { data: employee } = await supabase
          .from('employees')
          .select('password_set_at')
          .eq('id', user.id)
          .maybeSingle()

        if (!employee?.password_set_at) {
          window.location.replace('/set-password')
          return
        }

        window.location.replace(next)
      } catch (error) {
        const description =
          error instanceof Error ? error.message : 'Не удалось выполнить вход'
        window.location.replace(
          `/login?error=auth_failed&description=${encodeURIComponent(description)}`
        )
      }
    }

    finishSignIn()
  }, [router, searchParams, supabase])

  return (
    <main className="page-error">
      <section className="error-card">
        <div className="error-card-icon">...</div>
        <h1 className="error-title">{message}</h1>
        <p className="error-text">
          Если переход занял больше нескольких секунд, запросите письмо ещё раз.
        </p>
      </section>
    </main>
  )
}

function getCallbackParams(searchParams: URLSearchParams) {
  let nextParam = searchParams.get('next') ?? '/set-password?reset=1'
  let tokenHash = searchParams.get('token_hash')
  let type = (searchParams.get('type') ?? 'email') as EmailOtpType

  if (!tokenHash) {
    const marker = '?token_hash='
    const markerIndex = nextParam.indexOf(marker)

    if (markerIndex >= 0) {
      const cleanNext = nextParam.slice(0, markerIndex)
      const tail = nextParam.slice(markerIndex + 1)
      const tailParams = new URLSearchParams(tail)

      nextParam = cleanNext
      tokenHash = tailParams.get('token_hash')
      type = (tailParams.get('type') ?? type) as EmailOtpType
    }
  }

  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') && !nextParam.includes('\\')
    ? nextParam
    : '/set-password?reset=1'

  return { next, tokenHash, type }
}
