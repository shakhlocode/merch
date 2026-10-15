'use client'

import { unitFetch } from '@/lib/shop-context'

import ShopAnchor from '@/components/ShopAnchor'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
function AcceptContent() {
  const params = useSearchParams(),
    router = useRouter(),
    client = useMemo(() => createClient(), []),
    started = useRef(false),
    [error, setError] = useState('')
  useEffect(() => {
    if (started.current) return
    started.current = true
    async function accept() {
      try {
        const hash = new URLSearchParams(window.location.hash.slice(1))
        if (hash.get('error_description'))
          throw new Error(hash.get('error_description')!)
        if (hash.get('access_token') && hash.get('refresh_token')) {
          const { error } = await client.auth.setSession({
            access_token: hash.get('access_token')!,
            refresh_token: hash.get('refresh_token')!,
          })
          if (error) throw error
        } else {
          const { error } = await client.auth.initialize()
          if (error) throw error
        }
        const r = await unitFetch('/api/invitations/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: params.get('id') }),
          }),
          d = await r.json()
        if (!r.ok) throw new Error(d.error)
        window.history.replaceState(null, '', '/invite/accept')
        const {
          data: { user },
        } = await client.auth.getUser()
        const { data: employee } = await client
          .from('employees')
          .select('password_set_at')
          .eq('id', user!.id)
          .maybeSingle()
        window.location.replace(employee?.password_set_at ? (typeof d.next==='string' && /^\/(welcome|catalog)(\?|$)/.test(d.next) ? d.next : '/catalog') : '/set-password')
        router.refresh()
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Не удалось принять приглашение'
        )
      }
    }
    accept()
  }, [client, params, router])
  return (
    <main className="page-error">
      <section className="error-card">
        <h1>
          {error
            ? 'Не удалось открыть приглашение'
            : 'Подтверждаем приглашение…'}
        </h1>
        {error && <p role="alert">{error}</p>}
        <p>
          <ShopAnchor href="/login">Войти в существующий аккаунт</ShopAnchor>
        </p>
      </section>
    </main>
  )
}
export default function AcceptPage() {
  return (
    <Suspense>
      <AcceptContent />
    </Suspense>
  )
}
