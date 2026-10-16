export type PickupOffice = {
  id: string
  name: string
  address: string
  is_active: boolean
  sort: number
  deleted_at?: string | null
}
export type FulfillmentChoice = {
  id: string
  name: string
  mode: 'remote_shipping' | 'remote_visit' | 'pvz' | 'placeholder'
  is_active: boolean
  sort: number
  deleted_at?: string | null
}
export type FulfillmentMode = 'office' | 'remote_shipping' | 'remote_visit' | 'pvz'
export type PickupDetails = {
  mode: FulfillmentMode
  pvzCode: string
  officeId: string
  phone: string
  country: string
  city: string
  comment: string
  visitFrom: string
  visitUntil: string
}
export const DEFAULT_PICKUP_MESSAGE =
  'Спасибо за заказ! Дату, время и место раздачи объявим во внутрикоме — следите за обновлениями.'
export const fulfillmentLabel = (mode: string | null, remote = false) =>
  mode === 'pvz' ? 'Заберу в своём ПВЗ' : mode === 'remote_visit'
    ? 'Удалённо · заберу в Ташкенте'
    : mode === 'remote_shipping' || remote
      ? 'Удалённо · отправка'
      : 'Работаю в офисе'
export const tashkentToday = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })
