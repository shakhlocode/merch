'use client'

import { unitFetch } from '@/lib/shop-context'
import { useState } from 'react'
export default function AccessClosedLogout(){
 const [busy,setBusy]=useState(false)
 return <button type="button" className="btn btn-ghost" disabled={busy} onClick={async()=>{setBusy(true);await unitFetch('/api/auth/logout',{method:'POST'});window.location.href='/login'}}>{busy?'Выходим…':'Выйти из аккаунта'}</button>
}
