import { createBrowserClient } from '@supabase/ssr'
import { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'
import { browserUnit } from '@/lib/shop-context'

// See comment in server.ts — same workaround for broken Schema inference.
export function createClient(): SupabaseClient<Database> {
  const client = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      const unit = browserUnit()
      if (unit) headers.set('x-merch-unit', unit)
      return fetch(input, { ...init, headers })
    } } }
  )
  return client as unknown as SupabaseClient<Database>
}
