'use client'

import { unitFetch } from '@/lib/shop-context'

import Link from '@/components/ShopLink'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import InvitationResults from '@/components/InvitationResults'
import type { InvitationResult } from '@/lib/invitations'

type Recipient = {
  id: string
  full_name: string
  email: string
  external_id: string | null
}

export default function WelcomeInvitations({
  employees,
  defaultOpen = false,
}: {
  defaultOpen?: boolean
  employees: Recipient[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(defaultOpen)
  const [mode, setMode] = useState<'new' | 'existing'>('existing')
  const [fullName, setFullName] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [email, setEmail] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<InvitationResult[]>([])
  const selected = employees.find((e) => e.id === selectedId)
  const filtered = employees.filter((e) =>
    [
      e.full_name,
      e.external_id,
      e.email.endsWith('.merch.invalid') ? '' : e.email,
    ].some((value) =>
      value?.toLowerCase().includes(search.trim().toLowerCase())
    )
  )

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await unitFetch(
        mode === 'new' ? '/api/admin/employees' : '/api/admin/invitations',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            mode === 'new'
              ? {
                  action: 'create_employee',
                  full_name: fullName,
                  email,
                  external_id: identifier,
                  invitation: 'code',
                  invite_scope: 'welcome',
                  access_mode: 'one_order',
                  is_active: true,
                }
              : {
                  action: 'create',
                  ids: [selectedId],
                  channel: 'code',
                  scope: 'welcome',
                }
          ),
        }
      )
      const data = await response.json()
      if (!response.ok)
        throw new Error(data.error || 'Не удалось создать ссылку')
      const invitations: InvitationResult[] = data.invitations || []
      if (!invitations.length)
        throw new Error(
          'Ссылка не создана. Обновите страницу и проверьте запись сотрудника.'
        )
      setResults(invitations)
      if (invitations.some((i) => i.url)) setOpen(false)
      // If the record was created but its invitation failed, retry against that
      // record rather than inserting the same employee a second time.
      if (mode === 'new' && data.employee?.id) {
        setSelectedId(data.employee.id)
        setMode('existing')
        setSearch('')
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать ссылку')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dash-card welcome-employee-card">
      <div className="welcome-employees-link">
        <div>
          <h2>Ссылка на Welcome pack</h2>
          <p>Создайте и скопируйте персональную ссылку для новичка.</p>
        </div>
        <button
          type="button"
          className="ae-export-btn"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Свернуть' : 'Создать ссылку'}
        </button>
      </div>

      <InvitationResults items={results} />

      {open && (
        <form className="ae-editor ae-editor-create" onSubmit={submit}>
          <h2>Создать ссылку Welcome pack</h2>
          <fieldset disabled={busy} className="welcome-invite-fields">
            <div
              className="settings-tabs"
              role="group"
              aria-label="Кого пригласить"
            >
              <button
                type="button"
                className="ae-export-btn"
                aria-pressed={mode === 'new'}
                onClick={() => {
                  setMode('new')
                  setError('')
                }}
              >
                Новый сотрудник
              </button>
              <button
                type="button"
                className="ae-export-btn"
                aria-pressed={mode === 'existing'}
                onClick={() => {
                  setMode('existing')
                  setError('')
                }}
              >
                Уже в реестре
              </button>
            </div>
            {mode === 'new' ? (
              <div className="ae-editor-grid">
                <label className="ae-field">
                  ФИО
                  <input
                    className="ae-input"
                    required
                    maxLength={250}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </label>
                <label className="ae-field">
                  Идентификатор сотрудника
                  <input
                    className="ae-input"
                    required
                    maxLength={100}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                  />
                </label>
                <label className="ae-field">
                  Email · необязательно
                  <input
                    className="ae-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              </div>
            ) : (
              <div className="welcome-recipient-fields">
                <label className="ae-field">
                  Найти сотрудника
                  <input
                    className="ae-input"
                    placeholder="ФИО, email или идентификатор"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <label className="ae-field">
                  Сотрудник из реестра
                  <select
                    required
                    className="ae-input"
                    value={selectedId}
                    onChange={(e) => setSelectedId(e.target.value)}
                  >
                    <option value="">Выберите сотрудника</option>
                    {employees
                      .filter(
                        (e) => e.id === selectedId || filtered.includes(e)
                      )
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.full_name} ·{' '}
                          {e.external_id ||
                            (e.email.endsWith('.merch.invalid')
                              ? 'нет идентификатора'
                              : e.email)}
                        </option>
                      ))}
                  </select>
                </label>
                {selected && (
                  <p>
                    {selected.external_id ? (
                      `Идентификатор для входа: ${selected.external_id}`
                    ) : (
                      <>
                        Для личной ссылки нужен идентификатор.{' '}
                        <Link
                          href={
                            '/admin/employees?q=' +
                            encodeURIComponent(selected.full_name)
                          }
                        >
                          Укажите его в карточке сотрудника
                        </Link>
                        .
                      </>
                    )}
                  </p>
                )}
              </div>
            )}
            <p>
              Одна ссылка — один сотрудник и один полученный заказ. Активировать
              её можно в течение 7 дней, либо до более раннего окончания
              доступа. Передавайте каждому только его собственную ссылку. Новая
              ссылка заменяет прежний доступ; открытый заказ сначала нужно
              завершить или отменить.
            </p>
            {error && (
              <p role="alert" className="ae-error">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="ae-save-btn"
              disabled={busy || (mode === 'existing' && !selected?.external_id)}
            >
              {busy ? 'Создаём ссылку…' : 'Создать персональную ссылку'}
            </button>
          </fieldset>
        </form>
      )}
    </section>
  )
}
