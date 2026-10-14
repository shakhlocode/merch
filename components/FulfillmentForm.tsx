'use client'
import {
  type PickupDetails,
  type PickupOffice,
  tashkentToday,
} from '@/lib/fulfillment'
export default function FulfillmentForm({
  value,
  onChange,
  offices,
  identity,
  disabled,
}: {
  value: PickupDetails
  onChange: (value: PickupDetails) => void
  offices: PickupOffice[]
  identity: { full_name: string | null; legal_entity: string | null }
  disabled: boolean
}) {
  const update = (key: keyof PickupDetails, v: string) =>
    onChange({ ...value, [key]: v })
  return (
    <fieldset className="pickup-form" disabled={disabled}>
      <label className="form-label">
        Формат работы и получения
        <select
          className="form-input"
          value={
            value.mode === 'office'
              ? value.officeId
                ? 'office:' + value.officeId
                : ''
              : value.mode
          }
          onChange={(e) => {
            const v = e.target.value
            if (v.startsWith('office:'))
              onChange({ ...value, mode: 'office', officeId: v.slice(7) })
            else
              onChange({
                ...value,
                mode: v as PickupDetails['mode'],
                officeId: '',
              })
          }}
        >
          <option value="" disabled>
            Выберите формат работы
          </option>
          <optgroup label="Работаю в офисе">
            {offices.map((o) => (
              <option key={o.id} value={'office:' + o.id}>
                В офисе — {o.name}
              </option>
            ))}
          </optgroup>
          <option value="remote_shipping">Удалённо — отправка</option>
          <option value="remote_visit">Удалённо — заберу в Ташкенте</option>
        </select>
      </label>
      <p className="pickup-address">
        {value.mode === 'remote_shipping'
          ? 'Работаю удалённо. Отправьте мерч в мою страну.'
          : value.mode === 'remote_visit'
            ? 'Работаю удалённо, но смогу забрать мерч во время визита в Ташкент.'
            : value.officeId
              ? `Работаю в офисе: ${offices.find((o) => o.id === value.officeId)?.name || ''}`
              : 'Выберите свой офис или вариант для удалённого сотрудника.'}
      </p>
      {value.mode === 'office' && (
        <div className="pickup-identity">
          <p>
            <b>ФИО</b>
            <br />
            {identity.full_name || 'Не заполнено в реестре'}
          </p>
          <p>
            <b>Юридическое лицо</b>
            <br />
            {identity.legal_entity || 'Не указано в реестре'}
          </p>
        </div>
      )}
      {value.mode === 'remote_visit' && (
        <>
          <label className="form-label">
            Дата приезда в Ташкент
            <input
              required
              type="date"
              className="form-input"
              value={value.visitFrom}
              onChange={(e) => update('visitFrom', e.target.value)}
            />
          </label>
          <label className="form-label">
            Дата отъезда из Ташкента
            <input
              required
              type="date"
              className="form-input"
              min={value.visitFrom || tashkentToday()}
              value={value.visitUntil}
              onChange={(e) => update('visitUntil', e.target.value)}
            />
          </label>
          <label className="form-label">
            В каком офисе заберёте
            <select
              required
              className="form-input"
              value={value.officeId}
              onChange={(e) => update('officeId', e.target.value)}
            >
              <option value="" disabled>
                Выберите офис
              </option>
              {offices.map((o) => (
                <option value={o.id} key={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {value.mode !== 'remote_shipping' && value.officeId && (
        <p className="pickup-address">
          {offices.find((o) => o.id === value.officeId)?.address ||
            'Адрес офиса уточняется.'}
        </p>
      )}
      {value.mode === 'remote_shipping' && (
        <>
          <label className="form-label">
            Страна
            <input
              required
              maxLength={120}
              className="form-input"
              value={value.country}
              onChange={(e) => update('country', e.target.value)}
            />
          </label>
          <label className="form-label">
            Город
            <input
              required
              maxLength={120}
              className="form-input"
              value={value.city}
              onChange={(e) => update('city', e.target.value)}
            />
          </label>
        </>
      )}
      <label className="form-label">
        Телефон
        <input
          required
          type="tel"
          maxLength={40}
          className="form-input"
          placeholder="+998…"
          value={value.phone}
          onChange={(e) => update('phone', e.target.value)}
        />
      </label>
      {value.mode !== 'office' && (
        <label className="form-label">
          Комментарий · необязательно
          <textarea
            maxLength={2000}
            className="form-textarea"
            value={value.comment}
            onChange={(e) => update('comment', e.target.value)}
          />
        </label>
      )}
    </fieldset>
  )
}
