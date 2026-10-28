import {readFile} from 'node:fs/promises'
import {basename} from 'node:path'
import {cwd,localEnv,docker,decryptBackup} from './backup-lib.mjs'
if(process.argv[2]!=='--confirm-demo-only'||!/^merch-selfhost-\d+\.mshbak$/.test(basename(process.argv[3]||'')))throw new Error('Usage: npm run restore -- --confirm-demo-only merch-selfhost-TIMESTAMP.mshbak')
const env=await localEnv(),file=cwd+'.local/backups/'+basename(process.argv[3])
const backup=decryptBackup(await readFile(file),env.DEMO_BACKUP_KEY)
const ledger=JSON.parse(docker(['exec','-T','retention','node','-e',"process.stdout.write(require('fs').readFileSync('/data/ledger/deletions.json','utf8'))"]).toString())
if(backup.version!==1||backup.installation!==ledger.installation)throw new Error('Wrong installation or missing independent deletion ledger; remain quarantined')
// Never write unverified decrypted SQL or personal values to a log/temp file.
docker(['stop','app','retention'])
docker(['exec','-T','db','psql','-U','postgres','-d','merch_selfhost_demo','--single-transaction','-v','ON_ERROR_STOP=1'],Buffer.from(backup.database,'base64'))
// A backup can predate logout, invitation activation or physical issuance.
// Fail closed: never silently resurrect old credentials or reopen distribution.
docker(['exec','-T','db','psql','-U','postgres','-d','merch_selfhost_demo','-v','ON_ERROR_STOP=1','-c',"begin; delete from demo_sessions; delete from demo_flows; delete from demo_invites; delete from demo_outbox; update demo_campaigns set status='closed',closed_at=coalesce(closed_at,now()); update demo_employees set active=false where campaign_id is not null; commit;"])
const archive=Buffer.from(backup.files,'base64')
const listing=docker(['run','--rm','--no-deps','-T','--entrypoint','tar','setup','-tf','-'],archive).toString().trim().split('\n')
if(listing.some(x=>!['./','./shirt.svg','./book.svg'].includes(x)))throw new Error('Unexpected file path in demo backup; service remains stopped')
docker(['run','--rm','--no-deps','-T','--entrypoint','tar','setup','-C','/data/files','-xf','-'],archive)
docker(['up','-d','--no-deps','retention'])
let ready=false
for(let i=0;i<40;i++){
 try{docker(['exec','-T','retention','node','-e',"fetch('http://127.0.0.1:9050/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]);ready=true;break}catch{await new Promise(r=>setTimeout(r,500))}
}
if(!ready)throw new Error('Retention reconciliation failed; app remains stopped')
docker(['up','-d','--no-deps','app'])
console.log('Demo restored in closed-distribution mode. Old sessions/invitations revoked; deletion ledger reapplied before app startup. Physical stock and orders require operator reconciliation before any new distribution.')
