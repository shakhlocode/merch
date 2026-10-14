import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
export async function GET() {
 const supabase=await createClient()
 const {data:{user}}=await supabase.auth.getUser()
 if(!user)return NextResponse.json({allowed:false},{status:401,headers:{'Cache-Control':'no-store'}})
 const {data,error}=await supabase.rpc('has_system_access',{})
 if(error)return NextResponse.json({error:'Не удалось проверить доступ'},{status:503,headers:{'Cache-Control':'no-store'}})
 return NextResponse.json({allowed:!!data},{headers:{'Cache-Control':'no-store'}})
}
