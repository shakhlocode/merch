import ProductImage from '@/components/ProductImage'
import OrderContact from '@/components/OrderContact'
import {workStatus,workStatusLabel,workStatusLabels,workflowSteps,type WorkStatus,type OrderContactData} from '@/lib/order-workflow'
import {defaultStoreContent,orderMessage} from '@/lib/store-content'
import { displayColor, displaySize } from '@/lib/variant-labels'
import {fulfillmentLabel,DEFAULT_PICKUP_MESSAGE} from '@/lib/fulfillment'
import { requireSystemAccess } from '@/lib/system-access'
import AppNav from '@/components/AppNav'
import OrderBarcode from '@/components/OrderBarcode'
import Link from '@/components/ShopLink'
import { shopRedirect } from '@/lib/shop-redirect'
import { createClient } from '@/lib/supabase/server'
import { needsPasswordSetup } from '@/lib/auth'
import { decline } from '@/lib/utils'
import type { DeliveryType, OrderStatus } from '@/lib/supabase/types'

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Types                                                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

type OrderItem = {
  id: string
  product_id?: string | null
  product_name: string
  image_url?: string | null
  size: string | null
  color: string | null
  sku: string | null
  qty: number
}

type Order = {
  id: string
  order_number: string
  order_scope:string
  fulfillment_choice_name: string|null
  fulfillment_mode: string|null
  legal_entity: string|null
  visit_from:string|null
  visit_until:string|null
  is_remote: boolean
  pickup_code: string | null
  remote_contact_name: string | null
  received_by_name: string | null
  status: OrderStatus
  delivery_type: DeliveryType
  delivery_address: string | null
  full_name: string | null
  phone: string | null
  email: string | null
  city: string | null
  department: string | null
  comment: string | null
  admin_comment: string | null
  tracking_number: string | null
  created_at: string
  confirmed_at: string | null
  shipped_at: string | null
  received_at: string | null
  cancelled_at: string | null
  order_items: OrderItem[]
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Constants                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

const statusPillClass: Record<OrderStatus, string> = {
  new:        'pill pill-amber',
  review:     'pill pill-amber',
  confirmed:  'pill pill-blue',
  assembling: 'pill pill-blue',
  ready: 'pill pill-green',
  shipped:    'pill pill-green',
  received:   'pill pill-green',
  cancelled:  'pill pill-red',
  rejected:   'pill pill-red',
}


/* ─────────────────────────────────────────────────────────────────────────── */
/*  Page                                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

export default async function OrdersPage() {
  const redirect: (path: string) => never = await shopRedirect()

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  await requireSystemAccess(supabase)

  if (await needsPasswordSetup(supabase, user.id)) redirect('/set-password')

  const { data: rawOrders, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, order_scope, fulfillment_mode, fulfillment_choice_name, legal_entity, visit_from, visit_until, status, is_remote, pickup_code, remote_contact_name, received_by_name, delivery_type, delivery_address,
      full_name, phone, email, city, department,
      comment, admin_comment, tracking_number,
      created_at, confirmed_at, shipped_at, received_at, cancelled_at,
      order_items ( id, product_id, product_name, size, color, sku, qty )
    `)
    .eq('employee_id', user.id)
    .order('created_at', { ascending: false })

  const [{data:settings},{data:contacts}] = await Promise.all([
    supabase.from('merch_settings').select('*').eq('id',1).maybeSingle(),
    supabase.rpc('order_responsible_contacts',{p_order_ids:(rawOrders||[]).slice(0,2000).map(o=>o.id)}),
  ])

  const isAdmin = Boolean((await supabase.rpc('is_admin', {})).data)

  /* ── Error state ───────────────────────────────────────────────────────── */
  if (error) {
    return (
      <div>
        <PageHeader isAdmin={isAdmin} />
        <div className="orders-content">
          <div className="orders-empty orders-empty-narrow">
            <div className="empty-mark">!</div>
            <h1 className="section-title">Не удалось загрузить заказы</h1>
            <p>{error.message}</p>
            <Link href="/" className="btn btn-accent btn-md">Вернуться к выбору</Link>
          </div>
        </div>
      </div>
    )
  }

  const productIds = [...new Set((rawOrders ?? []).flatMap(order => order.order_items.map(item => item.product_id)).filter((id): id is string => Boolean(id)))]
  const { data: productPhotos } = productIds.length
    ? await supabase.from('products').select('id, image_url, images').in('id', productIds)
    : { data: [] }
  const photos = new Map((productPhotos ?? []).map(product => [product.id, product.image_url || product.images?.find(Boolean) || null]))
  const orders = (rawOrders ?? []).map(order => ({
    ...order,
    order_items: order.order_items.map(item => ({ ...item, image_url: photos.get(item.product_id) ?? null })),
  })) as Order[]
  const activeOrders  = orders.filter(o => !['received','cancelled','rejected'].includes(o.status)).length
  const doneOrders    = orders.filter(o => o.status === 'received').length

  /* ── Main render ───────────────────────────────────────────────────────── */
  return (
    <div>
      <PageHeader isAdmin={isAdmin} />

      <div className="orders-content">

        {/* ── Heading ── */}
        <header className="orders-head">
          <div>
            <span className="kicker">Мои заказы</span>
            <h1 className="display">
              История и статусы
            </h1>
            <p className="lead">
              Ваши заявки на корпоративный мерч, текущий статус обработки и детали получения.
            </p>
          </div>
          <Link href="/" className="btn btn-ghost btn-md">
            ← В каталог
          </Link>
        </header>

        {/* ── Stats ── */}
        <div className="stat-row">
          <StatCard label="Всего заказов"  value={orders.length} />
          <StatCard label="В работе"       value={activeOrders} />
          <StatCard label="Получено"       value={doneOrders} />
        </div>

        {/* ── Orders list ── */}
        {orders.length === 0 ? (
          <div className="orders-empty">
            <div className="empty-mark">+</div>
            <h2 className="section-title">Заказов пока нет</h2>
            <p>
              Перейдите в каталог, выберите мерч и оформите первую заявку.
            </p>
            <Link href="/" className="btn btn-accent btn-md">Выбрать мерч</Link>
          </div>
        ) : (
          <div className="orders-list">
            {orders.map(order => (
              <OrderCard key={order.id} order={order} contact={contacts?.find(c=>c.order_id===order.id)} message={orderMessage(settings||defaultStoreContent,order.order_scope,order.fulfillment_mode,order.is_remote)||DEFAULT_PICKUP_MESSAGE} />
            ))}
          </div>
        )}

      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  PageHeader — server-renderable site header                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

function PageHeader({ isAdmin }: { isAdmin: boolean }) {
  return (
    <header className="site-head">
      <div className="site-head-glass" aria-hidden="true" />
      <div className="head-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/uzum-big-logo.webp" alt="Uzum" />
          </span>
          <span className="brand-name">
            uzum <span className="brand-name-soft">мерч</span>
          </span>
          <span className="brand-sub">внутренний портал</span>
        </Link>

        {/* AppNav renders <nav className="head-nav"> — centres itself in the 1fr column */}
        <AppNav isAdmin={isAdmin} showLogout />
      </div>
    </header>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  StatCard                                                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  OrderCard                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function OrderCard({ order,message,contact }: { order: Order; message:string;contact?:OrderContactData|null }) {
  const items    = order.order_items ?? []
  const totalQty = items.reduce((s, i) => s + Number(i.qty), 0)

  const isRejected = order.status === 'cancelled' || order.status === 'rejected'
  const isReceived = order.status === 'received'
  const flowStatuses=workflowSteps(order.is_remote)
  const stage=workStatus(order)

  return (
    <article className="order">

      {/* ── Top: number + date + status pill ── */}
      <div className="order-top">
        <div className="order-meta">
          <span className="order-id">#{order.order_number}</span><span>{order.order_scope==='welcome'?'Welcome pack':'Каталог'}</span>
          <span className="order-date">Оформлен {formatDateShort(order.created_at)}</span>
          {order.tracking_number && (
            <span className="order-track">Трек: {order.tracking_number}</span>
          )}
        </div>
        <span className={statusPillClass[(stage==='closed'?'cancelled':stage) as OrderStatus]}>
          {workStatusLabel(order)}
        </span>
      </div>

      {/* ── Mid: thumbs | items | delivery side ── */}
      <div className="order-mid">
        <div className="order-thumbs">
          {items.slice(0, 4).map(item => (
            <div key={item.id} className="order-thumb">
              {item.image_url ? (
                <ProductImage src={item.image_url} alt={item.product_name} sizes="64px" className="order-thumb-photo" />
              ) : (
                <span role="img" aria-label={`Нет фото: ${item.product_name}`} title={item.product_name}>▧</span>
              )}
            </div>
          ))}
        </div>

        <div className="order-items">
          {items.map(item => (
            <div key={item.id} className="order-item">
              <b>{item.product_name}</b>
              <span>{formatVariant(item)} · {item.qty} шт.</span>
            </div>
          ))}
        </div>

        <div className="order-side">
          <span className="kicker">{isReceived ? 'Получено' : 'Получение'}</span>
          <p className="order-side-main">
            {isReceived && order.received_at
              ? formatDateShort(order.received_at)
              : (order.fulfillment_choice_name||fulfillmentLabel(order.fulfillment_mode,order.is_remote))}
          </p>
          <p className="order-side-mute">{order.delivery_address || 'Адрес не указан'}</p>
        </div>
      </div>

      {/* ── Progress timeline ── */}
      <div className="order-timeline">
        {isRejected ? (
          <div className="order-final-status">
            {order.status === 'cancelled' ? 'Заказ был отменён.' : 'Заказ был отклонён.'}
          </div>
        ) : (
          flowStatuses.map(step => {
            const stepIdx    = flowStatuses.indexOf(step)
            const currentIdx = Math.max(0, flowStatuses.indexOf(stage as OrderStatus))
            const isDone     = stepIdx < currentIdx
            const isCurrent  = stepIdx === currentIdx

            return (
              <div
                key={step}
                className={`timeline-step${isDone ? ' done' : ''}${isCurrent ? ' current' : ''}`}
              >
                <span className={`timeline-dot${isDone ? ' done' : ''}${isCurrent ? ' current' : ''}`} />
                <span className="timeline-lbl">{workStatusLabels[step as WorkStatus]}</span>
              </div>
            )
          })
        )}
      </div>

      {/* ── Comments ── */}
      {(order.comment || order.admin_comment) && (
        <div className="order-comments">
          {order.comment && (
            <div className="comment-box">
              <span>Ваш комментарий</span>
              <p>{order.comment}</p>
            </div>
          )}
          {order.admin_comment && (
            <div className="comment-box comment-box-admin">
              <span>Комментарий администратора</span>
              <p>{order.admin_comment}</p>
            </div>
          )}
        </div>
      )}

      {order.is_remote && !isRejected && <div className="order-pickup">
        <p className="pickup-message">{message}</p>
      </div>}
      {order.fulfillment_mode==='remote_visit'&&<p>Ваш визит в Ташкент: с {order.visit_from} по {order.visit_until}.{!isRejected&&!isReceived?' Мерч зарезервирован, администратор свяжется с вами.':''}</p>}
      {!isRejected&&!order.is_remote&&!isReceived&&<p className="pickup-message">{message}</p>}
      {isReceived && <p>Выдали: {order.received_at ? formatDateTime(order.received_at) : 'Дата не указана'} · {order.received_by_name || 'Администратор не указан'}</p>}
      {!isRejected&&<OrderContact contact={contact}/>}
      {/* ── Pickup barcode ── */}
      {!isRejected && !order.is_remote && order.pickup_code && (
        <div className="order-pickup">
          <OrderBarcode value={order.pickup_code} size={320} orderNumber={order.order_number} downloadable />
          <div className="order-pickup-text">
            <b>Код для получения: <span className="order-pickup-num">#{order.order_number}</span></b>
            <span>
              {isReceived
                ? 'Заказ уже выдали.'
                : 'Покажите штрихкод при получении. Выдача доступна после статуса «Можно забирать».'}
            </span>
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div className="order-foot">
        <div className="order-foot-info">
          <span>{totalQty} шт.</span>
          <span>·</span>
          <span>{items.length} {decline(items.length, ['позиция', 'позиции', 'позиций'])}</span>
        </div>
        <div className="order-foot-actions">
          {order.tracking_number && (
            <span className="order-status-note">Трек-номер указан</span>
          )}
          {isReceived && (
            <span className="order-status-note">Заказ завершён ✓</span>
          )}
          {!isReceived && !isRejected && (
            <span className="order-foot-mute">
              Статус обновляется администратором
            </span>
          )}
        </div>
      </div>

    </article>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

function formatVariant(item: OrderItem) {
  return [displayColor(item.color), displaySize(item.size)]
    .filter(Boolean)
    .join(' · ')
}

function formatDateShort(value: string) {
  return new Date(value).toLocaleDateString('ru-RU', {
    timeZone: 'Asia/Tashkent',
    day:      'numeric',
    month:    'short',
    year:     'numeric',
  })
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    timeZone: 'Asia/Tashkent',
    day:      'numeric',
    month:    'short',
    year:     'numeric',
    hour:     '2-digit',
    minute:   '2-digit',
  })
}
