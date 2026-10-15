'use client'
import {useContext,useEffect,useRef,useState} from 'react'
import {useRouter} from 'next/navigation'
import {ShopContextValue} from './ShopProvider'
import ActionDialog from './ActionDialog'
import {unitFetch} from '@/lib/shop-context'
import {displayColor,displaySize} from '@/lib/variant-labels'
type Variant={id:string;unit_id:string;family:string;name:string;sku:string|null;size:string|null;color:string|null;total:number;reserved:number;available:number}
export default function StockTransferButton() {
  const shop=useContext(ShopContextValue),[open,setOpen]=useState(false),[notice,setNotice]=useState('')
  if(!shop.is_super_admin)return null
  return <><button className="admin-small-button" type="button" onClick={()=>{setNotice('');setOpen(true)}}>Передать в другой БЮ</button>{notice&&<span role="status">{notice}</span>}{open&&<TransferDialog onClose={()=>setOpen(false)} onDone={()=>{setOpen(false);setNotice('Товар передан в другой БЮ')}}/>}</>
}
function TransferDialog({onClose,onDone}:{onClose:()=>void;onDone:()=>void}) {
  const shop=useContext(ShopContextValue),router=useRouter(),lock=useRef(false),requestId=useRef('')
  const [variants,setVariants]=useState<Variant[]|null>(null),[source,setSource]=useState(''),[targetUnit,setTarget]=useState(''),[qty,setQty]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{let stop=false;unitFetch('/api/admin/shops?view=stock',{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);if(!stop)setVariants(d.variants)}).catch(e=>{if(!stop)setError(e.message)});return()=>{stop=true}},[])
  const options=variants?.filter(v=>v.unit_id===shop.unit_id&&v.available>0)||[],from=options.find(v=>v.id===source),target=shop.units.find(u=>u.id===targetUnit),current=shop.units.find(u=>u.id===shop.unit_id)
  return <ActionDialog title="Передать товар в другой БЮ" onClose={onClose} busy={busy}>
    <p>Передача со склада {current?.name}. Зарезервированные под заказы товары остаются здесь.</p>
    <form className="admin-action-form" onSubmit={async e=>{
      e.preventDefault();if(lock.current||!from||!target)return
      lock.current=true;setBusy(true);setError('');requestId.current||=crypto.randomUUID()
      try{const r=await unitFetch('/api/admin/shops',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'transfer',id:requestId.current,source,target_unit:targetUnit,qty:Number(qty)})}),d=await r.json();if(!r.ok)throw new Error(d.error);router.refresh();onDone()}catch(err){setError(err instanceof Error?err.message:'Не удалось передать товар')}finally{lock.current=false;setBusy(false)}
    }}>
      <label className="admin-action-field">Товар, размер и цвет<select aria-label="Товар, размер и цвет" required className="ap-input" value={source} disabled={busy||!variants} onChange={e=>{setSource(e.target.value);requestId.current=''}}><option value="">Выберите товар</option>{options.map(v=><option key={v.id} value={v.id}>{v.name} · {displaySize(v.size)} · {displayColor(v.color)} · {v.sku||'без SKU'}</option>)}</select></label>
      {from&&<p>Свободно: {from.available} шт. · Зарезервировано: {from.reserved} шт.</p>}
      {variants&&!options.length&&<p>На этом складе нет свободных товаров для передачи.</p>}
      <label className="admin-action-field">Кому передать<select aria-label="Кому передать" required className="ap-input" value={targetUnit} disabled={busy} onChange={e=>{setTarget(e.target.value);requestId.current=''}}><option value="">Выберите БЮ</option>{shop.units.filter(u=>u.id!==shop.unit_id).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label className="admin-action-field">Сколько штук<input type="number" min="1" max={from?.available} step="1" required className="ap-input" value={qty} disabled={busy} onChange={e=>{setQty(e.target.value);requestId.current=''}}/></label>
      {from&&target&&Number(qty)>0&&<p className="admin-transfer-preview">Передать {qty} шт. товара «{from.name}» из {current?.name} в {target.name}. В {current?.name} останется {from.available-Number(qty)} свободных шт.</p>}
      {error&&<p role="alert" className="login-error">{error}</p>}
      <div className="admin-action-buttons"><button type="button" className="ao-light-btn" disabled={busy} onClick={onClose}>Отмена</button><button type="submit" className="ao-save-btn" disabled={busy||!from||!target}>{busy?'Передаём…':'Передать товар'}</button></div>
    </form>
  </ActionDialog>
}
