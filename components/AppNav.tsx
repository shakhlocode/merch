'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

type AppNavProps = {
  storeScope?: 'catalog'|'welcome'
  isAdmin?: boolean
  /** When true, renders a "Выйти" button alongside the nav links (default: false). */
  showLogout?: boolean
}

type NavItem = {
  href: string
  label: string
  adminOnly?: boolean
}

const navItems: NavItem[] = [
  { href: '/catalog',         label: 'Каталог'      },
  { href: '/orders',          label: 'Мои заказы'   },
  { href: '/welcome',         label: 'Welcome pack' },
  { href: '/profile',         label: 'Профиль'      },
  { href: '/admin/orders',    label: 'Заказы',     adminOnly: true },
  { href: '/admin/products',  label: 'Товары',     adminOnly: true },
  { href: '/admin/employees', label: 'Сотрудники', adminOnly: true },
]

const baseItems  = navItems.filter(item => !item.adminOnly)
const adminItems = navItems.filter(item => item.adminOnly)

const MENU_WIDTH = 208

export default function AppNav({
  storeScope,
  isAdmin    = false,
  showLogout = false,
}: AppNavProps) {
  const pathname = usePathname()
  const [scope,setScope]=useState<'catalog'|'welcome'|null>(storeScope??null)
  useEffect(()=>{if(storeScope){setScope(storeScope);return}let stop=false;fetch('/api/access',{cache:'no-store'}).then(r=>r.json()).then(d=>{if(!stop&&d.allowed)setScope(d.scope==='welcome'?'welcome':'catalog')}).catch(()=>{});return()=>{stop=true}},[storeScope])
  const [loggingOut, setLoggingOut] = useState(false)
  const [adminOpen,  setAdminOpen]  = useState(false)
  const [menuPos,    setMenuPos]    = useState<{ top: number; left: number } | null>(null)

  const adminRef   = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  function isItemActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  const adminActive = adminItems.some(item => isItemActive(item.href))

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      window.location.href = '/login'
    }
  }

  function toggleAdmin() {
    if (!adminOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const left = Math.max(
        12,
        Math.min(rect.left, window.innerWidth - MENU_WIDTH - 12)
      )
      setMenuPos({ top: rect.bottom + 8, left })
    }
    setAdminOpen(open => !open)
  }

  // Close the admin menu on route change.
  useEffect(() => {
    setAdminOpen(false)
  }, [pathname])

  // Close on outside click, Escape, scroll or resize (the menu is fixed-positioned).
  useEffect(() => {
    if (!adminOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (adminRef.current && !adminRef.current.contains(event.target as Node)) {
        setAdminOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setAdminOpen(false)
    }
    function handleReflow() {
      setAdminOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleReflow)
    window.addEventListener('scroll', handleReflow, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleReflow)
      window.removeEventListener('scroll', handleReflow, true)
    }
  }, [adminOpen])

  return (
    <nav className="head-nav">
      {baseItems.filter(item=>(item.href!=='/catalog'||scope==='catalog')&&(item.href!=='/welcome'||scope==='welcome')).map(item => (
        <Link
          key={item.href}
          href={item.href}
          className={`nav-link${isItemActive(item.href) ? ' is-on' : ''}`}
        >
          {item.label}
        </Link>
      ))}

      {isAdmin && (
        <div className="nav-admin" ref={adminRef}>
          <button
            ref={triggerRef}
            type="button"
            onClick={toggleAdmin}
            aria-haspopup="menu"
            aria-expanded={adminOpen}
            className={`nav-link nav-admin-trigger${adminActive || adminOpen ? ' is-on' : ''}`}
          >
            Админ-панель
            <span className={`nav-admin-caret${adminOpen ? ' is-open' : ''}`} aria-hidden="true">
              ▾
            </span>
          </button>

          {adminOpen && menuPos && (
            <div
              role="menu"
              className="nav-admin-menu"
              style={{ top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
            >
              {adminItems.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  className={`nav-admin-item${isItemActive(item.href) ? ' is-on' : ''}`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {showLogout && (
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="nav-link nav-link-logout"
        >
          {loggingOut ? 'Выходим…' : 'Выйти'}
        </button>
      )}
    </nav>
  )
}
