'use client'
import {useRef,useState} from 'react'
import {useRouter} from 'next/navigation'
import {unitFetch,type ShopContext} from '@/lib/shop-context'
import {displayColor,displaySize} from '@/lib/variant-labels'
export type Roles={admins:{email:string;unit_id:string}[];super_admins:{email:string}[]}
type Variant={id:string;unit_id:string;family:string;name:string;sku:string|null;size:string|null;color:string|null;total:number;reserved:number;available:number}
export type Overview={variants:Variant[];transfers:{id:string;source_variant:string;target_variant:string;qty:number;created_at:string}[]}
export default function ShopsClient({context,roles,overview,email}:{context:ShopContext;roles:Roles;overview:Overview;email:string}) {
  const router=useRouter(),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('')
  const busyRef=useRef(false)
  const [mail,setMail]=useState(''),[unit,setUnit]=useState(context.unit_id||context.units[0]?.id||''),[superRole,setSuper]=useState(false)
  const [source,setSource]=useState(''),[target,setTarget]=useState(''),[qty,setQty]=useState('')
  const [requestId,setRequestId]=useState('')
  const from=overview.variants.find(v=>v.id===source),to=overview.variants.find(v=>v.id===target)
  const unitName=(id:string)=>context.units.find(u=>u.id===id)?.name||id
  const label=(v:Variant)=>`${unitName(v.unit_id)} · ${v.name} · ${displaySize(v.size)} · ${displayColor(v.color)} · доступно ${v.available}`
  async function send(body:object,success:string) {
    if(busyRef.current)return false
    busyRef.current=true
    setBusy(true);setMessage('');setError('')
    try{const r=await unitFetch('/api/admin/shops',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw new Error(d.error);setMessage(success);router.refresh();return true}
    catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить');return false}finally{busyRef.current=false;setBusy(false)}
  }
  return <div className="shops-page">
    <p>У магазинов отдельные каталоги, остатки, заказы, сотрудники, правила и офисы. Переключайте магазин в боковой панели. Кадровые БЮ и юрлицо сотрудника не определяют доступ: сотрудник получает один магазин через его реестр.</p>
    {error&&<p role="alert" className="login-error">{error}</p>}{message&&<p role="status">{message}</p>}
    <section className="analytics-section"><h2>Администраторы</h2><p>Администратор настраивает указанный магазин. Суперадминистратор управляет всеми магазинами и назначает роли. Можно указать почту до регистрации: роль начнёт действовать после входа с ней.</p>
      <form className="shops-form" onSubmit={async e=>{e.preventDefault();if(await send({action:'role',email:mail,unit,super:superRole,enabled:true},'Права администратора сохранены'))setMail('')}}>
        <label>Email<input type="email" className="ap-input" required value={mail} onChange={e=>setMail(e.target.value)}/></label>
        <label>Роль<select aria-label="Роль" className="ap-input" value={superRole?'super':'unit'} onChange={e=>setSuper(e.target.value==='super')}><option value="unit">Администратор магазина</option><option value="super">Суперадминистратор</option></select></label>
        {!superRole&&<label>Магазин<select aria-label="Магазин администратора" className="ap-input" value={unit} onChange={e=>setUnit(e.target.value)}>{context.units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
        <button className="ao-save-btn" disabled={busy}>Назначить</button>
      </form>
      <ul className="shops-role-list">{roles.super_admins.map(a=><li key={'s'+a.email}><span>{a.email} · Суперадминистратор</span>{a.email!==email&&<button disabled={busy} className="ao-light-btn" onClick={()=>send({action:'role',email:a.email,super:true,enabled:false},'Роль снята')}>Снять роль</button>}</li>)}{roles.admins.map(a=><li key={a.email+a.unit_id}><span>{a.email} · {unitName(a.unit_id)}</span><button disabled={busy} className="ao-light-btn" onClick={()=>send({action:'role',email:a.email,unit:a.unit_id,super:false,enabled:false},'Роль снята')}>Снять роль</button></li>)}</ul>
    </section>
    <section className="analytics-section"><h2>Распределить остатки между складами</h2><p>Исходный остаток сохранён в Ecom. Перенос уменьшает один склад и увеличивает другой на такое же количество. Зарезервированные позиции остаются в исходном магазине.</p>
      <form className="shops-form" onSubmit={async e=>{e.preventDefault();const id=requestId||crypto.randomUUID();setRequestId(id);if(await send({action:'transfer',id,source,target,qty:Number(qty)},'Остатки перенесены')){setRequestId('');setQty('')}}}>
        <label>Откуда и какой товар<select aria-label="Откуда и какой товар" className="ap-input" required value={source} onChange={e=>{setSource(e.target.value);setTarget('');setRequestId('')}}><option value="">Выберите товар и склад</option>{overview.variants.filter(v=>v.available>0).map(v=><option key={v.id} value={v.id}>{label(v)}</option>)}</select></label>
        <label>Куда<select aria-label="Куда" className="ap-input" required value={target} onChange={e=>{setTarget(e.target.value);setRequestId('')}}><option value="">Выберите склад</option>{overview.variants.filter(v=>from&&v.family===from.family&&v.unit_id!==from.unit_id).map(v=><option key={v.id} value={v.id}>{label(v)}</option>)}</select></label>
        <label>Количество<input type="number" min="1" max={from?.available} step="1" required className="ap-input" value={qty} onChange={e=>{setQty(e.target.value);setRequestId('')}}/></label>
        {from&&to&&Number(qty)>0&&<p>{unitName(from.unit_id)}: {from.total} → {from.total-Number(qty)} шт. · {unitName(to.unit_id)}: {to.total} → {to.total+Number(qty)} шт.</p>}
        <button className="ao-save-btn" disabled={busy||!from||!to}>Перенести остаток</button>
      </form>
      <h3>Последние переносы</h3>{overview.transfers.length?<ul>{overview.transfers.map(t=><li key={t.id}>{new Date(t.created_at).toLocaleString('ru-RU',{timeZone:'Asia/Tashkent'})} · {unitName(overview.variants.find(v=>v.id===t.source_variant)?.unit_id||'')} → {unitName(overview.variants.find(v=>v.id===t.target_variant)?.unit_id||'')} · {t.qty} шт.</li>)}</ul>:<p>Переносов пока нет.</p>}
    </section>
  </div>
}
