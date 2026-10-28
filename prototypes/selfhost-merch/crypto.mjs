import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
export function seal(text,key=process.env.DEMO_DATA_KEY){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv)
  const body=Buffer.concat([cipher.update(text,'utf8'),cipher.final()])
  return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url')
}
export function unseal(text,key=process.env.DEMO_DATA_KEY){
  const b=Buffer.from(text,'base64url');if(b.length<29)throw new Error('Invalid ciphertext')
  const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),b.subarray(0,12));decipher.setAuthTag(b.subarray(12,28))
  return Buffer.concat([decipher.update(b.subarray(28)),decipher.final()]).toString('utf8')
}
