import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {readFile,mkdir,readdir} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {decryptBackup} from '../scripts/backup-lib.mjs'
const cwd=fileURLToPath(new URL('../',import.meta.url)),base='http://127.0.0.1:3280'
const creds=JSON.parse(await readFile(cwd+'.local/accounts.json','utf8'))
const env=Object.fromEntries((await readFile(cwd+'.local/demo.env','utf8')).trim().split('\n').map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}))
await mkdir(cwd+'artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.DEMO_CHROMIUM||undefined,args:['--no-sandbox']})
const contexts=[],errors=[];let count=0
function pass(name){count++;console.log('PASS: '+name)}
function run(args,input){const r=spawnSync(args[0],args.slice(1),{cwd,input,maxBuffer:64*1024*1024});assert.equal(r.status,0,'Local test command failed');return r.stdout.toString()}
function sql(query){return run(['docker','compose','--env-file','.local/demo.env','exec','-T','db','psql','-U','postgres','-d','merch_selfhost_demo','-Atc',query]).trim()}
async function context(){const c=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(c);await c.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());return c}
async function api(c,path,data,status=200){const res=await c.request.fetch(base+path,{method:data?'POST':'GET',headers:data?{Origin:base}:{},data});assert.equal(res.status(),status,path);return res.json()}
async function login(name){const c=await context(),p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/auth/login');await p.locator('#username').fill(name);await p.locator('#password').fill(creds.password);await p.locator('#kc-login').click();await p.waitForURL(base+'/shop');const me=await api(c,'/api/me');return{c,p,me}}
async function post(actor,path,data,status=200){return api(actor.c,path,{...data,csrf:actor.me.csrf},status)}
const variant=(unit,n)=>`70000000-0000-4000-8000-${String(unit*10+n).padStart(12,'0')}`
const campaign=n=>`60000000-0000-4000-8000-${String(n).padStart(12,'0')}`
async function waitUntil(fn){for(let i=0;i<40;i++){if(await fn())return;await new Promise(r=>setTimeout(r,500))}throw new Error('Timed out waiting for synthetic retention check')}
try{
 const anon=await context();await api(anon,'/api/me',undefined,401);await api(anon,'/api/admin/data',undefined,401)
 const op=await login('organizer'),unitAdmin=await login('fintech-admin'),alice=await login('alice'),boris=await login('boris')
 assert(op.me.isSuper);assert.deepEqual(unitAdmin.me.adminUnits,['fintech']);assert.equal(alice.me.scope,'catalog');assert(!('department'in alice.me));assert(!('legal_entity'in alice.me))
 pass('Real local OIDC creates server sessions; minimal profiles and separate organizer roles')
 const outsider=await context(),outsiderPage=await outsider.newPage();await outsiderPage.goto(base+'/auth/login');await outsiderPage.locator('#username').fill('outsider');await outsiderPage.locator('#password').fill(creds.password);await outsiderPage.locator('#kc-login').click();await outsiderPage.getByRole('heading',{name:'Вход отклонён'}).waitFor();await api(outsider,'/api/me',undefined,401)
 await api(alice.c,'/api/admin/data',undefined,403);await post(alice,'/api/orders',{requestKey:randomUUID(),items:[variant(1,1)],full_name:'Spoof'},400);await post(alice,'/api/orders',{requestKey:randomUUID(),items:[variant(1,1)],phone:'+000000000'},400)
 await api(unitAdmin.c,'/api/admin/data',undefined,403);await post(unitAdmin,'/api/admin/stocks/'+variant(1,1),{delta:1,threshold:5,active:true},404)
 pass('No registry grant, excessive personal fields, role and cross-unit access denied')
 const requestKey=randomUUID(),created=await post(alice,'/api/orders',{requestKey,items:[variant(1,1)]},201),retry=await post(alice,'/api/orders',{requestKey,items:[variant(1,1)]},201);assert.equal(created.id,retry.id)
 assert.equal(sql(`select reserved from demo_variants where id='${variant(1,1)}'`),'1');assert.equal(sql(`select snapshot::text from demo_orders where id='${created.id}'`),'{"delivery": "office"}')
 const token=(await api(alice.c,'/api/orders/'+created.id+'/receipt.json')).token;assert.equal(token.length,43)
 const svg=await alice.c.request.get(base+'/api/orders/'+created.id+'/receipt.svg');assert.equal(svg.status(),200);assert((await svg.text()).includes('<svg'))
 await api(boris.c,'/api/orders/'+created.id+'/receipt.json',undefined,404);await post(op,'/api/admin/issue',{token},400);await post(op,'/api/admin/orders/'+created.id+'/status',{status:'ready'},400)
 await post(op,'/api/admin/orders/'+created.id+'/status',{status:'assembling'});await post(op,'/api/admin/orders/'+created.id+'/status',{status:'ready'});await post(unitAdmin,'/api/admin/issue',{token},404)
 const issued=await Promise.all([post(op,'/api/admin/issue',{token}),post(op,'/api/admin/issue',{token})]);assert.deepEqual(issued.map(x=>x.already).sort(),[false,true]);assert.equal(sql(`select total||':'||reserved from demo_variants where id='${variant(1,1)}'`),'19:0')
 await post(alice,'/api/orders',{requestKey:randomUUID(),items:[variant(1,3)]},400);assert((await api(alice.c,'/api/orders')).some(x=>x.status==='received'))
 pass('Reservation/retry and parallel QR issuance atomic; only ready orders issued once; history remains visible')
 await post(boris,'/api/orders',{requestKey:randomUUID(),items:[variant(2,1)]},400)
 const bo=await post(boris,'/api/orders',{requestKey:randomUUID(),items:[variant(2,3)]},201);await post(boris,'/api/orders/'+bo.id+'/cancel',{});assert.equal(sql(`select reserved from demo_variants where id='${variant(2,3)}'`),'0')
 await alice.p.goto(base+'/shop');await alice.p.getByRole('heading',{name:'Мои заказы'}).waitFor();await alice.p.waitForFunction(()=>[...document.querySelectorAll('.product img')].every(i=>i.complete&&i.naturalWidth>0));assert.equal(await alice.p.locator('[name=phone]').count(),0);await alice.p.screenshot({path:cwd+'artifacts/customer.png',fullPage:true})
 pass('Welcome products restricted; cancellation releases stock; real customer UI loads')
 const mails=await api(op.c,'/api/admin/mailbox');assert(mails.some(m=>m.url.includes('/guest#token=')));assert(mails.every(m=>!m.to?.includes('@uzum')))
 const guestMail=mails.find(m=>m.url.includes('/guest#token=')),g1=await context(),g2=await context(),p1=await g1.newPage(),p2=await g2.newPage();await Promise.all([p1.goto(guestMail.url),p2.goto(guestMail.url)])
 const getBody=async p=>({token:new URL(guestMail.url).hash.slice(7),identifier:'TEST-GUEST-001',csrf:await p.locator('[name=csrf]').inputValue()})
 const gb1=await getBody(p1),gb2=await getBody(p2)
 const result=await Promise.all([g1.request.post(base+'/api/guest',{headers:{Origin:base},data:gb1}),g2.request.post(base+'/api/guest',{headers:{Origin:base},data:gb2})]);assert.deepEqual(result.map(x=>x.status()).sort(),[200,400])
 const gc=result[0].status()===200?g1:g2,oldGuestMe=await api(gc,'/api/me');assert.equal(oldGuestMe.email,null)
 await post(op,'/api/admin/invitations',{employeeId:'10000000-0000-4000-8000-000000000003',identifier:'TEST-GUEST-001'});await api(gc,'/api/me',undefined,401)
 const restoredMail=(await api(op.c,'/api/admin/mailbox')).find(m=>m.subject.includes('Восстановление')),recovered=await context(),rp=await recovered.newPage();await rp.goto(restoredMail.url);await rp.getByLabel('Идентификатор',{exact:true}).fill('TEST-GUEST-001');await rp.getByRole('button',{name:'Активировать приглашение'}).click();await rp.waitForURL(base+'/shop');const recoveredMe=await api(recovered,'/api/me');assert.equal(recoveredMe.id,oldGuestMe.id)
 const guest={c:recovered,p:rp,me:recoveredMe}
 pass('Encrypted mock outbox, concurrent one-time invitation and recovery preserve account and revoke old session')
 // Explicitly add one more synthetic eligible user for a genuine last-item race.
 sql(`insert into demo_employees(id,corporate_subject,full_name,email,unit,scope,campaign_id) values('10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000003','Тестовый участник','outsider@example.invalid','technologies','catalog','${campaign(3)}')`)
 const other=await login('outsider');await post(op,'/api/admin/stocks/'+variant(3,1),{delta:-19,threshold:5,active:true})
 const race=await Promise.all([guest,other].map(async a=>{const r=await a.c.request.post(base+'/api/orders',{headers:{Origin:base},data:{csrf:a.me.csrf,requestKey:randomUUID(),items:[variant(3,1)]}});return{actor:a,status:r.status()}}));assert.deepEqual(race.map(x=>x.status).sort(),[201,400]);assert.equal(sql(`select total||':'||reserved from demo_variants where id='${variant(3,1)}'`),'1:1')
 const row=(await api(race.find(x=>x.status===201).actor.c,'/api/orders'))[0];await post(op,'/api/admin/orders/'+row.id+'/status',{status:'assembling'});await post(op,'/api/admin/orders/'+row.id+'/status',{status:'ready'})
 const receipt=(await api(race.find(x=>x.status===201).actor.c,'/api/orders/'+row.id+'/receipt.json')).token;await post(op,'/api/admin/issue',{token:receipt});assert.equal(sql(`select total||':'||reserved from demo_variants where id='${variant(3,1)}'`),'0:0')
 pass('Two different employees cannot reserve the same last item; issuance never creates negative stock')
 const cannotDDL=spawnSync('docker',['compose','--env-file','.local/demo.env','exec','-T','db','psql','-U','merch_app','-d','merch_selfhost_demo','-v','ON_ERROR_STOP=1','-c','create table forbidden_runtime_ddl(id integer)'],{cwd});assert.notEqual(cannotDDL.status,0)
 const cannotPurge=spawnSync('docker',['compose','--env-file','.local/demo.env','exec','-T','db','psql','-U','merch_app','-d','merch_selfhost_demo','-v','ON_ERROR_STOP=1','-c',"select demo_run_retention('{}')"],{cwd});assert.notEqual(cannotPurge.status,0)
 assert.equal(sql("select rolsuper||':'||rolcreaterole||':'||rolcreatedb from pg_roles where rolname='merch_app'"),'false:false:false')
 const before=await readdir(cwd+'.local').catch(()=>[]);assert(before.includes('demo.env'))
 run(['node','scripts/backup.mjs']);const backupName=(await readdir(cwd+'.local/backups')).sort().at(-1),backupBytes=await readFile(cwd+'.local/backups/'+backupName)
 assert(!backupBytes.includes(Buffer.from('Тестовая')));const backup=decryptBackup(backupBytes,env.DEMO_BACKUP_KEY);assert(backup.database);assert(backup.files)
 pass('Runtime DB role cannot migrate/purge; authenticated encrypted backup contains DB and files without plaintext')
 await op.p.goto(base+'/admin');await op.p.getByRole('heading',{name:'Заказы'}).waitFor();await op.p.screenshot({path:cwd+'artifacts/admin.png',fullPage:true})
 await op.p.goto(base+'/data');await op.p.getByRole('heading',{name:'Где хранятся данные'}).waitFor();await op.p.screenshot({path:cwd+'artifacts/storage.png',fullPage:true})
 await post(op,'/api/admin/campaigns/'+campaign(1)+'/close',{});await api(alice.c,'/api/me',undefined,401)
 sql(`update demo_campaigns set closed_at=now()-interval '31 days' where id='${campaign(1)}'; insert into demo_events(kind,detail,created_at) values('expired-test','no personal values',now()-interval '31 days')`)
 await waitUntil(()=>sql(`select count(*) from demo_employees where campaign_id='${campaign(1)}'`)==='0')
 assert.equal(sql(`select count(*) from demo_orders where campaign_id='${campaign(1)}'`),'0');assert.equal(sql("select count(*) from demo_users where subject='20000000-0000-4000-8000-000000000001'"),'0');assert.equal(sql("select count(*) from demo_events where kind='expired-test'"),'0')
 assert.equal(sql(`select qty from demo_aggregates where campaign_id='${campaign(1)}' and variant_id='${variant(1,1)}'`),'1')
 assert.equal(sql(`select count(*) from demo_employees where campaign_id='${campaign(2)}'`),'1')
 pass('Due campaign cleanup removes participant profiles/accounts/orders/mail/invitations while preserving other campaign and quantity aggregates')
 run(['docker','compose','--env-file','.local/demo.env','restart','app']);assert.equal(sql("select count(*) from demo_employees where email='alice@example.invalid'"),'0')
 run(['node','scripts/restore.mjs','--confirm-demo-only',backupName])
 assert.equal(sql("select count(*) from demo_employees where email='alice@example.invalid'"),'0');assert.equal(sql('select count(*) from demo_sessions'),'0');assert.equal(sql('select count(*) from demo_invites'),'0');assert.equal(sql("select count(*) from demo_campaigns where status='open'"),'0')
 assert.equal(sql(`select qty from demo_aggregates where campaign_id='${campaign(1)}' and variant_id='${variant(1,1)}'`),'1')
 await api(op.c,'/api/me',undefined,401)
 pass('Restore reapplies independent deletion ledger, does not resurrect profiles or credentials, and keeps distributions closed')
 assert.deepEqual(errors,[])
 console.log(`Completed ${count} integrated scenario groups using synthetic local data only. Backup restored into this demo only.`)
}finally{await browser.close()}
