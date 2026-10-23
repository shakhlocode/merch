import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
const base='http://127.0.0.1:3180',idp='http://127.0.0.1:8180'
const credentials=JSON.parse(await readFile(new URL('../.local/accounts.json',import.meta.url),'utf8'))
const env=Object.fromEntries((await readFile(new URL('../.local/demo.env',import.meta.url),'utf8')).trim().split('\n').map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}))
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true})
const browser=await chromium.launch({headless:true,...(process.env.DEMO_CHROMIUM?{executablePath:process.env.DEMO_CHROMIUM}:{}),args:['--no-sandbox']})
let count=0
const pass=name=>{count++;console.log('PASS: '+name)}
async function context(){
  const c=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'})
  await c.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
  return c
}
async function api(c,path,body,status=200){const r=await c.request.fetch(base+path,{method:body?'POST':'GET',headers:body?{Origin:base}:undefined,data:body});assert.equal(r.status(),status,path);return r.json()}
async function login(c,username,status=200){
  const p=await c.newPage();let lastCallback
  p.on('request',r=>{const u=new URL(r.url());if(u.origin===base&&u.pathname==='/auth/callback')lastCallback=r.url()})
  await p.goto(base+'/auth/login')
  if(new URL(p.url()).origin===idp){
    const u=new URL(p.url());assert.equal(u.searchParams.get('scope'),'openid profile email');assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert(u.searchParams.get('nonce'));assert(u.searchParams.get('state'))
    await p.locator('#username').fill(username);await p.locator('#password').fill(credentials.password);await p.locator('#kc-login').click()
  }
  if(status===403)await p.getByRole('heading',{name:'Вход отклонён'}).waitFor()
  else await p.waitForURL(base+'/shop')
  return{p,callback:lastCallback}
}
async function admin(path,method='GET',data){
  const r=await fetch(idp+'/realms/master/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'admin-cli',username:'demo-admin',password:env.DEMO_KC_ADMIN_PASSWORD})})
  assert.equal(r.status,200);const {access_token}=await r.json()
  const result=await fetch(idp+'/admin/realms/merch-demo'+path,{method,headers:{Authorization:'Bearer '+access_token,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined})
  assert(result.ok,'Local Keycloak test administration failed')
  return result.status===204?null:result.json()
}
try {
  const health=await fetch(base+'/health');assert.equal(health.status,200);assert.equal((await health.json()).smtp,false)
  const anonymous=await context();await api(anonymous,'/api/me',undefined,401);await api(anonymous,'/api/orders',undefined,401)
  assert.equal((await anonymous.request.get(base+'/auth/callback?code=forged&state=forged')).status(),403)
  pass('Anonymous API access and forged OIDC callback denied')

  const alice=await context(),a=await login(alice,'alice'),me=await api(alice,'/api/me')
  assert.equal(me.id,'30000000-0000-4000-8000-000000000001');assert.equal(me.unit,'ecom');assert.equal(me.scope,'catalog');assert.equal(me.role,'employee')
  for(const name of ['ФИО','Email','Юрлицо','Отдел'])assert(await a.p.getByLabel(name,{exact:true}).getAttribute('readonly')!==null)
  assert(!(await a.p.locator('body').innerText()).includes('Создайте пароль'))
  const sessionCookie=(await alice.cookies()).find(c=>c.name==='merch_demo_session');assert(sessionCookie.httpOnly);assert.equal(sessionCookie.sameSite,'Lax')
  const history=await api(alice,'/api/orders');assert(history.some(o=>o.id==='50000000-0000-4000-8000-000000000001'))
  assert(!('access_token'in me));assert(!('refresh_token'in me))
  await a.p.screenshot({path:new URL('../artifacts/01-corporate.png',import.meta.url).pathname,fullPage:true})
  pass('Real local Keycloak OIDC/PKCE login, readonly identity, own cookie session and existing history preserved')

  const replay=await context();assert.equal((await replay.request.get(a.callback)).status(),403)
  const order={items:[{id:'shirt',size:'M',color:'Как на фото',qty:1}],mode:'office',office:'Офис 1 (тест)',phone:'+000 000 00 00',comment:'',csrf:me.csrf}
  await api(alice,'/api/orders',{...order,csrf:'forged'},403)
  await api(alice,'/api/orders',{...order,full_name:'Подмена'},400)
  await api(alice,'/api/orders',{...order,unit:'fintech'},400)
  await api(alice,'/api/orders',{...order,mode:'pvz',pvz:'000123'},400)
  const crossOrigin=await alice.request.post(base+'/api/orders',{headers:{Origin:'https://evil.example.invalid'},data:order});assert.equal(crossOrigin.status(),400)
  const created=await api(alice,'/api/orders',order,201);assert.equal(created.snapshot.full_name,me.full_name);assert.equal(created.snapshot.identity_source,'test-keycloak')
  assert((await api(alice,'/api/orders?unit=fintech')).every(o=>o.unit==='ecom'))
  await a.p.locator('[name=item][value=bag]').check();await a.p.locator('[name=phone]').fill('+000 000 00 00')
  await a.p.getByRole('button',{name:'Оформить тестовый заказ'}).click();await a.p.getByRole('status').filter({hasText:'Тестовый заказ сохранён'}).waitFor()
  await a.p.locator('[name=mode]').selectOption('shipping');await a.p.getByLabel('Страна',{exact:true}).waitFor();assert(await a.p.getByLabel('Адрес доставки',{exact:true}).isVisible())
  pass('Callback replay, CSRF, cross-origin requests, identity/tenant spoofing and unauthorized PVZ denied; trusted snapshot saved')

  const boris=await context(),b=await login(boris,'boris'),bm=await api(boris,'/api/me')
  assert.equal(bm.scope,'welcome');assert.equal(bm.unit,'fintech');assert.equal(await b.p.locator('[name=mode] option').count(),1)
  await api(boris,'/api/orders',{...order,csrf:bm.csrf},400)
  const welcome={...order,csrf:bm.csrf,items:[{id:'welcome-shirt',size:'M',color:'Как на фото',qty:1}]}
  await api(boris,'/api/orders',{...welcome,mode:'shipping',country:'Тест',city:'Тест',address:'Тест'},400)
  await api(boris,'/api/orders',welcome,201)
  assert(!(await api(boris,'/api/orders')).some(o=>o.id===created.id))
  await b.p.screenshot({path:new URL('../artifacts/02-welcome.png',import.meta.url).pathname,fullPage:true})
  pass('Welcome pack restricted to own shop/products and office pickup; another employee history hidden')

  const outsider=await context();await login(outsider,'outsider',403);await api(outsider,'/api/me',undefined,401)
  const blocked=await context(),bp=await blocked.newPage();await bp.goto(base+'/auth/login');await bp.locator('#username').fill('blocked');await bp.locator('#password').fill(credentials.password);await bp.locator('#kc-login').click();await bp.locator('#input-error, #kc-feedback, .pf-v5-c-alert').first().waitFor();assert(new URL(bp.url()).origin===idp);await api(blocked,'/api/me',undefined,401)
  pass('Successful identity without registry access denied; disabled Keycloak account denied')

  const uid='20000000-0000-4000-8000-000000000001',original=await admin('/users/'+uid)
  try{
    await admin('/users/'+uid,'PUT',{...original,email:'alice.changed@example.invalid',emailVerified:true})
    const again=await login(alice,'alice'),changed=await api(alice,'/api/me')
    assert.equal(changed.id,me.id);assert.equal(changed.email,'alice.changed@example.invalid');assert((await api(alice,'/api/orders')).some(o=>o.id===created.id));await again.p.close()
  }finally{await admin('/users/'+uid,'PUT',original)}
  pass('Changed email and existing SSO session retain stable local account and orders')

  await admin('/users/'+uid+'/logout','POST')
  await new Promise(r=>setTimeout(r,300))
  await api(alice,'/api/me',undefined,401)
  const unsigned=await anonymous.request.post(base+'/auth/backchannel-logout',{form:{logout_token:'forged'}});assert.equal(unsigned.status(),400)
  pass('Real signed Keycloak back-channel logout revokes local sessions; unsigned notification rejected')

  const g1=await context(),g2=await context(),gp1=await g1.newPage(),gp2=await g2.newPage()
  await Promise.all([gp1.goto(base+'/guest#token='+env.DEMO_GUEST_TOKEN),gp2.goto(base+'/guest#token='+env.DEMO_GUEST_TOKEN)])
  const getBody=async p=>({token:env.DEMO_GUEST_TOKEN,identifier:credentials.guestIdentifier,csrf:await p.locator('[name=csrf]').inputValue()})
  const gb2=await getBody(gp2)
  await gp1.getByLabel('Идентификатор',{exact:true}).fill(credentials.guestIdentifier)
  const first=gp1.waitForResponse(r=>r.url()===base+'/api/guest'&&r.request().method()==='POST')
  const results=await Promise.all([first,g2.request.post(base+'/api/guest',{headers:{Origin:base},data:gb2}),gp1.getByRole('button',{name:'Активировать приглашение'}).click()]).then(r=>r.slice(0,2))
  assert.deepEqual(results.map(r=>r.status()).sort(),[200,400])
  const winner=results[0].status()===200?g1:g2,wp=results[0].status()===200?gp1:gp2,gm=await api(winner,'/api/me')
  if(results[0].status()===200)await gp1.waitForURL(base+'/shop')
  assert.equal(gm.method,'identifier');assert.equal(gm.unit,'technologies');assert.equal(gm.email,null)
  await wp.goto(base+'/shop');await wp.reload();assert.equal((await api(winner,'/api/me')).id,gm.id)
  await api(winner,'/api/orders',{...order,csrf:gm.csrf,mode:'pvz',pvz:'000123'},201)
  assert((await api(winner,'/api/orders')).every(o=>o.unit==='technologies'))
  await wp.screenshot({path:new URL('../artifacts/03-identifier.png',import.meta.url).pathname,fullPage:true})
  pass('Concurrent invitation activation has one winner; identifier account needs no email/password and survives browser reload')

  const cookies=await winner.cookies()
  const logout=await winner.request.post(base+'/logout',{headers:{Origin:base},form:{csrf:gm.csrf},maxRedirects:0});assert.equal(logout.status(),303)
  await api(winner,'/api/me',undefined,401);await winner.addCookies(cookies);await api(winner,'/api/me',undefined,401)
  pass('Local logout revokes server session; restored old browser cookie cannot regain access')
  const review=await anonymous.newPage();await review.goto(base+'/review');await review.screenshot({path:new URL('../artifacts/04-review.png',import.meta.url).pathname,fullPage:true})
  console.log('Completed '+count+' browser/integration scenario groups. Only synthetic local data used; no SMTP or production services contacted.')
}finally{await browser.close()}
