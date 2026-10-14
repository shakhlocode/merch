import { NextResponse, type NextRequest } from 'next/server'
import { privilegedClient, isolatedAuthClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { hashSecret, identifierHash } from '@/lib/invitations'
export const maxDuration = 60
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (
      typeof body.token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.token) ||
      typeof body.identifier !== 'string' ||
      !body.identifier.trim() ||
      body.identifier.length > 128
    )
      return NextResponse.json(
        { error: 'Проверьте ссылку и идентификатор' },
        { status: 400 }
      )
    const service = privilegedClient(),
      tokenHash = hashSecret(body.token)
    // Fetch only on the server, then let the database lock, rate-limit and validate.
    const { data: record } = await service
      .from('employee_invitations')
      .select('id')
      .eq('token_hash', tokenHash)
      .maybeSingle()
    if (!record)
      return NextResponse.json(
        { error: 'Приглашение недоступно' },
        { status: 400 }
      )
    const codeHash = identifierHash(record.id, body.identifier)
    const { data: check, error: checkError } = await service.rpc(
      'check_invitation_code',
      { p_token_hash: tokenHash, p_code_hash: codeHash }
    )
    if (checkError || !check.ok)
      return NextResponse.json(
        {
          error:
            'Неверный идентификатор, приглашение уже использовано или срок истёк',
        },
        { status: 400 }
      )
    // Isolated auth keeps provisional credentials off the response until the claim wins.
    const { data: link, error: linkError } =
      await service.auth.admin.generateLink({
        type: 'magiclink',
        email: 'i-' + record.id + '@guest.merch.invalid',
      })
    if (linkError)
      throw new Error('Не удалось подготовить вход. Повторите попытку.')
    const auth = isolatedAuthClient()
    const { data: verified, error: verifyError } = await auth.auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type:
        link.properties.verification_type === 'signup' ? 'signup' : 'magiclink',
    })
    if (verifyError || !verified.session || !verified.user)
      throw new Error('Не удалось подготовить вход. Повторите попытку.')
    const { error: claimError } = await service.rpc('claim_invitation', {
      p_id: record.id,
      p_user_id: verified.user.id,
      p_code_hash: codeHash,
    })
    if (claimError)
      return NextResponse.json(
        { error: 'Приглашение уже использовано или больше недоступно' },
        { status: 409 }
      )
    const sessionClient = await createClient()
    const { error: sessionError } = await sessionClient.auth.setSession({
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
    })
    if (sessionError)
      throw new Error(
        'Не удалось сохранить вход. Обратитесь к администратору для нового приглашения.'
      )
    return NextResponse.json(
      { ok: true, next: '/catalog' },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Не удалось войти' },
      { status: 400 }
    )
  }
}
