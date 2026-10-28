import pg from 'pg'
import http from 'node:http'
import {readFile,writeFile,rename,open} from 'node:fs/promises'
const pool=new pg.Pool({host:'db',database:'merch_selfhost_demo',user:'merch_retention',password:process.env.DEMO_RETENTION_PASSWORD,max:2})
let healthy=false,last=null,busy=false
async function sweep(){
 if(busy)return;busy=true
 try{
  const ledger=JSON.parse(await readFile('/data/ledger/deletions.json','utf8'))
  const preview=(await pool.query('select demo_retention_preview() as p')).rows[0].p
  if(ledger.version!==1||ledger.installation!==preview.installation||!Array.isArray(ledger.campaigns)||ledger.campaigns.some(id=>!/^[a-f0-9-]{36}$/.test(id)))throw new Error('Invalid deletion ledger')
  const ids=[...new Set([...ledger.campaigns,...preview.due])]
  if(ids.length!==ledger.campaigns.length){
   // Persist deletion intent before database deletion. Restore never rolls this file back.
   await writeFile('/data/ledger/deletions.next',JSON.stringify({...ledger,campaigns:ids}),{mode:0o600})
   const f=await open('/data/ledger/deletions.next','r');await f.sync();await f.close()
   await rename('/data/ledger/deletions.next','/data/ledger/deletions.json')
  }
  last=(await pool.query('select demo_run_retention($1::uuid[]) as result',[ids])).rows[0].result
  healthy=true
 }catch{healthy=false;console.error('Retention check failed; service health is blocked. No personal values logged.')}finally{busy=false}
}
await sweep();setInterval(sweep,5000)
http.createServer((req,res)=>{res.writeHead(healthy?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:healthy,last}))}).listen(9050,'0.0.0.0')
