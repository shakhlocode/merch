import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'
import { redirect } from 'next/navigation'
import AdminShell from '@/components/AdminShell'
import FulfillmentSettings from './settings'
import { DEFAULT_PICKUP_MESSAGE } from '@/lib/fulfillment'
export default async function Page() {
  const s = await createClient(),
    a = await requireAdmin(s)
  if (!a.ok) redirect('/login')
  const [{ data: offices, error }, { data: settings }] = await Promise.all([
    s.from('pickup_offices').select('*').order('sort').order('name'),
    s.from('merch_settings').select('pickup_message').eq('id', 1).single(),
  ])
  return (
    <AdminShell adminEmail={a.user.email || ''} title="Офисы и получение">
      {error ? (
        <p role="alert">Не удалось загрузить офисы. Обновите страницу.</p>
      ) : (
        <FulfillmentSettings
          offices={offices || []}
          message={settings?.pickup_message || DEFAULT_PICKUP_MESSAGE}
        />
      )}
    </AdminShell>
  )
}
