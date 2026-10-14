'use client'

import InvitationQueue from '@/components/InvitationQueue'
import InvitationChoice, { type InvitationChoiceValue } from '@/components/InvitationChoice'
import InvitationResults from '@/components/InvitationResults'
import type { InvitationResult } from '@/lib/invitations'
import EmployeeAccessFields from '@/components/EmployeeAccessFields'
import { accessUntil, directoryAccessOpen, type AccessMode } from '@/lib/employee-access'
import EmployeeImport from '@/components/EmployeeImport'
import AdminShell from '@/components/AdminShell'
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getExportDate, toCsv } from '@/lib/utils'

export type DirectoryEmployee = {
  id: string
  email: string
  full_name: string
  business_unit: string | null
  position: string | null
  invitation_required: boolean
  invitation_user_id: string | null
  invitation_one_order: boolean
  access_mode: AccessMode
  access_expires_at: string | null
  access_used_at: string | null
  external_id: string | null
  hired_at: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

type Props = {
  employees: DirectoryEmployee[]
  adminEmail: string
  orderCount: number
  stockAlertCount: number
}

type StatusFilter = 'all' | 'active' | 'inactive'

export default function AdminEmployeesClient({
  employees,
  adminEmail,
  orderCount,
  stockAlertCount,
}: Props) {
  const searchParams = useSearchParams()
  const queryFromUrl = searchParams.get('q') ?? ''

  const [search,       setSearch]       = useState(queryFromUrl)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [inviteResults, setInviteResults] = useState<InvitationResult[]>([])
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [editingId,    setEditingId]    = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  useEffect(() => { setSearch(queryFromUrl) }, [queryFromUrl])

  const totals = useMemo(() => {
    const total    = employees.length
    const active   = employees.filter(directoryAccessOpen).length
    const inactive = total - active
    return { total, active, inactive }
  }, [employees])

  const filtered = useMemo(() => {
    const value = search.trim().toLowerCase()

    return employees.filter((e) => {
      const statusMatch =
        statusFilter === 'all' ||
        (statusFilter === 'active'   && directoryAccessOpen(e)) ||
        (statusFilter === 'inactive' && !directoryAccessOpen(e))


      const searchMatch =
        value.length === 0 ||
        e.full_name.toLowerCase().includes(value) ||
        e.email.toLowerCase().includes(value) ||
        e.external_id?.toLowerCase().includes(value) ||
        e.position?.toLowerCase().includes(value) ||
        e.business_unit?.toLowerCase().includes(value)

      return statusMatch && searchMatch
    })
  }, [employees, search, statusFilter])

  function handleExportCsv() {
    const rows = filtered.map((e) => ({
      full_name:     e.full_name,
      email:         e.email,
      external_id:   e.external_id || '',
      business_unit: e.business_unit || '',
      position:      e.position || '',
      hired_at:      formatDate(e.hired_at),
      access_mode: e.access_mode,
      access_until: accessUntil(e.access_expires_at),
      access_used_at: e.access_used_at || '',
      status: directoryAccessOpen(e) ? 'Доступ открыт' : 'Доступ закрыт',
    }))

    const csv  = toCsv(rows)
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href     = url
    link.download = `uzum-merch-employees-${getExportDate()}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const statusTabs: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all',      label: 'Все',       count: totals.total },
    { key: 'active',   label: 'Активные',  count: totals.active },
    { key: 'inactive', label: 'Отключённые', count: totals.inactive },
  ]

  return (
    <AdminShell
      adminEmail={adminEmail}
      title="Сотрудники"
      subtitle="Админ-панель · merch.uzum.tech"
      orderCount={orderCount}
      stockAlertCount={stockAlertCount}
    >
      <section className="ae-page ae-directory-simple">

        {/* Summary */}
        <section className="ae-summary-strip">
          <SummaryMetric label="Всего в реестре" value={String(totals.total)} />
          <SummaryMetric label="Активных"        value={String(totals.active)} />
          <SummaryMetric label="Отключённых"       value={String(totals.inactive)} />
        </section>

        {/* Status tabs */}
        <section className="ae-status-tabs">
          {statusTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={`ae-status-tab${statusFilter === tab.key ? ' ae-status-tab-active' : ''}`}
            >
              {tab.label}
              <span>{tab.count}</span>
            </button>
          ))}
        </section>

        {/* Toolbar */}
        <section className="ae-toolbar">
          <div className="ae-search-box">
            <span className="ae-search-icon">⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск: ФИО, email, идентификатор"
              className="ae-search-input"
            />
            {search.trim().length > 0 && (
              <button type="button" onClick={() => setSearch('')} className="ae-clear-btn">×</button>
            )}
          </div>

          <div className="ae-toolbar-right">


            <button type="button" className="ae-export-btn" onClick={() => setIsImportOpen(value => !value)}>Загрузить Excel / CSV</button>
            <button
              type="button"
              className="ae-export-btn"
              onClick={handleExportCsv}
              disabled={filtered.length === 0}
            >
              Экспорт CSV
            </button>

            <button
              type="button"
              className="ae-new-btn"
              onClick={() => { setEditingId(null); setIsCreateOpen((v) => !v) }}
            >
              + Добавить сотрудника
            </button>
          </div>
        </section>

        {isImportOpen && <EmployeeImport />}
        <InvitationQueue />
        <InvitationResults items={inviteResults} />
        {/* Create panel */}
        {isCreateOpen && (
          <EmployeeEditor onInvitations={setInviteResults} mode="create" onClose={() => setIsCreateOpen(false)} />
        )}

        {/* Table / empty */}
        {filtered.length === 0 ? (
          <section className="ae-empty-card">
            <div className="ae-empty-mark">∅</div>
            <h2 className="ae-empty-title">Сотрудники не найдены</h2>
            <p className="ae-empty-text">Измените поиск или статус.</p>
          </section>
        ) : (
          <section className="ae-table-card">
            <div className="ae-table-header">
              <div>Сотрудник</div>
              <div>Email</div>
              <div>Идентификатор</div>
              <div>Статус</div>
              <div />
            </div>

            <div className="ae-table-body">
              {filtered.map((employee) => {
                const isEditing = editingId === employee.id
                return (
                  <div key={employee.id} className="ae-row-group">
                    <button
                      type="button"
                      onClick={() => { setIsCreateOpen(false); setEditingId(isEditing ? null : employee.id) }}
                      className={`ae-row ae-row-button${isEditing ? ' ae-row-active' : ''}`}
                    >
                      <div className="ae-name-cell">
                        <div className="ae-avatar">{getInitials(employee.full_name, employee.email)}</div>
                        <div className="ae-name-text">
                          <b>{employee.full_name || 'Без имени'}</b>
                          <span>В реестре с {formatDate(employee.created_at)}</span>
                        </div>
                      </div>

                      <div className="ae-cell-mute">{employee.email.endsWith('.merch.invalid') ? 'Без почты · личная ссылка' : employee.email}</div>
                      <div className="ae-cell-mute">{employee.external_id || '—'}</div>

                      <div>
                        <span className={`ae-badge${directoryAccessOpen(employee) ? '' : ' ae-badge-off'}`}>
                          {employee.invitation_required && !employee.invitation_user_id ? 'Ожидает приглашения' : !employee.is_active ? 'Отключён' : (employee.access_mode === 'one_order' || employee.invitation_one_order) ? (employee.access_used_at ? 'Заказ получен · доступ закрыт' : 'До получения заказа') : employee.access_mode === 'until_date' ? `${directoryAccessOpen(employee) ? 'До' : 'Истёк'} ${formatDate(accessUntil(employee.access_expires_at))}` : 'Бессрочный'}
                        </span>
                      </div>

                      <div className="ae-row-caret">{isEditing ? '⌃' : '⌄'}</div>
                    </button>

                    {isEditing && (
                      <EmployeeEditor
                        onInvitations={setInviteResults}
                        mode="edit"
                        employee={employee}
                        onClose={() => setEditingId(null)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

      </section>
    </AdminShell>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  EmployeeEditor — shared create/edit form                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

function EmployeeEditor({
  mode,
  employee,
  onClose,
  onInvitations,
}: {
  onInvitations: (items: InvitationResult[]) => void
  mode: 'create' | 'edit'
  employee?: DirectoryEmployee
  onClose: () => void
}) {
  const router = useRouter()
  const isCreate = mode === 'create'

  const [fullName, setFullName] = useState(employee?.full_name ?? '')
  const [email,    setEmail]    = useState(employee?.email?.endsWith('.merch.invalid') ? '' : employee?.email ?? '')
  const [invitation, setInvitation] = useState<InvitationChoiceValue>('none')
  const [externalId, setExternalId] = useState(employee?.external_id ?? '')

  const [accessMode, setAccessMode] = useState<AccessMode>(employee?.access_mode ?? 'unlimited')
  const [accessDate, setAccessDate] = useState(accessUntil(employee?.access_expires_at ?? null))
  const [isSaving, setIsSaving] = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  async function handleSave(nextActive = employee?.is_active ?? true, renew = false) {
    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: isCreate ? 'create_employee' : 'update_employee',
          id: employee?.id,
          full_name: fullName,
          email: !isCreate && employee?.email?.endsWith('.merch.invalid') ? employee.email : email,
          external_id: externalId,
          invitation,
          access_mode: accessMode,
          access_until: accessDate,
          renew_access: renew,
          is_active: nextActive,
        }),
      })

      const result = await response.json()
      if (!response.ok) { setError(result.error || 'Не удалось сохранить'); return }

      if (result.invitations?.length) onInvitations(result.invitations)
      onClose()
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className={isCreate ? 'ae-editor ae-editor-create' : 'ae-editor'}>
      {isCreate && (
        <div className="ae-editor-head">
          <h3 className="ae-editor-title">Новый сотрудник</h3>
          <p className="ae-editor-hint">Без приглашения аккаунт связывается по email. С приглашением сотрудник получит доступ после его активации.</p>
        </div>
      )}

      <div className="ae-editor-grid">
        <label className="ae-field">
          ФИО
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Иван Иванов" className="ae-input" />
        </label>

        <label className="ae-field">
          {invitation === 'code' ? 'Email · необязательно' : 'Email'}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ivan@uzum.uz"
            disabled={!isCreate}
            className="ae-input"
          />
          {!isCreate && <span className="ae-field-note">Email менять нельзя — это ключ привязки к аккаунту</span>}
        </label>

        <label className="ae-field">{invitation === 'code' ? 'Идентификатор · обязателен для личной ссылки' : 'Идентификатор · необязательно'}
          <input value={externalId} onChange={e => setExternalId(e.target.value)} className="ae-input" placeholder="Например: EMP-001" />
        </label>
      </div>

      <InvitationChoice value={invitation} onChange={setInvitation} />
      <EmployeeAccessFields mode={accessMode} until={accessDate} onMode={setAccessMode} onUntil={setAccessDate} />
      {employee?.access_used_at && <p>Разовый доступ использован. При необходимости можно выдать его повторно.</p>}
      {error && <div className="ae-error">{error}</div>}

      <div className="ae-editor-actions">
        {!isCreate && (accessMode === 'one_order' || employee?.invitation_one_order) && employee?.access_used_at && <button type="button" className="ae-cancel-btn" disabled={isSaving} onClick={() => handleSave(true, true)}>Выдать доступ ещё на один заказ</button>}
        {!isCreate && <button type="button" className="ae-cancel-btn" disabled={isSaving} onClick={() => handleSave(!employee?.is_active)}>{employee?.is_active ? 'Отключить доступ' : 'Вернуть доступ'}</button>}
        <button type="button" onClick={onClose} className="ae-cancel-btn">Отмена</button>
        <button type="button" onClick={() => handleSave()} disabled={isSaving} className="ae-save-btn">
          {isSaving ? 'Сохраняем...' : isCreate ? 'Добавить' : 'Сохранить'}
        </button>
      </div>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  SummaryMetric                                                                */
/* ─────────────────────────────────────────────────────────────────────────── */

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="ae-summary-metric">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                      */
/* ─────────────────────────────────────────────────────────────────────────── */

function getInitials(name: string, email: string) {
  const source = name?.trim() || email?.split('@')[0] || 'U'
  const parts  = source.split(/[ ._-]/).filter(Boolean)
  return `${parts[0]?.[0] ?? 'U'}${parts[1]?.[0] ?? ''}`.toUpperCase()
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('ru-RU', {
    timeZone: 'Asia/Tashkent',
    day:   'numeric',
    month: 'short',
    year:  'numeric',
  })
}
