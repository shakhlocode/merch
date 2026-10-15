'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PickupOffice, FulfillmentChoice } from '@/lib/fulfillment'
import { contentLabels, type StoreContent } from '@/lib/store-content'
export default function InterfaceSettings({
  offices,
  choices,
  content,
}: {
  offices: PickupOffice[]
  choices: FulfillmentChoice[]
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
    (k) =>
      tab === 'rules'
        ? k.endsWith('_rules')
        : k.endsWith('_message') &&
          !['welcome_shipping_message', 'welcome_visit_message'].includes(k)
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
            ['offices', 'Офисы и получение'],
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
                aria-label={contentLabels[key]}
                className="form-textarea"
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
          <h2>Офисы</h2>
          <p>
            Добавляйте и редактируйте офисы. Неактивный офис виден сотрудникам
            серым, выбрать его нельзя. Удалённый исчезает из выбора; старые
            заказы сохраняют адрес и название.
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
          <h2>Другие варианты получения</h2>
          <p>
            Здесь можно менять названия, отключать и удалять варианты, а также
            добавлять новые. Неактивные варианты показываются серыми. В Welcome
            pack отображаются только офисы.
          </p>
          {choices.map((c) => (
            <ChoiceEditor
              key={c.id + c.name + c.mode + c.is_active}
              choice={c}
              save={save}
              busy={busy}
            />
          ))}
          <ChoiceEditor save={save} busy={busy} />
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
        Активен — можно выбрать. Если выключить, будет виден серым.
      </label>
      <div className="pickup-option-actions">
        <button className="ae-save-btn" disabled={busy} type="submit">
          {office ? 'Сохранить офис' : 'Добавить офис'}
        </button>
        {office && (
          <DeleteChoice
            label={office.name}
            busy={busy}
            remove={() => save({ action: 'office_delete', id: office.id })}
          />
        )}
      </div>
    </form>
  )
}

function ChoiceEditor({
  choice,
  save,
  busy,
}: {
  choice?: FulfillmentChoice
  save: (body: unknown) => Promise<boolean>
  busy: boolean
}) {
  const [name, setName] = useState(choice?.name || '')
  const [mode, setMode] = useState<FulfillmentChoice['mode']>(
    choice?.mode || 'placeholder'
  )
  const [active, setActive] = useState(choice?.is_active ?? false)
  return (
    <form
      className="dash-card pickup-office-editor"
      onSubmit={async (e) => {
        e.preventDefault()
        if (
          (await save({
            action: 'choice',
            id: choice?.id,
            name,
            mode,
            is_active: active,
          })) &&
          !choice
        ) {
          setName('')
          setMode('placeholder')
          setActive(false)
        }
      }}
    >
      <h3>{choice ? 'Вариант получения' : 'Новый вариант получения'}</h3>
      <label className="form-label">
        Название для сотрудника
        <input
          required
          maxLength={120}
          className="form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например: Курьером"
        />
      </label>
      <label className="form-label">
        Как работает этот вариант
        <select
          aria-label="Как работает этот вариант"
          className="form-input"
          disabled={!!choice}
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as FulfillmentChoice['mode'])
            setActive(false)
          }}
        >
          <option value="placeholder">
            Пока недоступен — показывать серым
          </option>
          <option value="remote_shipping">
            Удалённая отправка — страна, город и телефон
          </option>
          <option value="remote_visit">
            Визит в Ташкент — офис, даты и телефон
          </option>
        </select>
      </label>
      {mode === 'placeholder' ? (
        <p>
          Этот вариант нельзя выбрать при оформлении. Для включения ПВЗ, курьера
          или нового способа получения сначала нужен соответствующий процесс
          доставки.
        </p>
      ) : (
        <label className="form-check">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Активен — можно выбрать. Если выключить, будет виден серым.
        </label>
      )}
      <div className="pickup-option-actions">
        <button type="submit" className="ae-save-btn" disabled={busy}>
          {choice ? 'Сохранить вариант' : 'Добавить вариант'}
        </button>
        {choice && (
          <DeleteChoice
            label={choice.name}
            busy={busy}
            remove={() => save({ action: 'choice_delete', id: choice.id })}
          />
        )}
      </div>
    </form>
  )
}

function DeleteChoice({
  label,
  busy,
  remove,
}: {
  label: string
  busy: boolean
  remove: () => Promise<boolean>
}) {
  const [confirm, setConfirm] = useState(false)
  return confirm ? (
    <div className="pickup-delete-confirm">
      <p>Удалить «{label}» из вариантов получения? Старые заказы сохранятся.</p>
      <div className="pickup-option-actions">
        <button
          type="button"
          className="ae-cancel-btn"
          disabled={busy}
          onClick={async () => {
            if (await remove()) setConfirm(false)
          }}
        >
          Подтвердить удаление
        </button>
        <button
          type="button"
          className="ae-export-btn"
          disabled={busy}
          onClick={() => setConfirm(false)}
        >
          Отмена
        </button>
      </div>
    </div>
  ) : (
    <button
      type="button"
      className="ae-cancel-btn"
      aria-label={'Удалить ' + label}
      disabled={busy}
      onClick={() => setConfirm(true)}
    >
      Удалить из вариантов
    </button>
  )
}
