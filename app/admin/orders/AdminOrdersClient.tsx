'use client'

import { unitFetch } from '@/lib/shop-context'

import OrderContact from '@/components/OrderContact'
import {activeWorkStatuses,workStatus,workStatusLabel,workStatusLabels,workflowSteps,type WorkStatus} from '@/lib/order-workflow'
import {fulfillmentLabel} from '@/lib/fulfillment'
import {orderAction,type VisitReminder} from '@/lib/order-attention'
import {tashkentToday} from '@/lib/fulfillment'
import OrderNextAction from '@/components/OrderNextAction'
import AdminShell from '@/components/AdminShell'
import OrderBarcode from '@/components/OrderBarcode'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import JsBarcode from 'jsbarcode'
import Link from '@/components/ShopLink'
import OrderItemsEditor, { type EditableVariant } from '@/components/OrderItemsEditor'
import type { DeliveryType, OrderStatus } from '@/lib/supabase/types'
import { getExportDate, getProductLetter, toCsv } from '@/lib/utils'

export type AdminOrderItem = {
  id: string
  variant_id: string
  product_name: string
  size: string | null
  color: string | null
  sku: string | null
  qty: number
}

export type AdminOrder = {
  id: string
  order_scope:string
  order_number: string
  pickup_code: string | null
  version: number
  received_by_name: string | null
  remote_contact_name: string | null
  employee_id: string
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
  assigned_to: string | null
  storage_location: string | null
  pickup_status: string
  handed_to: string | null
  fulfillment_choice_name?:string|null
  fulfillment_mode:string|null
  legal_entity:string|null
  pickup_office_name:string|null
  visit_from:string|null
  visit_until:string|null
  is_remote: boolean
  country: string | null
  created_at: string
  confirmed_at: string | null
  shipped_at: string | null
  received_at: string | null
  cancelled_at: string | null
  order_items: AdminOrderItem[]
}

type AdminOrdersClientProps = {
  tasks?: VisitReminder[]
  orders: AdminOrder[]
  adminEmail: string
  stockAlertCount: number
  variants: EditableVariant[]
  admins: { id: string; full_name: string; email?:string|null; phone?:string|null }[]
  events: { id: string; order_id: string; action: string; data: Record<string, unknown>; created_at: string }[]
}

type SortMode = 'date_desc' | 'date_asc' | 'number_desc' | 'number_asc'

const deliveryLabels: Record<DeliveryType, string> = {
  office: 'В офис',
  pvz: 'ПВЗ / филиал',
  pickup: 'Самовывоз',
  courier: 'Курьер',
}

