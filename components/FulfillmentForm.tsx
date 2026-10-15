'use client'
import {
  type PickupDetails,
  type PickupOffice,
  type FulfillmentChoice,
  tashkentToday,
} from '@/lib/fulfillment'
export default function FulfillmentForm({
  value,
  onChange,
  offices,
  choices = [],
  identity,
  disabled,
  officeOnly = false,
}: {
  value: PickupDetails
  onChange: (value: PickupDetails) => void
  offices: PickupOffice[]
  choices?: FulfillmentChoice[]
  identity: { full_name: string | null; legal_entity: string | null }
  disabled: boolean
  officeOnly?: boolean
}) {
  const update = (key: keyof PickupDetails, v: string) =>
    onChange({ ...value, [key]: v })
  return (
    <fieldset className="pickup-form" disabled={disabled}>
      {officeOnly ? (
        <>
          <label className="form-label">
            Офис получения
            <select
              aria-label="Офис получения"
              required
              className="form-input"
              value={value.officeId}
              onChange={(e) =>
                offices.some((o) => o.id === e.target.value && o.is_active) &&
                onChange({ ...value, mode: 'office', officeId: e.target.value })
              }
            >
              <option value="" disabled>
                Выберите офис
              </option>
              {offices.map((o) => (
                <option key={o.id} value={o.id} disabled={!o.is_active}>
                  {o.name}
                  {!o.is_active ? ' — недоступно' : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="pickup-address">
            Welcome pack можно получить только лично в офисе.
          </p>
        </>
      ) : (
        <>
          <label className="form-label">
            Формат работы и получения
            <select
              aria-label="Формат работы и получения"
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
                if (
                  v.startsWith('office:') &&
                  offices.some((o) => o.id === v.slice(7) && o.is_active)
                )
                  onChange({ ...value, mode: 'office', officeId: v.slice(7) })
                else if (
                  choices.some(
                    (c) =>
                      c.mode === v && c.is_active && c.mode !== 'placeholder'
                  )
                )
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
                  <option
                    key={o.id}
                    value={'office:' + o.id}
                    disabled={!o.is_active}
                  >
                    В офисе — {o.name}
                    {!o.is_active ? ' — недоступно' : ''}
                  </option>
                ))}
              </optgroup>
              {choices.map((c) => (
                <option
                  key={c.id}
                  value={
                    c.mode === 'placeholder' ? 'unavailable:' + c.id : c.mode
                  }
                  disabled={!c.is_active || c.mode === 'placeholder'}
                >
                  {c.name}
                  {!c.is_active ? ' — недоступно' : ''}
                </option>
              ))}
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
        </>
      )}
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
                <option value={o.id} key={o.id} disabled={!o.is_active}>
                  {o.name}
                  {!o.is_active ? ' — недоступно' : ''}
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
