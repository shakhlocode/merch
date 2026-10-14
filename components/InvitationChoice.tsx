'use client'
export type InvitationChoiceValue = 'none' | 'email' | 'code'
export default function InvitationChoice({
  value,
  onChange,
}: {
  value: InvitationChoiceValue
  onChange: (value: InvitationChoiceValue) => void
}) {
  return (
    <div className="ae-access-fields">
      <label className="ae-field">
        Приглашение
        <select
          aria-label="Приглашение"
          className="ae-input"
          value={value}
          onChange={(e) => onChange(e.target.value as InvitationChoiceValue)}
        >
          <option value="none">Не отправлять</option>
          <option value="email">Отправить ссылку на почту</option>
          <option value="code">Личная ссылка + идентификатор</option>
        </select>
      </label>
      <p className="ae-field-note">
        Приглашение даёт доступ на один заказ. Личная ссылка активируется один
        раз, действует до 7 дней и требует идентификатор сотрудника. Передавайте
        её лично.
      </p>
    </div>
  )
}
