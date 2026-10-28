import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {seal,unseal} from '../crypto.mjs'
import {assertDemoConfig,corporateClaims,equal,pkce} from '../security.mjs'
import {encryptBackup,decryptBackup} from '../scripts/backup-lib.mjs'
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
 const c={DEMO_ONLY:'true',DEMO_BASE_URL:'http://127.0.0.1:3280',DEMO_ISSUER:'http://127.0.0.1:8280/realms/merch-storage-demo',DEMO_IDP_INTERNAL_ORIGIN:'http://keycloak:8080',DEMO_CLIENT_ID:'merch-storage-review',...Object.fromEntries(['DEMO_CLIENT_SECRET','DEMO_DB_PASSWORD','DEMO_GUEST_TOKEN','DEMO_SESSION_PEPPER','DEMO_DATA_KEY'].map(k=>[k,secret]))}
 assertDemoConfig(c)
 for(const change of [{DEMO_ONLY:'false'},{DEMO_BASE_URL:'https://uzum-merch-taupe.vercel.app'},{DEMO_ISSUER:'https://corporate.example.invalid/realms/company'},{DEMO_DATA_KEY:''}])assert.throws(()=>assertDemoConfig({...c,...change}))
})
test('Corporate identity requires verified email and nonce, not excess HR fields',()=>{
 const c={sub:'stable',aud:'merch-storage-review',nonce:'nonce',email:'demo@example.invalid',email_verified:true,name:'Тестовый сотрудник'}
 const identity=corporateClaims(c,'nonce','merch-storage-review');assert.equal(identity.subject,'stable');assert(!('department'in identity));assert(!('legal'in identity))
 assert.throws(()=>corporateClaims({...c,email_verified:false},'nonce','merch-storage-review'))
 assert.throws(()=>corporateClaims(c,'other','merch-storage-review'))
 assert.throws(()=>corporateClaims({...c,azp:'wrong'},'nonce','merch-storage-review'))
})
test('PKCE uses standard S256 and comparisons do not accept unequal lengths',()=>{
 assert.equal(pkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
 assert(equal('a','a'));assert(!equal('a','aa'));assert(!equal(undefined,undefined))
})
