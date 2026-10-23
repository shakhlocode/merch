import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair, SignJWT, jwtVerify } from 'jose'
import { assertDemoConfig, corporateClaims, equal, hash, pkce, sessionHash, validateOrder } from '../security.mjs'

const config = { DEMO_ONLY:'true', DEMO_BASE_URL:'http://127.0.0.1:3180', DEMO_ISSUER:'http://127.0.0.1:8180/realms/merch-demo', DEMO_IDP_INTERNAL_ORIGIN:'http://keycloak:8080', DEMO_CLIENT_ID:'merch-review', ...Object.fromEntries(['DEMO_CLIENT_SECRET','DEMO_DB_PASSWORD','DEMO_GUEST_TOKEN','DEMO_SESSION_PEPPER'].map(k=>[k,'a'.repeat(64)])) }
const claims={sub:'stable-user',nonce:'expected-nonce',aud:'merch-review',email:'alice@example.invalid',email_verified:true,name:'Тестовая Алина',employee_id:'TEST-101',legal_entity:'Тестовое юрлицо',department:'Тестовый отдел'}
const order={items:[{id:'shirt',size:'M',color:'Фиолетовый',qty:1}],mode:'office',office:'Офис 1 (тест)',phone:'+000 000 00 00',comment:'',csrf:'demo'}

test('Fail closed for production, external hosts and missing secrets',()=>{
  assert.equal(assertDemoConfig(config).base,config.DEMO_BASE_URL)
  for(const change of [{DEMO_ONLY:'false'},{DEMO_BASE_URL:'https://merch.example.com'},{DEMO_ISSUER:'https://corporate.example.com/realms/company'},{DEMO_IDP_INTERNAL_ORIGIN:'https://api.supabase.com'},{DEMO_CLIENT_SECRET:'placeholder'}])assert.throws(()=>assertDemoConfig({...config,...change}))
})
test('PKCE S256 matches RFC 7636 vector; sessions use keyed hashes',()=>{
  assert.equal(pkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  assert.notEqual(sessionHash('token','one'),sessionHash('token','two'))
  assert.notEqual(hash('token'),'token');assert.equal(equal('same','same'),true);assert.equal(equal('same','different'),false)
})
test('Trusted identity requires verified email, nonce, staffing attributes and correct authorized party',()=>{
  assert.equal(corporateClaims(claims,'expected-nonce','merch-review').subject,'stable-user')
  for(const change of [{email_verified:false},{nonce:'wrong'},{employee_id:null},{legal_entity:''},{aud:['merch-review','other'],azp:'other'}])assert.throws(()=>corporateClaims({...claims,...change},'expected-nonce','merch-review'))
})
test('JWT verification rejects bad signature, wrong issuer/audience and expiry',async()=>{
  const keys=await generateKeyPair('RS256'),other=await generateKeyPair('RS256')
  async function token(key,iss='demo-issuer',aud='merch-review',exp='2m'){return new SignJWT(claims).setProtectedHeader({alg:'RS256'}).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(key)}
  const options={issuer:'demo-issuer',audience:'merch-review',algorithms:['RS256']}
  assert.equal((await jwtVerify(await token(keys.privateKey),keys.publicKey,options)).payload.sub,claims.sub)
  for(const bad of [await token(other.privateKey),await token(keys.privateKey,'wrong'),await token(keys.privateKey,'demo-issuer','wrong'),await token(keys.privateKey,'demo-issuer','merch-review',Math.floor(Date.now()/1000)-10)])await assert.rejects(jwtVerify(bad,keys.publicKey,options))
})
test('Immutable identity and privileges cannot be supplied through checkout',()=>{
  assert.equal(validateOrder(order,'catalog','oidc').office,'Офис 1 (тест)')
  for(const key of ['full_name','email','legal_entity','department','unit','scope','role','user_id'])assert.throws(()=>validateOrder({...order,[key]:'forged'},'catalog','oidc'))
})
test('Scope/quantity and shipping rules enforced on server; unrelated delivery fields omitted',()=>{
  assert.throws(()=>validateOrder(order,'welcome','oidc'))
  assert.throws(()=>validateOrder({...order,items:[...order.items,...order.items]},'catalog','oidc'))
  assert.throws(()=>validateOrder({...order,items:[{...order.items[0],qty:2}]},'catalog','oidc'))
  assert.throws(()=>validateOrder({...order,mode:'shipping',country:'X',city:'Y',address:''},'catalog','oidc'))
  assert.throws(()=>validateOrder({...order,mode:'pvz',pvz:'000123'},'catalog','oidc'))
  assert.equal(validateOrder({...order,mode:'pvz',pvz:'000123'},'catalog','identifier').pvz,'000123')
  const clean=validateOrder({...order,country:'unnecessary',city:'unnecessary',address:'unnecessary'},'catalog','oidc')
  assert.equal(clean.country,undefined);assert.equal(clean.comment,undefined)
})
