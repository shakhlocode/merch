'use client'
export type InvitationChoiceValue = 'none' | 'email' | 'code'
export default function InvitationChoice({
  value,
  onChange,
  scope = 'catalog',
  onScope,
}: {
  scope?: 'catalog' | 'welcome'
  onScope?: (scope: 'catalog' | 'welcome') => void
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
      {value !== 'none' && onScope && (
        <label className="ae-field">
          Раздел приглашения
          <select
            aria-label="Раздел приглашения"
            className="ae-input"
            value={scope}
            onChange={(e) => onScope(e.target.value as 'catalog' | 'welcome')}
          >
            <option value="catalog">Каталог — доступ к раздаче</option>
            <option value="welcome">Только Welcome pack — для новичка</option>
          </select>
        </label>
      )}
      <p className="ae-field-note">
        Приглашение даёт доступ на один заказ. Личная ссылка активируется один
        раз, действует до 7 дней и требует идентификатор сотрудника. Передавайте
        её лично. Новое приглашение заменяет прежний доступ к разделу. Для
        Welcome pack выберите его в разделе приглашения.
      </p>
    </div>
  )
}
