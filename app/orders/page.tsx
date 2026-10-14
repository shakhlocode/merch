import AppNav from '@/components/AppNav'
import OrderBarcode from '@/components/OrderBarcode'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { needsPasswordSetup } from '@/lib/auth'
import { decline, getProductLetter } from '@/lib/utils'
import type { DeliveryType, OrderStatus } from '@/lib/supabase/types'

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Types                                                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

type OrderItem = {
  id: string
  product_id?: string | null
  product_name: string
  size: string | null
  color: string | null
  sku: string | null
  qty: number
}

type Order = {
  id: string
  order_number: string
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

const deliveryLabels: Record<DeliveryType, string> = {
  office:  'В офис',
  pvz:     'ПВЗ / филиал',
  pickup:  'Самовывоз',
  courier: 'Курьер',
}

const flowStatuses: OrderStatus[] = [
  'new', 'review', 'confirmed', 'assembling', 'ready', 'shipped', 'received',
]

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Page                                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

export default async function OrdersPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (await needsPasswordSetup(supabase, user.id)) redirect('/set-password')

  const { data: employee } = await supabase
    .from('employees')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle()

  const { data: rawOrders, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, status, is_remote, pickup_code, remote_contact_name, received_by_name, delivery_type, delivery_address,
      full_name, phone, email, city, department,
      comment, admin_comment, tracking_number,
      created_at, confirmed_at, shipped_at, received_at, cancelled_at,
      order_items ( id, product_id, product_name, size, color, sku, qty )
    `)
    .eq('employee_id', user.id)
    .order('created_at', { ascending: false })

  const { data: settings } = await supabase
    .from('merch_settings')
    .select('handout_deadline, handout_place, handout_note')
    .eq('id', 1)
    .maybeSingle()

  const isAdmin = Boolean(employee?.is_admin)

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
            <Link href="/catalog" className="btn btn-accent btn-md">Вернуться в каталог</Link>
          </div>
        </div>
      </div>
    )
  }

  const orders        = (rawOrders ?? []) as Order[]
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
          <Link href="/catalog" className="btn btn-ghost btn-md">
            ← В каталог
          </Link>
        </header>

        {/* ── Stats ── */}
        <div className="stat-row">
          <StatCard label="Всего заказов"  value={orders.length} />
          <StatCard label="В работе"       value={activeOrders} />
          <StatCard label="Получено"       value={doneOrders} />
        </div>

        {/* ── Handout deadline / place ── */}
        {settings && (settings.handout_deadline || settings.handout_place || settings.handout_note) && (
          <div className="handout-banner">
            <span className="kicker">Раздача мерча</span>
            {settings.handout_deadline && (
              <span><b>Когда:</b> {formatDateTime(settings.handout_deadline)}</span>
            )}
            {settings.handout_place && (
              <span><b>Где:</b> {settings.handout_place}</span>
            )}
            {settings.handout_note && <span>{settings.handout_note}</span>}
          </div>
        )}

        {/* ── Orders list ── */}
        {orders.length === 0 ? (
          <div className="orders-empty">
            <div className="empty-mark">+</div>
            <h2 className="section-title">Заказов пока нет</h2>
            <p>
              Перейдите в каталог, выберите мерч и оформите первую заявку.
            </p>
            <Link href="/catalog" className="btn btn-accent btn-md">Перейти в каталог</Link>
          </div>
        ) : (
          <div className="orders-list">
            {orders.map(order => (
              <OrderCard key={order.id} order={order} />
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
        <Link href="/catalog" className="brand">
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

function OrderCard({ order }: { order: Order }) {
  const items    = order.order_items ?? []
  const totalQty = items.reduce((s, i) => s + Number(i.qty), 0)

  const isRejected = order.status === 'cancelled' || order.status === 'rejected'
  const isReceived = order.status === 'received'

  return (
    <article className="order">

      {/* ── Top: number + date + status pill ── */}
      <div className="order-top">
        <div className="order-meta">
          <span className="order-id">#{order.order_number}</span>
          <span className="order-date">Оформлен {formatDateShort(order.created_at)}</span>
          {order.tracking_number && (
            <span className="order-track">Трек: {order.tracking_number}</span>
          )}
        </div>
        <span className={statusPillClass[order.status]}>
          {statusLabels[order.status]}
        </span>
      </div>

      {/* ── Mid: thumbs | items | delivery side ── */}
      <div className="order-mid">
        <div className="order-thumbs">
          {items.slice(0, 4).map(item => (
            <div key={item.id} className="order-thumb">
              {getProductLetter(item.product_name)}
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
              : deliveryLabels[order.delivery_type]}
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
            const currentIdx = Math.max(0, flowStatuses.indexOf(order.status))
            const isDone     = stepIdx < currentIdx
            const isCurrent  = stepIdx === currentIdx

            return (
              <div
                key={step}
                className={`timeline-step${isDone ? ' done' : ''}${isCurrent ? ' current' : ''}`}
              >
                <span className={`timeline-dot${isDone ? ' done' : ''}${isCurrent ? ' current' : ''}`} />
                <span className="timeline-lbl">{getFlowLabel(step)}</span>
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
        <p>Ваш заказ принят. {order.remote_contact_name ? `${order.remote_contact_name} свяжется с вами` : 'Ответственный сотрудник свяжется с вами'} и сообщит, как получить мерч, включая трек-номер при отправке. Штрихкод для офисной выдачи не нужен.</p>
      </div>}
      {isReceived && <p>Выдали: {order.received_at ? formatDateTime(order.received_at) : 'Дата не указана'} · {order.received_by_name || 'Администратор не указан'}</p>}
      {/* ── Pickup barcode ── */}
      {!isRejected && !order.is_remote && order.pickup_code && (
        <div className="order-pickup">
          <OrderBarcode value={order.pickup_code} size={320} />
          <div className="order-pickup-text">
            <b>Код для получения: <span className="order-pickup-num">#{order.order_number}</span></b>
            <span>
              {isReceived
                ? 'Заказ уже выдали.'
                : 'Покажите штрихкод при получении. Выдача доступна после статуса «Готов к выдаче».'}
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
  return [item.color || 'Без цвета', item.size || 'ONE SIZE']
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

function getFlowLabel(status: OrderStatus) {
  const map: Partial<Record<OrderStatus, string>> = {
    new:        'Заявка',
    review:     'Проверка',
    confirmed:  'Подтверждение',
    assembling: 'Сборка',
    ready: 'Готов к выдаче',
    shipped:    'Отправка',
    received:   'Получение',
  }
  return map[status] ?? statusLabels[status]
}
