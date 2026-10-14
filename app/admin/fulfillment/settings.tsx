'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PickupOffice } from '@/lib/fulfillment'
export default function FulfillmentSettings({
  offices,
  message,
}: {
  offices: PickupOffice[]
  message: string
}) {
  const [text, setText] = useState(message),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    router = useRouter()
  async function save(body: unknown) {
    setBusy(true)
    setNote('')
    try {
      const r = await fetch('/api/admin/fulfillment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setNote('Сохранено')
      router.refresh()
      return true
    } catch (e) {
      setNote((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="pickup-settings">
      <section className="dash-card">
        <h2>Сообщение после оформления</h2>
        <p>
          Показывается вместе со штрихкодом при получении в офисе, в том числе
          приезжающим в Ташкент. Можно указать дату, время и место или попросить
          следить за внутрикомом.
        </p>
        <label className="form-label">
          Текст для сотрудников
          <textarea
            className="form-textarea"
            maxLength={4000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <button
          className="ae-save-btn"
          disabled={busy}
          onClick={() => save({ action: 'message', message: text })}
        >
          Сохранить сообщение
        </button>
      </section>
      <h2>Офисы получения</h2>
      <p>
        Отключённый офис нельзя выбрать для нового заказа. В старых заказах
        останется прежнее название и адрес.
      </p>
      {offices.map((o) => (
        <OfficeEditor
          key={o.id + o.name + o.address + o.is_active}
          office={o}
          save={save}
          busy={busy}
        />
      ))}
      <OfficeEditor save={save} busy={busy} />
      {note && <p role="status">{note}</p>}
    </section>
  )
}
function OfficeEditor({
  office,
  save,
  busy,
}: {
  office?: PickupOffice
  save: (b: unknown) => Promise<boolean>
  busy: boolean
}) {
  const [name, setName] = useState(office?.name || ''),
    [address, setAddress] = useState(office?.address || ''),
    [active, setActive] = useState(office?.is_active ?? true)
  return (
    <form
      className="dash-card pickup-office-editor"
      onSubmit={async (e) => {
        e.preventDefault()
        if (
          (await save({
            action: 'office',
            id: office?.id,
            name,
            address,
            is_active: active,
          })) &&
          !office
        ) {
          setName('')
          setAddress('')
        }
      }}
    >
      <h3>{office ? 'Редактировать офис' : 'Новый офис'}</h3>
      <label className="form-label">
        Название офиса
        <input
          required
          maxLength={120}
          className="form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="form-label">
        Адрес офиса
        <input
          maxLength={1000}
          className="form-input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </label>
      <label className="form-check">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Доступен для получения
      </label>
      <button className="ae-save-btn" disabled={busy} type="submit">
        {office ? 'Сохранить офис' : 'Добавить офис'}
      </button>
    </form>
  )
}
