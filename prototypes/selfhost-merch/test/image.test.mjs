import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {normalizeProductImage,MAX_IMAGE_BYTES} from '../image.mjs'
test('Prototype stores re-encoded WebP without private metadata for every accepted format',async()=>{
 for(const format of ['png','jpeg','webp']){
  const input=await sharp({create:{width:12,height:8,channels:3,background:'purple'}}).toFormat(format).withMetadata({exif:{IFD0:{Artist:'PRIVATE'}}}).toBuffer()
  const out=await normalizeProductImage(input);const meta=await sharp(out.bytes).metadata()
  assert.equal(meta.format,'webp');assert.equal(out.contentType,'image/webp');assert.equal(meta.exif,undefined);assert.equal(meta.width,12)
 }
})
test('Prototype rejects SVG, fake signatures, corrupted, oversized and oversized-pixel files',async()=>{
 const valid=await sharp({create:{width:2,height:2,channels:3,background:'white'}}).png().toBuffer()
 for(const input of [Buffer.from('<svg/>'),Buffer.from('GIF89a-invalid'),valid.subarray(0,24),Buffer.alloc(MAX_IMAGE_BYTES+1)])await assert.rejects(()=>normalizeProductImage(input))
 const large=await sharp({create:{width:4100,height:4100,channels:3,background:'white'}}).png().toBuffer();await assert.rejects(()=>normalizeProductImage(large))
})
