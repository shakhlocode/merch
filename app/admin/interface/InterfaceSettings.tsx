'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PickupOffice } from '@/lib/fulfillment'
import { contentLabels, type StoreContent } from '@/lib/store-content'
export default function InterfaceSettings({
  offices,
  content,
}: {
  offices: PickupOffice[]
  content: StoreContent
}) {
  const [tab, setTab] = useState<'rules' | 'messages' | 'offices'>('rules'),
    [texts, setTexts] = useState(content),
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
  const keys = (Object.keys(contentLabels) as (keyof StoreContent)[]).filter(
    (k) => (tab === 'rules' ? k.endsWith('_rules') : k.endsWith('_message') && !['welcome_shipping_message','welcome_visit_message'].includes(k))
  )
  return (
    <section className="pickup-settings">
      <div
        className="settings-tabs"
        role="group"
        aria-label="Настройки интерфейса"
      >
        {(
          [
            ['rules', 'Правила'],
            ['messages', 'Сообщения после заказа'],
            ['offices', 'Офисы'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="ae-export-btn"
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key)
              setNote('')
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'rules' && (
        <p>
          Каждая строка — отдельное правило. Формулировки можно менять; система
          по-прежнему разрешает до 3 разных товаров, по 1 штуке каждого.
        </p>
      )}
      {tab === 'messages' && (
        <p>
          Основной текст подтверждения для каждого раздела и способа получения.
          Он показывается после оформления и в «Моих заказах».
        </p>
      )}
      {tab !== 'offices' &&
        keys.map((key) => (
          <section className="dash-card" key={key}>
            <label className="form-label">
              {contentLabels[key]}
              <textarea
                aria-label={contentLabels[key]} className="form-textarea"
                value={texts[key]}
                maxLength={4000}
                onChange={(e) => setTexts({ ...texts, [key]: e.target.value })}
              />
            </label>
            <button
              className="ae-save-btn"
              type="button"
              disabled={busy}
              onClick={() => save({ action: 'text', key, text: texts[key] })}
            >
              Сохранить: {contentLabels[key]}
            </button>
          </section>
        ))}
      {tab === 'offices' && (
        <>
          <p>
            Названия и адреса офисов в форме получения. Отключённые офисы нельзя
            выбрать для нового заказа; история сохраняет прежние данные.
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
        </>
      )}
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
