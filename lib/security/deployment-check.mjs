export const SECURITY_SCHEMA='anonymous-access-20261105'
/** Read-only release check; never logs keys, records, tokens or remote bodies.
 * @param {{appOrigin:string,backendOrigin:string,expectedAppOrigin:string,expectedBackendOrigin:string,expectedRelease:string,publicKey:string}} config
 * @param {typeof fetch} fetcher */
export async function checkDeployment(config,fetcher=fetch){
 const origin=value=>{const u=new URL(value);if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw new Error('Expected HTTPS origin without path');return u.origin}
 const app=origin(config.appOrigin),backend=origin(config.backendOrigin)
 if(app!==origin(config.expectedAppOrigin)||backend!==origin(config.expectedBackendOrigin))throw new Error('Configured origins differ from approved deployment')
 if(!/^[a-f0-9]{7,40}$/.test(config.expectedRelease))throw new Error('Expected release commit required')
 if(!config.publicKey||config.publicKey.startsWith('sb_secret_'))throw new Error('Use only a public publishable/anon key')
 if(!config.publicKey.startsWith('sb_publishable_')){
  try{const claims=JSON.parse(Buffer.from(config.publicKey.split('.')[1],'base64url').toString());if(claims.role!=='anon')throw Error()}catch{throw new Error('Use only a public publishable/anon key')}
 }
 const get=(url,headers={})=>fetcher(url,{method:'GET',headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(6000)})
 const settings=await get(backend+'/auth/v1/settings',{apikey:config.publicKey})
 if(!settings.ok)throw new Error('Auth settings unavailable')
 const auth=await settings.json()
 if(auth.mailer_autoconfirm!==false)throw new Error('Email confirmation must be enabled')
 const info=await get(app+'/api/security/version');if(!info.ok)throw new Error('Application release marker missing')
 const meta=await info.json()
 if(meta.release!==config.expectedRelease||meta.securitySchema!==SECURITY_SCHEMA||meta.backendOrigin!==backend)throw new Error('Application release or backend mismatch')
 const marker=await get(backend+'/rest/v1/rpc/merch_security_release',{apikey:config.publicKey})
 if(!marker.ok||await marker.json()!==SECURITY_SCHEMA)throw new Error('Required database migration missing')
 const probe=await get(backend+'/rest/v1/rpc/get_employee_merch_access?p_email=deployment-check-nonexistent%40example.invalid',{apikey:config.publicKey})
 if(![401,403].includes(probe.status))throw new Error('Anonymous employee RPC must return 401/403')
 return {ok:true,release:config.expectedRelease,securitySchema:SECURITY_SCHEMA,emailConfirmation:true,anonymousEmployeeLookup:false}
}
