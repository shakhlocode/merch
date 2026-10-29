import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
const cwd=new URL('../',import.meta.url),base='http://127.0.0.1:3280'
const {password}=JSON.parse(await readFile(new URL('.local/accounts.json',cwd),'utf8'))
const browser=await chromium.launch({headless:true,executablePath:process.env.DEMO_CHROMIUM||undefined,args:['--no-sandbox']})
const errors=[]
function sql(q){const r=spawnSync('docker',['compose','--env-file','.local/demo.env','exec','-T','db','psql','-U','postgres','-d','merch_selfhost_demo','-Atc',q],{cwd});assert.equal(r.status,0);return r.stdout.toString().trim()}
async function context(){const c=await browser.newContext({viewport:{width:1280,height:900}});await c.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());return c}
async function api(c,path,data,status=200){const r=await c.request.fetch(base+path,{method:data?'POST':'GET',headers:data?{Origin:base}:{},data});assert.equal(r.status(),status,path);return r.json()}
async function login(name){const c=await context(),p=await c.newPage();await p.goto(base+'/auth/login');await p.locator('#username').fill(name);await p.locator('#password').fill(password);await p.locator('#kc-login').click();await p.waitForURL(base+'/shop');return{c,p,me:await api(c,'/api/me')}}
const post=(a,path,data,status=200)=>api(a.c,path,{...data,csrf:a.me.csrf},status)
const campaign='60000000-0000-4000-8000-000000000001',notebook='70000000-0000-4000-8000-000000000013'
async function emailPage(url=base+'/email-login'){const c=await context(),p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url);return{c,p,csrf:await p.locator('#email-csrf').inputValue()}}
async function openMail(op,email){return(await api(op.c,'/api/admin/mailbox')).filter(m=>m.to===email).at(-1)}
async function clickLogin(url){const x=await emailPage(url);await x.p.getByRole('button',{name:'Войти в Welcome pack',exact:true}).click();await x.p.waitForURL(base+'/shop');x.me=await api(x.c,'/api/me');return x}
try{
 const op=await login('organizer'),fin=await login('fintech-admin'),alice=await login('alice')
 await api(alice.c,'/api/admin/welcome-email',undefined,403)
 const invite={action:'invite',campaignId:campaign,fullName:'Новичок Тестовый',email:'newcomer@example.invalid',validDays:14}
 await post(fin,'/api/admin/welcome-email',invite,400)
 await op.p.goto(base+'/access');const form=op.p.locator('#welcome-invite');await form.locator('[name=fullName]').fill(invite.fullName);await form.locator('[name=email]').fill(invite.email);await form.locator('[name=campaignId]').selectOption(campaign);await form.getByRole('button',{name:'Пригласить в Welcome pack'}).click();await op.p.getByText('Тестовое приглашение создано. Ссылка находится в тестовом почтовом ящике.').waitFor()
 const mail=await openMail(op,invite.email);assert(mail?.url.includes('/email-login#token='))
 const employee=(await api(op.c,'/api/admin/welcome-email')).find(e=>e.email===invite.email)
 assert.equal(sql(`select email_welcome||':'||scope from demo_employees where id='${employee.id}'`),'true:welcome')
 assert.equal(sql(`select count(*) from demo_users where employee_id='${employee.id}'`),'0')
 console.log('PASS: personal-email invitation created through UI with unit-admin scope and no portal account/password')
 const one=await emailPage(mail.url),two=await emailPage(mail.url),token=new URL(mail.url).hash.slice(7)
 await api(one.c,'/api/me',undefined,401);assert.equal(one.p.url(),base+'/email-login')
 await api(one.c,'/api/email/consume',{csrf:'wrong',token},403)
 const claims=await Promise.all([one,two].map(x=>x.c.request.post(base+'/api/email/consume',{headers:{Origin:base},data:{csrf:x.csrf,token}})))
 assert.deepEqual(claims.map(x=>x.status()).sort(),[200,409])
 const first=claims[0].status()===200?one:two;first.me=await api(first.c,'/api/me');assert.equal(first.me.method,'email');assert.equal(first.me.scope,'welcome');assert.equal(first.me.email,invite.email)
 assert((await api(first.c,'/api/catalog')).every(v=>['welcome','both'].includes(v.scope)))
 assert.equal(sql(`select issuer is null from demo_users where employee_id='${employee.id}'`),'t')
 console.log('PASS: GET does not activate link; concurrent CSRF-protected confirmation has one winner, Welcome-only access')
 await post(first,'/api/orders',{requestKey:randomUUID(),items:['70000000-0000-4000-8000-000000000011']},400)
 const order=await post(first,'/api/orders',{requestKey:randomUUID(),items:[notebook]},201)
 await post(first,'/api/orders',{requestKey:randomUUID(),items:[notebook]},400)
 sql(`update demo_email_links set created_at=now()-interval '2 minutes' where employee_id='${employee.id}'`)
 const returner=await emailPage(),unknown=await emailPage()
 const unknownResult=await api(unknown.c,'/api/email/request',{csrf:unknown.csrf,email:'unknown@example.invalid'})
 const knownResult=await api(returner.c,'/api/email/request',{csrf:returner.csrf,email:invite.email});assert.deepEqual(unknownResult,knownResult)
 const nextMail=await openMail(op,invite.email);assert.notEqual(nextMail.url,mail.url)
 const again=await clickLogin(nextMail.url);assert.equal(again.me.id,first.me.id);await api(first.c,'/api/me',undefined,401)
 assert((await api(again.c,'/api/orders')).some(o=>o.id===order.id));await api(two.c,'/api/email/consume',{csrf:two.csrf,token},409)
 console.log('PASS: repeated email login preserves account/order, revokes old session, prevents duplicates and email enumeration')
 const qr=(await api(again.c,'/api/orders/'+order.id+'/receipt.json')).token
 await post(op,'/api/admin/issue',{token:qr},400);await api(again.c,'/api/me')
 await post(op,'/api/admin/orders/'+order.id+'/status',{status:'assembling'});await post(op,'/api/admin/orders/'+order.id+'/status',{status:'ready'})
 const before=Number(sql(`select total from demo_variants where id='${notebook}'`))
 const result=await Promise.all([post(op,'/api/admin/issue',{token:qr}),post(op,'/api/admin/issue',{token:qr})]);assert.deepEqual(result.map(x=>x.already).sort(),[false,true])
 assert.equal(Number(sql(`select total from demo_variants where id='${notebook}'`)),before-1)
 for(const path of ['/api/me','/api/catalog','/api/orders'])await api(again.c,path,undefined,401)
 assert.equal(sql(`select active||':'||(welcome_received_at is not null) from demo_employees where id='${employee.id}'`),'false:true')
 assert.equal(sql(`select count(*) from demo_email_links where employee_id='${employee.id}'`),'0')
 const closed=await emailPage();assert.deepEqual(await api(closed.c,'/api/email/request',{csrf:closed.csrf,email:invite.email}),knownResult)
 assert.equal(await openMail(op,invite.email),undefined);await post(op,'/api/admin/welcome-email',invite,400)
 console.log('PASS: receiving atomically closes access and revokes links/sessions/mail; duplicate scan and reinvite do not grant twice')
 const second={...invite,email:'newcomer-cancel@example.invalid',fullName:'Другой Новичок'}
 await post(op,'/api/admin/welcome-email',second);const secondPage=await clickLogin((await openMail(op,second.email)).url)
 const so=await post(secondPage,'/api/orders',{requestKey:randomUUID(),items:[notebook]},201);await post(secondPage,'/api/orders/'+so.id+'/cancel',{});await api(secondPage.c,'/api/me')
 const se=(await api(op.c,'/api/admin/welcome-email')).find(e=>e.email===second.email)
 sql(`update demo_employees set access_expires_at=now()-interval '1 minute' where id='${se.id}'`);await api(secondPage.c,'/api/me',undefined,401)
 await post(op,'/api/admin/welcome-email',second);const reopened=await clickLogin((await openMail(op,second.email)).url);assert.equal(reopened.me.id,secondPage.me.id)
 await post(op,'/api/admin/welcome-email',{action:'revoke',employeeId:se.id});await api(reopened.c,'/api/me',undefined,401);await post(op,'/api/admin/welcome-email',second,400)
 assert.deepEqual(errors,[])
 console.log('PASS: cancellation preserves access; expiry blocks, extension keeps identity, manual revocation is immediate and resend cannot bypass it')
 console.log('Completed 5 welcome-email scenario groups. Synthetic data, local Keycloak and encrypted mock outbox only.')
}finally{await browser.close()}
