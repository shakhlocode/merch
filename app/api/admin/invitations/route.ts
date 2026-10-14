import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'
import {
  createInvitations,
  appOrigin,
  invitationEmailEnabled,
} from '@/lib/invitations'
import { privilegedClient, isolatedAuthClient } from '@/lib/supabase/admin'
export const maxDuration = 60
export async function GET() {
  const supabase = await createClient(),
    admin = await requireAdmin(supabase)
  if (!admin.ok)
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  const { data, error } = await supabase
    .from('employee_invitations')
    .select(
      'id,store_scope,employee_directory_id,channel,expires_at,claimed_at,revoked_at,delivery_status,delivery_error'
    )
    .order('created_at', { ascending: false })
    .limit(200)
  return error
    ? NextResponse.json({ error: error.message }, { status: 400 })
    : NextResponse.json({
        email_enabled: invitationEmailEnabled(),
        invitations: data,
      })
}
export async function POST(request: NextRequest) {
  const supabase = await createClient(),
    admin = await requireAdmin(supabase)
  if (!admin.ok)
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  const body = await request.json()
  if (body.action === 'create') {
    if (
      !Array.isArray(body.ids) ||
      !body.ids.length ||
      body.ids.length > 20 ||
      !['email', 'code'].includes(body.channel) || (body.scope!==undefined&&!['catalog','welcome'].includes(body.scope))
    )
      return NextResponse.json(
        { error: 'Укажите до 20 сотрудников и тип приглашения' },
        { status: 400 }
      )
    return NextResponse.json(
      {
        invitations: await createInvitations(supabase, body.ids, body.channel,body.scope||'catalog'),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }
  if (body.action === 'retry_failed') {
    const service = privilegedClient()
    await service
      .from('employee_invitations')
      .update({ delivery_status: 'queued', delivery_error: null })
      .eq('delivery_status', 'failed')
      .is('revoked_at', null)
      .is('claimed_at', null)
      .gt('expires_at', new Date().toISOString())
    await service
      .from('employee_invitations')
      .update({ delivery_status: 'queued', delivery_error: null })
      .eq('delivery_status', 'sending')
      .lt('delivery_started_at', new Date(Date.now() - 300000).toISOString())
      .is('revoked_at', null)
      .is('claimed_at', null)
      .gt('expires_at', new Date().toISOString())
    return NextResponse.json({ ok: true })
  }
  if (body.action === 'deliver') {
    if (!invitationEmailEnabled())
      return NextResponse.json(
        {
          error:
            'Корпоративный SMTP ещё не подключён. Приглашения сохранены в очереди.',
        },
        { status: 503 }
      )
    const service = privilegedClient()
    const { data: jobs, error } = await service
      .from('employee_invitations')
      .select('id,employee_directory_id')
      .eq('channel', 'email')
      .eq('delivery_status', 'queued')
      .is('claimed_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .limit(5)
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    let sent = 0,
      failed = 0
    for (const job of jobs || []) {
      const { data: locked } = await service
        .from('employee_invitations')
        .update({
          delivery_status: 'sending',
          delivery_started_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('delivery_status', 'queued')
        .select('id')
        .maybeSingle()
      if (!locked) continue
      try {
        const { data: employee, error: employeeError } = await service
          .from('employee_directory')
          .select('email,is_active')
          .eq('id', job.employee_directory_id)
          .single()
        if (employeeError || !employee?.is_active)
          throw new Error('recipient_unavailable')
        const { error: sendError } =
          await isolatedAuthClient().auth.signInWithOtp({
            email: employee.email,
            options: {
              emailRedirectTo: appOrigin() + '/invite/accept?id=' + job.id,
            },
          })
        if (sendError) throw sendError
        await service
          .from('employee_invitations')
          .update({ delivery_status: 'sent', delivery_error: null })
          .eq('id', job.id)
        sent++
      } catch {
        await service
          .from('employee_invitations')
          .update({
            delivery_status: 'failed',
            delivery_error:
              'Почтовый сервис отклонил отправку. Проверьте SMTP и лимиты.',
          })
          .eq('id', job.id)
        failed++
      }
    }
    return NextResponse.json({ sent, failed, processed: sent + failed })
  }
  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}
