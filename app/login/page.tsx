'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'

type LoginMode = 'password' | 'email' | 'reset'

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])

  const [mode, setMode] = useState<LoginMode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const [sentEmail, setSentEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const urlError = searchParams.get('error')
  const urlDescription = searchParams.get('description')

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    async function checkSession() {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        return
      }

      const { data: employee } = await supabase
        .from('employees')
        .select('password_set_at')
        .eq('id', user.id)
        .maybeSingle()

      router.replace(employee?.password_set_at ? '/catalog' : '/set-password')
    }

    checkSession()
  }, [router, supabase])

  useEffect(() => {
    if (urlError) {
      setError(getUrlErrorMessage(urlError, urlDescription))
    }
  }, [urlError, urlDescription])

  function switchMode(nextMode: LoginMode) {
    setMode(nextMode)
    setError(null)
    setSentEmail(null)
  }

  async function handlePasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || !password) {
      setError('Введите email и пароль')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      })

      if (signInError) {
        setError(
          'Не удалось войти по паролю. Если это первый вход, нажмите «Зарегистрироваться».'
        )
        return
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const { data: employee } = await supabase
          .from('employees')
          .select('password_set_at')
          .eq('id', user.id)
          .maybeSingle()

        router.replace(employee?.password_set_at ? '/catalog' : '/set-password')
        return
      }

      router.replace('/catalog')
    } catch (loginError) {
      setError(
        loginError instanceof Error ? loginError.message : 'Неизвестная ошибка'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleEmailSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setError('Введите корпоративный email')
      return
    }

    setIsSubmitting(true)
    setError(null)
    setSentEmail(null)

    try {
      const redirectTo = getEmailRedirectTo()

      const { error: signInError } = mode === 'reset'
        ? await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo })
        : await supabase.auth.signInWithOtp({
            email: normalizedEmail,
            options: { emailRedirectTo: redirectTo },
          })

      if (signInError) {
        setError(signInError.message || 'Не удалось отправить письмо')
        return
      }

      setSentEmail(normalizedEmail)
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : 'Неизвестная ошибка'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isMounted) {
    return (
      <main className="login-page login-welcome">
        <section className="login-shell">
          <div className="login-left" />
          <section className="login-card" aria-busy="true" />
        </section>
      </main>
    )
  }

  return (
    <main className="login-page login-welcome">
      <section className="login-shell">
        <div className="login-left">
          <a href="/login" className="login-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/uzum-big-logo.webp" alt="Uzum" className="login-logo" />
            <span className="login-brand-text">
              uzum <span className="fw-regular">мерч</span>
            </span>
          </a>

          <div className="login-hero">
            <h1 className="login-title">Uzum Merch Shop</h1>
            <p className="login-lead">Внутренний портал для выбора и получения корпоративного мерча Uzum.</p>
          </div>
          <section className="login-guide" aria-labelledby="login-guide-title">
            <h2 id="login-guide-title">Как начать пользоваться Uzum Merch Shop</h2>
            <ol className="login-steps">
              <LoginStep value="1" label="Зарегистрируйтесь" description="Введите корпоративную почту и подтвердите доступ через письмо. Откройте ссылку в том же браузере, где начали регистрацию." />
              <LoginStep value="2" label="Создайте пароль" description="После подтверждения почты придумайте пароль для аккаунта." />
              <LoginStep value="3" label="Войдите в магазин" description="Используйте email и пароль для следующих входов." />
            </ol>
          </section>
          <div className="login-help">
            <span className="login-help-icon" aria-hidden="true">?</span>
            <div><strong>Нужна помощь?</strong><br /><a href="mailto:s.xamrayeva@uzum.com">Свяжитесь с нами</a></div>
          </div>
        </div>

        <section className="login-card">
          <div className="login-card-top">
            <div>
              <h2 className="login-card-title">{mode === 'reset' ? 'Восстановление пароля' : 'Вход в Uzum Merch Shop'}</h2>
              <p className="login-card-text">
                {mode === 'reset' ? 'Отправим на вашу почту ссылку для создания нового пароля.' : 'Войдите в аккаунт или зарегистрируйтесь через корпоративную почту.'}
              </p>
            </div>
          </div>

          <div className="login-mode-tabs" aria-label="Вход и регистрация">
            <button
              type="button"
              className={`login-mode-tab${mode === 'password' ? ' is-active' : ''}`}
              onClick={() => switchMode('password')}
              aria-pressed={mode === 'password'}
              disabled={isSubmitting}
            >
              Войти
            </button>
            <button
              type="button"
              className={`login-mode-tab${mode === 'email' ? ' is-active' : ''}`}
              onClick={() => switchMode('email')}
              aria-pressed={mode === 'email'}
              disabled={isSubmitting}
            >
              Зарегистрироваться
            </button>
          </div>

          {sentEmail ? (
            <section className="login-success">
              <div className="login-success-icon">✓</div>
              <h3 className="login-success-title">Письмо отправлено</h3>
              <p className="login-success-text">
                {mode === 'reset' ? 'Ссылка для восстановления пароля отправлена на адрес:' : 'Ссылка для подтверждения почты отправлена на адрес:'}
              </p>
              <div className="login-email-box">{sentEmail}</div>
              <p className="login-success-hint">
                Откройте письмо в том же браузере и перейдите по ссылке, чтобы создать пароль. Если письма нет, проверьте папку «Спам».
              </p>
              <button
                type="button"
                onClick={() => { setSentEmail(null); setError(null) }}
                className="login-btn-secondary"
              >
                Отправить ещё раз
              </button>
            </section>
          ) : mode === 'password' ? (
            <form onSubmit={handlePasswordSubmit} className="login-form">
              <label className="login-label">
                Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@uzum.com"
                  autoComplete="email"
                  className="login-input"
                />
              </label>

              <label className="login-label">
                Пароль
                <span className="login-password-field"><input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Введите пароль"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  className="login-input"
                /><button type="button" className="login-password-toggle" aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
                </button></span>
              </label>

              {error && <div className="login-error">{error}</div>}

              <button
                type="submit"
                disabled={isSubmitting}
                className="login-btn-primary"
              >
                {isSubmitting ? 'Входим...' : 'Войти'}
              </button>

              <button
                type="button"
                onClick={() => switchMode('reset')}
                disabled={isSubmitting}
                className="login-text-button"
              >
                Забыли пароль?
              </button>
            </form>
          ) : (
            <form onSubmit={handleEmailSubmit} className="login-form">
              <label className="login-label">
                Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@uzum.com"
                  autoComplete="email"
                  className="login-input"
                />
              </label>

              {error && <div className="login-error">{error}</div>}

              <button
                type="submit"
                disabled={isSubmitting}
                className="login-btn-primary"
              >
                {isSubmitting ? 'Отправляем...' : mode === 'reset' ? 'Отправить ссылку' : 'Зарегистрироваться'}
              </button>
            </form>
          )}

          <div className="login-footer-note">
            Пароль создаётся только после подтверждения доступа к корпоративной почте.
          </div>
        </section>
      </section>
    </main>
  )
}

