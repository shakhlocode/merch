'use client'

import { unitFetch } from '@/lib/shop-context'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { orderAction, type VisitReminder } from '@/lib/order-attention'
import { tashkentToday } from '@/lib/fulfillment'
export default function OrderNextAction({
  orderId,
  status,
  remote,
  task,
}: {
  orderId: string
  status: string
  remote: boolean
  task?: VisitReminder
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    router = useRouter(),
    today = tashkentToday()
  if (['received', 'cancelled', 'rejected'].includes(status)) return null
  const action = orderAction({ status, is_remote: remote }, task, today)
  return (
    <section className="order-next-action">
      <h3>Следующее действие</h3>
      <b>{action.label}</b>
      <p>
        Товары уже зарезервированы при оформлении заказа. {remote?'После упаковки отметьте «Отправка», когда передадите мерч в доставку.':'После подготовки отметьте «Можно забирать».'}
      </p>
      {task && (
        <>
          <p>
            Визит: {task.due_on} — {task.reserve_until}. Если планы изменились,
            свяжитесь с сотрудником; отмена заказа освобождает резерв.
          </p>
          {task.contacted_at ? (
            <p>
              Связались:{' '}
              {new Date(task.contacted_at).toLocaleString('ru-RU', {
                timeZone: 'Asia/Tashkent',
              })}
            </p>
          ) : (
            task.due_on <= today && (
              <button
                className="ao-save-btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setError('')
                  try {
                    const r = await unitFetch('/api/admin/tasks', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          id: task.id,
                          order_id: orderId,
                        }),
                      }),
                      d = await r.json()
                    if (!r.ok) throw new Error(d.error)
                    router.refresh()
                  } catch (e) {
                    setError((e as Error).message)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Отметить «Связались»
              </button>
            )
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
