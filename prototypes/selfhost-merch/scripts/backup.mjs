import {localEnv,docker,saveBackup} from './backup-lib.mjs'
const env=await localEnv()
const installation=docker(['exec','-T','db','psql','-U','postgres','-d','merch_selfhost_demo','-Atc','select id from demo_installation limit 1']).toString().trim()
const database=docker(['exec','-T','db','pg_dump','-U','postgres','--clean','--if-exists','merch_selfhost_demo']).toString('base64')
const files=docker(['exec','-T','app','tar','-C','/data/files','-cf','-','.']).toString('base64')
const path=await saveBackup({version:1,installation,createdAt:new Date().toISOString(),database,files},env.DEMO_BACKUP_KEY)
console.log('Encrypted demo backup saved: '+path)
console.log('Includes application DB and product files, NOT secrets, Keycloak or the independent deletion ledger. Local copies older than 7 days rotate when this command runs.')