function LoginStep({ value, label, description }: { value: string; label: string; description: string }) {
  return (
    <li className="login-step">
      <b aria-hidden="true">{value}</b>
      <div><strong>{label}</strong><p>{description}</p></div>
    </li>
  )
}

function getEmailRedirectTo() {
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : undefined
  const configuredOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL)

  if (configuredOrigin && (!isLocalOrigin(configuredOrigin) || isLocalOrigin(currentOrigin))) {
    return `${configuredOrigin}/auth/hash-callback`
  }

  if (currentOrigin) {
    return `${currentOrigin}/auth/hash-callback`
  }

  return '/auth/hash-callback'
}

function normalizeOrigin(value: string | undefined) {
  if (!value) {
    return null
  }

  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function isLocalOrigin(value: string | null | undefined) {
  if (!value) {
    return false
  }

  try {
    const hostname = new URL(value).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

function getUrlErrorMessage(error: string, description: string | null) {
  if (description?.includes('expired')) {
    return 'Ссылка для входа недействительна или истекла. Запросите новую ссылку.'
  }

  if (error === 'auth_failed') {
    return 'Не удалось выполнить вход. Попробуйте запросить новую ссылку.'
  }

  return description || 'Не удалось выполнить вход. Попробуйте ещё раз.'
}
