import type {StockRow} from '@/lib/analytics'
import Link from '@/components/ShopLink'
import { shopRedirect } from '@/lib/shop-redirect'
import { createClient } from '@/lib/supabase/server'
import { needsPasswordSetup } from '@/lib/auth'
import AdminOrdersClient, { type AdminOrder } from './AdminOrdersClient'
import type { EditableVariant } from '@/components/OrderItemsEditor'

export default async function AdminOrdersPage() {
  const redirect: (path: string) => never = await shopRedirect()

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

  if (!(await supabase.rpc('is_admin', {})).data || !employee || !employee.is_active) {
    return (
      <main className="page-error">
        <section className="error-card">
          <div className="error-card-icon">🔒</div>
          <h1 className="error-title">Доступ запрещён</h1>
          <p className="error-text">
            Эта страница доступна только администраторам.
          </p>
          <Link href="/catalog" className="error-back-link">
            ← Вернуться в каталог
          </Link>
        </section>
      </main>
    )
  }

  const { data, error } = await supabase
    .from('orders')
    .select(
      `
      id,
      order_number,
      order_scope,
      fulfillment_mode,fulfillment_choice_name,legal_entity,pickup_office_name,visit_from,visit_until,
      pickup_code,
      version,
      received_by_name,
      remote_contact_name,
      employee_id,
      status,
      delivery_type,
      delivery_address,
      full_name,
      phone,
      email,
      city,
      department,
      comment,
      admin_comment,
      tracking_number, pvz_code,
      assigned_to,
      storage_location,
      pickup_status,
      handed_to,
      is_remote,
      country,
      created_at,
      confirmed_at,
      shipped_at,
      received_at,
      cancelled_at,
      order_items (
        id,
        variant_id,
        product_name,
        size,
        color,
        sku,
        qty
      )
    `
    )
    .order('created_at', { ascending: false })

  const {data:stockRows}=await supabase.rpc('admin_stock_report',{})
  const stockAlertCount=((stockRows||[]) as StockRow[]).filter(v=>v.alert).length

  if (error) {
    return (
      <main className="page-error">
        <section className="error-card">
          <div className="error-card-icon">!</div>
          <h1 className="error-title">Не удалось загрузить заказы</h1>
          <p className="error-text">{error.message}</p>
        </section>
      </main>
    )
  }

  const [{ data: variantRows }, { data: admins }, { data: events }, {data:tasks}] = await Promise.all([
    supabase.from('product_variants').select('id,product_id,size,color,sku,total_qty,reserved_qty,is_active,products(name,is_active,placement)'),
    supabase.rpc('admin_shop_contacts',{}),
    supabase.from('order_events').select('id,order_id,action,data,created_at').order('created_at', { ascending: false }).limit(200),
    supabase.from('order_tasks').select('id,order_id,due_on,reserve_until,contacted_at').is('closed_at',null),
  ])
  const variants: EditableVariant[] = (variantRows ?? []).map(v => {
    const product = Array.isArray(v.products) ? v.products[0] : v.products
    return { id: v.id, product_id: v.product_id,placement:product?.placement,
      label: [product?.name, v.size, v.color, v.sku].filter(Boolean).join(' · '),
      available_qty: v.is_active && product?.is_active ? Math.max(0, v.total_qty-v.reserved_qty) : 0 }
  })

  return (
    <AdminOrdersClient
      orders={(data ?? []) as AdminOrder[]}
      adminEmail={user.email ?? ''}
      stockAlertCount={stockAlertCount}
      variants={variants}
      tasks={tasks||[]}
      admins={admins ?? []}
      events={events ?? []}
    />
  )
}
