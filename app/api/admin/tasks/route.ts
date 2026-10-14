import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'
import { tashkentToday } from '@/lib/fulfillment'
export async function GET() {
  const s = await createClient(),
    a = await requireAdmin(s)
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })
  const { data, error } = await s
    .from('order_tasks')
    .select('id,due_on,reserve_until,contacted_at')
    .is('closed_at', null)
  if (error)
    return NextResponse.json(
      { error: 'Не удалось проверить задачи' },
      { status: 500 }
    )
  const today = tashkentToday()
  return NextResponse.json(
    {
      due: (data || []).filter((t) => t.due_on <= today && !t.contacted_at)
        .length,
      overdue: (data || []).filter((t) => t.reserve_until < today).length,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
export async function POST(request: NextRequest) {
  const s = await createClient(),
    a = await requireAdmin(s)
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })
  const b = await request.json()
  if (typeof b.id !== 'string')
    return NextResponse.json({ error: 'Не указана задача' }, { status: 400 })
  const { error } = await s.rpc('admin_contact_visit', { p_id: b.id })
  return NextResponse.json(error ? { error: error.message } : { ok: true }, {
    status: error ? 400 : 200,
  })
}
