'use client'

import { useContext, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import ActionDialog from '@/components/ActionDialog'
import { ShopContextValue } from '@/components/ShopProvider'
import { displayColor, displaySize } from '@/lib/variant-labels'
import { workStatusLabel } from '@/lib/order-workflow'
import type { AdminOrder } from '@/app/admin/orders/AdminOrdersClient'

function escape(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

function labelDocument(orders: AdminOrder[], sort: string, unit: string, perPage: number, batch: string) {
  const pages = Math.ceil(orders.length / perPage)
  const sheets = Array.from({ length: pages }, (_, page) => {
    const labels = orders.slice(page * perPage, (page + 1) * perPage).map((order, index) => {
      const position = page * perPage + index + 1
      let barcode = ''
      if (!order.is_remote && order.pickup_code) {
        if (!/^\d{20}$/.test(order.pickup_code)) throw new Error(`Некорректный код заказа ${order.order_number}. Проверьте заказ перед печатью.`)
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        JsBarcode(svg, order.pickup_code, { format: 'CODE128', width: 2, height: 52, margin: 12, displayValue: false })
        svg.setAttribute('viewBox', `0 0 ${parseFloat(svg.getAttribute('width')!)} ${parseFloat(svg.getAttribute('height')!)}`)
        barcode = new XMLSerializer().serializeToString(svg)
      }
      return `<article class="label" data-order="${escape(order.order_number)}">
        <div class="position">№ ${position} из ${orders.length} · лист ${page + 1}, ряд ${Math.floor(index / 2) + 1}, ${index % 2 === 0 ? 'слева' : 'справа'}</div>
        <strong class="number">#${escape(order.order_number)}</strong>
        <strong class="recipient">${escape(order.full_name || 'ФИО не указано')}</strong>
        <div class="destination">${escape(order.delivery_address || order.pickup_office_name || order.country || 'Место не указано')}${order.storage_location ? ' · Где лежит: ' + escape(order.storage_location) : ''}</div>
        <ul>${order.order_items.map(item => `<li>${escape(item.product_name)} · ${escape(displaySize(item.size))} · ${escape(displayColor(item.color))} · <b>${item.qty} шт.</b></li>`).join('')}</ul>
        <div class="barcode">${barcode || `<span>${order.is_remote ? 'Удалённая отправка — без кода выдачи' : 'Код получения отсутствует'}</span>`}</div>
        <div class="status">${escape(workStatusLabel(order))} · ${escape(unit)}</div>
      </article>`
    }).join('')
    return `<section class="sheet"><header><b>${escape(unit)} · лист ${page + 1}/${pages} · наклейки ${page * perPage + 1}–${Math.min((page + 1) * perPage, orders.length)}</b><span>${escape(sort)} · слева направо, сверху вниз · ${escape(batch)}</span></header><div class="labels">${labels}</div></section>`
  }).join('')
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Наклейки заказов — ${escape(batch)}</title><style>
    @page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#111;background:#e8e8ee}
    .sheet{width:190mm;height:277mm;margin:8mm auto;background:#fff;break-after:page;page-break-after:always}.sheet:last-child{break-after:auto;page-break-after:auto}
    header{height:12mm;font-size:8pt;line-height:1.35;display:flex;flex-direction:column;justify-content:center;white-space:nowrap}
    .labels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(${perPage / 2},minmax(0,1fr));gap:3mm;height:265mm}
    .label{border:0.3mm dashed #777;padding:3mm;min-width:0;min-height:0;display:flex;flex-direction:column;overflow-wrap:anywhere}
    .position{font-size:7.5pt;color:#444;margin-bottom:1mm}.number{font-size:12pt}.recipient{font-size:11pt;margin:1mm 0}.destination{font-size:8pt;line-height:1.2}
    ul{margin:1.5mm 0;padding-left:3.5mm;font-size:8pt;line-height:1.25}li+li{margin-top:0.5mm}
    .barcode{margin-top:auto;flex-shrink:0;display:flex;align-items:center;justify-content:center;min-height:18mm;font-size:8pt}.barcode svg{width:76mm;max-width:100%;height:18mm}
    .status{font-size:7.5pt;text-align:center;margin-top:0.5mm}
    @media print{body{background:white}.sheet{margin:0;box-shadow:none}}
  </style></head><body>${sheets}</body></html>`
}

type Preview = { orders: AdminOrder[]; sort: string; unit: string; batch: string; perPage: number; html: string }

export default function OrderLabelsPrint({ orders, sort, selected }: { orders: AdminOrder[]; sort: string; selected: boolean }) {
  const shop = useContext(ShopContextValue)
  const frame = useRef<HTMLIFrameElement>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [overflow, setOverflow] = useState(false)

  function open() {
    setError(null)
    const unit = shop.units.find(unit => unit.id === shop.unit_id)?.name || 'Uzum Merch Shop'
    const batch = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })
    try {
      const snapshot = structuredClone(orders)
      setReady(false); setOverflow(false)
      setPreview({ orders: snapshot, sort, unit, batch, perPage: 8, html: labelDocument(snapshot, sort, unit, 8, batch) })
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось подготовить наклейки') }
  }

  function resize(perPage: number) {
    if (!preview) return
    setReady(false); setOverflow(false)
    setPreview({ ...preview, perPage, html: labelDocument(preview.orders, preview.sort, preview.unit, perPage, preview.batch) })
  }

  function checkLayout() {
    const labels = frame.current?.contentDocument?.querySelectorAll<HTMLElement>('.label')
    setOverflow(Boolean(labels && Array.from(labels).some(label => label.scrollHeight > label.clientHeight + 1 || label.scrollWidth > label.clientWidth + 1)))
    setReady(true)
  }

  return <>
    <button type="button" className="ao-export-btn" disabled={!orders.length} onClick={open}>Печать наклеек ({orders.length})</button>
    {error && <span role="alert" className="ao-error">{error}</span>}
    {preview && <ActionDialog className="order-labels-dialog" title="Наклейки на A4" onClose={() => setPreview(null)}>
      <p>{selected ? 'Выбранные заказы из текущего списка' : 'Все заказы текущего списка'}: <b>{preview.orders.length}</b>. Сортировка: <b>{preview.sort}</b>.</p>
      <p>Порядок: слева направо, затем следующий ряд сверху вниз. На каждой наклейке указаны её номер, лист, ряд и сторона. Перед наклеиванием сверяйте номер заказа и ФИО с пакетом.</p>
      <label className="admin-action-field">Наклеек на листе<select className="ao-input" value={preview.perPage} onChange={e => resize(Number(e.target.value))}><option value="8">8 — компактные, 2 столбца × 4 ряда</option><option value="4">4 — крупные, 2 столбца × 2 ряда</option></select></label>
      <p>Печать: A4, книжная ориентация, масштаб 100%, поля 10 мм, колонтитулы браузера выключить. Подходит для сплошного самоклеящегося A4 с последующей нарезкой; для готовой сетки наклеек нужен её точный размер.</p>
      {overflow && <p role="alert" className="ao-error">Текст не помещается целиком. Выберите 4 наклейки на листе. Если предупреждение осталось, сократите длинные названия или адрес перед печатью.</p>}
      <button type="button" className="ao-save-btn" disabled={!ready || overflow} onClick={() => { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print() }}>Печатать / сохранить PDF · {Math.ceil(preview.orders.length / preview.perPage)} лист.</button>
      <iframe key={preview.perPage} ref={frame} title="Превью наклеек A4" className="order-labels-preview" srcDoc={preview.html} onLoad={checkLayout} />
      <p>Превью зафиксировано на момент открытия. Печать не меняет статусы заказов и остатки. Если состав заказа изменился, сформируйте наклейки заново.</p>
    </ActionDialog>}
  </>
}
