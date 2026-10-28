import pg from 'pg'
import {readFile,writeFile,mkdir,chown,access} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {hash,sessionHash} from './security.mjs'
import {seal} from './crypto.mjs'
const pool=new pg.Pool({host:'db',database:'merch_selfhost_demo',user:'merch_migrator',password:process.env.DEMO_MIGRATOR_PASSWORD})
for(const dir of ['/data/files','/data/ledger']){await mkdir(dir,{recursive:true});await chown(dir,1000,1000)}
await pool.query(await readFile('schema.sql','utf8'));await pool.query(await readFile('domain.sql','utf8'))
const existing=(await pool.query('select id from demo_installation limit 1')).rows[0]
if(existing){
  const ledger=JSON.parse(await readFile('/data/ledger/deletions.json','utf8'))
  if(ledger.installation!==existing.id)throw new Error('Deletion ledger mismatch: keep service quarantined')
  console.log('Existing demo schema retained; synthetic profiles are not recreated.')
}else{
 const db=await pool.connect(),installation=randomUUID()
 try{
  await db.query('begin');await db.query('insert into demo_installation values($1)',[installation])
  for(const [i,unit,name]of [[1,'ecom','E-com'],[2,'fintech','Fintech'],[3,'technologies','Technologies']]){
   const cid=`60000000-0000-4000-8000-${String(i).padStart(12,'0')}`
   await db.query('insert into demo_campaigns(id,unit,name) values($1,$2,$3)',[cid,unit,'Тестовая очная раздача · '+name])
   for(const [j,product,size,scope,img]of [[1,'Футболка','M','catalog','shirt.svg'],[2,'Футболка','L','catalog','shirt.svg'],[3,'Блокнот','Стандартный','both','book.svg']])await db.query('insert into demo_variants(id,unit,product,scope,size,color,image_name,total) values($1,$2,$3,$4,$5,$6,$7,20)',[`70000000-0000-4000-8000-${String(i*10+j).padStart(12,'0')}`,unit,product,scope,size,'Как на фото',img])
  }
  const people=[
   [1,'Алина Тестовая','alice@example.invalid','ecom','catalog',1,1],
   [2,'Борис Тестовый','boris@example.invalid','fintech','welcome',2,2],
   [3,'Гость Тестовый',null,'technologies','catalog',3,null],
   [5,'Организатор Тестовый','organizer@example.invalid','ecom','catalog',null,5],
   [6,'Админ Fintech Тестовый','fintech-admin@example.invalid','fintech','catalog',null,6]
  ]
  for(const [i,name,email,unit,scope,c,subject]of people){
   const eid=`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,uid=`30000000-0000-4000-8000-${String(i).padStart(12,'0')}`,sub=subject?`20000000-0000-4000-8000-${String(subject).padStart(12,'0')}`:null
   await db.query('insert into demo_employees(id,corporate_subject,full_name,email,unit,scope,campaign_id) values($1,$2,$3,$4,$5,$6,$7)',[eid,sub,name,email,unit,scope,c?`60000000-0000-4000-8000-${String(c).padStart(12,'0')}`:null])
   if(subject)await db.query('insert into demo_users values($1,$2,$3,$4)',[uid,eid,'http://127.0.0.1:8280/realms/merch-storage-demo',sub])
   if(i===5||i===6)await db.query('insert into demo_roles values($1,$2,$3)',[uid,i===5?'*':'fintech',i===5?'super':'admin'])
  }
  const invite='40000000-0000-4000-8000-000000000001',eid='10000000-0000-4000-8000-000000000003'
  await db.query(`insert into demo_invites(id,employee_id,token_hash,code_hash,expires_at) values($1,$2,$3,$4,now()+interval '7 days')`,[invite,eid,hash(process.env.DEMO_GUEST_TOKEN),sessionHash(invite+':TEST-GUEST-001',process.env.DEMO_SESSION_PEPPER)])
  const guestMessage=JSON.stringify({to:'Гость Тестовый — личная передача',subject:'Тестовое приглашение',body:'Откройте персональную ссылку и введите TEST-GUEST-001',url:'http://127.0.0.1:3280/guest#token='+process.env.DEMO_GUEST_TOKEN})
  await db.query(`insert into demo_outbox(id,employee_id,content_cipher,expires_at) values($1,$2,$3,now()+interval '7 days')`,[randomUUID(),eid,seal(guestMessage)])
  for(const i of [1,2])await db.query(`insert into demo_outbox(id,employee_id,content_cipher,expires_at) select $1,id,$2,now()+interval '7 days' from demo_employees where id=$3`,[randomUUID(),seal(JSON.stringify({to:i===1?'alice@example.invalid':'boris@example.invalid',subject:'Вам доступна тестовая раздача',body:'Подтвердите личность корпоративным входом. Приглашение не является самостоятельной авторизацией.',url:'http://127.0.0.1:3280/auth/login'})),`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`])
  await db.query('commit')
  await writeFile('/data/ledger/deletions.json',JSON.stringify({version:1,installation,campaigns:[]}),{mode:0o600});await chown('/data/ledger/deletions.json',1000,1000)
 }catch(e){await db.query('rollback');throw e}finally{db.release()}
}
for(const [name,icon]of [['shirt.svg','МЕРЧ'],['book.svg','БЛОКНОТ']]){
 try{await access('/data/files/'+name)}catch{await writeFile('/data/files/'+name,`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#eee5ff"/><rect x="150" y="70" width="300" height="250" rx="24" fill="#7700ff"/><text x="300" y="210" text-anchor="middle" font-family="sans-serif" font-size="36" fill="white">${icon}</text></svg>`);await chown('/data/files/'+name,1000,1000)}
}
console.log('Selfhost demo initialized. No production data, SMTP or corporate connections.');await pool.end()
