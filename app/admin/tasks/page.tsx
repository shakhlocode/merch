import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'
import { redirect } from 'next/navigation'
import AdminShell from '@/components/AdminShell'
import Tasks from './tasks'
export default async function Page() {
  const s = await createClient(),
    a = await requireAdmin(s)
  if (!a.ok) redirect('/login')
  const { data, error } = await s
    .from('order_tasks')
    .select(
      '*,orders(id,order_number,status,full_name,phone,pickup_office_name,visit_from,visit_until)'
    )
    .is('closed_at', null)
    .order('due_on')
  return (
    <AdminShell adminEmail={a.user.email || ''} title="Задачи по визитам">
      {error ? (
        <p role="alert">Не удалось загрузить задачи. Обновите страницу.</p>
      ) : (
        <Tasks tasks={data || []} />
      )}
    </AdminShell>
  )
}
