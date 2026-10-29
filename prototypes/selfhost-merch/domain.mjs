import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import QRCode from 'qrcode'
import {hash,random,equal} from './security.mjs'
import {seal,unseal} from './crypto.mjs'
import {portalAdmin} from './portal-admin.mjs'
const units=['ecom','fintech','technologies']
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
function cookie(req,name){return(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||''}
async function transaction(pool,fn){const db=await pool.connect();try{await db.query('begin');const r=await fn(db);await db.query('commit');return r}catch(e){await db.query('rollback');throw e}finally{db.release()}}
async function roles(pool,s){return s?.active?(await pool.query('select unit,role from demo_roles where user_id=$1',[s.user_id])).rows:[]}
const permitted=(rs,unit)=>rs.some(r=>r.role==='super'||r.unit===unit)
const unitList=rs=>rs.some(r=>r.role==='super')?units:rs.map(r=>r.unit)
async function move(db,variant,order,campaign,total,reserved,kind,actor){await db.query('insert into demo_stock_movements values($1,$2,$3,$4,$5,$6,$7,$8,now())',[randomUUID(),variant,order,campaign,total,reserved,kind,actor])}
async function audit(db,kind,actor){await db.query('insert into demo_events(kind,detail,actor_id) values($1,$2,$3)',[kind,'Операция мерчшопа; без контактов, кодов и содержимого запроса.',actor])}
async function lockCampaign(db,id){const c=(await db.query('select * from demo_campaigns where id=$1 for share',[id])).rows[0];if(!c||c.status!=='open')throw new Error('Раздача закрыта');return c}
async function cancel(db,order,actor){
 if(order.status==='received')throw new Error('Полученный заказ нельзя отменять без отдельного процесса возврата')
 if(order.status==='cancelled')return
 const items=(await db.query('select * from demo_order_items where order_id=$1 order by variant_id',[order.id])).rows
 for(const i of items){await db.query('select id from demo_variants where id=$1 for update',[i.variant_id]);await db.query('update demo_variants set reserved=reserved-$1 where id=$2',[i.qty,i.variant_id]);await move(db,i.variant_id,order.id,order.campaign_id,0,-i.qty,'release',actor)}
 await db.query("update demo_orders set status='cancelled',pickup_cipher=null where id=$1",[order.id])
 await audit(db,'order_cancelled',actor)
}
async function orderList(pool,s,adminUnits=null){
 const {rows}=await pool.query(`select o.id,o.user_id,o.unit,o.scope,o.status,o.created_at,o.received_at,e.full_name,
   coalesce((select jsonb_agg(jsonb_build_object('variant_id',v.id,'product',v.product,'size',v.size,'color',v.color,'qty',i.qty) order by v.id) from demo_order_items i join demo_variants v on v.id=i.variant_id where i.order_id=o.id),'[]') as items
   from demo_orders o join demo_users u on u.id=o.user_id join demo_employees e on e.id=u.employee_id
   where ($2::text[] is not null and o.unit=any($2::text[])) or ($2::text[] is null and o.user_id=$1)
   order by o.created_at desc`,[s.user_id,adminUnits])
 return rows
}
export async function domainRoute(req,res,url,s,h){
 const {pool,json,body,origin,event,sh,newSession}=h,path=url.pathname
 const page=['/','/shop','/admin','/data','/mailbox','/review','/access'].includes(path)
 if(req.method==='GET'&&page){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(await readFile('web/index.html'));return true}
 if(req.method==='GET'&&['/storage-demo.js','/storage-demo.css'].includes(path)){res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':'text/css'});res.end(await readFile('web/'+path.slice(1)));return true}
 if(path==='/outbox'&&req.method==='GET'){h.redirect(res,'/mailbox');return true}
 if(path==='/api/guest'&&req.method==='POST'){
  origin(req);const b=await body(req)
  if(!b.csrf||!equal(b.csrf,cookie(req,'merch_storage_guest_csrf'))||typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token)||typeof b.identifier!=='string'||b.identifier.length>128)throw new Error('Недействительное приглашение')
  const result=await transaction(pool,async db=>{
   const i=(await db.query('select * from demo_invites where token_hash=$1 and claimed_at is null and not revoked and expires_at>now() and attempts<8 for update',[hash(b.token)])).rows[0]
   if(!i)throw new Error('Приглашение недоступно')
   if(!equal(sh(i.id+':'+b.identifier.trim()),i.code_hash)){await db.query('update demo_invites set attempts=attempts+1 where id=$1',[i.id]);return false}
   const e=(await db.query('select * from demo_employees where id=$1 and active for update',[i.employee_id])).rows[0]
   if(!e)throw new Error('Доступ закрыт');await lockCampaign(db,e.campaign_id)
   let user=i.recovery_user_id
   if(user){if(!(await db.query('select id from demo_users where id=$1 and employee_id=$2 and issuer is null',[user,e.id])).rows[0])throw new Error('Аккаунт недоступен')}
   else{user=randomUUID();await db.query('insert into demo_users(id,employee_id) values($1,$2)',[user,e.id])}
   await db.query('update demo_invites set claimed_at=now() where id=$1',[i.id]);await newSession(db,res,user,'identifier');return true
  })
  await event(result?'guest_claimed':'guest_failed');json(res,result?200:400,result?{ok:true}:{error:'Идентификатор не совпадает или приглашение недоступно'});return true
 }
 if(!path.startsWith('/api/')&&!path.startsWith('/files/'))return false
 if(['/api/guest'].includes(path))return false
 if(!s||!s.active){json(res,401,{error:'Войдите в разрешённый тестовый аккаунт'});return true}
 // Retention/restore problems fail closed, not merely display an unhealthy badge.
 try{const health=await fetch('http://retention:9050/health',{signal:AbortSignal.timeout(1500)});if(!health.ok)throw new Error()}catch{json(res,503,{error:'Сервис очистки недоступен; работа временно закрыта'});return true}
 const rs=await roles(pool,s),isSuper=rs.some(r=>r.role==='super'),adminUnits=unitList(rs)
 if(await portalAdmin(req,res,url,s,{pool,json,body,origin,adminUnits}))return true
 const employee=(await pool.query('select campaign_id from demo_employees where id=$1',[s.employee_id])).rows[0]
 const campaign=employee?.campaign_id?(await pool.query('select * from demo_campaigns where id=$1',[employee.campaign_id])).rows[0]:null
 if(req.method==='GET'&&path==='/api/me'){json(res,200,{id:s.user_id,name:s.full_name,email:s.email,unit:s.unit,scope:s.scope,method:s.method,csrf:s.csrf,adminUnits,isSuper,campaign});return true}
 if(req.method==='GET'&&/^\/files\/(shirt|book)\.svg$/.test(path)){res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end(await readFile('/data/files/'+path.split('/').pop()));return true}
 if(req.method==='GET'&&path==='/api/catalog'){
  if(!campaign||campaign.status!=='open'){json(res,403,{error:'Нет действующей раздачи'});return true}
  json(res,200,(await pool.query("select *,total-reserved as available from demo_variants where unit=$1 and active and scope in($2,'both') order by product,size",[s.unit,s.scope])).rows);return true
 }
 if(req.method==='GET'&&path==='/api/orders'){json(res,200,await orderList(pool,s));return true}
 const receipt=path.match(/^\/api\/orders\/([a-f0-9-]{36})\/receipt\.(svg|json)$/)
 if(req.method==='GET'&&receipt){
  const o=(await pool.query('select * from demo_orders where id=$1',[receipt[1]])).rows[0]
  if(!o||(o.user_id!==s.user_id&&!permitted(rs,o.unit))){json(res,404,{error:'Не найдено'});return true}
  if(!o.pickup_cipher){json(res,410,{error:'Код больше не нужен'});return true}
  if(receipt[2]==='json'){json(res,200,{token:unseal(o.pickup_cipher)});return true}
  const svg=await QRCode.toString(unseal(o.pickup_cipher),{type:'svg',errorCorrectionLevel:'M',margin:4})
  res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end(svg);return true
 }
 if(req.method==='GET'&&path.startsWith('/api/admin/')){
  if(!rs.length){json(res,403,{error:'Нужны права организатора'});return true}
  if(path==='/api/admin/orders'){json(res,200,await orderList(pool,s,adminUnits));return true}
  if(path==='/api/admin/stocks'){json(res,200,(await pool.query('select *,total-reserved as available from demo_variants where unit=any($1) order by unit,product,size',[adminUnits])).rows);return true}
  if(path==='/api/admin/mailbox'){
   json(res,200,(await pool.query('select m.id,m.content_cipher from demo_outbox m join demo_employees e on e.id=m.employee_id where e.unit=any($1) and m.expires_at>now() order by m.created_at',[adminUnits])).rows.map(m=>({id:m.id,...JSON.parse(unseal(m.content_cipher))})));return true
  }
  if(path==='/api/admin/data'){
   if(!isSuper){json(res,403,{error:'Нужен супер администратор'});return true}
   const preview=(await pool.query('select demo_retention_preview() as p')).rows[0].p
   const campaigns=(await pool.query('select * from demo_campaigns order by unit')).rows
   json(res,200,{...preview,campaigns,storage:{database:'merch_selfhost_demo',files:'product-files /data/files',ledger:'deletion-ledger /data/ledger',mail:'encrypted demo_outbox; no SMTP',identity:'separate synthetic Keycloak volume'},fields:['ФИО','email — корпоративный вход или личная почта приглашённого новичка','iss + sub — только корпоративный вход','хэш приглашения/идентификатора — гостевой вход','случайный ID аккаунта','разрешение на раздачу и правила по юрлицу/группе/subject','код юрлица, группы и активность — только в 15-минутной серверной сессии','товары и статусы заказа']});return true
  }
  if(path==='/api/admin/analytics'){
   const rows=(await pool.query(`select v.unit,v.product,v.size,v.color,v.total,v.reserved,
     coalesce((select sum(i.qty) from demo_order_items i join demo_orders o on o.id=i.order_id where i.variant_id=v.id and o.status='received'),0)::integer+coalesce((select sum(a.qty) from demo_aggregates a where a.variant_id=v.id),0)::integer as issued
     from demo_variants v where unit=any($1) order by unit,product,size`,[adminUnits])).rows
   if(url.searchParams.get('format')==='csv'){res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="demo-stock.csv"'});res.end('\ufeff'+[['Магазин','Товар','Размер','Цвет','Всего','Резерв','Выдано'],...rows.map(r=>Object.values(r))].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n'))}
   else json(res,200,rows)
   return true
  }
 }
 if(req.method!=='POST'){json(res,404,{error:'Не найдено'});return true}
 origin(req);const b=await body(req)
 if(!equal(b.csrf,s.csrf)){json(res,403,{error:'Неверная сессия запроса'});return true}
 if(path==='/api/orders'){
  if(!campaign){json(res,403,{error:'Нет разрешения на раздачу'});return true}
  if(Object.keys(b).some(k=>!['csrf','items','requestKey'].includes(k))||!uuid(b.requestKey)||!Array.isArray(b.items)||!b.items.length||b.items.length>3||b.items.some(x=>!uuid(x))||new Set(b.items).size!==b.items.length)throw new Error('Выберите до трёх товаров. Кадровые и контактные поля не принимаются.')
  const result=await transaction(pool,async db=>{
   await lockCampaign(db,campaign.id);if(!(await db.query('select id from demo_employees where id=$1 and active and (not email_welcome or (welcome_received_at is null and access_expires_at>now())) for update',[s.employee_id])).rows[0])throw new Error('Доступ закрыт')
   const retry=(await db.query('select id from demo_orders where user_id=$1 and request_key=$2',[s.user_id,b.requestKey])).rows[0];if(retry)return retry
   if((await db.query("select id from demo_orders where user_id=$1 and campaign_id=$2 and status<>'cancelled'",[s.user_id,campaign.id])).rows[0])throw new Error('Для этой раздачи заказ уже оформлен')
   const vs=(await db.query('select * from demo_variants where id=any($1::uuid[]) order by id for update',[b.items])).rows
   if(vs.length!==b.items.length||vs.some(v=>v.unit!==s.unit||![s.scope,'both'].includes(v.scope)||!v.active||v.total-v.reserved<1)||new Set(vs.map(v=>v.product)).size!==vs.length)throw new Error('Товар недоступен или выбран повторно')
   const id=randomUUID(),token=random()
   await db.query('insert into demo_orders(id,user_id,unit,scope,snapshot,campaign_id,request_key,pickup_hash,pickup_cipher) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,s.user_id,s.unit,s.scope,JSON.stringify({delivery:'office'}),campaign.id,b.requestKey,hash(token),seal(token)])
   for(const v of vs){await db.query('insert into demo_order_items values($1,$2,1)',[id,v.id]);await db.query('update demo_variants set reserved=reserved+1 where id=$1',[v.id]);await move(db,v.id,id,campaign.id,0,1,'reserve',s.user_id)}
   await audit(db,'order_created',s.user_id);return{id}
  });json(res,201,result);return true
 }
 const cancelRoute=path.match(/^\/api\/orders\/([a-f0-9-]{36})\/cancel$/)
 if(cancelRoute){
  const o=(await pool.query('select * from demo_orders where id=$1',[cancelRoute[1]])).rows[0]
  if(!o||(o.user_id!==s.user_id&&!permitted(rs,o.unit))){json(res,404,{error:'Не найдено'});return true}
  await transaction(pool,async db=>{await lockCampaign(db,o.campaign_id);const cur=(await db.query('select * from demo_orders where id=$1 for update',[o.id])).rows[0];await cancel(db,cur,s.user_id)})
  json(res,200,{ok:true});return true
 }
 if(!rs.length){json(res,403,{error:'Нужны права организатора'});return true}
 if(path==='/api/admin/issue'){
  if(typeof b.token!=='string'||!/^[\w-]{43}$/.test(b.token))throw new Error('Некорректный код получения')
  const found=(await pool.query('select * from demo_orders where pickup_hash=$1',[hash(b.token)])).rows[0]
  if(!found||!permitted(rs,found.unit)){json(res,404,{error:'Заказ не найден в доступном магазине'});return true}
  const result=await transaction(pool,async db=>{
   await lockCampaign(db,found.campaign_id)
   const o=(await db.query('select * from demo_orders where id=$1 for update',[found.id])).rows[0]
   if(o.status==='received')return{already:true,id:o.id,received_at:o.received_at}
   if(o.status!=='ready')throw new Error('Выдавать можно только подготовленный заказ')
   const items=(await db.query('select * from demo_order_items where order_id=$1 order by variant_id',[o.id])).rows
   for(const i of items){await db.query('select id from demo_variants where id=$1 for update',[i.variant_id]);await db.query('update demo_variants set total=total-$1,reserved=reserved-$1 where id=$2',[i.qty,i.variant_id]);await move(db,i.variant_id,o.id,o.campaign_id,-i.qty,-i.qty,'issue',s.user_id)}
   await db.query("update demo_orders set status='received',received_at=now(),received_by=$1,pickup_cipher=null where id=$2",[s.user_id,o.id])
   const employee=(await db.query('select e.* from demo_employees e join demo_users u on u.employee_id=e.id where u.id=$1 for update of e',[o.user_id])).rows[0]
   if(employee?.email_welcome){
    await db.query('update demo_employees set active=false,welcome_received_at=now() where id=$1',[employee.id])
    await db.query('delete from demo_sessions where user_id=$1',[o.user_id])
    await db.query('delete from demo_email_links where employee_id=$1',[employee.id])
    await db.query('delete from demo_outbox where employee_id=$1',[employee.id])
   }
   await audit(db,'order_issued',s.user_id)
   return{already:false,id:o.id}
  });json(res,200,result);return true
 }
 const statusRoute=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/status$/)
 if(statusRoute){
  const o=(await pool.query('select * from demo_orders where id=$1',[statusRoute[1]])).rows[0]
  if(!o||!permitted(rs,o.unit)){json(res,404,{error:'Не найдено'});return true}
  await transaction(pool,async db=>{await lockCampaign(db,o.campaign_id);const cur=(await db.query('select status from demo_orders where id=$1 for update',[o.id])).rows[0];if(cur.status===b.status)return;if(!((cur.status==='new'&&b.status==='assembling')||(cur.status==='assembling'&&b.status==='ready')))throw new Error('Недопустимый переход');await db.query('update demo_orders set status=$1 where id=$2',[b.status,o.id])});json(res,200,{ok:true});return true
 }
 const stockRoute=path.match(/^\/api\/admin\/stocks\/([a-f0-9-]{36})$/)
 if(stockRoute){
  const v=(await pool.query('select * from demo_variants where id=$1',[stockRoute[1]])).rows[0]
  if(!v||!permitted(rs,v.unit)){json(res,404,{error:'Не найдено'});return true}
  if(!Number.isSafeInteger(b.delta)||Math.abs(b.delta)>100000||!Number.isSafeInteger(b.threshold)||b.threshold<0||b.threshold>100000||typeof b.active!=='boolean')throw new Error('Проверьте количество')
  await transaction(pool,async db=>{await db.query('select id from demo_variants where id=$1 for update',[v.id]);await db.query('update demo_variants set total=total+$1,threshold=$2,active=$3 where id=$4',[b.delta,b.threshold,b.active,v.id]);if(b.delta)await move(db,v.id,null,null,b.delta,0,'adjustment',s.user_id)});json(res,200,{ok:true});return true
 }
 const closeRoute=path.match(/^\/api\/admin\/campaigns\/([a-f0-9-]{36})\/close$/)
 if(closeRoute){
  await transaction(pool,async db=>{const c=(await db.query('select * from demo_campaigns where id=$1 for update',[closeRoute[1]])).rows[0];if(!c||!permitted(rs,c.unit))throw new Error('Нет доступа');if(c.status==='closed')return;const orders=(await db.query("select * from demo_orders where campaign_id=$1 and status in('new','assembling','ready') order by id for update",[c.id])).rows;for(const o of orders)await cancel(db,o,s.user_id);await db.query("update demo_campaigns set status='closed',closed_at=now() where id=$1",[c.id]);await db.query('update demo_employees set active=false where campaign_id=$1',[c.id]);await db.query('delete from demo_sessions where user_id in(select u.id from demo_users u join demo_employees e on e.id=u.employee_id where e.campaign_id=$1)',[c.id])});json(res,200,{ok:true});return true
 }
 if(path==='/api/admin/invitations'){
  if(!uuid(b.employeeId))throw new Error('Проверьте получателя')
  const e=(await pool.query('select * from demo_employees where id=$1 and active and campaign_id is not null',[b.employeeId])).rows[0]
  if(!e||!permitted(rs,e.unit)){json(res,404,{error:'Не найдено'});return true}
  await transaction(pool,async db=>{
   await lockCampaign(db,e.campaign_id)
   let message
   if(e.email_welcome)throw new Error('Используйте приглашение Welcome pack по личной почте')
   if(e.corporate_subject){message={to:e.email,subject:'Доступ к тестовой раздаче',body:'Подтвердите личность корпоративным входом.',url:h.config.base+'/auth/login'}}
   else{
    if(typeof b.identifier!=='string'||b.identifier.trim().length<3||b.identifier.length>128)throw new Error('Укажите идентификатор')
    await db.query('select id from demo_employees where id=$1 for update',[e.id]);const user=(await db.query('select id from demo_users where employee_id=$1',[e.id])).rows[0]
    if(user)await db.query('delete from demo_sessions where user_id=$1',[user.id])
    await db.query('update demo_invites set revoked=true where employee_id=$1',[e.id])
    const id=randomUUID(),token=Buffer.from(random()+random()).toString('hex').slice(0,64)
    await db.query(`insert into demo_invites(id,employee_id,token_hash,code_hash,recovery_user_id,expires_at) values($1,$2,$3,$4,$5,now()+interval '1 day')`,[id,e.id,hash(token),sh(id+':'+b.identifier.trim()),user?.id||null])
    message={to:e.full_name+' — личная передача',subject:user?'Восстановление тестового входа':'Тестовое приглашение',body:'Персональная ссылка. Идентификатор сообщается отдельно после проверки личности.',url:h.config.base+'/guest#token='+token}
   }
   await db.query(`insert into demo_outbox(id,employee_id,content_cipher,expires_at) values($1,$2,$3,now()+interval '1 day')`,[randomUUID(),e.id,seal(JSON.stringify(message))])
  });json(res,200,{ok:true,mock:true});return true
 }
 json(res,404,{error:'Не найдено'});return true
}
