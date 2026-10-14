import { tashkentToday } from '@/lib/fulfillment'
export type VisitReminder = {
  id: string
  order_id: string
  due_on: string
  reserve_until: string
  contacted_at: string | null
}
export function orderAction(
  order: { status: string; is_remote?: boolean },
  task?: VisitReminder,
  today = tashkentToday()
) {
  if (['received', 'cancelled', 'rejected'].includes(order.status))
    return { label: 'Заказ закрыт', needsAction: false }
  if (task && task.reserve_until < today)
    return { label: 'Визит завершён — проверьте резерв', needsAction: true }
  if (task && task.due_on <= today && !task.contacted_at)
    return { label: 'Связаться с приехавшим сотрудником', needsAction: true }
  if (order.status === 'review')
    return { label: 'Проверить заказ', needsAction: true }
  if (['new', 'confirmed', 'assembling'].includes(order.status))
    return { label: 'Подготовить и упаковать', needsAction: true }
  if (order.status === 'ready' && task && task.due_on > today)
    return { label: 'Подготовлен — ждём приезда', needsAction: false }
  if (order.status === 'ready')
    return {
      label: order.is_remote ? 'Согласовать отправку' : 'Выдать по штрихкоду',
      needsAction: true,
    }
  return {
    label: order.is_remote ? 'Ожидаем получения отправки' : 'Заказ в работе',
    needsAction: false,
  }
}
