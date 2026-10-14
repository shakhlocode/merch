import type { StoreScope } from '@/lib/store-content'
import type { InvitationResult } from '@/lib/invitations'
export async function buildInvitationBatches(
  ids: string[],
  channel: 'email' | 'code',
  scope: StoreScope = 'catalog'
) {
  const results: InvitationResult[] = []
  for (let i = 0; i < ids.length; i += 20) {
    try {
      const response = await fetch('/api/admin/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          ids: ids.slice(i, i + 20),
          channel,
          scope,
        }),
      })
      const data = await response.json()
      if (!response.ok)
        throw new Error(data.error || 'Ошибка создания приглашений')
      results.push(...data.invitations)
    } catch (e) {
      results.push(
        ...ids.slice(i, i + 20).map((employee_id) => ({
          employee_id,
          channel,
          error: e instanceof Error ? e.message : 'Ошибка',
        }))
      )
    }
  }
  return results
}
