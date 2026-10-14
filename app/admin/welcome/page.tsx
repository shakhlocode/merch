import { redirect } from 'next/navigation'
import AdminShell from '@/components/AdminShell'
import { requireAdmin } from '@/lib/admin'
import { createClient } from '@/lib/supabase/server'
import WelcomeInvitations from './WelcomeInvitations'

export default async function Page() {
  const supabase = await createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) redirect('/login')

  const { data, error } = await supabase
    .from('employee_directory')
    .select('id,full_name,email,external_id')
    .eq('is_active', true)
    .order('full_name')

  return (
    <AdminShell adminEmail={admin.user.email || ''} title="Welcome pack">
      {error ? (
        <p role="alert">Не удалось загрузить сотрудников. Обновите страницу.</p>
      ) : (
        <WelcomeInvitations employees={data || []} />
      )}
    </AdminShell>
  )
}
