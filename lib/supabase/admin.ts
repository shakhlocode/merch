import 'server-only'
import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'
export function privilegedClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key)
    throw new Error(
      'Приглашения ещё не настроены: отсутствует серверный ключ Supabase'
    )
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
export function isolatedAuthClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: 'implicit',
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  )
}
