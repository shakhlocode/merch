import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'
export async function POST(request: NextRequest) {
  const s = await createClient(),
    a = await requireAdmin(s)
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })
  const b = await request.json()
  if (b.action === 'message') {
    if (
      typeof b.message !== 'string' ||
      !b.message.trim() ||
      b.message.length > 4000
    )
      return NextResponse.json(
        { error: 'Введите текст до 4000 символов' },
        { status: 400 }
      )
    const { error } = await s
      .from('merch_settings')
      .update({
        pickup_message: b.message.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
    return NextResponse.json(error ? { error: error.message } : { ok: true }, {
      status: error ? 400 : 200,
    })
  }
  if (b.action === 'office') {
    if (
      typeof b.name !== 'string' ||
      !b.name.trim() ||
      b.name.length > 120 ||
      typeof b.address !== 'string' ||
      b.address.length > 1000
    )
      return NextResponse.json(
        { error: 'Проверьте название и адрес офиса' },
        { status: 400 }
      )
    const fields = {
      name: b.name.trim(),
      address: b.address.trim(),
      is_active: b.is_active !== false,
    }
    const q = b.id
      ? s.from('pickup_offices').update(fields).eq('id', b.id)
      : s.from('pickup_offices').insert(fields)
    const { error } = await q
    return NextResponse.json(error ? { error: error.message } : { ok: true }, {
      status: error ? 400 : 200,
    })
  }
  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}
