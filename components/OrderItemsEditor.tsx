'use client'

import { unitFetch } from '@/lib/shop-context'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type EditableVariant = { id: string; product_id: string; placement?: string; label: string; available_qty: number }

export default function OrderItemsEditor({ orderId, version, initialIds, variants, locked }: {
  orderId: string; version: number; initialIds: string[]; variants: EditableVariant[]; locked: boolean
}) {
  const router = useRouter()
  const [ids, setIds] = useState(initialIds)
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  async function save() {
    setBusy(true); setMessage(null)
    try {
      const r = await unitFetch(`/api/admin/orders/${orderId}/items`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, items: ids.map(id => ({ variant_id: id, qty: 1 })) }) })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      setMessage('Состав сохранён, резерв пересчитан. Проверьте сборку и снова отметьте готовность.')
      router.refresh()
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Ошибка изменения состава') }
    finally { setBusy(false) }
  }
  if (locked) return <p>Состав завершённого, отправленного или отменённого заказа зафиксирован.</p>
  return <div className="order-items-editor">
    <h3>Изменить состав заказа</h3>
    <p>До трёх разных товаров, по одной единице. Изменение снимает готовность к выдаче.</p>
    {ids.map(id => <div className="order-edit-row" key={id}>
      <span>{variants.find(v => v.id === id)?.label || id}</span>
      <button type="button" className="ao-light-btn" disabled={busy} onClick={() => setIds(ids.filter(x => x !== id))}>Убрать позицию</button>
    </div>)}
    <div className="order-edit-row">
      <select aria-label="Добавить товар в заказ" className="ao-input" value={adding} onChange={e => setAdding(e.target.value)} disabled={busy || ids.length >= 3}>
        <option value="">Выберите товар / размер / цвет</option>
        {variants.filter(v => !ids.includes(v.id) && v.available_qty > 0 && !ids.some(id => variants.find(x => x.id === id)?.product_id === v.product_id)).map(v =>
          <option key={v.id} value={v.id}>{v.label} · свободно {v.available_qty}</option>)}
      </select>
      <button type="button" className="ao-light-btn" disabled={!adding || busy || ids.length >= 3} onClick={() => { setIds([...ids, adding]); setAdding('') }}>Добавить позицию</button>
    </div>
    <button type="button" className="ao-save-btn" disabled={busy || ids.length === 0} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить состав'}</button>
    {message && <p role="status">{message}</p>}
  </div>
}
