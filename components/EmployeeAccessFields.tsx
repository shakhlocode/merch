'use client'
import type { AccessMode } from '@/lib/employee-access'
export default function EmployeeAccessFields({ mode, until, onMode, onUntil }: { mode: AccessMode; until: string; onMode: (mode: AccessMode) => void; onUntil: (date: string) => void }) {
 return <div className="ae-access-fields">
  <label className="ae-field">Доступ в систему<select aria-label="Доступ в систему" className="ae-input" value={mode} onChange={e => onMode(e.target.value as AccessMode)}><option value="unlimited">Бессрочный</option><option value="until_date">До выбранной даты</option><option value="one_order">До получения одного заказа</option></select></label>
  {mode === 'until_date' && <label className="ae-field">Последний день доступа<input type="date" className="ae-input" value={until} onChange={e => onUntil(e.target.value)} /><span className="ae-field-note">Включительно, по времени Ташкента.</span></label>}
  {mode === 'one_order' && <p className="ae-field-note">Можно оформить один заказ. После отметки «Получен» доступ закроется автоматически. Отменённый заказ не расходует доступ.</p>}
 </div>
}
