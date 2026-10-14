import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { needsPasswordSetup } from '@/lib/auth'
import AdminEmployeesClient, { type DirectoryEmployee } from './AdminEmployeesClient'

export default async function AdminEmployeesPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  if (await needsPasswordSetup(supabase, user.id)) {
    redirect('/set-password')
  }

  const { data: employee, error: employeeError } = await supabase
    .from('employees')
    .select('id, email, full_name, is_admin, is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (employeeError) {
    return (
      <main className="page-error">
        <section className="error-card">
          <div className="error-card-icon">!</div>
          <h1 className="error-title">Не удалось проверить роль</h1>
          <p className="error-text">{employeeError.message}</p>
        </section>
      </main>
    )
  }

  if (!employee?.is_admin || employee.is_active === false) {
    return (
      <main className="page-error">
        <section className="error-card">
          <div className="error-card-icon">!</div>
          <h1 className="error-title">Доступ запрещен</h1>
          <p className="error-text">
            Эта страница доступна только администраторам.
          </p>
          <Link href="/catalog" className="error-back-link">
            Вернуться в каталог
          </Link>
        </section>
      </main>
    )
  }

  const [{ data: directoryData, error: directoryError }, { data: ordersData }, { data: productsForStock }] =
    await Promise.all([
      supabase
        .from('employee_directory')
        .select('id, email, full_name, legal_entity, external_id, access_mode, access_expires_at, access_used_at, invitation_required, invitation_user_id, invitation_one_order, business_unit, position, hired_at, is_active, created_at, updated_at')
        .order('full_name', { ascending: true }),
      supabase
        .from('orders')
        .select('id'),
      supabase
        .from('products')
        .select('id, product_variants ( id, total_qty, reserved_qty, is_active )'),
    ])

  if (directoryError) {
    return (
      <main className="page-error">
        <section className="error-card">
          <div className="error-card-icon">!</div>
          <h1 className="error-title">Не удалось загрузить сотрудников</h1>
          <p className="error-text">{directoryError.message}</p>
        </section>
      </main>
    )
  }

  const stockAlertCount =
    productsForStock?.reduce((sum, product) => {
      const variants = product.product_variants ?? []
      const lowCount = variants.filter((variant) => {
        if (!variant.is_active) return false
        const available = Number(variant.total_qty) - Number(variant.reserved_qty)
        return available > 0 && available <= 4
      }).length
      return sum + lowCount
    }, 0) ?? 0

  return (
    <AdminEmployeesClient
      employees={(directoryData ?? []) as DirectoryEmployee[]}
      adminEmail={user.email ?? ''}
      orderCount={ordersData?.length ?? 0}
      stockAlertCount={stockAlertCount}
    />
  )
}
