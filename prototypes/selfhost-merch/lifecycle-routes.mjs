import {randomUUID} from 'node:crypto'
import {equal,hash,random,sessionHash} from './security.mjs'
import {sourceKey,verifyEvent,eraseNow} from './lifecycle-auth.mjs'
import {seal} from './crypto.mjs'
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x)
const date=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))?new Date(x).toISOString():null
const text=x=>typeof x==='string'&&x.trim()&&x.length<=250?x.trim():null
export function parseHR(csv){
 const rows=[];let row=[],field='',quoted=false
 for(let i=0;i<csv.length;i++){const c=csv[i];if(c==='"'){if(quoted&&csv[i+1]==='"'){field+='"';i++}else quoted=!quoted}else if(!quoted&&(c===';'||c==='\n')){row.push(field.replace(/\r$/,''));field='';if(c==='\n'){if(row.some(Boolean))rows.push(row);row=[]}}else field+=c}
 if(quoted)throw new Error('Незакрытая кавычка CSV');row.push(field.replace(/\r$/,''));if(row.some(Boolean))rows.push(row)
 const header=(rows.shift()||[]).map(x=>x.replace(/^\uFEFF/,'').trim())
 if(header.join(';')!=='full_name;legal_entity;position;phone;pinfl')throw new Error('Нужны колонки шаблона: full_name;legal_entity;position;phone;pinfl')
 return rows.map(r=>{if(r.length!==5)throw new Error('Проверьте колонки CSV');return Object.fromEntries(header.map((h,i)=>[h,r[i]]))})
}
async function transaction(pool,fn){const db=await pool.connect();try{await db.query('begin');await db.query('select pg_advisory_xact_lock(77334455)');const r=await fn(db);await db.query('commit');return r}catch(e){await db.query('rollback');throw e}finally{db.release()}}
export async function lifecycleRoute(req,res,url,s,h){
 const {pool,json,body,origin,config}=h,path=url.pathname
 const inbound=path==='/api/lifecycle/events'
 const admin=['/api/admin/lifecycle','/api/admin/hr','/api/admin/products'].includes(path)
 const image=path.match(/^\/api\/product-image\/([a-f0-9-]{36})$/)
 if(!inbound&&!admin&&!image)return false
 try{const health=await fetch('http://retention:9050/health',{signal:AbortSignal.timeout(1500)});if(!health.ok)throw new Error()}catch{json(res,503,{error:'Сервис удаления временно недоступен'});return true}
 let roles=[],units=[]
 if(!inbound){
  if(!s?.active){json(res,401,{error:'Войдите в систему'});return true}
  roles=(await pool.query('select * from demo_roles where user_id=$1',[s.user_id])).rows
  units=roles.some(r=>r.role==='super')?['ecom','fintech','technologies']:roles.map(r=>r.unit)
  if(admin&&!units.length){json(res,403,{error:'Нужны права организатора'});return true}
 }
 if(image&&req.method==='GET'){
  const v=(await pool.query('select * from demo_variants where id=$1',[image[1]])).rows[0]
  if(!v||!(units.includes(v.unit)||v.active&&v.unit===s.unit&&[s.scope,'both'].includes(v.scope))){json(res,404,{error:'Не найдено'});return true}
  if(!v.image_data){const fallback=(await pool.query('select image_data,image_mime from demo_variants where unit=$1 and image_name=$2 and image_data is not null limit 1',[v.unit,v.image_name])).rows[0];if(!fallback){json(res,404,{error:'Нет изображения'});return true}v.image_data=fallback.image_data;v.image_mime=fallback.image_mime}
  res.writeHead(200,{'Content-Type':v.image_mime,'Cache-Control':'private, no-store'});res.end(v.image_data);return true
 }
 if(admin&&req.method==='GET'){
  if(path==='/api/admin/hr'){json(res,200,(await pool.query('select id,full_name,legal_entity,position,phone,active,source_delete_at,fulfilled_at,purge_after from demo_employees where unit=any($1) and hr_personnel',[units])).rows);return true}
  if(path==='/api/admin/lifecycle'){json(res,200,{people:(await pool.query('select id,corporate_subject,full_name,email,business_unit,legal_entity,source_delete_at,fulfilled_at,purge_after from demo_employees where unit=any($1)',[units])).rows,mock:true});return true}
 }
 if(req.method!=='POST'){json(res,405,{error:'Недопустимый метод'});return true}
 const b=await body(req)
 if(inbound){if(!verifyEvent(req,b)){json(res,403,{error:'Недоверенное кадровое событие'});return true}}
 else{origin(req);if(!equal(b.csrf,s.csrf)){json(res,403,{error:'Неверная сессия'});return true}}
 if(path==='/api/admin/hr'){
  const rows=Array.isArray(b.rows)?b.rows:typeof b.csv==='string'?parseHR(b.csv):[]
  if(rows.length<1||rows.length>2000||!uuid(b.campaignId))throw new Error('Загрузите от 1 до 2000 строк')
  const result=await transaction(pool,async db=>{
   await db.query('select pg_advisory_xact_lock(77334458)')
   const c=(await db.query("select * from demo_campaigns where id=$1 and status='open' and purged_at is null and unit=any($2) for share",[b.campaignId,units])).rows[0]
   if(!c)throw new Error('Раздача недоступна')
   let created=0
   for(const row of rows){
    if(!['full_name','legal_entity','position','phone'].every(k=>text(row[k]))||typeof row.pinfl!=='string'||!/^\d{14}$/.test(row.pinfl.trim())||!/^[+\d() -]{7,30}$/.test(row.phone))throw new Error('Проверьте ФИО, юрлицо, должность, телефон и 14 цифр ПИНФЛ')
    const pinfl=row.pinfl.trim(),key=sourceKey('hr',pinfl)
    if((await db.query('select 1 from demo_source_blocks where key_hash=$1',[key])).rows[0])throw new Error('Кадровый доступ отозван')
    const old=(await db.query('select * from demo_employees where pinfl_hash=$1 for update',[key])).rows[0]
    if(old){if(old.unit!==c.unit||old.campaign_id!==c.id||!old.active||old.fulfilled_at)throw new Error('Участник уже зарегистрирован или доступ закрыт');continue}
    const id=randomUUID(),invite=randomUUID(),token=Buffer.from(random()+random()).toString('hex').slice(0,64)
    await db.query("insert into demo_employees(id,full_name,unit,scope,campaign_id,legal_entity,position,phone,pinfl_hash,source_key,hr_personnel) values($1,$2,$3,'catalog',$4,$5,$6,$7,$8,$8,true)",[id,row.full_name.trim(),c.unit,c.id,row.legal_entity.trim(),row.position.trim(),row.phone.trim(),key])
    await db.query("insert into demo_invites(id,employee_id,token_hash,code_hash,expires_at) values($1,$2,$3,$4,now()+interval '30 days')",[invite,id,hash(token),sessionHash(invite+':'+pinfl,process.env.DEMO_SESSION_PEPPER)])
    await db.query("insert into demo_outbox(id,employee_id,content_cipher,expires_at) values($1,$2,$3,now()+interval '30 days')",[randomUUID(),id,seal(JSON.stringify({to:row.full_name+' — личная передача',subject:'Персональный доступ HR',body:'Откройте личную ссылку и введите свой ПИНФЛ. Он не включён в ссылку и не хранится открытым текстом.',url:config.base+'/guest#token='+token}))]);created++
   }
   return{created,skipped:rows.length-created}
  });json(res,200,{ok:true,...result,mock:true});return true
 }
 if(path==='/api/admin/products'){
  if(!text(b.name)||!text(b.kind)||!['catalog','welcome','both'].includes(b.scope)||!units.includes(b.unit)||!Array.isArray(b.variants)||!b.variants.length||b.variants.length>30)throw new Error('Проверьте карточку товара')
  let data=null,mime=null
  if(b.image){
   if(typeof b.image!=='string'||b.image.length>2800000||!/^[A-Za-z0-9+/]+={0,2}$/.test(b.image))throw new Error('Изображение слишком большое или повреждено')
   data=Buffer.from(b.image,'base64')
   mime=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':data[0]===255&&data[1]===216&&data[2]===255?'image/jpeg':data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP'?'image/webp':null
   if(!mime||data.length>2*1024*1024)throw new Error('Поддерживаются PNG, JPEG и WebP до 2 МБ')
  }
  await transaction(pool,async db=>{for(const v of b.variants){
   if(!text(v.size)||!text(v.color)||!Number.isInteger(v.qty)||v.qty<0||v.qty>1000000)throw new Error('Проверьте размеры и количество')
   const id=randomUUID();await db.query('insert into demo_variants(id,unit,product,scope,size,color,image_name,total,product_kind,image_data,image_mime) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,b.unit,b.name.trim(),b.scope,v.size.trim(),v.color.trim(),'book.svg',v.qty,b.kind.trim(),data,mime])
   if(v.qty)await db.query("insert into demo_stock_movements(id,variant_id,delta_total,delta_reserved,kind,actor) values($1,$2,$3,0,'income',$4)",[randomUUID(),id,v.qty,s.user_id])
  }});json(res,201,{ok:true});return true
 }
 // Mock UI and signed source events share one lifecycle handler.
 if(!['updated','scheduled','deleted','terminated'].includes(b.kind)||!inbound&&!uuid(b.employeeId)||inbound&&!uuid(b.id))throw new Error('Некорректное кадровое событие')
 let guard,committed=false
 if(inbound){guard=await pool.connect();await guard.query('begin');await guard.query('select pg_advisory_xact_lock(77334459)')}
 const eventDB=guard||pool
 try{
 let e,key
 if(inbound){
  if(b.source==='hr'){
   if(typeof b.pinfl!=='string'||!/^\d{14}$/.test(b.pinfl))throw new Error('Нужны 14 цифр ПИНФЛ из доверенного кадрового события')
   key=sourceKey('hr',b.pinfl);e=(await eventDB.query('select * from demo_employees where pinfl_hash=$1',[key])).rows[0]
  }else{
   if(typeof b.subject!=='string'||!b.subject||b.subject.length>250)throw new Error('Нужен стабильный subject источника')
   key=sourceKey('oidc',config.issuer+':'+b.subject);e=(await eventDB.query('select * from demo_employees where corporate_subject=$1',[b.subject])).rows[0]
  }
  const digest=sessionHash(JSON.stringify(b),process.env.DEMO_LIFECYCLE_KEY),old=(await eventDB.query('select body_hash from demo_source_events where id=$1',[b.id])).rows[0]
  if(old){if(old.body_hash!==digest)throw new Error('Event ID conflict');json(res,200,{ok:true,duplicate:true});return true}
 }else{
  e=(await eventDB.query('select * from demo_employees where id=$1 and unit=any($2)',[b.employeeId,units])).rows[0]
  if(!e)throw new Error('Участник недоступен')
  key=e.source_key||(e.corporate_subject?sourceKey('oidc',config.issuer+':'+e.corporate_subject):null)
 }
 if(b.kind==='deleted'||b.kind==='terminated'){
  await eraseNow(e?[e.id]:[],key?[key]:[])
 }else{
  const deletion=b.deletion_at==null?null:date(b.deletion_at)
  if(b.deletion_at!=null&&!deletion)throw new Error('Некорректная дата удаления')
  if(deletion&&new Date(deletion)<=new Date()){await eraseNow(e?[e.id]:[],key?[key]:[])}else{
  if(key){
   if(deletion)await eventDB.query('insert into demo_source_schedules values($1,$2) on conflict(key_hash) do update set delete_at=excluded.delete_at',[key,deletion])
   else await eventDB.query('delete from demo_source_schedules where key_hash=$1',[key])
  }
  if(e){
   await eventDB.query('update demo_employees set source_key=$1,source_delete_at=$2,full_name=coalesce($3,full_name),email=coalesce($4,email),business_unit=coalesce($5,business_unit),legal_entity=coalesce($6,legal_entity) where id=$7',[key,deletion,text(b.full_name),text(b.email),text(b.business_unit),text(b.legal_entity),e.id])
  }
  }
 }
 if(inbound)await eventDB.query("insert into demo_source_events values($1,$2,now()+interval '10 minutes') on conflict do nothing",[b.id,sessionHash(JSON.stringify(b),process.env.DEMO_LIFECYCLE_KEY)])
 if(guard){await guard.query('commit');committed=true}
 json(res,200,{ok:true,mock:!inbound});return true
 }finally{if(guard){if(!committed)await guard.query('rollback');guard.release()}}
}
