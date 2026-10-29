import {randomUUID} from 'node:crypto'

export function choosePortalGrant(identity,rules){
  if(identity.active!==true)return null
  const matches=rules.filter(r=>r.enabled&&(
    r.kind==='person'&&r.value===identity.subject||
    r.kind==='legal_entity'&&r.value===identity.legalEntity||
    r.kind==='group'&&identity.groups.includes(r.value)))
  // A matching exclusion overrides every allow, including individual grants.
  if(matches.some(r=>r.effect==='deny'))return null
  const grants=[...new Map(matches.filter(r=>r.effect==='allow').map(r=>[r.campaign_id+':'+r.scope,r])).values()]
  // Never choose a shop or a catalog arbitrarily when rules conflict.
  return grants.length===1?grants[0]:null
}
export async function portalGrant(db,identity){
  const {rows}=await db.query(`select r.*,c.unit from demo_portal_rules r join demo_campaigns c on c.id=r.campaign_id
    where c.status='open' and c.purged_at is null`)
  return choosePortalGrant(identity,rows)
}
export async function portalEmployee(db,identity){
  // Serialize first login and policy changes without creating a duplicate account.
  await db.query('select pg_advisory_xact_lock(77334456)')
  const existing=(await db.query('select * from demo_employees where corporate_subject=$1 for update',[identity.subject])).rows[0]
  // Explicit pre-existing participants and organizer accounts keep their existing grants.
  if(existing&&!existing.portal_managed){if(!existing.active)throw new Error('Access denied');return existing}
  const grant=await portalGrant(db,identity)
  if(!grant||existing&&!existing.active)throw new Error('Portal access denied')
  if(existing){
    if(existing.campaign_id!==grant.campaign_id||existing.scope!==grant.scope||existing.unit!==grant.unit)throw new Error('Shop binding conflict; organizer review required')
    return existing
  }
  // Only successful, authorized login creates a minimal participant. No HR import.
  return (await db.query(`insert into demo_employees(id,corporate_subject,full_name,email,unit,scope,campaign_id,portal_managed)
    values($1,$2,$3,$4,$5,$6,$7,true) returning *`,[randomUUID(),identity.subject,identity.name,identity.email,grant.unit,grant.scope,grant.campaign_id])).rows[0]
}
