'use client'

import { unitFetch } from '@/lib/shop-context'

import ShopAnchor from '@/components/ShopAnchor'

import { useState } from 'react'

export type EmployeeProfile = {
  id: string
  full_name: string
  email: string
  phone: string
  department: string
  position: string
  city: string
  office: string
  is_admin: boolean
}

type ProfileClientProps = {
  profile: EmployeeProfile
}

export default function ProfileClient({ profile }: ProfileClientProps) {
  const [fullName,   setFullName]   = useState(profile.full_name)
  const [phone,      setPhone]      = useState(profile.phone)
  const [department, setDepartment] = useState(profile.department)
  const [position,   setPosition]   = useState(profile.position)
  const [city,       setCity]       = useState(profile.city)
  const [office,     setOffice]     = useState(profile.office)

  const [isSaving, setIsSaving] = useState(false)
  const [message,  setMessage]  = useState<string | null>(null)
  const [error,    setError]    = useState<string | null>(null)

  const completion = getProfileCompletion({
    ...profile,
    full_name: fullName,
    phone, department, position, city, office,
  })

  async function handleSave() {
    setIsSaving(true)
    setMessage(null)
    setError(null)

    try {
      const res = await unitFetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName, phone, department, position, city, office }),
      })

      const result = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(result.error || 'Не удалось сохранить профиль')
        return
      }

      setMessage('Профиль сохранён')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка')
    } finally {
      setIsSaving(false)
    }
  }

  const initials = getInitials(fullName, profile.email)

  return (
    <div className="profile-wrapper">

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <div className="profile-hero">
        <div className="profile-hero-main">
          <span className="kicker">Личный кабинет</span>
          <h1 className="display">
            Профиль сотрудника
          </h1>
          <p className="lead">
            Эти данные используются при оформлении заявки на мерч: телефон,
            город и офис будут автоматически подставляться в корзину.
          </p>
          <div className="profile-hero-actions">
            <ShopAnchor href="/" className="btn btn-accent btn-md">Выбрать мерч</ShopAnchor>
            <ShopAnchor href="/orders"  className="btn btn-ghost  btn-md">Мои заказы</ShopAnchor>
          </div>
        </div>

        <aside className="profile-card">
          <div className="profile-avatar">{initials}</div>
          <div className="profile-name">{fullName || 'Сотрудник Uzum'}</div>
          <div className="profile-email">{profile.email}</div>

          <div className="profile-completion">
            <div className="profile-completion-top">
              <span>Заполнение профиля</span>
              <b>{completion}%</b>
            </div>
            <div className="profile-progress-track">
              <div className="profile-progress-bar" style={{ width: `${completion}%` }} />
            </div>
          </div>

          <span className={`profile-role-badge ${profile.is_admin ? 'admin' : 'employee'}`}>
            {profile.is_admin ? 'Администратор' : 'Сотрудник'}
          </span>
        </aside>
      </div>

      {/* ── Content grid: form + side ───────────────────────────────────── */}
      <div className="profile-content-grid">

        {/* Form card */}
        <div className="profile-form-card">
          <div className="profile-form-head">
            <h2>Данные для получения</h2>
            <p>Заполните профиль один раз, чтобы при заказе мерча не вводить данные вручную.</p>
          </div>

          <div className="form-grid">
            <label className="form-field wide">
              ФИО
              <input
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Например: Роман Волобуев"
              />
            </label>

            <label className="form-field">
              Телефон
              <input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+998..."
              />
            </label>

            <label className="form-field">
              Город
              <input
                value={city}
                onChange={e => setCity(e.target.value)}
                placeholder="Например: Ташкент"
              />
            </label>

            <label className="form-field">
              Отдел
              <input
                value={department}
                onChange={e => setDepartment(e.target.value)}
                placeholder="Например: Outbound"
              />
            </label>

            <label className="form-field">
              Должность
              <input
                value={position}
                onChange={e => setPosition(e.target.value)}
                placeholder="Например: Технолог"
              />
            </label>

            <label className="form-field wide">
              Офис / склад / филиал / точка получения
              <input
                value={office}
                onChange={e => setOffice(e.target.value)}
                placeholder="Например: Сергели, склад / офис"
              />
            </label>
          </div>

          {error   && <div className="form-msg-err">{error}</div>}
          {message && <div className="form-msg-ok">{message}</div>}

          <button
            type="button"
            className="profile-save-btn"
            disabled={isSaving}
            onClick={handleSave}
          >
            {isSaving ? 'Сохраняем…' : 'Сохранить профиль'}
          </button>
        </div>

        {/* Side panel */}
        <aside className="profile-side-panel">
          <div className="profile-info-card">
            <div className="profile-info-icon">i</div>
            <h3>Как это работает</h3>
            <p>
              При оформлении заказа система автоматически подтянет телефон и
              адрес получения из профиля. Вы сможете изменить их прямо в корзине
              перед отправкой заявки.
            </p>
          </div>

          <div className="profile-summary-card">
            <h3>Данные профиля</h3>
            <ProfileSummaryRow label="Email"    value={profile.email || 'Не указан'} />
            <ProfileSummaryRow label="Телефон"  value={phone       || 'Не указан'} />
            <ProfileSummaryRow label="Город"    value={city        || 'Не указан'} />
            <ProfileSummaryRow label="Офис"     value={office      || 'Не указан'} />
            <ProfileSummaryRow label="Отдел"    value={department  || 'Не указан'} />
          </div>
        </aside>

      </div>
    </div>
  )
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function ProfileSummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="profile-summary-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

function getInitials(name: string, email: string): string {
  const src   = name.trim() || email.split('@')[0] || 'U'
  const parts = src.split(/[ ._-]/).filter(Boolean)
  return `${parts[0]?.[0] ?? 'U'}${parts[1]?.[0] ?? ''}`.toUpperCase()
}

function getProfileCompletion(p: EmployeeProfile): number {
  const fields = [p.full_name, p.email, p.phone, p.department, p.position, p.city, p.office]
  const filled = fields.filter(f => f.trim().length > 0).length
  return Math.round((filled / fields.length) * 100)
}
