'use client'

import { unitFetch } from '@/lib/shop-context'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type SetPasswordClientProps = {
  email: string
  mode: 'create' | 'reset'
}

export default function SetPasswordClient({ email, mode }: SetPasswordClientProps) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (password.length < 8) {
      setError('Пароль должен быть не короче 8 символов')
      return
    }

    if (password !== confirm) {
      setError('Пароли не совпадают')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const response = await unitFetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const result = await response.json()

      if (!response.ok) {
        setError(result.error || 'Не удалось сохранить пароль')
        return
      }

      window.location.replace('/catalog')
      router.refresh()
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'Неизвестная ошибка'
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-shell login-shell-single">
        <section className="login-card">
          <div className="login-card-top">
            <div className="login-card-icon">#</div>
            <div>
              <h1 className="login-card-title">
                {mode === 'reset' ? 'Обновите пароль' : 'Создайте пароль'}
              </h1>
              <p className="login-card-text">
                {mode === 'reset'
                  ? `Вы вошли через письмо. Задайте новый пароль для ${email}.`
                  : `Первый вход выполнен через письмо. Теперь задайте пароль для ${email}, чтобы в следующий раз входить быстрее.`}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            <label className="login-label">
              Пароль
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                autoComplete="new-password"
                className="login-input"
              />
            </label>

            <label className="login-label">
              Повторите пароль
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                minLength={8}
                autoComplete="new-password"
                className="login-input"
              />
            </label>

            {error && <div className="login-error">{error}</div>}

            <button
              type="submit"
              disabled={isSaving}
              className="login-btn-primary"
            >
              {isSaving ? 'Сохраняем...' : 'Сохранить пароль'}
            </button>
          </form>

          <div className="login-footer-note">
            Пароль хранится в Supabase Auth, приложение его не сохраняет.
          </div>
        </section>
      </section>
    </main>
  )
}
