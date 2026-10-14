import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { privilegedClient } from '@/lib/supabase/admin'
export async function POST(request: NextRequest) {
  const client = await createClient(),
    {
      data: { user },
    } = await client.auth.getUser()
  if (!user)
    return NextResponse.json(
      { error: 'Подтвердите вход по ссылке из письма' },
      { status: 401 }
    )
  const body = await request.json()
  if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.id))
    return NextResponse.json({ error: 'Неверное приглашение' }, { status: 400 })
  const service = privilegedClient()
  const { error } = await service.rpc('claim_invitation', {
    p_id: body.id,
    p_user_id: user.id,
    p_code_hash: null,
  })
  if (error)
    return NextResponse.json(
      {
        error:
          'Приглашение уже использовано, истекло или вы вошли с другой почтой',
      },
      { status: 409 }
    )
  return NextResponse.json({ ok: true, next: '/catalog' })
}
