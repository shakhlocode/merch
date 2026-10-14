'use client'
import { useState } from 'react'
import type { InvitationResult } from '@/lib/invitations'
import { toCsv } from '@/lib/utils'
export default function InvitationResults({
  items,
}: {
  items: InvitationResult[]
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  if (!items.length) return null
  return (
    <section className="ae-editor ae-editor-create">
      <h3>Приглашения</h3>
      <p>
        Ссылки для входа по идентификатору показываются только сейчас. Сохраните
        их перед уходом со страницы. Новое приглашение отменяет прежнюю ссылку.
      </p>
      {items.some((i) => i.url) && (
        <button
          type="button"
          className="ae-export-btn"
          onClick={() => {
            const csv = toCsv(
              items
                .filter((i) => i.url)
                .map((i) => ({
                  full_name: i.full_name || '',
                  identifier: i.external_id || '',
          store_scope:i.store_scope||'catalog',
                  link: i.url!,
                  expires_at: i.expires_at || '',
                }))
            )
            const url = URL.createObjectURL(
                new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
              ),
              a = document.createElement('a')
            a.href = url
            a.download = 'merch-personal-invitations.csv'
            a.click()
            URL.revokeObjectURL(url)
          }}
        >
          Скачать личные ссылки CSV
        </button>
      )}
      <ul className="invite-results">
        {items.map((item, index) => (
          <li key={item.id || index}>
            <strong>{item.full_name || item.employee_id}</strong><span> · {item.store_scope==='welcome'?'Welcome pack':'Каталог'}</span>
            {item.error ? (
              <p role="alert">{item.error}</p>
            ) : item.url ? (
              <div>
                <span>Идентификатор: {item.external_id}</span>
                <input
                  aria-label={`Личная ссылка ${item.full_name}`}
                  readOnly
                  value={item.url}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  className="ae-export-btn"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(item.url!)
                      setMessage('Ссылка скопирована. Отправьте её этому сотруднику.')
                    } catch {
                      setMessage('Не удалось скопировать автоматически. Выделите ссылку и скопируйте вручную.')
                    }
                  }}
                >
                  Скопировать ссылку
                </button>
              </div>
            ) : (
              <p>Приглашение в очереди отправки на почту.</p>
            )}
          </li>
        ))}
      </ul>
      {items.some((i) => i.channel === 'email' && !i.error) && (
        <button
          type="button"
          className="ae-save-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setMessage('')
            let sent = 0,
              failed = 0
            try {
              for (let i = 0; i < 400; i++) {
                const r = await fetch('/api/admin/invitations', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'deliver' }),
                })
                const d = await r.json()
                if (!r.ok) throw new Error(d.error)
                sent += d.sent
                failed += d.failed
                setMessage(
                  `Принято почтовым сервисом: ${sent}. Ошибок: ${failed}.`
                )
                if (!d.processed) break
              }
            } catch (e) {
              setMessage(e instanceof Error ? e.message : 'Ошибка отправки')
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Отправляем…' : 'Отправить приглашения из очереди'}
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  )
}
