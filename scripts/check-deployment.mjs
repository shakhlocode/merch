import {checkDeployment} from '../lib/security/deployment-check.mjs'
try{
 const result=await checkDeployment({appOrigin:process.env.NEXT_PUBLIC_APP_URL,backendOrigin:process.env.NEXT_PUBLIC_SUPABASE_URL,
  expectedAppOrigin:process.env.MERCH_EXPECTED_APP_ORIGIN,expectedBackendOrigin:process.env.MERCH_EXPECTED_SUPABASE_ORIGIN,
  expectedRelease:process.env.MERCH_EXPECTED_RELEASE,publicKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY})
 console.log(JSON.stringify(result))
}catch(error){console.error('Release check FAILED:',error instanceof Error?error.message:'Unavailable');process.exitCode=1}
