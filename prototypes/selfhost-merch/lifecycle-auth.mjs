import {createHmac} from 'node:crypto'
import {equal,sessionHash} from './security.mjs'
export const sourceKey=(kind,id)=>sessionHash(kind+':'+id,process.env.DEMO_SESSION_PEPPER)
export const eventSignature=(timestamp,body,key=process.env.DEMO_LIFECYCLE_KEY)=>createHmac('sha256',key).update(timestamp+'\n'+JSON.stringify(body)).digest('hex')
export function verifyEvent(req,body){const time=req.headers['x-event-timestamp'];return typeof time==='string'&&/^\d{13}$/.test(time)&&Math.abs(Date.now()-Number(time))<300000&&equal(req.headers['x-event-signature'],eventSignature(time,body))}
export async function eraseNow(people=[],blocks=[]){
 const b={people,blocks},time=String(Date.now())
 const r=await fetch('http://retention:9050/erase',{method:'POST',headers:{'Content-Type':'application/json','x-event-timestamp':time,'x-event-signature':eventSignature(time,b)},body:JSON.stringify(b),signal:AbortSignal.timeout(10000)})
 if(!r.ok)throw new Error('Deletion service unavailable; retry source event')
}
