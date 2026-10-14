'use client'
import { useEffect, useState } from 'react'
export default function AdminTaskNotice() {
  const [counts, setCounts] = useState({ due: 0, overdue: 0 })
  useEffect(() => {
    let stopped = false
    async function check() {
      if (document.visibilityState === 'hidden') return
      try {
        const r = await fetch('/api/admin/tasks', { cache: 'no-store' })
        if (r.ok && !stopped) setCounts(await r.json())
      } catch {}
    }
    check()
    const t = setInterval(check, 60000)
    window.addEventListener('focus', check)
    return () => {
      stopped = true
      clearInterval(t)
      window.removeEventListener('focus', check)
    }
  }, [])
  return counts.due || counts.overdue ? (
    <a href="/admin/tasks" className="admin-task-notice" role="status">
      {counts.due > 0 && (
        <span>Свяжитесь с приезжающими сотрудниками: {counts.due}. </span>
      )}
      {counts.overdue > 0 && (
        <span>
          Срок визита истёк у {counts.overdue} заказов — проверьте резерв.{' '}
        </span>
      )}
      Открыть задачи →
    </a>
  ) : null
}
