import sharp from 'sharp'
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_PIXELS = 16_000_000
/** @param {Uint8Array} input */
export async function normalizeProductImage(input) {
  if (!input.length || input.length > MAX_IMAGE_BYTES) throw new Error('invalid_image')
  const b=Buffer.from(input)
  const signature=b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png'
    : b[0]===255&&b[1]===216&&b[2]===255?'jpeg'
    : ['GIF87a','GIF89a'].includes(b.subarray(0,6).toString())?'gif'
    : b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'?'webp':null
  if(!signature)throw new Error('invalid_image')
  // Decode one frame only: animated inputs intentionally become a static product photo.
  const image=sharp(b,{limitInputPixels:MAX_PIXELS,failOn:'warning',animated:false})
  const meta=await image.metadata()
  if(meta.format!==signature||!meta.width||!meta.height||meta.width*meta.height>MAX_PIXELS)throw new Error('invalid_image')
  const bytes=await image.rotate().webp({quality:85}).toBuffer()
  if(bytes.length>MAX_IMAGE_BYTES)throw new Error('invalid_image')
  // Sharp strips EXIF/XMP/ICC metadata unless explicitly retained.
  return {bytes,contentType:'image/webp',extension:'webp'}
}
