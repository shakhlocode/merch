'use client'
import {useContext,useEffect,useRef,useState} from 'react'
import {useRouter} from 'next/navigation'
import {ShopContextValue} from './ShopProvider'
import ActionDialog from './ActionDialog'
import {unitFetch} from '@/lib/shop-context'
type Roles={admins:{email:string;unit_id:string}[];super_admins:{email:string}[]}
export default function AdminAccessButton({email,fullName}:{email?:string;fullName?:string}) {
  const shop=useContext(ShopContextValue),[open,setOpen]=useState(false)
  if(!shop.is_super_admin)return null
  return <><button type="button" className="admin-small-button" onClick={()=>setOpen(true)}>{email?'Права администратора':'Доступы администраторов'}</button>{open&&<AccessDialog email={email} fullName={fullName} onClose={()=>setOpen(false)}/>}</>
}
function AccessDialog({email,fullName,onClose}:{email?:string;fullName?:string;onClose:()=>void}) {
  const shop=useContext(ShopContextValue),router=useRouter(),lock=useRef(false)
  const [roles,setRoles]=useState<Roles|null>(null),[mail,setMail]=useState(email||''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  useEffect(()=>{let stop=false;unitFetch('/api/admin/shops?view=roles',{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);if(!stop)setRoles(d)}).catch(e=>{if(!stop)setError(e.message)});return()=>{stop=true}},[])
  const address=mail.trim().toLowerCase(),isSuper=!!roles?.super_admins.some(a=>a.email===address),isAdmin=!!roles?.admins.some(a=>a.email===address&&a.unit_id===shop.unit_id)
  const unitName=shop.units.find(u=>u.id===shop.unit_id)?.name||'этого БЮ'
  async function change(superRole:boolean,enabled:boolean,target=address) {
    if(lock.current)return
    lock.current=true;setBusy(true);setError('');setMessage('')
    try {
      const r=await unitFetch('/api/admin/shops',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'role',email:target,unit:shop.unit_id,super:superRole,enabled})}),d=await r.json()
      if(!r.ok)throw new Error(d.error)
      const next=await unitFetch('/api/admin/shops?view=roles',{cache:'no-store'}),data=await next.json()
      if(!next.ok)throw new Error(data.error)
      setRoles(data);setMessage(enabled?'Права предоставлены':'Права сняты');router.refresh()
    }catch(e){setError(e instanceof Error?e.message:'Не удалось изменить права')}finally{lock.current=false;setBusy(false)}
  }
  const valid=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)&&!address.endsWith('.merch.invalid')
  return <ActionDialog title={fullName?`Доступы: ${fullName}`:'Доступы администраторов'} onClose={onClose} busy={busy}>
    <p>Администратор управляет БЮ «{unitName}». Суперадминистратор — всеми БЮ и назначением прав.</p>
    <label className="admin-action-field">Email для входа<input type="email" className="ap-input" value={mail} readOnly={!!email} onChange={e=>{setMail(e.target.value);setMessage('')}}/></label>
    {email?.endsWith('.merch.invalid')&&<p>Для административного доступа добавьте сотруднику рабочую почту в реестре.</p>}
    {!roles&&!error&&<p role="status">Загружаем права…</p>}
    {roles&&<><p>Текущие права: {isSuper?'суперадминистратор':isAdmin?`администратор ${unitName}`:'сотрудник'}.</p>
      <div className="admin-action-buttons">
        <button type="button" className="ao-light-btn" disabled={busy||!valid||isSuper} onClick={()=>change(false,!isAdmin)}>{isAdmin?'Снять права администратора':'Сделать админом'}</button>
        <button type="button" className="ao-save-btn" disabled={busy||!valid} onClick={()=>change(true,!isSuper)}>{isSuper?'Снять права суперадминистратора':'Сделать суперадмином'}</button>
      </div>
    </>}
    {error&&<p role="alert" className="login-error">{error}</p>}{message&&<p role="status">{message}</p>}
    {!email&&roles&&<details className="admin-access-list"><summary>Кому уже выданы права</summary>
      <ul>{roles.super_admins.map(a=><li key={'s'+a.email}><span>{a.email} · Суперадминистратор</span><button className="admin-small-button" disabled={busy} onClick={()=>change(true,false,a.email)}>Снять права</button></li>)}{roles.admins.filter(a=>a.unit_id===shop.unit_id).map(a=><li key={a.email}><span>{a.email} · Администратор {unitName}</span><button className="admin-small-button" disabled={busy} onClick={()=>change(false,false,a.email)}>Снять права</button></li>)}</ul>
    </details>}
  </ActionDialog>
}
