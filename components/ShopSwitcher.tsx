'use client'
import { useContext } from 'react'
import { ShopContextValue } from './ShopProvider'
export default function ShopSwitcher() {
  const shop = useContext(ShopContextValue)
  const current = shop.units.find(u => u.id === shop.unit_id)
  return <div className="shop-switcher">
    {shop.units.length > 1 ? <select aria-label="Бизнес-юнит" value={shop.unit_id || ''} onChange={e => { window.location.href = '/admin?unit=' + encodeURIComponent(e.target.value) }}>{shop.units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select> : <span>{current?.name || 'Текущий'}</span>}
  </div>
}
