export type AccessMode = 'unlimited' | 'until_date' | 'one_order'
export function accessFields(mode: unknown = 'unlimited', until?: unknown, allowPast = false) {
  if (!['unlimited','until_date','one_order'].includes(String(mode))) throw new Error('Выберите тип доступа')
  let expires: string | null = null
  if (mode === 'until_date') {
    if (typeof until !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error('Укажите дату окончания доступа')
    const parsed = new Date(`${until}T00:00:00+05:00`)
    if (!Number.isFinite(parsed.getTime()) || new Date(parsed.getTime()+5*3600000).toISOString().slice(0,10) !== until) throw new Error('Некорректная дата')
    expires = new Date(parsed.getTime()+86400000).toISOString()
    if (!allowPast && new Date(expires).getTime() <= Date.now()) throw new Error('Дата окончания доступа уже прошла')
  }
  return { access_mode: mode as AccessMode, access_expires_at: expires }
}
export function accessUntil(expires: string | null) {
  return expires ? new Date(new Date(expires).getTime()-1).toLocaleDateString('en-CA',{timeZone:'Asia/Tashkent'}) : ''
}

export function directoryAccessOpen(employee: { is_active: boolean; access_mode: string; access_used_at: string | null; access_expires_at: string | null; invitation_required?: boolean; invitation_user_id?: string | null; invitation_one_order?: boolean }) {
 return employee.is_active && (!employee.invitation_required || !!employee.invitation_user_id) && (!employee.invitation_one_order || !employee.access_used_at) && (employee.access_mode !== 'one_order' || !employee.access_used_at) && (employee.access_mode !== 'until_date' || !!employee.access_expires_at && new Date(employee.access_expires_at).getTime() > Date.now())
}