export default function AdminOrdersClient({
  orders,
  adminEmail,
  stockAlertCount, variants, admins, events,tasks=[],
}: AdminOrdersClientProps) {
  const searchParams = useSearchParams()
  const queryFromUrl = searchParams.get('q') ?? ''
  const workFromUrl=searchParams.get('work')||'all'
  const [workFilter,setWorkFilter]=useState(workFromUrl)
  const [scopeFilter,setScopeFilter]=useState('all')
  useEffect(()=>setWorkFilter(workFromUrl),[workFromUrl])

  const [statusFilter, setStatusFilter] = useState<WorkStatus | 'all'>('all')
  const [showClosed,setShowClosed]=useState(false)
  const [search, setSearch] = useState(queryFromUrl)
  const [sortMode, setSortMode] = useState<SortMode>('date_desc')
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)
  const [selectedOrders, setSelectedOrders] = useState<string[]>([])

  function toggleOrderSelection(orderId: string) {
    setSelectedOrders((current) =>
      current.includes(orderId)
        ? current.filter((id) => id !== orderId)
        : [...current, orderId]
    )
  }

  function handleSelectAll(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.checked) {
      setSelectedOrders(filteredOrders.map((order) => order.id))
      return
    }
    setSelectedOrders([])
  }

  useEffect(() => {
    setSearch(queryFromUrl)
  }, [queryFromUrl])

  const counters = useMemo(() => {
    return orders.reduce<Record<string, number>>((acc, order) => {
      const stage=workStatus(order)
      if(stage!=='closed')acc.all = (acc.all ?? 0) + 1
      acc[stage] = (acc[stage] ?? 0) + 1
      return acc
    }, {})
  }, [orders])

  const filteredOrders = useMemo(() => {
    const searchValue = search.trim().toLowerCase()

    const result = orders.filter((order) => {
      const statusMatch =
        (showClosed?workStatus(order)==='closed':workStatus(order)!=='closed') && (statusFilter === 'all' || workStatus(order) === statusFilter)

      const itemsMatch = order.order_items.some((item) =>
        [item.product_name, item.size, item.color, item.sku]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(searchValue)
      )

      const searchMatch =
        searchValue.length === 0 ||
        order.order_number.toLowerCase().includes(searchValue) ||
        order.full_name?.toLowerCase().includes(searchValue) ||
        order.email?.toLowerCase().includes(searchValue) ||
        order.phone?.toLowerCase().includes(searchValue) ||
        order.department?.toLowerCase().includes(searchValue) ||
        order.legal_entity?.toLowerCase().includes(searchValue) ||
        order.delivery_address?.toLowerCase().includes(searchValue) ||
        itemsMatch

      const task=tasks.find(t=>t.order_id===order.id),today=tashkentToday()
      const workMatch=workFilter==='all'||(workFilter==='attention'&&orderAction(order,task,today).needsAction)||(workFilter==='prepare'&&['new','review','confirmed','assembling'].includes(order.status))||(workFilter==='arrivals'&&!!task&&((task.due_on<=today&&!task.contacted_at)||task.reserve_until<today))
      return statusMatch && searchMatch && workMatch && (scopeFilter==='all'||order.order_scope===scopeFilter)
    })

    return [...result].sort((a, b) => {
      if (sortMode === 'date_desc')
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      if (sortMode === 'date_asc')
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      if (sortMode === 'number_desc')
        return b.order_number.localeCompare(a.order_number, 'ru', { numeric: true })
      return a.order_number.localeCompare(b.order_number, 'ru', { numeric: true })
    })
  }, [orders, search, sortMode, statusFilter,workFilter,scopeFilter,tasks,showClosed])

  function handleExportCsv() {
    const rows = filteredOrders.map((order) => {
      const itemsText = order.order_items
        .map((item) =>
          `${item.product_name} / ${formatVariant(item)} / ${item.qty} шт. / SKU: ${item.sku || '—'}`
        )
        .join('; ')

      return {
        order_number:     order.order_number,
        order_scope:order.order_scope,
        next_action:orderAction(order,tasks.find(t=>t.order_id===order.id)).label,
        status:           workStatusLabel(order),
        created_at:       formatDateTime(order.created_at),
        received_at:      order.received_at ? formatDateTime(order.received_at) : '',
        full_name:        order.full_name || '',
        email:            order.email || '',
        phone:            order.phone || '',
        department:       order.department || '',
        city:             order.city || '',
        delivery_type:    deliveryLabels[order.delivery_type],
        delivery_address: order.delivery_address || '',
        is_remote: order.is_remote ? 'Да' : 'Нет',
        contact: admins.find(a=>a.id===order.assigned_to)?.full_name || order.remote_contact_name || '',
        contact_email: admins.find(a=>a.id===order.assigned_to)?.email||'',
        contact_phone: admins.find(a=>a.id===order.assigned_to)?.phone||'',
        items_qty:        String(getTotalQty(order)),
        items:            itemsText,
        comment:          order.comment || '',
        fulfillment_mode:(order.fulfillment_choice_name||fulfillmentLabel(order.fulfillment_mode,order.is_remote)),
        legal_entity:order.legal_entity||'',
        visit_from:order.visit_from||'',visit_until:order.visit_until||'',
        admin_comment:    order.admin_comment || '',
        tracking_number:  order.tracking_number || '',
      }
    })

    const csv  = toCsv(rows)
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href     = url
    link.download = `uzum-merch-orders-${getExportDate()}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <AdminShell
      adminEmail={adminEmail}
      title="Заказы сотрудников"
      subtitle="Админ-панель · merch.uzum.tech"
      orderCount={orders.length}
      stockAlertCount={stockAlertCount}
    >
      <section className="ao-page">
        {!showClosed&&<StatusTabs
          statuses={activeWorkStatuses.filter(s=>s!=='shipped'||orders.some(o=>o.is_remote))}
          activeStatus={statusFilter}
          counters={counters}
          onChange={setStatusFilter}
        />}
        <div className="ao-closed-switch"><button type="button" className="ao-light-btn" aria-pressed={showClosed} onClick={()=>{setShowClosed(v=>!v);setStatusFilter('all');setWorkFilter('all')}}>{showClosed?'← К рабочим заказам':`Отменённые заявки (${counters.closed||0})`}</button>{showClosed&&<span>Архив отменённых заявок</span>}</div>

        <section className="ao-toolbar">
          <div className="ao-search-box">
            <span className="ao-search-icon">⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск: номер, ФИО, email, телефон, отдел, товар"
              className="ao-search-input"
            />
            {search.trim().length > 0 && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="ao-clear-btn"
              >
                ×
              </button>
            )}
          </div>

          <div className="ao-toolbar-right">
            <label className="ao-sort-label">Действие<select className="ao-sort-select" value={workFilter} onChange={e=>setWorkFilter(e.target.value)}><option value="all">Все заказы</option><option value="attention">Требуют внимания</option><option value="prepare">Подготовить и упаковать</option><option value="arrivals">Связаться с приезжающими</option></select></label>
            <label className="ao-sort-label">Раздел<select className="ao-sort-select" value={scopeFilter} onChange={e=>setScopeFilter(e.target.value)}><option value="all">Все разделы</option><option value="catalog">Каталог</option><option value="welcome">Welcome pack</option></select></label>
            <label className="ao-sort-label">
              Сортировка:
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="ao-sort-select"
              >
                <option value="date_desc">По дате ↓</option>
                <option value="date_asc">По дате ↑</option>
                <option value="number_desc">По номеру ↓</option>
                <option value="number_asc">По номеру ↑</option>
              </select>
            </label>

            <button
              type="button"
              className="ao-export-btn"
              onClick={handleExportCsv}
              disabled={filteredOrders.length === 0}
            >
              Экспорт CSV
            </button>
          </div>
        </section>

        {filteredOrders.length === 0 ? (
          <section className="ao-empty-card">
            <div className="ao-empty-mark">∅</div>
            <h2 className="ao-empty-title">Заказы не найдены</h2>
            <p className="ao-empty-text">
              Измените поиск или выберите другой статус.
            </p>
          </section>
        ) : (
          <section className="ao-table-card">
            <div className="ao-table-header">
              <div className="ao-checkbox-cell">
                <input
                  type="checkbox"
                  checked={
                    filteredOrders.length > 0 &&
                    selectedOrders.length === filteredOrders.length
                  }
                  onChange={handleSelectAll}
                />
              </div>
              <div>№</div>
              <div>Получатель</div>
              <div>Отдел · контакт</div>
              <div>Состав</div>
              <div>Доставка</div>
              <div>Создан</div>
              <div>Статус</div>
              <div />
            </div>

            <div className="ao-table-body">
              {filteredOrders.map((order) => {
                const isExpanded = expandedOrderId === order.id

                return (
                  <div key={order.id} className="ao-order-group">
                    <button
                      type="button"
                      className={`ao-row${isExpanded ? ' ao-row-expanded' : ''}`}
                      onClick={() =>
                        setExpandedOrderId(isExpanded ? null : order.id)
                      }
                    >
                      <div className="ao-checkbox-cell">
                        <input
                          type="checkbox"
                          checked={selectedOrders.includes(order.id)}
                          onChange={() => toggleOrderSelection(order.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>

                      <div className="ao-order-number">#{order.order_number}</div>

                      <div className="ao-receiver-cell">
                        <div className="ao-avatar">
                          {getInitials(order.full_name, order.email)}
                        </div>
                        <div className="ao-receiver-text">
                          <b>{order.full_name || 'Сотрудник'}</b>
                          <span>{order.city || 'Город не указан'}</span>
                        </div>
                      </div>

                      <div className="ao-contact-cell">
                        <b>{order.department || 'Отдел не указан'}</b>
                        <span>{order.email || order.phone || 'Контакт не указан'}</span>
                      </div>

                      <div className="ao-items-cell">
                        <div className="ao-item-marks">
                          {order.order_items.slice(0, 3).map((item, index) => (
                            <span key={item.id} className={getItemMarkClass(index)}>
                              {getProductLetter(item.product_name)}
                            </span>
                          ))}
                        </div>
                        <span className="ao-items-qty">
                          {getTotalQty(order)} шт.
                        </span>
                      </div>

                      <div className="ao-delivery-cell">
                        {(order.fulfillment_choice_name||fulfillmentLabel(order.fulfillment_mode,order.is_remote))}
                      </div>

                      <div className="ao-date-cell">
                        {formatRelativeDate(order.created_at)}
                      </div>

                      <div>
                        <span className={getStatusBadgeClass(workStatus(order))}>
                          {workStatusLabel(order)}
                        </span><small className="ao-action-note">{orderAction(order,tasks.find(t=>t.order_id===order.id)).label}</small>
                      </div>

                      <div className="ao-arrow-cell">
                        {isExpanded ? '↑' : '→'}
                      </div>
                    </button>

                    {isExpanded && <OrderDetail key={`${order.id}-${order.version}`} order={order} task={tasks.find(t=>t.order_id===order.id)} variants={variants} admins={admins} events={events.filter(e => e.order_id === order.id)} />}
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </section>
    </AdminShell>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  StatusTabs                                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

function StatusTabs({
  statuses,
  activeStatus,
  counters,
  onChange,
}: {
  statuses:WorkStatus[]
  activeStatus: WorkStatus | 'all'
  counters: Record<string, number>
  onChange: (status: WorkStatus | 'all') => void
}) {
  return (
    <section className="ao-status-tabs">
      <button
        type="button"
        onClick={() => onChange('all')}
        className={`ao-status-tab${activeStatus === 'all' ? ' ao-status-tab-active' : ''}`}
      >
        Все
        <span>{counters.all ?? 0}</span>
      </button>

      {statuses.map((status) => (
        <button
          key={status}
          type="button"
          onClick={() => onChange(status)}
          className={`ao-status-tab${activeStatus === status ? ' ao-status-tab-active' : ''}`}
        >
          {workStatusLabels[status]}
          <span>{counters[status] ?? 0}</span>
        </button>
      ))}
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  OrderDetail                                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

function OrderDetail({ order, variants, admins, events,task }: { task?:VisitReminder; order: AdminOrder; variants: EditableVariant[]; admins: AdminOrdersClientProps['admins']; events: AdminOrdersClientProps['events'] }) {
  const router = useRouter()

  const [status, setStatus] = useState<OrderStatus>(workStatus(order)==='closed'?order.status:workStatus(order) as OrderStatus)
  const [confirmCancel,setConfirmCancel]=useState(false)
  const terminal=['received','cancelled','rejected'].includes(order.status)
  const [adminComment, setAdminComment] = useState(order.admin_comment ?? '')
  const [trackingNumber, setTrackingNumber] = useState(order.tracking_number ?? '')

  const [storageLocation, setStorageLocation] = useState(order.storage_location ?? '')
  const [assignedTo, setAssignedTo] = useState(order.assigned_to ?? '')
  const selectedAdmin = admins.find(admin => admin.id === assignedTo)

  const [isSaving, setIsSaving] = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [success,  setSuccess]  = useState<string | null>(null)

  async function handleSave(nextStatus?:OrderStatus) {
    setIsSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await unitFetch(`/api/admin/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus || (status===workStatus(order)?order.status:status),
          version: order.version,
          assigned_to: assignedTo || null,
          admin_comment: adminComment,
          tracking_number: trackingNumber,
          storage_location: storageLocation,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        setError(result.error || 'Не удалось обновить заказ')
        return
      }

      setSuccess('Заказ обновлён')
      router.refresh()
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'Неизвестная ошибка'
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function handlePrintLabel() {
    let barcode = ''
    if (order.pickup_code && !order.is_remote) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      JsBarcode(svg, order.pickup_code, { format: 'CODE128', width: 2, height: 70, margin: 16 })
      barcode = new XMLSerializer().serializeToString(svg)
    }

    const itemsHtml = order.order_items
      .map((it) => `<li>${escapeHtml(it.product_name)} — ${escapeHtml(formatVariant(it))} × ${it.qty}</li>`)
      .join('')

    const win = window.open('', '_blank', 'width=440,height=640')
    if (!win) return

    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Наклейка #${order.order_number}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:18px;color:#1a0d3a}
        .label{border:2px solid #1a0d3a;border-radius:14px;padding:18px}
        h1{font-size:20px;margin:0 0 2px}
        .num{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:26px;font-weight:800;margin:0 0 12px}
        .sec{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b6585;margin-top:10px}
        ul{margin:6px 0;padding-left:18px;font-size:13px}
        .loc{margin-top:8px;font-size:15px}
        img{display:block;margin:14px auto 0}
        button{margin-top:16px;width:100%;padding:11px;border:0;border-radius:10px;background:#1f1238;color:#fff;font-weight:700;cursor:pointer}
        @media print{button{display:none}}
      </style></head><body>
      <div class="label">
        <h1>${escapeHtml(order.full_name || 'Сотрудник')}</h1>
        <p class="num">#${order.order_number}</p>
        <div class="sec">Состав</div>
        <ul>${itemsHtml}</ul>
        <div class="loc">Где лежит: <b>${escapeHtml(storageLocation || '—')}</b></div>
        ${barcode}
      </div>
      <button onclick="window.print()">Печать</button>
      </body></html>`)
    win.document.close()
  }

  return (
    <section className="ao-detail-panel">
      <div className="ao-detail-grid">

        {/* Получатель */}
        <div className="ao-detail-card">
          <div className="ao-card-head">
            <h3 className="ao-card-title">Получатель</h3>
          </div>
          <div className="ao-info-grid">
            <Info label="Раздел" value={order.order_scope==='welcome'?'Welcome pack':'Каталог'}/>
            <Info label="ФИО"      value={order.full_name || 'Не указан'} />
            <Info label="Email"    value={order.email || 'Не указан'} />
            <Info label="Телефон"  value={order.phone || 'Не указан'} />
            <Info label="Юрлицо" value={order.legal_entity||'Не указано в реестре'} />
            <Info label="Отдел"    value={order.department || 'Не указан'} />
            <Info label="Доставка" value={deliveryLabels[order.delivery_type] ?? order.delivery_type} />
            <Info label="Адрес"    value={order.delivery_address || 'Не указан'} />
            <Info label="Формат"   value={(order.fulfillment_choice_name||fulfillmentLabel(order.fulfillment_mode,order.is_remote))} />
            {order.is_remote && <><Info label="Страна" value={order.country || 'Не указана'} /><Info label="Город" value={order.city || 'Не указан'} /></>}
            {order.fulfillment_mode==='remote_visit'&&<><Info label="Приезд" value={order.visit_from||'—'}/><Info label="Отъезд" value={order.visit_until||'—'}/><span>Напоминание и действия — в этом заказе.</span></>}
          </div>
          {order.comment && (
            <div className="ao-note-box">
              <span>Комментарий сотрудника</span>
              <p>{order.comment}</p>
            </div>
          )}
        </div>

        {/* Состав заказа */}
        <div className="ao-detail-card">
          <div className="ao-card-head">
            <h3 className="ao-card-title">Состав заказа</h3>
            <span className="ao-card-hint">{getTotalQty(order)} шт.</span>
            <OrderItemsEditor key={`items-${order.version}`} orderId={order.id} version={order.version} initialIds={order.order_items.map(i => i.variant_id)} variants={variants.filter(v=>!v.placement||v.placement==='both'||v.placement===order.order_scope||order.order_items.some(i=>i.variant_id===v.id))} locked={['shipped','received','cancelled','rejected'].includes(order.status)} />
          </div>
          <div className="ao-items-list">
            {order.order_items.map((item, index) => (
              <div key={item.id} className="ao-detail-item">
                <span className={getItemMarkClass(index)}>
                  {getProductLetter(item.product_name)}
                </span>
                <div className="ao-detail-item-main">
                  <b>{item.product_name}</b>
                  <span>{formatVariant(item)} · SKU: {item.sku || '—'}</span>
                </div>
                <strong>{item.qty} шт.</strong>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Управление */}
      <div className="ao-manage-panel">
        <div className="ao-manage-head">
          <h3 className="ao-card-title">Управление заказом</h3>
          <p className="ao-manage-text">
            Изменение статуса может повлиять на резерв и движение остатков.
          </p>
        </div>

      <OrderNextAction orderId={order.id} status={order.status} remote={order.is_remote} task={task}/>
        <div className="ao-manage-grid">
          <label className="ao-label">
            Статус
            <select
              aria-label="Статус заказа"
              disabled={terminal}
              value={status}
              onChange={(e) => setStatus(e.target.value as OrderStatus)}
              className="ao-input"
            >
              {workStatus(order) === 'closed' ? (
                <option value={order.status}>Отменена</option>
              ) : workflowSteps(order.is_remote).map(opt => (
                <option key={opt} value={opt} disabled={
                  (!order.is_remote && opt === 'received' && order.status !== 'received') ||
                  (order.status === 'shipped' && ['new', 'assembling'].includes(opt)) ||
                  (order.is_remote && opt === 'received' && !['shipped', 'received'].includes(order.status))
                }>{workStatusLabels[opt as WorkStatus]}</option>
              ))}
            </select>
          </label>

          {order.is_remote && <label className="ao-label">
            Трек-номер
            <input
              type="text"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="Номер от службы доставки"
              className="ao-input"
              aria-describedby={`tracking-help-${order.id}`}
            />
            <small id={`tracking-help-${order.id}`}>Укажите трек-номер посылки. Сотрудник увидит его в «Моих заказах» и сможет отслеживать доставку на сайте службы доставки.</small>
          </label>}

          <label className="ao-label">
            Где лежит заказ
            <input
              type="text"
              value={storageLocation}
              onChange={(e) => setStorageLocation(e.target.value)}
              placeholder="Например: стеллаж B-3, офис Ташкент"
              className="ao-input"
            />
          </label>

          {!order.is_remote&&!terminal&&<p className="ao-manage-text">Статус «Получен» выставляется автоматически при сканировании кода.</p>}
          <label className="ao-label">Ответственный администратор
            <select className="ao-input" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
              <option value="">Не назначен</option>
              {assignedTo&&!admins.some(a=>a.id===assignedTo)&&<option value={assignedTo} disabled>Нужен новый ответственный</option>}
              {admins.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </select>
          </label>

          <div className="ao-label-wide">
            <OrderContact contact={selectedAdmin ? {
              full_name: selectedAdmin.full_name,
              email: selectedAdmin.email || null,
              phone: selectedAdmin.phone || null,
            } : null}/>
            <small>Изменение ответственного применяется после сохранения.</small>
          </div>
          <label className="ao-label-wide">
            Комментарий администратора
            <textarea
              value={adminComment}
              onChange={(e) => setAdminComment(e.target.value)}
              placeholder="Например: передано на сборку / отправлено курьером"
              className="ao-textarea"
            />
          </label>

          {error   && <div className="ao-error">{error}</div>}
          {success && <div className="ao-success">{success}</div>}

          <button
            type="button"
            className="ao-save-btn"
            onClick={()=>handleSave()}
            disabled={isSaving}
          >
            {isSaving ? 'Сохраняем...' : 'Сохранить изменения'}
          </button>
          {!terminal && <div className="ao-label-wide">
            {confirmCancel ? <div className="ao-cancel-confirm">
              <p>{order.status === 'shipped'
                ? 'Отменить отправленный заказ? Его позиции вернутся на склад. Подтверждайте только после возврата товара.'
                : 'Отменить заявку? Зарезервированные позиции снова станут доступны.'}</p>
              <button className="ao-light-btn" type="button" disabled={isSaving} onClick={() => handleSave('cancelled')}>Подтвердить отмену</button>{' '}
              <button className="ao-light-btn" type="button" disabled={isSaving} onClick={() => setConfirmCancel(false)}>Оставить заказ</button>
            </div> : <button className="ao-light-btn" type="button" disabled={isSaving} onClick={() => setConfirmCancel(true)}>Отменить заявку</button>}
          </div>}

        </div>
      </div>

      {/* Выдача — штрихкод и наклейка */}
      {!order.is_remote && order.pickup_code && <div className="ao-handout-card">
        <div className="ao-handout-qr">
          <OrderBarcode value={order.pickup_code} size={320} />
          <span className="ao-handout-num">#{order.order_number}</span>
        </div>
        <div className="ao-handout-body">
          <h3 className="ao-card-title">Выдача заказа</h3>
          <p className="ao-manage-text">
            Сотрудник показывает код при получении. Выдавать можно только заказ со статусом «Можно забирать».
          </p>
          <button type="button" className="ao-light-btn" onClick={handlePrintLabel}>
            🖶 Напечатать наклейку
          </button>
        </div>
      </div>}
      {order.is_remote && <p className="ao-manage-text">Удалённый заказ. Ответственный свяжется с сотрудником: {admins.find(a=>a.id===order.assigned_to)?.full_name || 'Назначьте администратора в управлении заказом'}. Штрихкод не выдаётся.</p>}
      {!order.is_remote && <Link href="/admin/issue" className="ao-light-btn">Открыть выдачу по штрихкоду</Link>}
      {order.received_at && <p>Выдали: {formatDateTime(order.received_at)} · {order.received_by_name || 'Администратор не указан'}</p>}

      <details className="order-items-editor"><summary>Последние события заказа</summary>
        {events.map(e => <p key={e.id}>{formatDateTime(e.created_at)} · {{ created: 'Создан', updated: 'Изменён', issued: 'Выдали', items_changed: 'Изменён состав' }[e.action] || e.action}</p>)}
      </details>

    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Info                                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="ao-info">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

function getTotalQty(order: AdminOrder) {
  return order.order_items.reduce((sum, item) => sum + Number(item.qty), 0)
}

function formatVariant(item: AdminOrderItem) {
  return `${item.color || 'Без цвета'} · ${item.size || 'ONE SIZE'}`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatRelativeDate(value: string) {
  const date     = new Date(value)
  const diffMs   = Date.now() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays <= 0) return 'сегодня'
  if (diffDays === 1) return 'вчера'
  if (diffDays < 7)   return `${diffDays} дн. назад`

  return date.toLocaleDateString('ru-RU', {
    timeZone: 'Asia/Tashkent',
    day: 'numeric',
    month: 'short',
  })
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    timeZone: 'Asia/Tashkent',
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
    hour:     '2-digit',
    minute:   '2-digit',
  })
}

function getInitials(name: string | null, email: string | null) {
  const source = name?.trim() || email?.split('@')[0] || 'U'
  const parts  = source.split(/[ ._-]/).filter(Boolean)
  return `${parts[0]?.[0] ?? 'U'}${parts[1]?.[0] ?? ''}`.toUpperCase()
}

function getItemMarkClass(index: number): string {
  const mod = index % 4
  return mod === 0 ? 'ao-item-mark' : `ao-item-mark ao-item-mark-${mod}`
}

function getStatusBadgeClass(status: WorkStatus): string {
  if (status === 'ready' || status === 'shipped' || status === 'received')   return 'ao-badge ao-badge-green'
  if (status === 'assembling') return 'ao-badge ao-badge-blue'
  if (status === 'closed')   return 'ao-badge ao-badge-red'
  return 'ao-badge'
}
