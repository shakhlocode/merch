import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { domainRoute } from './domain.mjs'
import {welcomeEmailRoute} from './welcome-email.mjs'
import {portalEmployee,portalGrant} from './portal-access.mjs'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { assertDemoConfig, corporateClaims, equal, hash, pkce, random, sessionHash, validateOrder } from './security.mjs'

const config = assertDemoConfig(process.env)
// No production URL, SMTP client, Supabase SDK, or corporate API exists in this process.
const pool = new pg.Pool({ host:'db', port:5432, database:'merch_selfhost_demo', user:'merch_app', password:process.env.DEMO_DB_PASSWORD, max:8 })
const pepper = process.env.DEMO_SESSION_PEPPER
const internal = process.env.DEMO_IDP_INTERNAL_ORIGIN
const clientId = process.env.DEMO_CLIENT_ID
const callback = config.base + '/auth/callback'
const inviteId = '40000000-0000-4000-8000-000000000001'
const jwks = createRemoteJWKSet(new URL(internal + '/realms/merch-storage-demo/protocol/openid-connect/certs'), { timeoutDuration:4000 })
const events = {
  login_started:'Браузер → тестовый Keycloak: openid profile email, state, nonce, PKCE. Пароль получает только Keycloak.',
  login_succeeded:'Сервер → тестовый Keycloak: обмен кода. Проверены подпись, issuer, audience, срок, nonce. Проверено локальное разрешение или правило доступа портала.',
  login_failed:'Корпоративный вход отклонён. Секреты и ответ провайдера в журнал не записываются.',
  guest_claimed:'Персональное приглашение и идентификатор проверены транзакционно. Создана локальная сессия.',
  guest_failed:'Активация приглашения отклонена.',
  order_created:'Заказ зарезервирован. ФИО и контакты в заказ не копируются.',
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
  const token = cookie(req,'merch_storage_session')
  if (!/^[\w-]{43}$/.test(token)) return null
  const {rows} = await pool.query(`select s.*,u.employee_id,u.issuer as identity_issuer,u.subject,e.full_name,e.email,e.unit,e.scope,e.campaign_id,e.portal_managed,e.email_welcome,e.welcome_received_at,e.access_expires_at,e.active,false as access_used
    from demo_sessions s join demo_users u on u.id=s.user_id join demo_employees e on e.id=u.employee_id where s.token_hash=$1 and s.expires_at>now()`,[sh(token)])
  const s=rows[0]
  if(s?.email_welcome&&(!s.active||s.welcome_received_at||!s.access_expires_at||new Date(s.access_expires_at)<=new Date()))return null
  if(s?.portal_managed){
    if(!s.portal_claims)return null
    const grant=await portalGrant(pool,s.portal_claims)
    if(!grant||grant.campaign_id!==s.campaign_id||grant.scope!==s.scope||grant.unit!==s.unit)return null
  }
  return s || null
}
async function newSession(db,res,userId,method,idpSid=null,portalIdentity=null) {
  const token=random(), csrf=random()
  await db.query(`insert into demo_sessions(token_hash,user_id,csrf,method,issuer,idp_sid,expires_at) values($1,$2,$3,$4,$5,$6,now()+interval '15 minutes')`,[sh(token),userId,csrf,method,method==='oidc'?config.issuer:null,idpSid])
  if(portalIdentity)await db.query('update demo_sessions set portal_claims=$1 where token_hash=$2',[JSON.stringify({subject:portalIdentity.subject,legalEntity:portalIdentity.legalEntity,groups:portalIdentity.groups,active:portalIdentity.active}),sh(token)])
  setCookie(res,'merch_storage_session',token,900)
}
function internalEndpoint(endpoint) {
  const url=new URL(endpoint)
  if (url.origin !== new URL(config.issuer).origin || !url.pathname.startsWith('/realms/merch-storage-demo/')) throw new Error('Untrusted provider endpoint')
  return internal + url.pathname + url.search
}
async function discovery() {
  const r=await fetch(internal+'/realms/merch-storage-demo/.well-known/openid-configuration',{redirect:'error',signal:AbortSignal.timeout(4000)})
  if(!r.ok)throw new Error('Test identity provider unavailable')
  const d=await r.json()
  if(d.issuer!==config.issuer)throw new Error('Issuer mismatch')
  for(const k of ['authorization_endpoint','token_endpoint','jwks_uri'])internalEndpoint(d[k])
  return d
}
async function initialize() { await pool.query('select 1 from demo_installation limit 1') }

