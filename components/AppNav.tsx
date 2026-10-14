'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

type AppNavProps = {
  storeScope?: 'catalog'|'welcome'
  isAdmin?: boolean
  /** When true, renders a "Выйти" button alongside the nav links (default: false). */
  showLogout?: boolean
}

type NavItem = {
  href: string
  label: string
}

const navItems: NavItem[] = [
  { href: '/catalog',         label: 'Каталог'      },
  { href: '/orders',          label: 'Мои заказы'   },
  { href: '/welcome',         label: 'Welcome pack' },
  { href: '/profile',         label: 'Профиль'      },
]

export default function AppNav({
  storeScope,
  isAdmin    = false,
  showLogout = false,
}: AppNavProps) {
  const pathname = usePathname()
  const [scope,setScope]=useState<'catalog'|'welcome'|null>(storeScope??null)
  useEffect(()=>{if(storeScope){setScope(storeScope);return}let stop=false;fetch('/api/access',{cache:'no-store'}).then(r=>r.json()).then(d=>{if(!stop&&d.allowed)setScope(d.scope==='welcome'?'welcome':'catalog')}).catch(()=>{});return()=>{stop=true}},[storeScope])
  const [loggingOut, setLoggingOut] = useState(false)
  function isItemActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      window.location.href = '/login'
    }
  }

  return (
    <nav className="head-nav">
      {navItems.filter(item=>(item.href!=='/catalog'||scope==='catalog')&&(item.href!=='/welcome'||scope==='welcome')).map(item => (
        <Link
          key={item.href}
          href={item.href}
          className={`nav-link${isItemActive(item.href) ? ' is-on' : ''}`}
        >
          {item.label}
        </Link>
      ))}

      {isAdmin && (
        <Link
          href="/admin"
          className={`nav-link${isItemActive('/admin') ? ' is-on' : ''}`}
        >
          Админ-панель
        </Link>
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
