import {readFile,mkdir,writeFile,readdir,stat,unlink} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {gzipSync,gunzipSync} from 'node:zlib'
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto'
export const cwd=fileURLToPath(new URL('../',import.meta.url))
export async function localEnv(){return Object.fromEntries((await readFile(cwd+'.local/demo.env','utf8')).trim().split('\n').map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}))}
export function docker(args,input){const p=spawnSync('docker',['compose','--env-file','.local/demo.env',...args],{cwd,input,maxBuffer:64*1024*1024});if(p.status!==0)throw new Error('Demo Docker operation failed; no backup content printed');return p.stdout}
export function encryptBackup(payload,key){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);const data=gzipSync(Buffer.from(JSON.stringify(payload)));return Buffer.concat([Buffer.from('MSH1'),iv,c.update(data),c.final(),c.getAuthTag()])}
export function decryptBackup(buffer,key){if(buffer.subarray(0,4).toString()!=='MSH1'||buffer.length<33)throw new Error('Invalid backup');const d=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),buffer.subarray(4,16));d.setAuthTag(buffer.subarray(-16));const data=Buffer.concat([d.update(buffer.subarray(16,-16)),d.final()]);return JSON.parse(gunzipSync(data,{maxOutputLength:64*1024*1024}).toString())}
export async function saveBackup(payload,key){const dir=cwd+'.local/backups/';await mkdir(dir,{recursive:true,mode:0o700});const name='merch-selfhost-'+Date.now()+'.mshbak';await writeFile(dir+name,encryptBackup(payload,key),{mode:0o600,flag:'wx'});for(const old of await readdir(dir)){if(!/^merch-selfhost-\d+\.mshbak$/.test(old))continue;const p=dir+old;if((await stat(p)).mtimeMs<Date.now()-7*86400000)await unlink(p)}return dir+name}
