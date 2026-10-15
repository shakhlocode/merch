'use client'
import {useContext,useEffect,useRef,useState} from 'react'
import {useRouter} from 'next/navigation'
import {ShopContextValue} from './ShopProvider'
import ActionDialog from './ActionDialog'
import {unitFetch} from '@/lib/shop-context'
import {displayColor,displaySize} from '@/lib/variant-labels'
type Product={id:string;name:string;is_active:boolean}
type Variant={id:string;product_id:string;unit_id:string;sku:string|null;size:string|null;color:string|null;reserved:number;available:number}
export default function StockTransferButton({product}:{product:Product}) {
  const shop=useContext(ShopContextValue),[open,setOpen]=useState(false),[notice,setNotice]=useState('')
  if(!shop.is_super_admin)return null
  return <><button className="admin-small-button" type="button" disabled={!product.is_active} onClick={()=>{setNotice('');setOpen(true)}}>Передать</button>{notice&&<span role="status">{notice}</span>}{open&&<TransferDialog product={product} onClose={()=>setOpen(false)} onDone={()=>{setOpen(false);setNotice('Товар передан')}}/>}</>
}
function TransferDialog({product,onClose,onDone}:{product:Product;onClose:()=>void;onDone:()=>void}) {
  const shop=useContext(ShopContextValue),router=useRouter(),lock=useRef(false),requestId=useRef('')
  const [variants,setVariants]=useState<Variant[]|null>(null),[color,setColor]=useState(''),[size,setSize]=useState(''),[variantId,setVariantId]=useState(''),[targetUnit,setTarget]=useState(''),[qty,setQty]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{let stop=false;unitFetch('/api/admin/shops?view=stock',{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);if(!stop)setVariants(d.variants)}).catch(e=>{if(!stop)setError(e.message)});return()=>{stop=true}},[])
  const options=variants?.filter(v=>v.unit_id===shop.unit_id&&v.product_id===product.id&&v.available>0)||[]
  const colors=[...new Set(options.map(v=>displayColor(v.color)))],selectedColor=colors.length===1?colors[0]:color
  const sizes=[...new Set(options.filter(v=>displayColor(v.color)===selectedColor).map(v=>displaySize(v.size)))],selectedSize=sizes.length===1?sizes[0]:size
  const matches=options.filter(v=>displayColor(v.color)===selectedColor&&displaySize(v.size)===selectedSize),from=matches.length===1?matches[0]:matches.find(v=>v.id===variantId)
  const target=shop.units.find(u=>u.id===targetUnit),current=shop.units.find(u=>u.id===shop.unit_id)
  return <ActionDialog title={`Передать: ${product.name}`} onClose={onClose} busy={busy}>
    <p>Из {current?.name}. Зарезервированные под заказы товары остаются здесь.</p>
    <form className="admin-action-form" onSubmit={async e=>{
      e.preventDefault();if(lock.current||!from||!target)return
      lock.current=true;setBusy(true);setError('');requestId.current||=crypto.randomUUID()
      try{const r=await unitFetch('/api/admin/shops',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'transfer',id:requestId.current,source:from.id,target_unit:targetUnit,qty:Number(qty)})}),d=await r.json();if(!r.ok)throw new Error(d.error);router.refresh();onDone()}catch(err){setError(err instanceof Error?err.message:'Не удалось передать товар')}finally{lock.current=false;setBusy(false)}
    }}>
      <label className="admin-action-field">Цвет<select aria-label="Цвет" required className="ap-input" value={selectedColor} disabled={busy||!variants} onChange={e=>{setColor(e.target.value);setSize('');setVariantId('');requestId.current=''}}><option value="">Выберите цвет</option>{colors.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
      <label className="admin-action-field">Размер<select aria-label="Размер" required className="ap-input" value={selectedSize} disabled={busy||!selectedColor} onChange={e=>{setSize(e.target.value);setVariantId('');requestId.current=''}}><option value="">Выберите размер</option>{sizes.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
      {matches.length>1&&<label className="admin-action-field">Вариант<select aria-label="Вариант" required className="ap-input" value={variantId} disabled={busy} onChange={e=>{setVariantId(e.target.value);requestId.current=''}}><option value="">Выберите SKU</option>{matches.map(v=><option key={v.id} value={v.id}>{v.sku||v.id} · свободно {v.available} шт.</option>)}</select></label>}
      {from&&<p>Свободно: {from.available} шт. · Зарезервировано: {from.reserved} шт.</p>}
      {variants&&!options.length&&<p>У этого товара нет свободных остатков для передачи.</p>}
      <label className="admin-action-field">Кому передать<select aria-label="Кому передать" required className="ap-input" value={targetUnit} disabled={busy} onChange={e=>{setTarget(e.target.value);requestId.current=''}}><option value="">Выберите получателя</option>{shop.units.filter(u=>u.id!==shop.unit_id).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label className="admin-action-field">Сколько штук<input type="number" min="1" max={from?.available} step="1" required className="ap-input" value={qty} disabled={busy} onChange={e=>{setQty(e.target.value);requestId.current=''}}/></label>
      {from&&target&&Number(qty)>0&&<p className="admin-transfer-preview">Передать {qty} шт. товара «{product.name}» · {displaySize(from.size)} · {displayColor(from.color)} из {current?.name} в {target.name}. В {current?.name} останется {from.available-Number(qty)} свободных шт.</p>}
      {error&&<p role="alert" className="login-error">{error}</p>}
      <div className="admin-action-buttons"><button type="button" className="ao-light-btn" disabled={busy} onClick={onClose}>Отмена</button><button type="submit" className="ao-save-btn" disabled={busy||!from||!target}>{busy?'Передаём…':'Передать товар'}</button></div>
    </form>
  </ActionDialog>
}
