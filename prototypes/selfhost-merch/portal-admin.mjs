import {randomUUID} from 'node:crypto'
import {equal} from './security.mjs'
import {portalPeople,legalEntities,portalGroups} from './portal-directory.mjs'
const validUUID=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x)

export async function portalAdmin(req,res,url,s,{pool,json,body,origin,adminUnits}){
 if(!url.pathname.startsWith('/api/admin/portal'))return false
 if(!adminUnits.length){json(res,403,{error:'Нужны права организатора'});return true}
 if(req.method==='GET'&&url.pathname==='/api/admin/portal'){
  const q=(url.searchParams.get('q')||'').trim().toLocaleLowerCase()
  if(q.length>100){json(res,400,{error:'Слишком длинный поиск'});return true}
  const people=portalPeople.filter(p=>adminUnits.includes(p.unit)&&(!q||[p.name,p.email].some(v=>v.toLocaleLowerCase().includes(q)))).map(({subject,name,email,legalEntity,active})=>({subject,name,email,legalEntity,active}))
  const campaigns=(await pool.query("select id,unit,name,status from demo_campaigns where unit=any($1) and purged_at is null order by unit",[adminUnits])).rows
  const rules=(await pool.query(`select r.*,c.unit,c.name as campaign_name from demo_portal_rules r join demo_campaigns c on c.id=r.campaign_id
    where c.unit=any($1) and c.purged_at is null order by c.unit,r.kind,r.value`,[adminUnits])).rows
  json(res,200,{mock:true,people,legalEntities:legalEntities.filter(x=>adminUnits.includes(x.unit)),groups:portalGroups.filter(x=>adminUnits.includes(x.unit)),campaigns,rules});return true
 }
 if(req.method!=='POST'){json(res,404,{error:'Не найдено'});return true}
 origin(req);const b=await body(req)
 if(!equal(b.csrf,s.csrf)){json(res,403,{error:'Неверная сессия запроса'});return true}
 const db=await pool.connect()
 try{
  await db.query('begin');await db.query('select pg_advisory_xact_lock(77334456)')
  if(url.pathname==='/api/admin/portal/rules'){
   if(Object.keys(b).some(k=>!['csrf','campaignId','kind','value','effect','scope'].includes(k))||!validUUID(b.campaignId)||!['allow','deny'].includes(b.effect)||!['catalog','welcome'].includes(b.scope))throw new Error('Invalid rule')
   const c=(await db.query("select * from demo_campaigns where id=$1 and status='open' and purged_at is null for share",[b.campaignId])).rows[0]
   if(!c||!adminUnits.includes(c.unit)){await db.query('rollback');json(res,403,{error:'Раздача недоступна'});return true}
   const options=b.kind==='person'?portalPeople.map(p=>({code:p.subject,unit:p.unit,active:p.active})):b.kind==='legal_entity'?legalEntities:b.kind==='group'?portalGroups:[]
   if(!options.some(x=>x.code===b.value&&adminUnits.includes(x.unit)&&x.active!==false))throw new Error('Unknown or forbidden directory value')
   await db.query(`insert into demo_portal_rules(id,campaign_id,kind,value,effect,scope) values($1,$2,$3,$4,$5,$6)
     on conflict(campaign_id,kind,value,effect,scope) do update set enabled=true`,[randomUUID(),b.campaignId,b.kind,b.value,b.effect,b.scope])
  }else if(url.pathname==='/api/admin/portal/toggle'){
   if(Object.keys(b).some(k=>!['csrf','id','enabled'].includes(k))||!validUUID(b.id)||typeof b.enabled!=='boolean')throw new Error('Invalid rule')
   const r=(await db.query(`select r.id from demo_portal_rules r join demo_campaigns c on c.id=r.campaign_id
     where r.id=$1 and c.unit=any($2) and c.status='open' and c.purged_at is null for update of r`,[b.id,adminUnits])).rows[0]
   if(!r){await db.query('rollback');json(res,403,{error:'Правило недоступно'});return true}
   await db.query('update demo_portal_rules set enabled=$1 where id=$2',[b.enabled,b.id])
  }else{await db.query('rollback');json(res,404,{error:'Не найдено'});return true}
  await db.query("insert into demo_events(kind,detail,actor_id) values('portal_rule_changed','Изменено правило доступа; без кадровых данных в журнале.',$1)",[s.user_id])
  await db.query('commit');json(res,200,{ok:true});return true
 }catch(e){await db.query('rollback');throw e}finally{db.release()}
}
