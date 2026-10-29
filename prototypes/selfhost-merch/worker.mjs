import pg from 'pg'
import http from 'node:http'
import {readFile,writeFile,rename,open} from 'node:fs/promises'
import {verifyEvent} from './lifecycle-auth.mjs'
const pool=new pg.Pool({host:'db',database:'merch_selfhost_demo',user:'merch_retention',password:process.env.DEMO_RETENTION_PASSWORD,max:2})
let healthy=false,last=null,queue=Promise.resolve()
const uuid=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x)
function sweep(extra={people:[],blocks:[]}){
 const work=queue.then(async()=>{
  try{
   const ledger=JSON.parse(await readFile('/data/ledger/deletions.json','utf8'))
   const preview=(await pool.query('select demo_retention_preview() as p')).rows[0].p
   if(ledger.version!==1||ledger.installation!==preview.installation||!Array.isArray(ledger.campaigns)||ledger.campaigns.some(x=>!uuid(x))||!Array.isArray(ledger.people||[])||!Array.isArray(ledger.blocks||[]))throw new Error('Invalid deletion ledger')
   const next={...ledger,campaigns:[...new Set([...ledger.campaigns,...preview.due])],people:[...new Set([...(ledger.people||[]),...preview.people,...extra.people])],blocks:[...new Set([...(ledger.blocks||[]),...preview.blocks,...extra.blocks])]}
   if(next.people.some(x=>!uuid(x))||next.blocks.some(x=>typeof x!=='string'||!/^\w{64}$/.test(x)))throw new Error('Invalid deletion key')
   await writeFile('/data/ledger/deletions.next',JSON.stringify(next),{mode:0o600});const f=await open('/data/ledger/deletions.next','r');await f.sync();await f.close();await rename('/data/ledger/deletions.next','/data/ledger/deletions.json')
   last=(await pool.query('select demo_apply_lifecycle($1::uuid[],$2::uuid[],$3::text[]) as result',[next.people,next.campaigns,next.blocks])).rows[0].result
   healthy=true
  }catch{healthy=false;throw new Error('Lifecycle deletion check failed')}
 })
 queue=work.catch(()=>{});return work
}
await sweep();setInterval(()=>sweep().catch(()=>console.error('Lifecycle worker unhealthy; no personal values logged.')),5000)
http.createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
 if(req.url==='/erase'&&req.method==='POST'){
  try{let text='';for await(const c of req){text+=c;if(text.length>20000)throw new Error()};const b=JSON.parse(text)
   if(!verifyEvent(req,b)||!Array.isArray(b.people)||!Array.isArray(b.blocks)||b.people.length>100||b.blocks.length>100){res.writeHead(403);return res.end('{}')}
   await sweep(b);res.writeHead(200);return res.end('{"ok":true}')
  }catch{res.writeHead(503);return res.end('{}')}
 }
 if(req.url!=='/health'){res.writeHead(404);return res.end('{}')}
 res.writeHead(healthy?200:503);res.end(JSON.stringify({ok:healthy,last}))
}).listen(9050,'0.0.0.0')
