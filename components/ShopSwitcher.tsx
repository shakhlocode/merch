'use client'
import { useContext } from 'react'
import { ShopContextValue } from './ShopProvider'
import ShopLink from './ShopLink'
export default function ShopSwitcher() {
  const shop = useContext(ShopContextValue)
  const current = shop.units.find(u => u.id === shop.unit_id)
  return <div className="shop-switcher">
    {shop.units.length > 1 ? <label>Магазин<select aria-label="Магазин" value={shop.unit_id || ''} onChange={e => { window.location.href = '/admin?unit=' + encodeURIComponent(e.target.value) }}>{shop.units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label> : <strong>{current?.name || 'Магазин'}</strong>}
    {shop.is_super_admin && <ShopLink href="/admin/shops">Магазины и администраторы →</ShopLink>}
  </div>
}
