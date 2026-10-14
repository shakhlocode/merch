import AdminShell from '@/components/AdminShell'
import { createClient } from '@/lib/supabase/server'
import { needsPasswordSetup } from '@/lib/auth'
import { redirect } from 'next/navigation'

type OrderStatus =
  | 'new' | 'review' | 'confirmed' | 'assembling'
  | 'ready' | 'shipped' | 'received' | 'cancelled' | 'rejected'

type AdminDashOrderItem = {
  id: string
  product_name: string
  size: string | null
  color: string | null
  sku: string | null
  qty: number
}

type AdminDashOrder = {
  id: string
  order_number: string
  employee_id: string
  status: OrderStatus
  full_name: string | null
  email: string | null
  department: string | null
  created_at: string
  order_items: AdminDashOrderItem[]
}

type AdminDashVariant = {
  id: string
  size: string | null
  color: string | null
  sku: string | null
  total_qty: number
  reserved_qty: number
  is_active: boolean
}

type AdminDashProduct = {
  id: string
  name: string
  is_active: boolean
  product_variants: AdminDashVariant[]
}

const statusLabels: Record<OrderStatus, string> = {
  new:        'Новый',
  review:     'На проверке',
  confirmed:  'Подтверждён',
  assembling: 'Собирается',
  ready: 'Готов к выдаче',
  shipped:    'Отправлен',
  received:   'Выдали',
  cancelled:  'Отменён',
  rejected:   'Отклонён',
}

const statusOrder: OrderStatus[] = [
  'new', 'review', 'confirmed', 'assembling', 'ready', 'shipped', 'received', 'cancelled', 'rejected',
]

