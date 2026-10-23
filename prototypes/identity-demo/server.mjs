import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { assertDemoConfig, corporateClaims, equal, hash, pkce, random, sessionHash, validateOrder } from './security.mjs'

const config = assertDemoConfig(process.env)
// No production URL, SMTP client, Supabase SDK, or corporate API exists in this process.
const pool = new pg.Pool({ host:'db', port:5432, database:'merch_identity_demo', user:'merch_demo', password:process.env.DEMO_DB_PASSWORD, max:8 })
const pepper = process.env.DEMO_SESSION_PEPPER
const internal = process.env.DEMO_IDP_INTERNAL_ORIGIN
const clientId = process.env.DEMO_CLIENT_ID
const callback = config.base + '/auth/callback'
const inviteId = '40000000-0000-4000-8000-000000000001'
const jwks = createRemoteJWKSet(new URL(internal + '/realms/merch-demo/protocol/openid-connect/certs'), { timeoutDuration:4000 })
const events = {
  login_started:'Браузер → тестовый Keycloak: openid profile email, state, nonce, PKCE. Пароль получает только Keycloak.',
  login_succeeded:'Сервер → тестовый Keycloak: обмен кода. Проверены подпись, issuer, audience, срок, nonce. Права проверены по локальному реестру.',
  login_failed:'Корпоративный вход отклонён. Секреты и ответ провайдера в журнал не записываются.',
  guest_claimed:'Персональное приглашение и идентификатор проверены транзакционно. Создана локальная сессия.',
  guest_failed:'Активация приглашения отклонена.',
  order_created:'Заказ сохранён с кадровыми данными из доверенного источника, а не из тела запроса.',
  logout:'Локальная сессия удалена. Общая сессия Keycloak этим действием не завершается.',
  backchannel_logout:'Проверено подписанное уведомление Keycloak. Соответствующие корпоративные сессии удалены.'
}
const event = kind => pool.query('insert into demo_events(kind,detail) values($1,$2)', [kind,events[kind]])
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const sh = token => sessionHash(token,pepper)
function cookie(req,name) { return (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1) || '' }
function setCookie(res,name,value,age) { res.appendHeader('Set-Cookie',`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}`) }
function redirect(res,path) { res.writeHead(303,{Location:path}); res.end() }
function json(res,status,value) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value)) }
function html(res,title,body,status=200) {
  res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'})
  res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · Merch demo</title><link rel="stylesheet" href="/style.css"><script src="/ui.js" defer></script></head><body><header><a href="/">uzum <b>мерч</b></a><span class="badge">Изолированный прототип · только вымышленные данные</span><a href="/review">Схема для проверки</a></header><main>${body}</main><footer>Это отдельный стенд. Рабочий мерчшоп, корпоративный Keycloak и SMTP не подключены.</footer></body></html>`)
}
async function body(req) {
  let text = ''
  for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text)>16384) throw new Error('Request too large') }
  const value = req.headers['content-type']?.startsWith('application/json') ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request')
  return value
}
function origin(req) { if (req.headers.origin !== config.base) throw new Error('Invalid request origin') }
async function session(req) {
  const token = cookie(req,'merch_demo_session')
  if (!/^[\w-]{43}$/.test(token)) return null
  const {rows} = await pool.query(`select s.*,u.employee_id,u.issuer as identity_issuer,u.subject,e.full_name,e.email,e.legal_entity,e.department,e.unit,e.scope,e.active,e.access_used
    from demo_sessions s join demo_users u on u.id=s.user_id join demo_employees e on e.id=u.employee_id where s.token_hash=$1 and s.expires_at>now()`,[sh(token)])
  return rows[0] || null
}
async function newSession(db,res,userId,method,idpSid=null) {
  const token=random(), csrf=random()
  await db.query(`insert into demo_sessions(token_hash,user_id,csrf,method,issuer,idp_sid,expires_at) values($1,$2,$3,$4,$5,$6,now()+interval '15 minutes')`,[sh(token),userId,csrf,method,method==='oidc'?config.issuer:null,idpSid])
  setCookie(res,'merch_demo_session',token,900)
}
function allowed(s) { return s && s.active && !s.access_used }
function internalEndpoint(endpoint) {
  const url=new URL(endpoint)
  if (url.origin !== new URL(config.issuer).origin || !url.pathname.startsWith('/realms/merch-demo/')) throw new Error('Untrusted provider endpoint')
  return internal + url.pathname + url.search
}
async function discovery() {
  const r=await fetch(internal+'/realms/merch-demo/.well-known/openid-configuration',{redirect:'error',signal:AbortSignal.timeout(4000)})
  if(!r.ok)throw new Error('Test identity provider unavailable')
  const d=await r.json()
  if(d.issuer!==config.issuer)throw new Error('Issuer mismatch')
  for(const k of ['authorization_endpoint','token_endpoint','jwks_uri'])internalEndpoint(d[k])
  return d
}
async function initialize() {
  await pool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'))
  const db=await pool.connect()
  try {
    await db.query('begin'); await db.query('select pg_advisory_xact_lock(73319001)')
    for(const p of [
      ['10000000-0000-4000-8000-000000000001','TEST-101','20000000-0000-4000-8000-000000000001','Алина Тестовая','alice@example.invalid','Тестовое юрлицо E-com','Тестовый отдел','ecom','catalog'],
      ['10000000-0000-4000-8000-000000000002','TEST-102','20000000-0000-4000-8000-000000000002','Борис Тестовый','boris@example.invalid','Тестовое юрлицо Fintech','Онбординг (тест)','fintech','welcome'],
      ['10000000-0000-4000-8000-000000000003','TEST-GUEST-001',null,'Гость Тестовый',null,'Тестовое юрлицо Technologies','Склад (тест)','technologies','catalog']
    ])await db.query('insert into demo_employees(id,employee_code,corporate_subject,full_name,email,legal_entity,department,unit,scope) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing',p)
    const alice='30000000-0000-4000-8000-000000000001'
    await db.query('insert into demo_users(id,employee_id,issuer,subject) values($1,$2,$3,$4) on conflict do nothing',[alice,'10000000-0000-4000-8000-000000000001',config.issuer,'20000000-0000-4000-8000-000000000001'])
    await db.query(`insert into demo_orders(id,user_id,unit,scope,snapshot) values('50000000-0000-4000-8000-000000000001',$1,'ecom','catalog',$2) on conflict do nothing`,[alice,JSON.stringify({note:'Существующий тестовый заказ: должен сохраниться при корпоративном входе',full_name:'Алина Тестовая'})])
    await db.query(`insert into demo_invites(id,employee_id,token_hash,code_hash,expires_at) values($1,'10000000-0000-4000-8000-000000000003',$2,$3,now()+interval '7 days') on conflict do nothing`,[inviteId,hash(process.env.DEMO_GUEST_TOKEN),hash(inviteId+':TEST-GUEST-001')])
    await db.query('commit')
  }catch(e){await db.query('rollback');throw e}finally{db.release()}
}
const css=`*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui;color:#24143d;background:#f7f4ff}header,footer{padding:20px 5%;display:flex;gap:24px;align-items:center;justify-content:space-between;background:white;border-bottom:1px solid #ded4ef}header a{color:#24143d;text-decoration:none}header>a:first-child{font-size:24px}main{max-width:1120px;margin:36px auto;padding:0 22px}h1{font-size:34px;line-height:1.2}h2{margin-top:0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.card{background:white;border:1px solid #d4c5e8;border-radius:20px;padding:26px;margin-bottom:22px;box-shadow:0 4px 18px #25143c05}.badge{font-size:12px;background:#eee6ff;border-radius:20px;padding:8px 12px;color:#6425b8}.muted{color:#71677e}.button,button{display:inline-block;background:#7200ff;color:white;border:0;border-radius:12px;padding:13px 20px;font:inherit;cursor:pointer;text-decoration:none}.secondary{background:#eee6ff;color:#351d53}label{display:block;margin:14px 0}input,select,textarea{display:block;width:100%;margin-top:6px;border:1px solid #c8bbdd;border-radius:10px;padding:11px;background:white;font:inherit}input[readonly]{background:#f4f0fa;color:#514462}input[type=checkbox]{display:inline;width:auto}dl{display:grid;grid-template-columns:1fr 1fr;gap:6px}dd{margin:0}code{word-break:break-all}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f4ff;padding:16px;border-radius:12px}#message{color:#a0183f}#result{margin-top:20px}.hidden{display:none}.product{border:1px solid #dfd4ee;padding:12px;border-radius:12px}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #ded4ef;padding:10px;vertical-align:top}footer{font-size:13px;color:#71677e}@media(max-width:700px){.grid{grid-template-columns:1fr}header{flex-wrap:wrap}h1{font-size:28px}}`
const ui=`document.querySelector('#guest')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.target;const token=new URLSearchParams(location.hash.slice(1)).get('token')||f.dataset.token;f.dataset.token=token;history.replaceState(null,'','/guest');await submit('/api/guest',{token,identifier:f.identifier.value,csrf:f.csrf.value},()=>location.assign('/shop'))});
async function submit(url,data,ok){const message=document.querySelector('#message');message.textContent='';try{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw Error(d.error||'Ошибка');ok(d)}catch(e){message.textContent=e.message}}
const checkout=document.querySelector('#checkout');if(checkout){const mode=checkout.mode;function refresh(){document.querySelectorAll('[data-mode]').forEach(el=>el.classList.toggle('hidden',el.dataset.mode!==mode.value));checkout.comment.closest('label').classList.toggle('hidden',mode.value==='office')}mode.addEventListener('change',refresh);refresh();checkout.addEventListener('submit',e=>{e.preventDefault();const items=[...checkout.querySelectorAll('[name=item]:checked')].map(x=>({id:x.value,size:checkout.querySelector('[data-size="'+x.value+'"]').value,color:checkout.querySelector('[data-color="'+x.value+'"]').value,qty:1}));const data={items,csrf:checkout.csrf.value,mode:mode.value,phone:checkout.phone.value,office:checkout.office.value,country:checkout.country?.value||'',city:checkout.city?.value||'',address:checkout.address?.value||'',pvz:checkout.pvz?.value||'',comment:checkout.comment?.value||''};submit('/api/orders',data,d=>{document.querySelector('#result').textContent='Тестовый заказ сохранён. Номер: '+d.id;document.querySelector('#history').textContent=JSON.stringify(d.snapshot,null,2)})})}`

const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer')
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
  const url=new URL(req.url,config.base),path=url.pathname
  try {
    if(req.method==='GET'&&path==='/style.css'){res.writeHead(200,{'Content-Type':'text/css'});return res.end(css)}
    if(req.method==='GET'&&path==='/ui.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(ui)}
    if(req.method==='GET'&&path==='/health'){
      await pool.query('select 1');await discovery();return json(res,200,{ok:true,mode:'isolated-synthetic-demo',smtp:false,corporateSystems:false})
    }
    if(req.method==='GET'&&path==='/')return html(res,'Вход',`<h1>Вход в Uzum Merch Shop</h1><p class="muted">Демонстрация будущей авторизации без Supabase Auth. Все аккаунты и заказы вымышлены.</p><div class="grid"><section class="card"><h2>Корпоративный аккаунт</h2><p>Вход через отдельный тестовый Keycloak. ФИО, юрлицо и отдел будут получены от провайдера.</p><a class="button" href="/auth/login">Войти корпоративным аккаунтом</a><p class="muted">alice — каталог E-com; boris — Welcome pack Fintech; outsider — без доступа; blocked — заблокирован.</p></section><section class="card"><h2>Персональное приглашение</h2><p>Для сотрудников без корпоративного аккаунта. Идентификатор проверяется по тестовому реестру.</p><a class="button secondary" href="/outbox">Открыть тестовый ящик приглашений</a></section></div><section class="card"><h2>Уже вошли?</h2><a href="/shop">Открыть свой магазин</a><p>Пароль тестовых корпоративных аккаунтов сгенерирован при установке и находится в локальном файле .local/accounts.json.</p></section>`)
    if(req.method==='GET'&&path==='/outbox')return html(res,'Тестовые приглашения',`<h1>Тестовый ящик · писем не отправляем</h1><section class="card"><p>Адресат: alice@example.invalid</p><p>Вам предоставлен доступ к каталогу E-com. Приглашение сообщает о доступе; личность подтверждает Keycloak.</p><a class="button" href="/auth/login">Принять через корпоративный вход</a></section><section class="card"><p>Гость Тестовый · приглашение передаётся лично</p><p>Тестовый идентификатор: <b>TEST-GUEST-001</b></p><a class="button secondary" href="/guest#token=${esc(process.env.DEMO_GUEST_TOKEN)}">Открыть персональную ссылку</a><p>Одна активация; для повторного входа используйте сохранённую сессию. Эта страница доступна всем только внутри локального демо.</p></section>`)
    if(req.method==='GET'&&path==='/guest'){
      const csrf=random();setCookie(res,'merch_demo_guest_csrf',csrf,300)
      return html(res,'Активация',`<h1>Активация персонального приглашения</h1><section class="card"><form id="guest"><input type="hidden" name="csrf" value="${csrf}"><label>Идентификатор<input name="identifier" required maxlength="128" autocomplete="off"></label><button>Активировать приглашение</button></form><p id="message" role="alert"></p></section>`)
    }
    if(req.method==='GET'&&path==='/auth/login'){
      const d=await discovery(),state=random(),verifier=random(),nonce=random()
      await pool.query(`delete from demo_flows where expires_at<now()`)
      await pool.query(`insert into demo_flows values($1,$2,$3,now()+interval '5 minutes')`,[hash(state),verifier,nonce])
      setCookie(res,'merch_demo_flow',state,300)
      const target=new URL(d.authorization_endpoint)
      for(const[k,v]of Object.entries({client_id:clientId,redirect_uri:callback,response_type:'code',scope:'openid profile email',state,nonce,code_challenge:pkce(verifier),code_challenge_method:'S256'}))target.searchParams.set(k,v)
      await event('login_started');return redirect(res,target.href)
    }
    if(req.method==='GET'&&path==='/auth/callback'){
      const state=url.searchParams.get('state'),saved=cookie(req,'merch_demo_flow')
      setCookie(res,'merch_demo_flow','',0)
      if(!state||!equal(state,saved)||url.searchParams.has('error'))throw new Error('Invalid login callback')
      const {rows}=await pool.query(`delete from demo_flows where state_hash=$1 and expires_at>now() returning *`,[hash(state)])
      if(!rows[0]||!url.searchParams.get('code'))throw new Error('Login expired or replayed')
      const flow=rows[0],d=await discovery()
      const r=await fetch(internalEndpoint(d.token_endpoint),{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+Buffer.from(clientId+':'+process.env.DEMO_CLIENT_SECRET).toString('base64')},body:new URLSearchParams({grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:callback,code_verifier:flow.verifier})})
      if(!r.ok)throw new Error('Code exchange failed')
      const tokens=await r.json()
      const {payload}=await jwtVerify(tokens.id_token,jwks,{issuer:config.issuer,audience:clientId,algorithms:['RS256'],requiredClaims:['exp','iat','sub','nonce'],maxTokenAge:'5m',clockTolerance:5})
      const identity=corporateClaims(payload,flow.nonce,clientId)
      const db=await pool.connect()
      try {
        await db.query('begin')
        // Pre-bound synthetic identities. No automatic merging by email or editable metadata.
        const {rows:people}=await db.query('select * from demo_employees where corporate_subject=$1 for update',[identity.subject])
        const employee=people[0]
        if(!employee||!employee.active||employee.access_used||employee.employee_code!==identity.code)throw new Error('Registry access denied')
        await db.query('update demo_employees set full_name=$1,email=$2,legal_entity=$3,department=$4 where id=$5',[identity.name,identity.email,identity.legal,identity.department,employee.id])
        await db.query(`insert into demo_users(id,employee_id,issuer,subject) values($1,$2,$3,$4) on conflict(employee_id) do nothing`,[randomUUID(),employee.id,config.issuer,identity.subject])
        const {rows:users}=await db.query('select * from demo_users where employee_id=$1 and issuer=$2 and subject=$3',[employee.id,config.issuer,identity.subject])
        if(!users[0])throw new Error('Account binding conflict')
        await newSession(db,res,users[0].id,'oidc',identity.sid)
        await db.query('commit')
      }catch(e){await db.query('rollback');throw e}finally{db.release()}
      await event('login_succeeded');return redirect(res,'/shop')
    }
    if(req.method==='POST'&&path==='/auth/backchannel-logout'){
      const b=await body(req)
      const {payload}=await jwtVerify(b.logout_token,jwks,{issuer:config.issuer,audience:clientId,algorithms:['RS256'],requiredClaims:['iat','jti'],maxTokenAge:'2m',clockTolerance:5})
      if(payload.nonce!==undefined||!payload.events||typeof payload.events!=='object'||!Object.hasOwn(payload.events,'http://schemas.openid.net/event/backchannel-logout')||typeof payload.jti!=='string'||payload.jti.length>250||(!payload.sid&&!payload.sub)||(payload.sid!==undefined&&typeof payload.sid!=='string')||(payload.sub!==undefined&&typeof payload.sub!=='string'))throw new Error('Invalid logout token')
      const db=await pool.connect()
      try {
        await db.query('begin')
        await db.query('delete from demo_logout_tokens where expires_at<now()')
        await db.query(`insert into demo_logout_tokens values($1,now()+interval '5 minutes')`,[payload.jti])
        if(payload.sid)await db.query('delete from demo_sessions where method=$1 and issuer=$2 and idp_sid=$3',['oidc',config.issuer,payload.sid])
        else await db.query('delete from demo_sessions s using demo_users u where s.user_id=u.id and s.method=$1 and u.issuer=$2 and u.subject=$3',['oidc',config.issuer,payload.sub])
        await db.query('commit')
      }catch(e){await db.query('rollback');throw e}finally{db.release()}
      await event('backchannel_logout');res.writeHead(200);return res.end()
    }
    if(req.method==='POST'&&path==='/api/guest'){
      origin(req);const b=await body(req)
      if(!equal(b.csrf,cookie(req,'merch_demo_guest_csrf'))||!b.csrf||typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token)||typeof b.identifier!=='string'||b.identifier.length>128)throw new Error('Invalid invitation request')
      const db=await pool.connect()
      try {
        await db.query('begin')
        const {rows}=await db.query(`select * from demo_invites where token_hash=$1 and claimed_at is null and expires_at>now() and attempts<8 for update`,[hash(b.token)])
        const i=rows[0]
        if(!i)throw new Error('Invitation unavailable')
        if(!equal(hash(i.id+':'+b.identifier.trim()),i.code_hash)){
          await db.query('update demo_invites set attempts=attempts+1 where id=$1',[i.id]);await db.query('commit')
          await event('guest_failed');return json(res,400,{error:'Неверный идентификатор или приглашение недоступно'})
        }
        const {rows:people}=await db.query('select * from demo_employees where id=$1 and active and not access_used for update',[i.employee_id])
        if(!people[0])throw new Error('Registry access denied')
        const id=randomUUID()
        await db.query('insert into demo_users(id,employee_id) values($1,$2)',[id,i.employee_id])
        await db.query('update demo_invites set claimed_at=now() where id=$1',[i.id])
        await newSession(db,res,id,'identifier');await db.query('commit')
      }catch(e){await db.query('rollback');throw e}finally{db.release()}
      setCookie(res,'merch_demo_guest_csrf','',0);await event('guest_claimed');return json(res,200,{ok:true})
    }
    const s=await session(req)
    if(req.method==='GET'&&path==='/api/me')return allowed(s)?json(res,200,{id:s.user_id,method:s.method,full_name:s.full_name,email:s.email,legal_entity:s.legal_entity,department:s.department,unit:s.unit,scope:s.scope,csrf:s.csrf,role:'employee'}):json(res,s?403:401,{error:'Доступ закрыт'})
    if(req.method==='POST'&&path==='/logout'){
      origin(req);const b=await body(req)
      if(!s||!equal(s.csrf,b.csrf))return json(res,403,{error:'Недействительная сессия'})
      await pool.query('delete from demo_sessions where token_hash=$1',[s.token_hash]);setCookie(res,'merch_demo_session','',0);await event('logout');return redirect(res,'/')
    }
    if(req.method==='GET'&&path==='/api/orders'){
      if(!allowed(s))return json(res,s?403:401,{error:'Доступ закрыт'})
      const {rows}=await pool.query('select id,unit,scope,snapshot from demo_orders where user_id=$1 and unit=$2 and scope=$3 order by created_at',[s.user_id,s.unit,s.scope])
      return json(res,200,rows)
    }
    if(req.method==='POST'&&path==='/api/orders'){
      origin(req);const b=await body(req)
      if(!allowed(s))return json(res,s?403:401,{error:'Доступ закрыт'})
      if(!equal(s.csrf,b.csrf))return json(res,403,{error:'Неверный CSRF-токен'})
      const order=validateOrder(b,s.scope,s.method),db=await pool.connect();let snapshot,id
      try {
        await db.query('begin')
        const {rows}=await db.query('select * from demo_employees where id=$1 and active and not access_used for update',[s.employee_id])
        const e=rows[0];if(!e)throw new Error('Access revoked')
        if(e.scope!==s.scope||e.unit!==s.unit)throw new Error('Access changed')
        // Ignore no client identity: only validated delivery fields plus server identity snapshot.
        snapshot={...order,full_name:e.full_name,email:e.email,legal_entity:e.legal_entity,department:e.department,identity_source:s.method==='oidc'?'test-keycloak':'test-registry'}
        id=randomUUID();await db.query('insert into demo_orders(id,user_id,unit,scope,snapshot) values($1,$2,$3,$4,$5)',[id,s.user_id,e.unit,e.scope,JSON.stringify(snapshot)]);await db.query('commit')
      }catch(e){await db.query('rollback');throw e}finally{db.release()}
      await event('order_created');return json(res,201,{id,snapshot})
    }
    if(req.method==='GET'&&path==='/shop'){
      if(!allowed(s))return html(res,'Доступ закрыт',`<section class="card"><h1>Доступ закрыт</h1><p>Нужны действующая сессия и разрешение реестра. Корпоративный вход сам по себе не даёт доступ к мерчу.</p><a href="/">Вернуться ко входу</a></section>`,s?403:401)
      const products=s.scope==='welcome'?[['welcome-shirt','Футболка Welcome (тест)'],['welcome-notebook','Блокнот Welcome (тест)']]:[['shirt','Футболка (тест)'],['notebook','Блокнот (тест)'],['bag','Шоппер (тест)']]
      const {rows:history}=await pool.query('select id,snapshot from demo_orders where user_id=$1 and unit=$2 and scope=$3 order by created_at',[s.user_id,s.unit,s.scope])
      return html(res,'Магазин',`<h1>${s.scope==='welcome'?'Welcome pack':'Каталог'} · ${s.unit==='ecom'?'E-com':s.unit==='fintech'?'Fintech':'Technologies'}</h1><p class="muted">Вы вошли ${s.method==='oidc'?'через тестовый Keycloak':'по персональному приглашению'}. Административные права не выдаются.</p><div class="grid"><section class="card"><h2>Выберите мерч</h2><form id="checkout"><input type="hidden" name="csrf" value="${s.csrf}">${products.map(([id,name])=>`<div class="product"><label><input type="checkbox" name="item" value="${id}"> ${name}</label><label>Размер<select data-size="${id}"><option>Стандартный</option><option>S</option><option>M</option><option>L</option></select></label><label>Цвет<select data-color="${id}"><option>Как на фото</option><option>Фиолетовый</option></select></label></div>`).join('')}<h2>Получение</h2><label>Способ получения<select name="mode"><option value="office">В офисе</option>${s.scope!=='welcome'?`<option value="shipping">Отправить в мою страну</option>${s.method==='identifier'?'<option value="pvz">Заберу в своём ПВЗ</option>':''}`:''}</select></label><div data-mode="office"><label>Офис<select name="office"><option>Офис 1 (тест)</option><option>Офис 2 (тест)</option></select></label></div><div data-mode="shipping"><label>Страна<input name="country" maxlength="300"></label><label>Город<input name="city" maxlength="300"></label><label>Адрес доставки<input name="address" maxlength="300"></label></div><div data-mode="pvz"><label>Код ПВЗ<input name="pvz" maxlength="300"></label></div><label>Телефон для получения<input name="phone" required placeholder="Введите вымышленный номер" maxlength="30"></label><label>Комментарий к доставке (необязательно)<textarea name="comment" maxlength="1000"></textarea></label><button>Оформить тестовый заказ</button></form><p id="message" role="alert"></p><p id="result" role="status"></p></section><div><section class="card"><h2>Данные сотрудника</h2><p class="muted">${s.method==='oidc'?'Получены из тестового корпоративного источника':'Загружены в тестовый реестр администратором'}. Изменить их в заказе нельзя.</p>${[['ФИО',s.full_name],['Email',s.email||'Не требуется'],['Юрлицо',s.legal_entity],['Отдел',s.department]].map(([label,value])=>`<label>${label}<input readonly value="${esc(value)}"></label>`).join('')}<form action="/logout" method="post"><input type="hidden" name="csrf" value="${s.csrf}"><button class="secondary">Выйти из мерчшопа</button></form></section><section class="card"><h2>История / снимок заказа</h2><pre id="history">${esc(JSON.stringify(history,null,2))}</pre></section></div></div>`)
    }
    if(req.method==='GET'&&path==='/review'){
      const {rows}=await pool.query('select kind,detail from demo_events order by id desc limit 30')
      return html(res,'Схема для проверки',`<h1>Что проверяет этот прототип</h1><section class="card"><h2>Корпоративный путь</h2><ol><li>Браузер → сервер мерчшопа: начало входа.</li><li>Браузер → тестовый Keycloak: авторизация; пароль остаётся у Keycloak.</li><li>Keycloak → сервер мерчшопа через браузер: одноразовый код.</li><li>Сервер → Keycloak: код + PKCE + аутентификация клиента.</li><li>Сервер: проверка подписи, iss, aud, exp, nonce; сопоставление по iss + sub.</li><li>Сервер → локальный реестр: магазин, раздел, активность.</li><li>Браузер получает только HttpOnly cookie собственной сессии.</li></ol><p>Scopes: <code>openid profile email</code>. Дополнительные тестовые claims: employee_id, legal_entity, department. Токены провайдера после проверки не сохраняются и не отправляются браузеру.</p></section><section class="card"><h2>Изоляция и границы</h2><p>Только localhost-порты, отдельная Docker-сеть без внешнего выхода, синтетическая БД, нет SMTP. Страница «Тестовый ящик» заменяет отправку писем. Роли Keycloak не превращаются в административные права мерчшопа.</p><p>Сессия 15 минут без фонового продления. Локальный выход не завершает общий вход в Keycloak. Подписанный back-channel logout отзывает корпоративные сессии; простое отключение пользователя без такого события не гарантирует немедленного отзыва. Полный перенос рабочего приложения, восстановление гостевого доступа, склад, выдача и QR не реализуются этим прототипом.</p></section><section class="card"><h2>Последовательность событий · без токенов</h2><table><thead><tr><th>Событие</th><th>Взаимодействие</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.kind)}</td><td>${esc(r.detail)}</td></tr>`).join('')}</tbody></table></section>`)
    }
    return json(res,404,{error:'Not found'})
  }catch{
    if(path==='/auth/callback'){await event('login_failed');return html(res,'Вход отклонён','<section class="card"><h1>Вход отклонён</h1><p>Проверьте тестовый аккаунт, разрешение реестра или начните вход заново. Кадровый идентификатор и корпоративная личность должны соответствовать реестру.</p><a href="/">На страницу входа</a></section>',403)}
    return json(res,path==='/health'?503:400,{error:'Запрос отклонён. Проверьте данные, разрешения и срок действия приглашения.'})
  }
})
await initialize()
server.listen(3180,'0.0.0.0',()=>console.log('Isolated synthetic identity demo started; no corporate services or SMTP configured.'))
process.on('SIGTERM',()=>server.close(()=>pool.end().then(()=>process.exit(0))))
