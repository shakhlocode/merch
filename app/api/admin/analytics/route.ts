import {NextResponse,type NextRequest} from 'next/server'
import {createClient} from '@/lib/supabase/server'
import {requireAdmin} from '@/lib/admin'
import {tashkentToday} from '@/lib/fulfillment'
import {analyticsCsv,emptyHandout,reportFilters,reportNames,type ReportName,type HandoutReport,type StockRow} from '@/lib/analytics'

export async function GET(request:NextRequest) {
  const supabase=await createClient(),access=await requireAdmin(supabase)
  if(!access.ok)return NextResponse.json({error:access.error},{status:access.status})
  let filters
  try{filters=reportFilters(request.nextUrl.searchParams)}catch(e){return NextResponse.json({error:(e as Error).message},{status:400})}
  const name=request.nextUrl.searchParams.get('report')||'items'
  if(!Object.hasOwn(reportNames,name))return NextResponse.json({error:'Неизвестный отчёт'},{status:400})
  const stockReport=name==='stock'||name==='alerts'
  const {data,error}=stockReport?await supabase.rpc('admin_stock_report',{p_query:filters.q}):await supabase.rpc('admin_handout_report',{p_from:filters.from,p_until:filters.until,p_scope:filters.scope,p_mode:filters.mode,p_query:filters.q})
  if(error)return NextResponse.json({error:'Не удалось сформировать отчёт. Попробуйте ещё раз.'},{status:500})
  const csv=analyticsCsv(name as ReportName,stockReport?emptyHandout:data as HandoutReport,stockReport?data as StockRow[]:[],filters)
  const period=stockReport?'current-'+tashkentToday():filters.from+'-'+filters.until
  return new Response(csv,{headers:{'Content-Type':'text/csv;charset=utf-8;','Content-Disposition':`attachment; filename="uzum-merch-${name}-${period}.csv"`,'Cache-Control':'no-store'}})
}
