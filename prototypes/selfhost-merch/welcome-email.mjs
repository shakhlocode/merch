import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {hash,random,equal,sessionHash} from './security.mjs'
import {seal} from './crypto.mjs'
const normalize=x=>typeof x==='string'?x.trim().toLowerCase():''
const validEmail=x=>x.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x)
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x)
function cookie(req,name){return(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||''}
async function transaction(pool,fn){const db=await pool.connect();try{await db.query('begin');const r=await fn(db);await db.query('commit');return r}catch(e){await db.query('rollback');throw e}finally{db.release()}}
async function audit(db,actor,kind){await db.query('insert into demo_events(kind,detail,actor_id) values($1,$2,$3)',[kind,'Операция приглашения Welcome pack; без email, ссылок и тела запроса в журнале.',actor])}
async function queueLink(db,e,base){
 await db.query('delete from demo_email_links where employee_id=$1',[e.id])
 const token=random()
 await db.query("insert into demo_email_links(id,employee_id,token_hash,expires_at) values($1,$2,$3,now()+interval '20 minutes')",[randomUUID(),e.id,hash(token)])
 await db.query("insert into demo_outbox(id,employee_id,content_cipher,expires_at) values($1,$2,$3,now()+interval '20 minutes')",[randomUUID(),e.id,seal(JSON.stringify({to:e.email,subject:'Вход в Welcome pack',body:'Персональная ссылка действует 20 минут. Откройте её и нажмите «Войти в Welcome pack». Если ссылка истекла, запросите новую на странице входа по личной почте.',url:base+'/email-login#token='+token}))])
}
async function available(db,id){return(await db.query(`select e.* from demo_employees e join demo_campaigns c on c.id=e.campaign_id
 where e.id=$1 and e.email_welcome and e.scope='welcome' and e.active and e.welcome_received_at is null and e.access_expires_at>now() and c.status='open' and c.purged_at is null for update of e`,[id])).rows[0]}

export async function welcomeEmailRoute(req,res,url,s,h){
 const {pool,json,body,origin,newSession,config}=h,path=url.pathname
 if(req.method==='GET'&&path==='/email-login'){
  const csrf=random();res.appendHeader('Set-Cookie',`merch_email_csrf=${csrf}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1800`)
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'})
  res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome pack · вход по личной почте</title><link rel="stylesheet" href="/storage-demo.css"><script src="/email-access.js" defer></script></head><body><main><section class="card portal"><span class="badge">Изолированный стенд · только вымышленные данные</span><h1>Ваш Welcome pack</h1><p>Вход по личной почте без корпоративного портала. Доступ открывает онбординг-менеджер.</p><input id="email-csrf" type="hidden" value="${csrf}"><form id="email-consume" hidden><p>Подтвердите вход по персональной ссылке из письма.</p><button>Войти в Welcome pack</button></form><form id="email-request"><label>Личная почта<input name="email" type="email" required autocomplete="email" placeholder="newcomer@example.invalid"></label><button>Отправить ссылку для входа</button><p>Можно вернуться к тому же заказу до получения мерча. После выдачи доступ закрывается.</p></form><p id="email-message" role="status"></p><a href="/">Другие способы входа</a><p class="muted">Реальные письма не отправляются. Тестовая ссылка доступна организатору в тестовом почтовом ящике. Не вводите настоящие персональные данные.</p></section></main></body></html>`);return true
 }
 if(req.method==='GET'&&path==='/email-access.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile('web/email-access.js'));return true}
 if(!['/api/email/request','/api/email/consume','/api/admin/welcome-email'].includes(path))return false
 // Public email endpoints are also quarantined if retention/restore is unhealthy.
 try{const r=await fetch('http://retention:9050/health',{signal:AbortSignal.timeout(1500)});if(!r.ok)throw new Error()}catch{json(res,503,{error:'Сервис временно недоступен'});return true}
 let adminUnits=[]
 if(path.startsWith('/api/admin/')){
  if(!s?.active){json(res,401,{error:'Войдите как организатор'});return true}
  const roles=(await pool.query('select unit,role from demo_roles where user_id=$1',[s.user_id])).rows
  adminUnits=roles.some(r=>r.role==='super')?['ecom','fintech','technologies']:roles.map(r=>r.unit)
  if(!adminUnits.length){json(res,403,{error:'Нужны права организатора'});return true}
  if(req.method==='GET'){
   json(res,200,(await pool.query(`select e.id,e.full_name,e.email,e.unit,e.campaign_id,e.active,e.access_expires_at,e.email_verified_at,e.welcome_received_at from demo_employees e
    where e.email_welcome and e.unit=any($1) order by e.full_name`,[adminUnits])).rows);return true
  }
 }
 if(req.method!=='POST'){json(res,405,{error:'Недопустимый метод'});return true}
 origin(req);const b=await body(req)
 if(path.startsWith('/api/admin/')){
  if(!equal(b.csrf,s.csrf)){json(res,403,{error:'Неверная сессия запроса'});return true}
  await transaction(pool,async db=>{
   // Serialize creation/resend/revoke; never silently merge accounts by email.
   await db.query('select pg_advisory_xact_lock(77334457)')
   if(b.action==='revoke'){
    if(!uuid(b.employeeId))throw new Error('Invalid participant')
    const e=(await db.query('select * from demo_employees where id=$1 and email_welcome and unit=any($2) for update',[b.employeeId,adminUnits])).rows[0]
    if(!e)throw new Error('Participant unavailable')
    await db.query('update demo_employees set active=false where id=$1',[e.id]);await db.query('delete from demo_email_links where employee_id=$1',[e.id])
    await db.query('delete from demo_sessions where user_id in(select id from demo_users where employee_id=$1)',[e.id]);await audit(db,s.user_id,'welcome_email_revoked');return
   }
   if(b.action!=='invite'||!uuid(b.campaignId)||typeof b.fullName!=='string'||!b.fullName.trim()||b.fullName.length>250||!validEmail(normalize(b.email))||!Number.isInteger(b.validDays)||b.validDays<1||b.validDays>90)throw new Error('Проверьте ФИО, почту и срок приглашения')
   const c=(await db.query("select * from demo_campaigns where id=$1 and unit=any($2) and status='open' and purged_at is null for share",[b.campaignId,adminUnits])).rows[0]
   if(!c)throw new Error('Раздача недоступна')
   const email=normalize(b.email),old=(await db.query('select * from demo_employees where lower(email)=$1 for update',[email])).rows
   if(old.length>1||old.some(e=>!e.email_welcome||e.campaign_id!==c.id||e.unit!==c.unit||e.welcome_received_at))throw new Error('Аккаунт уже существует или Welcome pack уже получен. Автоматическое объединение и повторная выдача запрещены.')
   let e=old[0]
   if(e){
    // A revoked invitation is not automatically reactivated by a resend.
    if(!e.active)throw new Error('Доступ отозван; нужна отдельная проверка организатора')
    e=(await db.query("update demo_employees set full_name=$1,access_expires_at=now()+make_interval(days=>$2) where id=$3 returning *",[b.fullName.trim(),b.validDays,e.id])).rows[0]
   }else e=(await db.query("insert into demo_employees(id,full_name,email,unit,scope,campaign_id,email_welcome,access_expires_at) values($1,$2,$3,$4,'welcome',$5,true,now()+make_interval(days=>$6)) returning *",[randomUUID(),b.fullName.trim(),email,c.unit,c.id,b.validDays])).rows[0]
   await queueLink(db,e,config.base);await audit(db,s.user_id,'welcome_email_invited')
  });json(res,200,{ok:true,mock:true});return true
 }
 if(!equal(b.csrf,cookie(req,'merch_email_csrf'))){json(res,403,{error:'Обновите страницу входа'});return true}
 if(path==='/api/email/request'){
  // Same status and message for unknown, expired, revoked and completed invitations.
  const email=normalize(b.email)
  await transaction(pool,async db=>{
   const key=sessionHash('email-request-ip:'+req.socket.remoteAddress,process.env.DEMO_SESSION_PEPPER)
   const rate=(await db.query(`insert into demo_email_throttles(key_hash,hits,expires_at) values($1,1,now()+interval '1 minute')
    on conflict(key_hash) do update set hits=case when demo_email_throttles.expires_at<=now() then 1 else demo_email_throttles.hits+1 end,
    expires_at=case when demo_email_throttles.expires_at<=now() then now()+interval '1 minute' else demo_email_throttles.expires_at end returning hits`,[key])).rows[0]
   if(rate.hits>15||!validEmail(email))return
   const raw=(await db.query('select id from demo_employees where lower(email)=$1 and email_welcome',[email])).rows[0]
   if(!raw)return
   const e=await available(db,raw.id);if(!e)return
   const recent=(await db.query("select 1 from demo_email_links where employee_id=$1 and created_at>now()-interval '1 minute'",[e.id])).rows[0]
   if(recent)return
   await queueLink(db,e,config.base)
  })
  json(res,200,{ok:true,message:'Если для этой почты есть действующее приглашение, мы отправили ссылку. Проверьте почту. Новая ссылка заменяет предыдущую.'});return true
 }
 if(typeof b.token!=='string'||!/^[\w-]{43}$/.test(b.token)){json(res,400,{error:'Ссылка недействительна. Запросите новую.'});return true}
 const accepted=await transaction(pool,async db=>{
  // Lock participant before link: resend/receipt/recovery take the same lock order.
  const candidate=(await db.query('select employee_id from demo_email_links where token_hash=$1',[hash(b.token)])).rows[0]
  if(!candidate)return false
  const e=await available(db,candidate.employee_id);if(!e)return false
  const link=(await db.query('select * from demo_email_links where token_hash=$1 and used_at is null and expires_at>now() for update',[hash(b.token)])).rows[0]
  if(!link)return false
  let user=(await db.query('select * from demo_users where employee_id=$1',[e.id])).rows[0]
  if(user?.issuer)throw new Error('Identity binding conflict')
  if(!user)user=(await db.query('insert into demo_users(id,employee_id) values($1,$2) returning *',[randomUUID(),e.id])).rows[0]
  await db.query('update demo_email_links set used_at=now() where employee_id=$1',[e.id])
  await db.query('update demo_employees set email_verified_at=coalesce(email_verified_at,now()) where id=$1',[e.id])
  await db.query('delete from demo_sessions where user_id=$1',[user.id])
  await newSession(db,res,user.id,'email');await audit(db,user.id,'welcome_email_login');return true
 })
 json(res,accepted?200:409,accepted?{ok:true,next:'/shop'}:{error:'Ссылка использована, истекла или доступ закрыт. Запросите новую ссылку либо обратитесь к организатору.'});return true
}
