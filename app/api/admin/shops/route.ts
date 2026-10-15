import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
export async function GET(request:NextRequest) {
  const s=await createClient(),{data:{user}}=await s.auth.getUser()
  if(!user)return NextResponse.json({error:'Войдите в систему'},{status:401})
  const {data:allowed,error:checkError}=await s.rpc('is_super_admin',{})
  if(checkError||!allowed)return NextResponse.json({error:'Нужны права суперадминистратора'},{status:403})
  const view=request.nextUrl.searchParams.get('view')
  if(view!=='roles'&&view!=='stock')return NextResponse.json({error:'Неизвестный запрос'},{status:400})
  const {data,error}=await s.rpc(view==='roles'?'super_admin_roles':'super_stock_overview',{})
  return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json(data,{headers:{'Cache-Control':'no-store'}})
}
export async function POST(request: NextRequest) {
  const s = await createClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return NextResponse.json({error:'Войдите в систему'},{status:401})
  const {data:allowed,error:checkError}=await s.rpc('is_super_admin',{})
  if(checkError||!allowed)return NextResponse.json({error:'Нужны права суперадминистратора'},{status:403})
  let b
  try{b=await request.json()}catch{return NextResponse.json({error:'Неверный запрос'},{status:400})}
  if(b.action==='role') {
    if(typeof b.email!=='string'||typeof b.super!=='boolean'||typeof b.enabled!=='boolean'||(!b.super&&!validId(b.unit)))return NextResponse.json({error:'Проверьте email и магазин'},{status:400})
    const {error}=await s.rpc('super_set_admin',{p_email:b.email,p_unit:b.super?null:b.unit,p_super:b.super,p_enabled:b.enabled})
    return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json({ok:true})
  }
  if(b.action==='transfer') {
    if(b.target_unit!==undefined) {
      if(!validId(b.id)||!validId(b.source)||!validId(b.target_unit)||!Number.isSafeInteger(b.qty)||b.qty<=0)return NextResponse.json({error:'Укажите товар, БЮ и положительное целое количество'},{status:400})
      const {data,error}=await s.rpc('super_transfer_stock_to_unit',{p_id:b.id,p_source:b.source,p_unit:b.target_unit,p_qty:b.qty})
      return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json(data)
    }
    if(!validId(b.id)||!validId(b.source)||!validId(b.target)||!Number.isSafeInteger(b.qty)||b.qty<=0)return NextResponse.json({error:'Укажите товар, склады и положительное целое количество'},{status:400})
    const {data,error}=await s.rpc('super_transfer_stock',{p_id:b.id,p_source:b.source,p_target:b.target,p_qty:b.qty})
    return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json(data)
  }
  return NextResponse.json({error:'Неизвестное действие'},{status:400})
}
function validId(value:unknown):value is string{return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)}
