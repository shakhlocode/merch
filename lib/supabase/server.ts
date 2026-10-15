import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'
import { cookies, headers } from 'next/headers'

type CookieToSet = {
  name: string
  value: string
  options?: CookieOptions
}

// Workaround: @supabase/ssr@0.5.2 imports GenericSchema from a path that no
// longer exists in @supabase/supabase-js@2.106.1. This causes createServerClient
// to return SupabaseClient<Db, 'public', Db['public']> where Db['public'] is
// accidentally placed in the SchemaName (string) slot, making Schema = never.
// We explicitly annotate the return as SupabaseClient<Database> (1-arg form),
// which correctly computes Schema = Database['public'].
export async function createClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies()
  const unit = (await headers()).get('x-merch-unit')

  const client = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: unit ? { 'x-merch-unit': unit } : {} },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            /*
              В Server Components Next.js не разрешает менять cookies.
              Это нормально для страниц /catalog, /orders, /profile, /admin.
              Cookies будут обновляться в Route Handlers:
              /auth/callback
              /api/orders
              /api/profile
              /api/admin/*
            */
          }
        },
      },
    }
  )

  return client as unknown as SupabaseClient<Database>
}
