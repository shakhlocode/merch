'use client'
import InvitationChoice, { type InvitationChoiceValue } from '@/components/InvitationChoice'
import InvitationResults from '@/components/InvitationResults'
import type { InvitationResult } from '@/lib/invitations'
import { buildInvitationBatches } from '@/lib/invitation-batches'
import EmployeeAccessFields from '@/components/EmployeeAccessFields'
import type { AccessMode } from '@/lib/employee-access'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseEmployeeCsv, validateEmployeeRows, type ImportEmployee } from '@/lib/employee-import'

export default function EmployeeImport() {
  const router = useRouter()
  const [invitation, setInvitation] = useState<InvitationChoiceValue>('none')
  const [inviteResults, setInviteResults] = useState<InvitationResult[]>([])
  const [mode, setMode] = useState<AccessMode>('unlimited')
  const [until, setUntil] = useState('')
  const [rows, setRows] = useState<ImportEmployee[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [submitError, setSubmitError] = useState('')
  return <section className="ae-editor ae-editor-create">
    <h2 className="ae-editor-title">Загрузка сотрудников из таблицы</h2>
    <p>Первый лист Excel (.xlsx) или CSV, до 5 МБ и 2000 сотрудников. Колонки: Email, ФИО, Идентификатор (необязательно). Идентификаторы с ведущими нулями храните как текст.</p>
    <a href="/templates/employees.csv" download className="login-text-button">Скачать шаблон CSV для Excel</a>
    <p>Существующие email будут пропущены. Для личных ссылок без почты также пропускаются существующие идентификаторы. С приглашением доступ откроется после его активации.</p>
    <p>Тип доступа ниже будет назначен всем новым сотрудникам из файла.</p>
    <InvitationChoice value={invitation} onChange={value => { setInvitation(value); setRows([]); setErrors([]) }} />
    <EmployeeAccessFields mode={mode} until={until} onMode={setMode} onUntil={setUntil} />
    <label className="ae-field">Выберите таблицу<input type="file" accept=".xlsx,.csv" disabled={busy} onChange={async event => {
      const file = event.target.files?.[0]; setRows([]); setErrors([]); setMessage(''); setSubmitError('')
      if (!file) return
      setBusy(true)
      try {
        if (file.size > 5*1024*1024) throw new Error('Файл должен быть не больше 5 МБ')
        let raw: unknown[][]
        if (file.name.toLowerCase().endsWith('.xlsx')) {
          const { readSheet } = await import('read-excel-file/browser')
          raw = await readSheet(file, 1)
        } else if (file.name.toLowerCase().endsWith('.csv')) raw = parseEmployeeCsv(await file.text())
        else throw new Error('Выберите файл .xlsx или .csv')
        const result = validateEmployeeRows(raw, invitation === 'code'); setRows(result.rows); setErrors(result.errors)
      } catch (e) { setErrors([e instanceof Error ? e.message : 'Не удалось прочитать файл']) } finally { setBusy(false) }
    }} /></label>
    {errors.length > 0 && <div role="alert" className="ae-error">{errors.slice(0,20).map((error,i) => <p key={i}>{error}</p>)}{errors.length>20 && <p>И ещё {errors.length-20} ошибок.</p>}</div>}
    {rows.length>0 && !errors.length && <div><p>Проверено строк: {rows.length}. Первые 5:</p><ul>{rows.slice(0,5).map(row => <li key={row.email || row.external_id}>{row.full_name} · {row.email} · {row.external_id || 'Без идентификатора'}</li>)}</ul></div>}
    <button type="button" className="ae-save-btn" disabled={busy || !rows.length || !!errors.length} onClick={async () => {
      setBusy(true); setMessage(''); setSubmitError('')
      try {
        const response = await fetch('/api/admin/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import_employees', rows, access_mode: mode, access_until: until, invitation }) })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Не удалось загрузить сотрудников')
        if (invitation !== 'none' && result.employee_ids?.length) setInviteResults(await buildInvitationBatches(result.employee_ids, invitation))
        setMessage(`Добавлено: ${result.added}. Уже были в реестре: ${result.skipped}.`); setRows([]); router.refresh()
      } catch (e) { setSubmitError(e instanceof Error ? e.message : 'Ошибка загрузки') } finally { setBusy(false) }
    }}>{busy ? 'Обрабатываем…' : 'Добавить сотрудников'}</button>
    <InvitationResults items={inviteResults} />
    {submitError && <p role="alert" className="ae-error">{submitError}</p>}
    {message && <p role="status">{message}</p>}
  </section>
}
