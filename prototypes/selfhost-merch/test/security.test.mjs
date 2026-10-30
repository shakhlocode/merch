import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {seal,unseal} from '../crypto.mjs'
import {assertDemoConfig,corporateClaims,equal,pkce} from '../security.mjs'
import {encryptBackup,decryptBackup} from '../scripts/backup-lib.mjs'
import {choosePortalGrant} from '../portal-access.mjs'
const secret=randomBytes(32).toString('hex')
test('Local secret envelopes reject wrong keys and modified ciphertext',()=>{
 const value='only a synthetic invitation';const cipher=seal(value,secret)
 assert(!cipher.includes(value));assert.equal(unseal(cipher,secret),value)
 assert.throws(()=>unseal(cipher,randomBytes(32).toString('hex')))
 const b=Buffer.from(cipher,'base64url');b[b.length-1]^=1;assert.throws(()=>unseal(b.toString('base64url'),secret))
})
test('Backup is authenticated and cannot be restored with modified content',()=>{
 const data={version:1,database:'SYNTHETIC PERSONAL DATA',files:'none'};const backup=encryptBackup(data,secret)
 assert(!backup.includes(Buffer.from(data.database)));assert.deepEqual(decryptBackup(backup,secret),data)
 const changed=Buffer.from(backup);changed[20]^=1;assert.throws(()=>decryptBackup(changed,secret))
 assert.throws(()=>decryptBackup(backup,randomBytes(32).toString('hex')))
})
test('Only loopback demo origins and generated local secrets accepted',()=>{
 const c={DEMO_ONLY:'true',DEMO_BASE_URL:'http://127.0.0.1:3280',DEMO_ISSUER:'http://127.0.0.1:8280/realms/merch-storage-demo',DEMO_IDP_INTERNAL_ORIGIN:'http://keycloak:8080',DEMO_CLIENT_ID:'merch-storage-review',...Object.fromEntries(['DEMO_CLIENT_SECRET','DEMO_DB_PASSWORD','DEMO_GUEST_TOKEN','DEMO_SESSION_PEPPER','DEMO_DATA_KEY','DEMO_LIFECYCLE_KEY'].map(k=>[k,secret]))}
 assertDemoConfig(c)
 for(const change of [{DEMO_ONLY:'false'},{DEMO_BASE_URL:'https://uzum-merch-taupe.vercel.app'},{DEMO_ISSUER:'https://corporate.example.invalid/realms/company'},{DEMO_DATA_KEY:''}])assert.throws(()=>assertDemoConfig({...c,...change}))
})
test('Corporate identity requires verified email and nonce, not excess HR fields',()=>{
 const c={sub:'stable',aud:'merch-storage-review',nonce:'nonce',email:'demo@example.invalid',email_verified:true,name:'Тестовый сотрудник',business_unit:'ecom',legal_entity_name:'Тестовое ЮЛ'}
 const identity=corporateClaims(c,'nonce','merch-storage-review');assert.equal(identity.subject,'stable');assert.equal(identity.businessUnit,'ecom');assert.equal(identity.legalName,'Тестовое ЮЛ');assert(!('department'in identity));assert(!('legal'in identity))
 assert.throws(()=>corporateClaims({...c,email_verified:false},'nonce','merch-storage-review'))
 assert.throws(()=>corporateClaims(c,'other','merch-storage-review'))
 assert.throws(()=>corporateClaims({...c,azp:'wrong'},'nonce','merch-storage-review'))
})
test('PKCE uses standard S256 and comparisons do not accept unequal lengths',()=>{
 assert.equal(pkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
 assert(equal('a','a'));assert(!equal('a','aa'));assert(!equal(undefined,undefined))
})
test('Portal admission fails closed for unknown, inactive, denied and ambiguous identities',()=>{
 const identity={subject:'person',legalEntity:'TEST-ECOM',groups:['merch-ecom'],active:true}
 const a={id:'1',campaign_id:'one',scope:'catalog',kind:'legal_entity',value:'TEST-ECOM',effect:'allow',enabled:true}
 assert.equal(choosePortalGrant(identity,[]),null)
 assert.equal(choosePortalGrant(identity,[a]),a)
 assert.equal(choosePortalGrant({...identity,active:false},[a]),null)
 assert.equal(choosePortalGrant({...identity,legalEntity:null},[a]),null)
 assert.equal(choosePortalGrant(identity,[a,{...a,id:'2',kind:'person',value:'person',effect:'deny'}]),null)
 assert.equal(choosePortalGrant(identity,[a,{...a,id:'2',scope:'welcome'}]),null)
 assert.equal(choosePortalGrant(identity,[a,{...a,id:'2',campaign_id:'other'}]),null)
 assert.equal(choosePortalGrant(identity,[a,{...a,id:'2',kind:'group',value:'merch-ecom'}]).campaign_id,'one')
 assert.equal(choosePortalGrant(identity,[{...a,enabled:false}]),null)
})
test('Portal rule attributes are typed, bounded claims; arbitrary HR metadata is discarded',()=>{
 const c={sub:'stable',nonce:'nonce',email:'demo@example.invalid',email_verified:true,name:'Тест',business_unit:'ecom',legal_entity_name:'Тестовое ЮЛ',legal_entity_code:'TEST-ECOM',merch_groups:['merch-ecom'],employee_active:true,department:'discard'}
 const i=corporateClaims(c,'nonce','client');assert.equal(i.legalEntity,'TEST-ECOM');assert.deepEqual(i.groups,['merch-ecom']);assert(i.active);assert(!('department'in i))
 const invalid=corporateClaims({...c,employee_active:'true',merch_groups:'merch-ecom',legal_entity_code:{code:'TEST-ECOM'}},'nonce','client')
 assert.equal(invalid.active,false);assert.equal(invalid.legalEntity,null);assert.deepEqual(invalid.groups,[])
})

import {eventSignature,verifyEvent} from '../lifecycle-auth.mjs'
import {parseHR} from '../lifecycle-routes.mjs'
test('HR CSV keeps PINFL strings and quoted delimiters; malformed data rejected',()=>{
 const rows=parseHR('full_name;legal_entity;position;phone;pinfl\n"Тест; Имя";Тестовое ЮЛ;Тест;+998000000000;00000000000001')
 assert.equal(rows[0].pinfl,'00000000000001');assert.equal(rows[0].full_name,'Тест; Имя');assert.throws(()=>parseHR('wrong;header\n1;2'))
})
test('Source events require a fresh, matching keyed signature',()=>{
 process.env.DEMO_LIFECYCLE_KEY=secret
 const time=String(Date.now()),b={id:'synthetic',kind:'deleted'},req={headers:{'x-event-timestamp':time,'x-event-signature':eventSignature(time,b)}}
 assert(verifyEvent(req,b));assert(!verifyEvent(req,{...b,kind:'updated'}));assert(!verifyEvent({headers:{...req.headers,'x-event-timestamp':'0'}},b))
})

test('Audit excludes caller secrets and emits one correlated denial',async()=>{
 const {EventEmitter}=await import('node:events');const {attachAudit,auditCategory}=await import('../audit.mjs')
 const res=new EventEmitter();const headers={};res.setHeader=(k,v)=>headers[k]=v;res.statusCode=403;res.writableFinished=true;const lines=[]
 const identify=attachAudit({method:'POST',url:'/api/admin/hr?secret=SECRET',headers:{authorization:'SECRET'},body:'SECRET'},res,'/api/admin/hr',line=>lines.push(line))
 identify('30000000-0000-4000-8000-000000000001');res.emit('finish');res.emit('close')
 assert.equal(lines.length,1);assert(!lines[0].includes('SECRET'));const r=JSON.parse(lines[0]);assert.equal(r.category,'administration');assert.equal(r.outcome,'rejected');assert.equal(r.actor_id,'30000000-0000-4000-8000-000000000001');assert.equal(r.request_id,headers['X-Request-ID']);assert.equal(auditCategory('/style.css'),null)
})
test('Audit records abort without untrusted identity or method',async()=>{
 const {EventEmitter}=await import('node:events');const {attachAudit}=await import('../audit.mjs')
 const res=new EventEmitter();res.setHeader=()=>{};res.statusCode=200;res.writableFinished=false;const lines=[]
 const identify=attachAudit({method:'SECRET'},res,'/auth/callback',line=>lines.push(line));identify('fake@example.invalid');res.emit('close');res.emit('finish')
 const r=JSON.parse(lines[0]);assert.equal(lines.length,1);assert.equal(r.status,499);assert.equal(r.actor_id,null);assert.equal(r.method,'OTHER')
})
