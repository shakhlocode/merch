import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {randomUUID,createHmac} from 'node:crypto'
const cwd=new URL('../',import.meta.url),base='http://127.0.0.1:3280'
const {password}=JSON.parse(await readFile(new URL('.local/accounts.json',cwd),'utf8'))
const env=Object.fromEntries((await readFile(new URL('.local/demo.env',cwd),'utf8')).trim().split('\n').map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}))
const browser=await chromium.launch({headless:true,executablePath:process.env.DEMO_CHROMIUM||undefined,args:['--no-sandbox']})
function run(args,input){const r=spawnSync(args[0],args.slice(1),{cwd,input,maxBuffer:64*1024*1024});assert.equal(r.status,0,r.stderr?.toString().slice(0,500));return r.stdout.toString()}
const sql=q=>run(['docker','compose','--env-file','.local/demo.env','exec','-T','db','psql','-U','postgres','-d','merch_selfhost_demo','-Atc',q]).trim()
async function ctx(state){const c=await browser.newContext({storageState:state,viewport:{width:390,height:844}});await c.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());return c}
async function api(c,path,data,status=200){const r=await c.request.fetch(base+path,{method:data?'POST':'GET',headers:data?{Origin:base}:{},data});const d=await r.json();assert.equal(r.status(),status,path+': '+(d.error||'unexpected status'));return d}
async function login(name,allowed=true){const c=await ctx(),p=await c.newPage();await p.goto(base+'/auth/login');await p.locator('#username').fill(name);await p.locator('#password').fill(password);await p.locator('#kc-login').click();if(!allowed){await p.getByRole('heading',{name:'Вход отклонён'}).waitFor();return{c,p}}await p.waitForURL(base+'/shop');return{c,p,me:await api(c,'/api/me')}}
const post=(a,path,data,status=200)=>api(a.c,path,{...data,csrf:a.me.csrf},status)
async function event(c,b,status=200,valid=true){const time=String(Date.now()),signature=createHmac('sha256',env.DEMO_LIFECYCLE_KEY).update(time+'\n'+JSON.stringify(b)).digest('hex');const r=await c.request.post(base+'/api/lifecycle/events',{headers:{'x-event-timestamp':time,'x-event-signature':valid?signature:'bad'},data:b});assert.equal(r.status(),status);return r.json()}
async function until(fn){for(let i=0;i<50;i++){if(await fn())return;await new Promise(r=>setTimeout(r,300))}throw Error('Lifecycle deadline not applied')}
const cid='60000000-0000-4000-8000-000000000001',shirt='70000000-0000-4000-8000-000000000011',book='70000000-0000-4000-8000-000000000013'
try{
 const op=await login('organizer'),alice=await login('alice'),boris=await login('boris'),fin=await login('fintech-admin')
 assert.equal(alice.me.business_unit,'ecom');assert(alice.me.legal_entity.includes('E-com'))
 const c=await ctx(),bad={id:randomUUID(),kind:'deleted',subject:'20000000-0000-4000-8000-000000000001'}
 await event(c,bad,403,false);await api(alice.c,'/api/me')
 await post(fin,'/api/admin/hr',{campaignId:cid,rows:[{full_name:'X',legal_entity:'X',position:'X',phone:'+998000000000',pinfl:'90000000000001'}]},400)
 console.log('PASS: trusted corporate attributes stored; unsigned lifecycle and cross-unit HR import denied')
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII='
 await op.p.goto(base+'/admin');const productForm=op.p.locator('#create-product')
 await productForm.locator('[name=name]').fill('Тестовый товар жизненного цикла');await productForm.locator('[name=kind]').fill('Одежда');await productForm.locator('[name=unit]').selectOption('ecom');await productForm.locator('[name=scope]').selectOption('both');await productForm.locator('[name=variants]').fill('M;7\nL;9');await productForm.locator('[name=color]').fill('Фиолетовый');await productForm.locator('[name=image]').setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await productForm.getByRole('button',{name:'Создать товар',exact:true}).click();await op.p.getByText('Товар и изображение сохранены в БД').waitFor()
 assert.equal(sql("select count(*) from demo_variants where product='Тестовый товар жизненного цикла' and image_data is not null and product_kind='Одежда'"),'2')
 const aOrder=await post(alice,'/api/orders',{requestKey:randomUUID(),items:[shirt]},201)
 const before=Number(sql(`select reserved from demo_variants where id='${shirt}'`));assert.equal(before,1)
 // Before deletion: backup contains a pending order and personal profile.
 run(['node','scripts/backup.mjs']);const backup=(await readdir(new URL('.local/backups',cwd))).sort().at(-1)
 const removed=await event(c,bad);assert(removed.ok);assert((await event(c,bad)).duplicate)
 await api(alice.c,'/api/me',undefined,401);assert.equal(sql("select count(*) from demo_employees where corporate_subject='20000000-0000-4000-8000-000000000001'"),'0')
 assert.equal(sql(`select reserved from demo_variants where id='${shirt}'`),'0');assert.equal(sql(`select count(*) from demo_orders where id='${aOrder.id}'`),'0');await login('alice',false)
 console.log('PASS: signed deletion erases an inactive-browser user immediately, releases reservation, denies replay login, keeps products/images')
 const bp=sql("select id from demo_employees where corporate_subject='20000000-0000-4000-8000-000000000002'")
 await event(c,{id:randomUUID(),kind:'scheduled',subject:'20000000-0000-4000-8000-000000000002',deletion_at:new Date(Date.now()+1000).toISOString()})
 await until(()=>sql(`select count(*) from demo_employees where id='${bp}'`)==='0');await api(boris.c,'/api/me',undefined,401)
 console.log('PASS: future source deletion runs without another login')
 const row={full_name:'Массовый Тестовый',legal_entity:'Тестовое юрлицо',position:'Тестовая должность',phone:'+998000000000',pinfl:'90000000000001'}
 await post(op,'/api/admin/hr',{campaignId:cid,rows:[row]})
 const imported=(await api(op.c,'/api/admin/hr')).find(x=>x.full_name===row.full_name);assert(imported);assert(!('pinfl'in imported))
 const mail=(await api(op.c,'/api/admin/mailbox')).find(x=>x.to.includes(row.full_name)),g=await ctx(),p=await g.newPage();await p.goto(mail.url);await p.getByLabel('Идентификатор',{exact:true}).fill(row.pinfl);await p.getByRole('button',{name:'Активировать приглашение'}).click();await p.waitForURL(base+'/shop')
 const me=await api(g,'/api/me');assert.equal(me.phone,row.phone);assert.equal(me.position,row.position)
 const state=await g.storageState(),cookie=state.cookies.find(x=>x.name==='merch_storage_session');assert(cookie.expires>Date.now()/1000+29*86400)
 const again=await ctx(state);assert.equal((await api(again,'/api/me')).id,me.id)
 assert(!run(['docker','compose','--env-file','.local/demo.env','exec','-T','db','pg_dump','-U','postgres','merch_selfhost_demo']).includes(row.pinfl))
 const person={c:again,me},ship=await post(person,'/api/orders',{requestKey:randomUUID(),items:[book],fulfillment:'shipment'},201)
 await api(again,'/api/orders/'+ship.id+'/receipt.json',undefined,404);await post(op,'/api/admin/orders/'+ship.id+'/status',{status:'assembling'});await post(op,'/api/admin/orders/'+ship.id+'/status',{status:'shipped'})
 await api(again,'/api/me',undefined,401);assert.equal(sql(`select (purge_after=(((fulfilled_at at time zone 'Asia/Tashkent')+interval '2 months') at time zone 'Asia/Tashkent')) from demo_employees where id='${imported.id}'`),'t')
 const total=sql(`select total from demo_variants where id='${book}'`)
 sql(`update demo_employees set purge_after=now()-interval '1 second' where id='${imported.id}'`)
 await until(()=>sql(`select count(*) from demo_employees where id='${imported.id}'`)==='0')
 assert.equal(sql(`select total from demo_variants where id='${book}'`),total);assert.equal(sql(`select qty from demo_aggregates where campaign_id='${cid}' and variant_id='${book}'`),'1')
 console.log('PASS: HR PINFL never stored in plaintext; persistent browser session works, shipment closes access, per-person two-month purge preserves stock and quantities')
 // The source can fire a worker without an account ever logging in.
 const row2={...row,full_name:'HR Уволенный Тестовый',pinfl:'90000000000002'};await post(op,'/api/admin/hr',{campaignId:cid,rows:[row2]})
 const fired=(await api(op.c,'/api/admin/hr')).find(x=>x.full_name===row2.full_name);await post(op,'/api/admin/lifecycle',{kind:'terminated',employeeId:fired.id});assert(!(await api(op.c,'/api/admin/hr')).some(x=>x.full_name===row2.full_name))
 await post(op,'/api/admin/hr',{campaignId:cid,rows:[row2]},400)
 // Restore predates deletion: independent ledger must suppress resurrection.
 run(['node','scripts/restore.mjs','--confirm-demo-only',backup])
 assert.equal(sql("select count(*) from demo_employees where corporate_subject in('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002')"),'0')
 assert.equal(sql("select count(*) from demo_variants where product='Тестовый товар жизненного цикла' and image_data is not null"),'2')
 assert.equal(sql('select count(*) from demo_sessions'),'0')
 console.log('PASS: optional manual HR deletion works; restore cannot resurrect portal identities or credentials and preserves database-backed product images')
 console.log('Completed 5 lifecycle scenario groups. Only local mocks used; no corporate services called.')
}finally{await browser.close()}
