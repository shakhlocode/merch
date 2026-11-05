import test from 'node:test'
import assert from 'node:assert/strict'
import {internalRedirect} from '../lib/security/internal-redirect.mjs'
import {checkDeployment,SECURITY_SCHEMA} from '../lib/security/deployment-check.mjs'
const site='https://shop.example.invalid',backend='https://db.example.invalid'
const config={appOrigin:site,backendOrigin:backend,expectedAppOrigin:site,expectedBackendOrigin:backend,expectedRelease:'e9c9d27',publicKey:'sb_publishable_SYNTHETIC'}
function mock(changes={}){const calls=[];return{calls,fetch:async(url,options)=>{calls.push({url,options});const responses={
 [backend+'/auth/v1/settings']:[200,{mailer_autoconfirm:false,disable_signup:false}],
 [site+'/api/security/version']:[200,{release:'e9c9d27',securitySchema:SECURITY_SCHEMA,backendOrigin:backend}],
 [backend+'/rest/v1/rpc/merch_security_release']:[200,SECURITY_SCHEMA],
 [backend+'/rest/v1/rpc/get_employee_merch_access?p_email=deployment-check-nonexistent%40example.invalid']:[401,{error:'denied'}],...changes};const r=responses[url];assert(r,'unexpected outbound request');return new Response(JSON.stringify(r[1]),{status:r[0]})}}}
test('Redirect rejects protocol-relative, single/double backslash, controls, encoded separators and external origins',()=>{
 const invalid=['//example.invalid/landing','/\\example.invalid/landing','/\\\\example.invalid','https://example.invalid','javascript:alert(1)',' /catalog','/\n/example.invalid','/%2fexample.invalid','/%5cexample.invalid','/%252fexample.invalid','/%0a/example.invalid']
 for(const value of invalid)assert.equal(internalRedirect(value,site,'/safe'),'/safe',value)
 for(const value of ['/catalog','/orders?unit=123','/set-password?reset=1','/profile#details'])assert.equal(internalRedirect(value,site),value)
})
test('Deployment probe is read-only, public-key-only and includes no employee email or cookie',async()=>{
 const m=mock();const r=await checkDeployment(config,m.fetch);assert(r.ok);assert.equal(m.calls.length,4)
 for(const c of m.calls){assert.equal(c.options.method,'GET');assert.equal(c.options.redirect,'error');assert(!c.options.headers.Authorization);assert(!c.options.headers.Cookie)}
 await assert.rejects(()=>checkDeployment({...config,publicKey:'sb_secret_BAD'},m.fetch))
})
test('Release gate fails on autoconfirm, unavailable settings, wrong app/db, missing migration and anonymous RPC success',async()=>{
 const cases=[{[backend+'/auth/v1/settings']:[200,{mailer_autoconfirm:true}]},{[backend+'/auth/v1/settings']:[503,{}]},
 {[site+'/api/security/version']:[200,{release:'old',securitySchema:SECURITY_SCHEMA,backendOrigin:backend}]},
 {[site+'/api/security/version']:[200,{release:'e9c9d27',securitySchema:SECURITY_SCHEMA,backendOrigin:'https://wrong.invalid'}]},
 {[backend+'/rest/v1/rpc/merch_security_release']:[404,{}]},
 {[backend+'/rest/v1/rpc/get_employee_merch_access?p_email=deployment-check-nonexistent%40example.invalid']:[200,[]]}]
 for(const change of cases)await assert.rejects(()=>checkDeployment(config,mock(change).fetch))
 await assert.rejects(()=>checkDeployment({...config,expectedBackendOrigin:'https://wrong.invalid'},mock().fetch))
})
