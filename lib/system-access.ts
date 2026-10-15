import { shopRedirect } from '@/lib/shop-redirect'
import type { createClient } from '@/lib/supabase/server'
export async function requireSystemAccess(supabase: Awaited<ReturnType<typeof createClient>>) {
  const redirect: (path: string) => never = await shopRedirect()

  const { data, error } = await supabase.rpc('has_system_access', {})
  if (error || !data) redirect('/access-closed')
}
