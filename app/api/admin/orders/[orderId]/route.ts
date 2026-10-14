import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'
import { orderError } from '@/lib/order-errors'
import type { OrderStatus } from '@/lib/supabase/types'

const statuses: OrderStatus[] = ['new','review','confirmed','assembling','ready','shipped','received','cancelled','rejected']
export async function PATCH(request: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  const supabase = await createClient()
  const access = await requireAdmin(supabase)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const { orderId } = await context.params
  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 }) }
  if (!body || !Number.isInteger(body.version) || body.version < 0 || !statuses.includes(body.status)) {
    return NextResponse.json({ error: 'Нужны статус и актуальная версия заказа' }, { status: 400 })
  }
  for (const key of ['admin_comment','tracking_number','storage_location','assigned_to']) {
    if (body[key] != null && typeof body[key] !== 'string') return NextResponse.json({ error: 'Некорректные поля заказа' }, { status: 400 })
  }
  const { data, error } = await supabase.rpc('admin_save_order', {
    p_order_id: orderId, p_status: body.status, p_expected_version: body.version,
    p_admin_comment: body.admin_comment ?? null, p_tracking_number: body.tracking_number ?? null,
    p_storage_location: body.storage_location ?? null, p_assigned_to: body.assigned_to || null,
  })
  if (error) return NextResponse.json({ error: orderError(error.message) }, { status: 409 })
  return NextResponse.json({ ok: true, order: data })
}
