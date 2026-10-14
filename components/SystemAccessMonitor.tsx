'use client'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
export default function SystemAccessMonitor() {
 const pathname=usePathname(), router=useRouter()
 useEffect(()=>{
  if(!['/catalog','/orders','/profile','/welcome'].some(path=>pathname===path||pathname.startsWith(path+'/')))return
  let stopped=false, busy=false
  async function check(){
   if(stopped||busy||document.visibilityState==='hidden')return
   busy=true
   try{const response=await fetch('/api/access',{cache:'no-store'});if(response.ok||response.status===401){const result=await response.json();if(!stopped&&!result.allowed){router.replace('/access-closed');router.refresh()}}}catch{/* Retry on focus or the next interval after a network failure. */}finally{busy=false}
  }
  const timer=setInterval(check,15000)
  window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);check()
  return()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check)}
 },[pathname,router])
 return null
}
