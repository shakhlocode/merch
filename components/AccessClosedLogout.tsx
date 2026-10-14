'use client'
import { useState } from 'react'
export default function AccessClosedLogout(){
 const [busy,setBusy]=useState(false)
 return <button type="button" className="btn btn-ghost" disabled={busy} onClick={async()=>{setBusy(true);await fetch('/api/auth/logout',{method:'POST'});window.location.href='/login'}}>{busy?'Выходим…':'Выйти из аккаунта'}</button>
}
