import type { OrderStatus } from '@/lib/supabase/types'

export type WorkStatus =
  | 'new'
  | 'assembling'
  | 'ready'
  | 'shipped'
  | 'received'
  | 'closed'
export type WorkflowOrder = { status: OrderStatus; is_remote: boolean }

export const workStatusLabels: Record<WorkStatus, string> = {
  new: 'Заявка',
  assembling: 'Сборка',
  ready: 'Можно забирать',
  shipped: 'Отправка',
  received: 'Получен',
  closed: 'Отменена',
}
export const activeWorkStatuses: WorkStatus[] = [
  'new',
  'assembling',
  'ready',
  'shipped',
  'received',
]

/** Project historical statuses into the four steps without rewriting orders. */
export function workStatus(order: WorkflowOrder): WorkStatus {
  if (order.status === 'cancelled' || order.status === 'rejected')
    return 'closed'
  if (order.status === 'review' || order.status === 'confirmed') return 'new'
  if (order.status === 'ready' && order.is_remote) return 'assembling'
  if (order.status === 'shipped' && !order.is_remote) return 'ready'
  return order.status
}
export function workStatusLabel(order: WorkflowOrder) {
  return workStatusLabels[workStatus(order)]
}
export function workflowSteps(remote: boolean): OrderStatus[] {
  return ['new', 'assembling', remote ? 'shipped' : 'ready', 'received']
}

export type OrderContactData = {
  full_name: string
  email: string | null
  phone: string | null
}
