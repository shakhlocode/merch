import CsvDownload from '@/components/CsvDownload'
import type {StockRow} from '@/lib/analytics'
import {activeWorkStatuses,workStatus,workStatusLabel,workStatusLabels,type WorkStatus} from '@/lib/order-workflow'
import {orderAction} from '@/lib/order-attention'
import AdminShell from '@/components/AdminShell'
import { createClient } from '@/lib/supabase/server'
import { needsPasswordSetup } from '@/lib/auth'
import { redirect } from 'next/navigation'

type OrderStatus =
  | 'new' | 'review' | 'confirmed' | 'assembling'
  | 'ready' | 'shipped' | 'received' | 'cancelled' | 'rejected'

type AdminDashOrder = {
  id: string
  order_number: string
  employee_id: string
  status: OrderStatus
  is_remote:boolean
  full_name: string | null
  email: string | null
  department: string | null
  created_at: string
}

export default async function AdminDashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (await needsPasswordSetup(supabase, user.id)) redirect('/set-password')

  const { data: employee } = await supabase
    .from('employees')
    .select('is_admin, is_active, email')
    .eq('id', user.id)
    .maybeSingle()

  if (!employee?.is_admin || !employee.is_active) redirect('/catalog')

  // Read every page: dashboard counts and CSV must not stop at 1,000 orders.
  async function loadOrders() {
    const rows:AdminDashOrder[]=[]
    for(let offset=0;;offset+=1000){
      const {data,error}=await supabase.from('orders').select('id,order_number,employee_id,status,is_remote,full_name,email,department,created_at').order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+999)
      if(error)throw new Error('Не удалось загрузить сводку заказов')
      rows.push(...data)
      if(data.length<1000)return rows
    }
  }
  const [orders,stockResult,{data:tasks}]=await Promise.all([
    loadOrders(),supabase.rpc('admin_stock_report',{}),
    supabase.from('order_tasks').select('id,order_id,due_on,reserve_until,contacted_at').is('closed_at',null),
  ])
  if(stockResult.error)throw new Error('Не удалось загрузить остатки')
  const stock=stockResult.data as StockRow[]

  const activeOrders = orders.filter(
    o => !['received', 'cancelled', 'rejected'].includes(o.status)
  )

  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  const newThisWeek = orders.filter(o => new Date(o.created_at) >= weekAgo)

  const attentionCount=orders.filter(o=>orderAction(o,tasks?.find(t=>t.order_id===o.id)).needsAction).length

  const lowStockVariants = stock.filter(v=>v.alert).map(v=>({
    productName:v.product_name,sku:v.sku,size:v.size,color:v.color,
    availableQty:v.available_qty,threshold:v.low_stock_threshold,
  }))

  const statusCounters = activeWorkStatuses.filter(status=>status!=='shipped'||orders.some(o=>o.is_remote)).map(status => ({
    status,
    label: workStatusLabels[status],
    count: orders.filter(o => workStatus(o) === status).length,
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
      <div className="pickup-option-actions"><a href="/admin/analytics" className="ao-light-btn">Аналитика выдач за период →</a><CsvDownload filename="uzum-merch-dashboard.csv" label="Сводка CSV" rows={[
        {'Показатель':'Активных заказов','Количество':String(activeOrders.length)},
        {'Показатель':'Новые заявки за последние 7 дней','Количество':String(newThisWeek.length)},
        {'Показатель':'Предупреждений об остатках','Количество':String(lowStockVariants.length)},
        ...statusCounters.map(s=>({'Показатель':s.label,'Количество':String(s.count)})),
      ]}/></div>
      {/* ── KPI row ── */}
      <section className="dash-kpi-grid">
        <KpiCard tone="primary"  label="Активных заказов"        value={String(activeOrders.length)}     hint={`из ${orders.length} всего`} />
        <KpiCard tone="default"  label="Новые за неделю"         value={String(newThisWeek.length)}      hint="заявки за последние 7 дней" />
        <KpiCard tone="danger"   label="Позиций в дефиците"      value={String(lowStockVariants.length)} hint="по настроенным порогам" />
        <a href="/admin/orders?work=attention" className="dash-kpi-link"><KpiCard tone="default" label="Требуют внимания" value={String(attentionCount)} hint="подготовить, связаться или выдать →"/></a>
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
            <div><a href="/admin/orders" className="dash-card-link">Все →</a><CsvDownload filename="uzum-merch-recent-orders.csv" label="CSV списка" rows={recentOrders.map(o=>({'Заказ':o.order_number,'Статус':workStatusLabel(o),'Дата создания':o.created_at}))}/></div>
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
                  <span className={getStatusBadgeClass(workStatus(order))}>
                    {workStatusLabel(order)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Низкие остатки */}
        <div className="dash-card">
          <div className="dash-card-head">
            <h2 className="dash-card-title">Предупреждения об остатках</h2>
            <a href="/admin/products" className="dash-card-link">В склад →</a>
          </div>
          <a className="ao-light-btn" href="/api/admin/analytics?report=alerts">Экспорт CSV</a>
          {lowStockVariants.length>7&&<p>Показаны 7 из {lowStockVariants.length}. Все предупреждения — в аналитике и CSV.</p>}
          <div className="dash-stock-list">
            {lowStockVariants.length === 0 ? (
              <p className="dash-empty-text">Критичных остатков нет.</p>
            ) : lowStockVariants.slice(0, 7).map((variant, index) => (
              <div key={`${variant.productName}-${variant.sku}-${index}`} className="dash-stock-row">
                <div className="dash-stock-mark">{variant.availableQty}</div>
                <div>
                  <b>{variant.productName}</b>
                  <span>{formatVariant(variant.size, variant.color)} · SKU: {variant.sku || '—'} · порог {variant.threshold} шт.</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Журнал */}
        <div className="dash-card">
          <div className="dash-card-head">
            <h2 className="dash-card-title">Журнал действий</h2>
            <CsvDownload filename="uzum-merch-recent-activity.csv" label="CSV списка" rows={recentActivity.map(o=>({'Заказ':o.order_number,'Статус':workStatusLabel(o),'Дата создания':o.created_at}))}/>
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
                    {order.full_name || order.email || 'Сотрудник'} · {workStatusLabel(order)}
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

function getStatusDotClass(status: WorkStatus) {
  if (status === 'new')     return 'dash-status-dot-amber'
  if (status === 'assembling') return 'dash-status-dot-blue'
  if (status === 'ready' || status === 'shipped' || status === 'received')   return 'dash-status-dot-green'
  return 'dash-status-dot-red'
}

function getStatusBadgeClass(status: WorkStatus) {
  if (status === 'ready' || status === 'shipped' || status === 'received')   return 'dash-badge dash-badge-green'
  if (status === 'assembling') return 'dash-badge dash-badge-blue'
  if (status === 'closed') return 'dash-badge dash-badge-red'
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
