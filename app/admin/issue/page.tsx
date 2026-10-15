import { shopRedirect } from '@/lib/shop-redirect'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'
import AdminShell from '@/components/AdminShell'
import IssueClient from './IssueClient'

export default async function IssuePage() {
  const redirect: (path: string) => never = await shopRedirect()

  const supabase = await createClient()
  const access = await requireAdmin(supabase)
  if (!access.ok) {
    if (access.status === 401) redirect('/login')
    return <main className="page-error">Выдача доступна только активным администраторам.</main>
  }
  return <AdminShell adminEmail={access.employee.email} title="Выдача заказов">
    <IssueClient />
  </AdminShell>
}
