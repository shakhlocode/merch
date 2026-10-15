'use client'

import { unitFetch } from '@/lib/shop-context'
import { useState } from 'react'
export default function InvitationQueue() {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [emailEnabled, setEmailEnabled] = useState(false),
    [rows, setRows] = useState<
      {
        id: string
        channel: string
        delivery_status: string
        claimed_at: string | null
        revoked_at: string | null
      }[]
    >([])
  async function refresh() {
    const r = await unitFetch('/api/admin/invitations', { cache: 'no-store' }),
      d = await r.json()
    if (!r.ok) throw new Error(d.error)
    setRows(d.invitations)
    setEmailEnabled(d.email_enabled)
  }
  return (
    <section className="ae-editor ae-editor-create">
      <button
        type="button"
        className="ae-export-btn"
        onClick={async () => {
          setOpen(!open)
          if (!open) {
            try {
              await refresh()
            } catch (e) {
              setMessage((e as Error).message)
            }
          }
        }}
      >
        Приглашения и отправка писем
      </button>
      {open && (
        <>
          <p>
            {emailEnabled
              ? 'Отправка через корпоративную почту подключена.'
              : 'Корпоративный SMTP ещё не подключён. Письма остаются в очереди; личные ссылки с идентификатором работают без почты.'}
          </p>
          <div className="ae-editor-actions">
            <button
              type="button"
              className="ae-save-btn"
              disabled={busy || !emailEnabled}
              onClick={async () => {
                setBusy(true)
                let sent = 0,
                  failed = 0
                try {
                  for (let i = 0; i < 400; i++) {
                    const r = await unitFetch('/api/admin/invitations', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'deliver' }),
                      }),
                      d = await r.json()
                    if (!r.ok) throw new Error(d.error)
                    sent += d.sent
                    failed += d.failed
                    setMessage(
                      `Принято почтовым сервисом: ${sent}. Ошибок: ${failed}.`
                    )
                    if (!d.processed) break
                  }
                  await refresh()
                } catch (e) {
                  setMessage((e as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Отправляем…' : 'Отправить очередь'}
            </button>
            <button
              type="button"
              className="ae-export-btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const r = await unitFetch('/api/admin/invitations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'retry_failed' }),
                  })
                  if (!r.ok)
                    throw new Error('Не удалось подготовить повторную отправку')
                  await refresh()
                  setMessage('Неотправленные приглашения возвращены в очередь.')
                } catch (e) {
                  setMessage((e as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              Повторить неотправленные
            </button>
          </div>
          <p>
            Последние приглашения: {rows.length}. Отправлено:{' '}
            {rows.filter((i) => i.delivery_status === 'sent').length}. Ошибок:{' '}
            {rows.filter((i) => i.delivery_status === 'failed').length}.
            Активировано: {rows.filter((i) => i.claimed_at).length}.
          </p>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  )
}
