import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'
import { orderError } from '@/lib/order-errors'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const access = await requireAdmin(supabase)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 }) }
  if (typeof body?.code !== 'string' || !/^\d{20}$/.test(body.code.trim())) {
    return NextResponse.json({ error: orderError('invalid_pickup_code') }, { status: 400 })
  }
  if (body.confirmed !== true || typeof body.order_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.order_id) || !Number.isInteger(body.version) || body.version < 0) {
    return NextResponse.json({ error: 'Сначала отсканируйте код, проверьте заказ и нажмите «Выдать заказ».' }, { status: 400 })
  }
  const { data, error } = await supabase.rpc('admin_confirm_pickup', { p_code: body.code.trim(), p_order_id: body.order_id, p_expected_version: body.version })
  if (error) return NextResponse.json({ error: orderError(error.message) }, { status: 409 })
  return NextResponse.json({ ok: true, receipt: data })
}
