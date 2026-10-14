'use client'

import Link from 'next/link'
import AdminTaskNotice from '@/components/AdminTaskNotice'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

type AdminShellProps = {
  children: ReactNode
  adminEmail: string
  title?: string
  subtitle?: string
  orderCount?: number
  stockAlertCount?: number
}

const navItems = [
  { key:'interface',href:'/admin/interface',label:'Тексты и настройки',description:'Правила, сообщения, офисы',icon:'⚙' },
  { key: 'issue', href: '/admin/issue', label: 'Выдача', description: 'Сканирование Code 128', icon: '▥' },
  { key: 'dashboard', href: '/admin',                   label: 'Дашборд', description: 'Сводка',           icon: '⌂' },
  { key: 'orders',    href: '/admin/orders',             label: 'Заказы',  description: 'Заявки и статусы', icon: '◇' },
  { key: 'stock',     href: '/admin/products',           label: 'Склад',   description: 'Остатки товаров',  icon: '▦' },
  { key: 'products',  href: '/admin/products?mode=cards',label: 'Товары',  description: 'Карточки и фото',  icon: '⌑' },
  { key: 'employees', href: '/admin/employees',          label: 'Сотрудники',  description: 'HR-реестр и доступ',      icon: 'HR' },
]

export default function AdminShell({
  children,
  adminEmail,
  title    = 'Сводка',
  subtitle = 'Админ-панель · merch.uzum.tech',
  orderCount,
  stockAlertCount,
}: AdminShellProps) {
  const pathname     = usePathname()
  const router       = useRouter()
  const searchParams = useSearchParams()
  const mode         = searchParams.get('mode')

  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [topSearch,    setTopSearch]    = useState('')

  useEffect(() => {
    setTopSearch(searchParams.get('q') ?? '')
  }, [searchParams])

  function getBadge(itemKey: string) {
    if (itemKey === 'orders' && typeof orderCount     === 'number') return orderCount
    if (itemKey === 'stock'  && typeof stockAlertCount === 'number') return stockAlertCount
    return null
  }

  async function handleLogout() {
    setIsLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      window.location.href = '/login'
    }
  }

  function handleTopSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query  = topSearch.trim()
    const params = new URLSearchParams(searchParams.toString())
    if (query) { params.set('q', query) } else { params.delete('q') }
    const suffix = params.toString() ? `?${params.toString()}` : ''

    if (pathname === '/admin/orders')   { router.push(`/admin/orders${suffix}`);   return }
    if (pathname === '/admin/products') { router.push(`/admin/products${suffix}`); return }
    router.push(query ? `/admin/orders?q=${encodeURIComponent(query)}` : '/admin/orders')
  }

  return (
    <main className="admin-shell">

      {/* ── Sidebar ── */}
      <aside className="admin-sidebar">

        <Link href="/admin" className="admin-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/uzum-big-logo.webp" alt="Uzum" className="admin-brand-logo" />
          <div className="admin-brand-text">uzum мерч</div>
          <span className="admin-badge">ADMIN</span>
        </Link>

        <nav className="admin-nav">
          {navItems.map((item, index) => {
            const active =
              (item.key === 'interface' && pathname === '/admin/interface') ||
              (item.key === 'issue' && pathname === '/admin/issue') ||
              (item.key === 'dashboard' && pathname === '/admin') ||
              (item.key === 'orders'    && pathname === '/admin/orders') ||
              (item.key === 'stock'     && pathname === '/admin/products' && mode !== 'cards') ||
              (item.key === 'products'  && pathname === '/admin/products' && mode === 'cards') ||
              (item.key === 'employees' && pathname === '/admin/employees')

            const badge = getBadge(item.key)

            return (
              <Link
                key={`${item.label}-${index}`}
                href={item.href}
                className={`admin-nav-link${active ? ' admin-nav-link-active' : ''}`}
              >
                <span className="admin-nav-icon">{item.icon}</span>
                <span className="admin-nav-text">
                  <b>{item.label}</b>
                  <small>{item.description}</small>
                </span>
                {badge !== null && badge > 0 && (
                  <span className="admin-nav-badge">{badge}</span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-user">
            <div className="admin-user-avatar">{getInitials(adminEmail)}</div>
            <div className="admin-user-text">
              <b>Администратор</b>
              <span>{adminEmail}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="admin-logout-link"
          >
            {isLoggingOut ? 'Выходим...' : 'Выход →'}
          </button>
        </div>

      </aside>

      {/* ── Main area ── */}
      <section className="admin-main">

        <header className="admin-topbar">
          <div>
            <div className="admin-topbar-sub">{subtitle}</div>
            <h1 className="admin-topbar-title">{title}</h1>
          </div>

          <div className="admin-topbar-actions">
            <Link href="/admin/issue" className="ao-light-btn">Выдача по коду</Link>
            <form
              className="admin-search admin-card-hover"
              onSubmit={handleTopSearchSubmit}
            >
              <span className="admin-search-icon">⌕</span>
              <input
                type="text"
                value={topSearch}
                onChange={e => setTopSearch(e.target.value)}
                placeholder="Поиск: номер, ФИО, email, телефон"
                className="admin-search-input"
              />
              <span className="admin-search-shortcut">Enter</span>
            </form>

            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="admin-mobile-logout"
            >
              {isLoggingOut ? 'Выходим...' : 'Выход'}
            </button>
          </div>
        </header>

        <div className="admin-content">
          <AdminTaskNotice/>{children}
        </div>

      </section>

    </main>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

function getInitials(email: string) {
  const local = email.split('@')[0] || 'admin'
  const parts = local.split(/[._-]/).filter(Boolean)
  return `${parts[0]?.[0] ?? 'A'}${parts[1]?.[0] ?? ''}`.toUpperCase()
}
