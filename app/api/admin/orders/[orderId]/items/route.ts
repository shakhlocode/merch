import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'
import { orderError } from '@/lib/order-errors'

export async function PUT(request: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  const supabase = await createClient()
  const access = await requireAdmin(supabase)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const { orderId } = await context.params
  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 }) }
  if (!body || !Number.isInteger(body.version) || !Array.isArray(body.items) || body.items.some((i: { variant_id?: unknown; qty?: unknown } | null) =>
    !i || typeof i.variant_id !== 'string' || i.qty !== 1)) {
    return NextResponse.json({ error: 'Некорректный состав заказа' }, { status: 400 })
  }
  const { data, error } = await supabase.rpc('admin_replace_order_items', {
    p_order_id: orderId, p_items: body.items, p_expected_version: body.version,
  })
  if (error) return NextResponse.json({ error: orderError(error.message) }, { status: 409 })
  return NextResponse.json({ ok: true, order: data })
}