export default async function AdminDashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (await needsPasswordSetup(supabase, user.id)) redirect('/set-password')

  const { data: employee } = await supabase
    .from('employees')
    .select('is_admin, email')
    .eq('id', user.id)
    .maybeSingle()

  if (!employee?.is_admin) redirect('/catalog')

  const [{ data: ordersData }, { data: productsData }] = await Promise.all([
    supabase
      .from('orders')
      .select(`
        id, order_number, employee_id, status, full_name, email, department, created_at,
        order_items ( id, product_name, size, color, sku, qty )
      `)
      .order('created_at', { ascending: false }),

    supabase
      .from('products')
      .select(`
        id, name, is_active,
        product_variants ( id, size, color, sku, total_qty, reserved_qty, is_active )
      `)
      .order('created_at', { ascending: false }),
  ])

  const orders   = ((ordersData   ?? []) as unknown) as AdminDashOrder[]
  const products = ((productsData ?? []) as unknown) as AdminDashProduct[]

  const activeOrders = orders.filter(
    o => !['received', 'cancelled', 'rejected'].includes(o.status)
  )

  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  const newThisWeek = orders.filter(o => new Date(o.created_at) >= weekAgo)

  const uniqueEmployees = new Set(orders.map(o => o.employee_id)).size

  const lowStockVariants = products.flatMap(product =>
    product.product_variants
      .filter(v => v.is_active)
      .map(v => ({
        productName:  product.name,
        sku:          v.sku,
        size:         v.size,
        color:        v.color,
        availableQty: Math.max(0, Number(v.total_qty) - Number(v.reserved_qty)),
      }))
      .filter(v => v.availableQty <= 4)
  )

  const statusCounters = statusOrder.map(status => ({
    status,
    label: statusLabels[status],
    count: orders.filter(o => o.status === status).length,
  }))

  const recentOrders   = orders.slice(0, 6)
  const recentActivity = orders.slice(0, 7)

  return (
    <AdminShell
      adminEmail={employee.email || user.email || 'admin'}
      title="Сводка"
      subtitle="Админ-панель · merch.uzum.tech"
      orderCount={orders.length}
      stockAlertCount={lowStockVariants.length}
    >
      {/* ── KPI row ── */}
      <section className="dash-kpi-grid">
        <KpiCard tone="primary"  label="Активных заказов"        value={String(activeOrders.length)}     hint={`из ${orders.length} всего`} />
        <KpiCard tone="default"  label="Новые за неделю"         value={String(newThisWeek.length)}      hint="заявки за последние 7 дней" />
        <KpiCard tone="danger"   label="Позиций в дефиците"      value={String(lowStockVariants.length)} hint="≤ 4 шт. доступно" />
        <KpiCard tone="default"  label="Сотрудников с заказами"  value={String(uniqueEmployees)}         hint="уникальных получателей" />
      </section>

      {/* ── Dashboard 2×2 ── */}
      <section className="dash-grid">

        {/* По статусам */}
        <div className="dash-card">
          <div className="dash-card-head">
            <h2 className="dash-card-title">По статусам</h2>
            <a href="/admin/orders" className="dash-card-link">Все заказы →</a>
          </div>
          <div className="dash-status-grid">
            {statusCounters.map(item => (
              <div key={item.status} className="dash-status-tile">
                <span className={`dash-status-dot ${getStatusDotClass(item.status)}`} />
                <b>{item.count}</b>
                <small>{item.label}</small>
              </div>
            ))}
          </div>
        </div>

        {/* Свежие заказы */}
        <div className="dash-card">
          <div className="dash-card-head">
            <h2 className="dash-card-title">Свежие заказы</h2>
            <a href="/admin/orders" className="dash-card-link">Все →</a>
          </div>
          <div className="dash-recent-list">
            {recentOrders.length === 0 ? (
              <p className="dash-empty-text">Заказов пока нет.</p>
            ) : recentOrders.map(order => (
              <div key={order.id} className="dash-recent-row">
                <div>
                  <b>#{order.order_number}</b>
                  <span>{order.full_name || order.email || 'Сотрудник'}</span>
                </div>
                <div className="dash-recent-right">
                  <small>{formatRelativeDate(order.created_at)}</small>
                  <span className={getStatusBadgeClass(order.status)}>
                    {statusLabels[order.status]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Низкие остатки */}
        <div className="dash-card">
          <div className="dash-card-head">
            <h2 className="dash-card-title">Низкие остатки</h2>
            <a href="/admin/products" className="dash-card-link">В склад →</a>
          </div>
          <div className="dash-stock-list">
            {lowStockVariants.length === 0 ? (
              <p className="dash-empty-text">Критичных остатков нет.</p>
            ) : lowStockVariants.slice(0, 7).map((variant, index) => (
              <div key={`${variant.productName}-${variant.sku}-${index}`} className="dash-stock-row">
                <div className="dash-stock-mark">{variant.availableQty}</div>
                <div>
                  <b>{variant.productName}</b>
                  <span>{formatVariant(variant.size, variant.color)} · SKU: {variant.sku || '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Журнал */}
        <div className="dash-card">
          <div className="dash-card-head">
            <h2 className="dash-card-title">Журнал действий</h2>
            <span className="dash-card-link">CSV</span>
          </div>
          <div className="dash-activity-list">
            {recentActivity.length === 0 ? (
              <p className="dash-empty-text">Активности пока нет.</p>
            ) : recentActivity.map(order => (
              <div key={order.id} className="dash-activity-row">
                <span className="dash-activity-dot" />
                <div>
                  <b>Создан заказ #{order.order_number}</b>
                  <span>
                    {order.full_name || order.email || 'Сотрудник'} · {statusLabels[order.status]}
                  </span>
                </div>
                <small>{formatRelativeDate(order.created_at)}</small>
              </div>
            ))}
          </div>
        </div>

      </section>
    </AdminShell>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  KpiCard                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

function KpiCard({
  label, value, hint, tone,
}: {
  label: string
  value: string
  hint: string
  tone: 'primary' | 'danger' | 'default'
}) {
  const cls =
    tone === 'primary' ? 'dash-kpi dash-kpi-primary' :
    tone === 'danger'  ? 'dash-kpi dash-kpi-danger'  : 'dash-kpi'
  return (
    <div className={cls}>
      <span>{label}</span>
      <b>{value}</b>
      <small>{hint}</small>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

function getStatusDotClass(status: OrderStatus) {
  if (status === 'new'       || status === 'review')     return 'dash-status-dot-amber'
  if (status === 'confirmed' || status === 'assembling') return 'dash-status-dot-blue'
  if (status === 'shipped'   || status === 'received')   return 'dash-status-dot-green'
  return 'dash-status-dot-red'
}

function getStatusBadgeClass(status: OrderStatus) {
  if (status === 'shipped'   || status === 'received')   return 'dash-badge dash-badge-green'
  if (status === 'confirmed' || status === 'assembling') return 'dash-badge dash-badge-blue'
  if (status === 'cancelled' || status === 'rejected')   return 'dash-badge dash-badge-red'
  return 'dash-badge dash-badge-amber'
}

function formatVariant(size: string | null, color: string | null) {
  return [color || 'Без цвета', size || 'ONE SIZE'].join(' · ')
}

function formatRelativeDate(value: string) {
  const date    = new Date(value)
  const diffMs  = Date.now() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays <= 0) return 'сегодня'
  if (diffDays === 1) return 'вчера'
  if (diffDays < 7)   return `${diffDays} дн. назад`

  return date.toLocaleDateString('ru-RU', {
    timeZone: 'Asia/Tashkent',
    day:   'numeric',
    month: 'short',
  })
}
