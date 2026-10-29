import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {readFile,mkdir} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
const base='http://127.0.0.1:3280',cwd=new URL('../',import.meta.url)
const {password}=JSON.parse(await readFile(new URL('.local/accounts.json',cwd),'utf8'))
const browser=await chromium.launch({headless:true,executablePath:process.env.DEMO_CHROMIUM||undefined,args:['--no-sandbox']})
const contexts=[],errors=[]
const campaign=n=>`60000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const subject=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function sql(q){const r=spawnSync('docker',['compose','--env-file','.local/demo.env','exec','-T','db','psql','-U','postgres','-d','merch_selfhost_demo','-Atc',q],{cwd});assert.equal(r.status,0);return r.stdout.toString().trim()}
async function context(){const c=await browser.newContext({viewport:{width:1400,height:1000}});contexts.push(c);await c.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());return c}
async function api(c,path,data,status=200){const r=await c.request.fetch(base+path,{method:data?'POST':'GET',headers:data?{Origin:base}:{},data});assert.equal(r.status(),status,path);return r.json()}
async function login(name,allowed=true){const c=await context(),p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/auth/login');await p.locator('#username').fill(name);await p.locator('#password').fill(password);await p.locator('#kc-login').click();if(!allowed){await p.getByRole('heading',{name:'Вход отклонён'}).waitFor();return{c,p}}await p.waitForURL(base+'/shop');return{c,p,me:await api(c,'/api/me')}}
async function post(a,path,data,status=200){return api(a.c,path,{...data,csrf:a.me.csrf},status)}
const rule=(campaignId,kind,value,scope='catalog',effect='allow')=>({campaignId,kind,value,scope,effect})
try{
 const op=await login('organizer'),fin=await login('fintech-admin'),alice=await login('alice')
 await api(alice.c,'/api/admin/portal',undefined,403)
 const directory=await api(fin.c,'/api/admin/portal');assert(directory.mock);assert(directory.people.every(p=>p.legalEntity==='TEST-FINTECH'));assert(!directory.people.some(p=>p.subject===subject(7)))
 await post(fin,'/api/admin/portal/rules',rule(campaign(1),'legal_entity','TEST-ECOM'),403)
 await post(fin,'/api/admin/portal/rules',rule(campaign(2),'person',subject(7)),400)
 console.log('PASS: mock directory and rule management obey administrator and unit scope')
 assert.equal(sql(`select count(*) from demo_employees where corporate_subject='${subject(7)}'`),'0')
 await login('dana',false)
 assert.equal(sql(`select count(*) from demo_employees where corporate_subject='${subject(7)}'`),'0')
 await post(op,'/api/admin/portal/rules',rule(campaign(1),'legal_entity','TEST-ECOM'))
 const dana=await login('dana');assert.equal(dana.me.unit,'ecom');assert.equal(dana.me.scope,'catalog');assert.equal(dana.me.name,'Дана Портальная')
 assert.equal(sql(`select portal_managed from demo_employees where corporate_subject='${subject(7)}'`),'t')
 const repeated=await login('dana');assert.equal(repeated.me.id,dana.me.id)
 assert.equal(sql(`select count(*) from demo_users where subject='${subject(7)}'`),'1')
 console.log('PASS: signed legal-entity claim admits a new portal user without registry import, repeat login preserves account')
 await post(op,'/api/admin/portal/rules',rule(campaign(1),'person',subject(7),'catalog','deny'))
 await api(dana.c,'/api/me',undefined,401);await login('dana',false)
 let rules=(await api(op.c,'/api/admin/portal')).rules
 const deny=rules.find(r=>r.kind==='person'&&r.value===subject(7)&&r.effect==='deny')
 await post(op,'/api/admin/portal/toggle',{id:deny.id,enabled:false});assert.equal((await api(dana.c,'/api/me')).id,dana.me.id)
 await post(op,'/api/admin/portal/rules',rule(campaign(1),'group','merch-ecom','welcome'))
 await api(dana.c,'/api/catalog',undefined,401);await login('dana',false)
 rules=(await api(op.c,'/api/admin/portal')).rules
 const conflict=rules.find(r=>r.kind==='group'&&r.value==='merch-ecom')
 await post(op,'/api/admin/portal/toggle',{id:conflict.id,enabled:false});await api(dana.c,'/api/catalog')
 console.log('PASS: exclusions and conflicting shop/catalog rules fail closed, including existing sessions')
 await post(fin,'/api/admin/portal/rules',rule(campaign(2),'group','merch-fintech','welcome'))
 const elena=await login('elena');assert.equal(elena.me.scope,'welcome');assert.equal(elena.me.unit,'fintech')
 assert((await api(elena.c,'/api/catalog')).every(v=>['welcome','both'].includes(v.scope)))
 rules=(await api(fin.c,'/api/admin/portal')).rules
 const group=rules.find(r=>r.kind==='group'&&r.value==='merch-fintech')
 await post(fin,'/api/admin/portal/toggle',{id:group.id,enabled:false});await api(elena.c,'/api/me',undefined,401)
 await post(fin,'/api/admin/portal/rules',rule(campaign(2),'person',subject(8),'welcome'))
 assert.equal((await login('elena')).me.id,elena.me.id)
 console.log('PASS: group and individual admission expose Welcome pack only; permission changes do not duplicate accounts')
 await op.p.goto(base+'/access');await op.p.getByRole('heading',{name:'Доступ через портал',exact:true}).waitFor()
 const f=op.p.locator('#portal-rule');await f.locator('[name=search]').fill('Елена');assert.equal(await f.locator('[name=value] option').count(),1)
 await f.locator('[name=kind]').selectOption('legal_entity');assert.equal(await f.locator('[name=search]').isVisible(),false)
 await f.locator('[name=kind]').selectOption('person');await f.locator('[name=search]').fill('Дана');await f.locator('[name=campaignId]').selectOption(campaign(1));await f.locator('[name=effect]').selectOption('deny');await f.getByRole('button',{name:'Сохранить правило'}).click();await op.p.getByText('Правило сохранено. Приглашения по почте не отправлялись.').waitFor();await api(dana.c,'/api/me',undefined,401)
 await mkdir(new URL('artifacts',cwd),{recursive:true});await op.p.screenshot({path:new URL('artifacts/portal-access.png',cwd).pathname,fullPage:true})
 assert.deepEqual(errors,[])
 console.log('PASS: real browser renders rules, filters people and switches selection type without JavaScript errors')
 // Remove only this test's fixtures so the independent storage/issuance suite remains repeatable.
 sql(`delete from demo_sessions where user_id in(select id from demo_users where subject in('${subject(7)}','${subject(8)}'));
 delete from demo_users where subject in('${subject(7)}','${subject(8)}');
 delete from demo_employees where corporate_subject in('${subject(7)}','${subject(8)}');
 delete from demo_portal_rules where kind<>'person' or value in('${subject(7)}','${subject(8)}');`)
 console.log('Completed 5 portal access scenario groups. Only isolated synthetic data used.')
}finally{await browser.close()}
