import 'server-only'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { createClient } from '@/lib/supabase/server'
export type InvitationChoice = 'none' | 'email' | 'code'
export type InvitationResult = {
  id?: string
  employee_id: string
  full_name?: string
  external_id?: string | null
  channel: string
  url?: string
  expires_at?: string
  error?: string
}
export const invitationEmailEnabled = () =>
  process.env.INVITE_EMAIL_ENABLED === 'true'
export const hashSecret = (value: string) =>
  createHash('sha256').update(value).digest('hex')
export const identifierHash = (id: string, code: string) =>
  hashSecret(id + ':' + code.trim().toUpperCase())
export function appOrigin() {
  return new URL(process.env.NEXT_PUBLIC_APP_URL!).origin
}
export async function createInvitations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
  channel: 'email' | 'code'
) {
  const results: InvitationResult[] = []
  // One database request per invitation; callers issue bounded batches.
  for (const employee_id of ids) {
    try {
      const { data: employee, error: readError } = await supabase
        .from('employee_directory')
        .select('external_id')
        .eq('id', employee_id)
        .single()
      if (readError) throw new Error(readError.message)
      if (channel === 'code' && !employee.external_id)
        throw new Error('Для ссылки укажите идентификатор сотрудника')
      const id = randomUUID(),
        token = randomBytes(32).toString('hex')
      const { data, error } = await supabase.rpc('admin_create_invitation', {
        p_id: id,
        p_employee_id: employee_id,
        p_token_hash: hashSecret(token),
        p_code_hash: identifierHash(
          id,
          employee.external_id || randomBytes(16).toString('hex')
        ),
        p_channel: channel,
      })
      if (error) throw new Error(error.message)
      results.push({
        employee_id,
        id,
        channel,
        full_name: data.full_name,
        external_id: data.external_id,
        expires_at: data.expires_at,
        ...(channel === 'code'
          ? { url: appOrigin() + '/invite#' + token }
          : {}),
      })
    } catch (e) {
      results.push({
        employee_id,
        channel,
        error:
          e instanceof Error ? e.message : 'Не удалось создать приглашение',
      })
    }
  }
  return results
}