const css=`*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui;color:#24143d;background:#f7f4ff}header,footer{padding:20px 5%;display:flex;gap:24px;align-items:center;justify-content:space-between;background:white;border-bottom:1px solid #ded4ef}header a{color:#24143d;text-decoration:none}header>a:first-child{font-size:24px}main{max-width:1120px;margin:36px auto;padding:0 22px}h1{font-size:34px;line-height:1.2}h2{margin-top:0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.card{background:white;border:1px solid #d4c5e8;border-radius:20px;padding:26px;margin-bottom:22px;box-shadow:0 4px 18px #25143c05}.badge{font-size:12px;background:#eee6ff;border-radius:20px;padding:8px 12px;color:#6425b8}.muted{color:#71677e}.button,button{display:inline-block;background:#7200ff;color:white;border:0;border-radius:12px;padding:13px 20px;font:inherit;cursor:pointer;text-decoration:none}.secondary{background:#eee6ff;color:#351d53}label{display:block;margin:14px 0}input,select,textarea{display:block;width:100%;margin-top:6px;border:1px solid #c8bbdd;border-radius:10px;padding:11px;background:white;font:inherit}input[readonly]{background:#f4f0fa;color:#514462}input[type=checkbox]{display:inline;width:auto}dl{display:grid;grid-template-columns:1fr 1fr;gap:6px}dd{margin:0}code{word-break:break-all}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f4ff;padding:16px;border-radius:12px}#message{color:#a0183f}#result{margin-top:20px}.hidden{display:none}.product{border:1px solid #dfd4ee;padding:12px;border-radius:12px}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #ded4ef;padding:10px;vertical-align:top}footer{font-size:13px;color:#71677e}@media(max-width:700px){.grid{grid-template-columns:1fr}header{flex-wrap:wrap}h1{font-size:28px}}`
const ui=`document.querySelector('#guest')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.target;const token=new URLSearchParams(location.hash.slice(1)).get('token')||f.dataset.token;f.dataset.token=token;history.replaceState(null,'','/guest');const message=document.querySelector('#message');try{const r=await fetch('/api/guest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,identifier:f.identifier.value,csrf:f.csrf.value})});const d=await r.json();if(!r.ok)throw Error(d.error||'Активация отклонена');location.assign('/shop')}catch(error){message.textContent=error.message}})`

const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer')
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
  const url=new URL(req.url,config.base),path=url.pathname
  try {
    const currentSession=await session(req)
    if(await welcomeEmailRoute(req,res,url,currentSession,{pool,config,json,body,origin,newSession}))return
    if(await domainRoute(req,res,url,currentSession,{pool,config,html,json,redirect,body,origin,event,newSession,sh,esc}))return
    if(req.method==='GET'&&path==='/style.css'){res.writeHead(200,{'Content-Type':'text/css'});return res.end(css)}
    if(req.method==='GET'&&path==='/ui.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(ui)}
    if(req.method==='GET'&&path==='/health'){
      await pool.query('select 1');await discovery();return json(res,200,{ok:true,mode:'isolated-synthetic-demo',smtp:false,corporateSystems:false})
    }
    if(req.method==='GET'&&path==='/guest'){
      const csrf=random();setCookie(res,'merch_storage_guest_csrf',csrf,300)
      return html(res,'Активация',`<h1>Активация персонального приглашения</h1><section class="card"><form id="guest"><input type="hidden" name="csrf" value="${csrf}"><label>Идентификатор<input name="identifier" required maxlength="128" autocomplete="off"></label><button>Активировать приглашение</button></form><p id="message" role="alert"></p></section>`)
    }
    if(req.method==='GET'&&path==='/auth/login'){
      const d=await discovery(),state=random(),verifier=random(),nonce=random()
      await pool.query(`delete from demo_flows where expires_at<now()`)
      await pool.query(`insert into demo_flows values($1,$2,$3,now()+interval '5 minutes')`,[hash(state),verifier,nonce])
      setCookie(res,'merch_storage_flow',state,300)
      const target=new URL(d.authorization_endpoint)
      for(const[k,v]of Object.entries({client_id:clientId,redirect_uri:callback,response_type:'code',scope:'openid profile email',state,nonce,code_challenge:pkce(verifier),code_challenge_method:'S256'}))target.searchParams.set(k,v)
      await event('login_started');return redirect(res,target.href)
    }
    if(req.method==='GET'&&path==='/auth/callback'){
      const state=url.searchParams.get('state'),saved=cookie(req,'merch_storage_flow')
      setCookie(res,'merch_storage_flow','',0)
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
        // Bound by issuer + subject, never by email. Rules use signed IdP claims only.
        const employee=await portalEmployee(db,identity)
        await db.query('update demo_employees set full_name=$1,email=$2 where id=$3',[identity.name,identity.email,employee.id])
        await db.query(`insert into demo_users(id,employee_id,issuer,subject) values($1,$2,$3,$4) on conflict(employee_id) do nothing`,[randomUUID(),employee.id,config.issuer,identity.subject])
        const {rows:users}=await db.query('select * from demo_users where employee_id=$1 and issuer=$2 and subject=$3',[employee.id,config.issuer,identity.subject])
        if(!users[0])throw new Error('Account binding conflict')
        await newSession(db,res,users[0].id,'oidc',identity.sid,employee.portal_managed?identity:null)
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
    const s=await session(req)
    if(req.method==='POST'&&path==='/logout'){
      origin(req);const b=await body(req)
      if(!s||!equal(s.csrf,b.csrf))return json(res,403,{error:'Недействительная сессия'})
      await pool.query('delete from demo_sessions where token_hash=$1',[s.token_hash]);setCookie(res,'merch_storage_session','',0);await event('logout');return redirect(res,'/')
    }
    return json(res,404,{error:'Not found'})
  }catch{
    if(path==='/auth/callback'){await event('login_failed');return html(res,'Вход отклонён','<section class="card"><h1>Вход отклонён</h1><p>Нет однозначного разрешения на открытую раздачу. Уточните доступ у организатора или начните вход заново.</p><a href="/">На страницу входа</a></section>',403)}
    return json(res,path==='/health'?503:400,{error:'Запрос отклонён. Проверьте данные, разрешения и срок действия приглашения.'})
  }
})
await initialize()
server.listen(3280,'0.0.0.0',()=>console.log('Isolated synthetic identity demo started; no corporate services or SMTP configured.'))
process.on('SIGTERM',()=>server.close(()=>pool.end().then(()=>process.exit(0))))
