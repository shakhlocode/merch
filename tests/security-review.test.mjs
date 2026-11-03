import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {normalizeProductImage,MAX_IMAGE_BYTES} from '../lib/security/image.mjs'
import {publicError} from '../lib/security/public-error.mjs'
import {contentSecurityPolicy,securityHeaders} from '../lib/security/headers.mjs'

test('Product photos are decoded, re-encoded and stripped of metadata regardless of claimed filename/MIME',async()=>{
 for(const format of ['png','jpeg','webp','gif']){
  const bytes=await sharp({create:{width:12,height:9,channels:4,background:'#7200ff'}}).toFormat(format).withMetadata({exif:{IFD0:{Artist:'PRIVATE METADATA'}}}).toBuffer()
  const out=await normalizeProductImage(bytes);const meta=await sharp(out.bytes).metadata()
  assert.equal(out.contentType,'image/webp');assert.equal(out.extension,'webp');assert.equal(meta.format,'webp');assert.equal(meta.width,12);assert.equal(meta.height,9);assert.equal(meta.exif,undefined);assert(!out.bytes.includes(Buffer.from('PRIVATE METADATA')))
 }
})
test('Fake images, SVG, corrupted/truncated files, oversized payloads and pixel bombs are rejected',async()=>{
 const bytes=await sharp({create:{width:10,height:10,channels:3,background:'red'}}).png().toBuffer()
 for(const b of [Buffer.from('<svg><script>alert(1)</script></svg>'),Buffer.from('<html>fake jpeg</html>'),bytes.subarray(0,25),Buffer.alloc(0),Buffer.alloc(MAX_IMAGE_BYTES+1)])await assert.rejects(()=>normalizeProductImage(b))
 const large=await sharp({create:{width:4100,height:4100,channels:3,background:'white'}}).png().toBuffer()
 await assert.rejects(()=>normalizeProductImage(large))
})
test('Public errors use exact allowlist without returning SQL, personal data or arbitrary exceptions',()=>{
 for(const error of [new Error('postgres password=SECRET'),{message:'duplicate key value violates constraint (email)=(person@example.invalid)'},'not_admin: SECRET',new Error('fetch failed at internal.db:5432')]){
  const message=publicError(error);assert(!message.includes('SECRET'));assert(!message.includes('person@'));assert(!message.includes('internal.db'));assert(message.startsWith('Не удалось'))
 }
 assert(publicError({code:'23505',message:'private detail'}).includes('уже существует'))
 assert(publicError('not_admin').includes('администраторам'))
})
test('CSP uses per-request nonce, blocks frames/objects and permits backend plus same-origin camera',()=>{
 const nonce='a'.repeat(32),csp=contentSecurityPolicy(nonce,'https://db.example.invalid')
 assert(csp.includes(`'nonce-${nonce}'`));assert(csp.includes("script-src 'self'"));assert(!csp.includes("'unsafe-eval'"));assert(csp.includes("frame-ancestors 'none'"));assert(csp.includes('wss://db.example.invalid'))
 assert.throws(()=>contentSecurityPolicy('injected nonce',undefined));assert.throws(()=>contentSecurityPolicy(nonce,'file:///secret'))
 const headers=Object.fromEntries(securityHeaders(true).map(h=>[h.key,h.value]));assert.equal(headers['X-Frame-Options'],'DENY');assert(headers['Permissions-Policy'].includes('camera=(self)'));assert.equal(headers['Strict-Transport-Security'],'max-age=31536000');assert(!securityHeaders(false).some(h=>h.key==='Strict-Transport-Security'))
})
