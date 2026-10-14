'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { tashkentToday } from '@/lib/fulfillment'
export type VisitTask = {
  id: string
  due_on: string
  reserve_until: string
  contacted_at: string | null
  orders: {
    id: string
    order_number: string
    status: string
    full_name: string | null
    phone: string | null
    pickup_office_name: string | null
    visit_from: string | null
    visit_until: string | null
  } | null
}
export default function Tasks({ tasks }: { tasks: VisitTask[] }) {
  const today = tashkentToday(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    router = useRouter()
  return (
    <section className="pickup-settings">
      <p>
        Товар уже зарезервирован при оформлении. В день приезда появится
        напоминание связаться с сотрудником. Выдавайте весь подготовленный заказ
        сканированием кода.
      </p>
      <p>
        После даты отъезда резерв автоматически не снимается: сначала свяжитесь
        с сотрудником, затем выдайте или отмените заказ. Выданные и отменённые
        задачи закрываются автоматически.
      </p>
      {error && <p role="alert">{error}</p>}
      {!tasks.length && <p>Открытых задач нет.</p>}
      {tasks.map((t) => {
        const o = t.orders
        return (
          <article className="dash-card" key={t.id}>
            <h2>
              {o?.full_name || 'Сотрудник'} · #{o?.order_number}
            </h2>
            <p>
              {t.reserve_until < today
                ? 'Срок визита истёк — проверьте резерв'
                : t.due_on <= today
                  ? 'Сотрудник уже в Ташкенте — свяжитесь с ним'
                  : 'Предстоящий визит'}
            </p>
            <p>
              Приезд: {t.due_on}. Отъезд: {t.reserve_until}. Офис:{' '}
              {o?.pickup_office_name}. Телефон: {o?.phone}.
            </p>
            {t.contacted_at ? (
              <p>
                Связались:{' '}
                {new Date(t.contacted_at).toLocaleString('ru-RU', {
                  timeZone: 'Asia/Tashkent',
                })}
              </p>
            ) : (
              <button
                className="ae-save-btn"
                disabled={!!busy || t.due_on > today}
                onClick={async () => {
                  setBusy(t.id)
                  setError('')
                  try {
                    const r = await fetch('/api/admin/tasks', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: t.id }),
                      }),
                      d = await r.json()
                    if (!r.ok) throw new Error(d.error)
                    router.refresh()
                  } catch (e) {
                    setError((e as Error).message)
                  } finally {
                    setBusy('')
                  }
                }}
              >
                Отметить «Связались»
              </button>
            )}{' '}
            <a
              className="ae-export-btn"
              href={
                '/admin/orders?q=' + encodeURIComponent(o?.order_number || '')
              }
            >
              Открыть заказ
            </a>
          </article>
        )
      })}
    </section>
  )
}
