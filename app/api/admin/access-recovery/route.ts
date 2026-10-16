import { NextResponse, type NextRequest } from 'next/server'
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'
import { appOrigin, hashSecret, identifierHash } from '@/lib/invitations'
export async function POST(request: NextRequest) {
  const client = await createClient(), admin = await requireAdmin(client)
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  try {
    const body = await request.json()
    if (typeof body.employee_id !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.employee_id)) return NextResponse.json({ error: 'Выберите сотрудника' }, { status: 400 })
    const { data: employee } = await client.from('employee_directory').select('external_id').eq('id', body.employee_id).single()
    if (!employee?.external_id) return NextResponse.json({ error: 'Для восстановления нужен идентификатор сотрудника' }, { status: 400 })
    const id = randomUUID(), token = randomBytes(32).toString('hex')
    const { data, error } = await client.rpc('admin_recover_browser_access', { p_employee_id: body.employee_id, p_id: id, p_token_hash: hashSecret(token), p_code_hash: identifierHash(id, employee.external_id) })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ url: appOrigin() + (data.store_scope === 'welcome' ? '/welcome/invite#' : '/invite#') + token }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: 'Не удалось восстановить доступ' }, { status: 400 }) }
}
