'use client'
import Image from 'next/image'
import {usePathname} from 'next/navigation'
import { useEffect, useState } from 'react'
export default function InvitePage() {
  const isWelcome=usePathname().startsWith('/welcome/')
  const [token, setToken] = useState(''),
    [identifier, setIdentifier] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    setToken(window.location.hash.slice(1))
  }, [])
  return (
    <main className="login-page">
      <section className="login-shell login-shell-single">
        <div className="login-card">
          <Image
            src="/brand/uzum-big-logo.webp"
            width="56"
            height="56"
            alt="Uzum"
          />
          <h1 className="login-card-title">
            {isWelcome?'Ваш Welcome pack':'Добро пожаловать в Uzum Merch Shop'}
          </h1>
          <p>
            Введите свой идентификатор. Приглашение можно активировать только
            один раз, затем оформите один заказ в этом браузере.
          </p>
          <form
            className="login-form"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              setError('')
              try {
                const r = await fetch('/api/invitations/redeem', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token, identifier }),
                })
                const d = await r.json()
                if (!r.ok) throw new Error(d.error)
                window.location.replace(d.next==='/welcome'?'/welcome':'/catalog')
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Ошибка входа')
              } finally {
                setBusy(false)
              }
            }}
          >
            <label className="login-label">
              Ваш идентификатор
              <input
                required
                className="login-input"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="off"
                maxLength={128}
              />
            </label>
            {error && (
              <p role="alert" className="login-error">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="login-btn-primary"
              disabled={busy || !token}
            >
              {busy ? 'Открываем…' : 'Войти и выбрать мерч'}
            </button>
          </form>
          <p className="login-footer-note">
            Не передавайте ссылку и идентификатор другим людям. После активации
            сохраните этот браузер: при его потере обратитесь к администратору
            за новым приглашением.
          </p>
          <a href="/catalog">Уже активировали? Открыть магазин</a>
          <p>
            <a href="mailto:s.xamrayeva@uzum.com">Связаться с нами</a>
          </p>
        </div>
      </section>
    </main>
  )
}
