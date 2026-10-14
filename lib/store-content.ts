export type StoreScope = 'catalog' | 'welcome'
export const defaultStoreContent = {
  catalog_rules:
    'До 3 уникальных товаров.\nПо 1 штуке каждого товара.\nОдин товар — один размер и цвет.\nПолучение — в офисе. Для удалённых сотрудников — по согласованию.',
  welcome_rules:
    'Выберите до 3 товаров для своего Welcome pack.\nПо 1 штуке каждого товара.\nВыберите нужный размер и цвет.\nПолучение — только лично в офисе. Выберите офис при оформлении.',
  pickup_message:
    'Спасибо за заказ! Дату, время и место раздачи объявим во внутрикоме — следите за обновлениями.',
  shipping_message:
    'Спасибо, заказ получен! Ответственный сотрудник свяжется с вами и согласует отправку.',
  visit_message:
    'Спасибо за заказ! Администратор свяжется с вами во время визита в Ташкент.',
  welcome_pickup_message:
    'Ваш Welcome pack заказан! Мы сообщим, когда и где его можно забрать.',
  welcome_shipping_message:
    'Ваш Welcome pack заказан! Ответственный сотрудник свяжется с вами и согласует отправку.',
  welcome_visit_message:
    'Ваш Welcome pack заказан! Мы свяжемся с вами во время визита в Ташкент.',
}
export type StoreContent = typeof defaultStoreContent
export const contentLabels: Record<keyof StoreContent, string> = {
  catalog_rules: 'Правила основного каталога',
  welcome_rules: 'Правила Welcome pack',
  pickup_message: 'Каталог — получение в офисе',
  shipping_message: 'Каталог — удалённая отправка',
  visit_message: 'Каталог — визит в Ташкент',
  welcome_pickup_message: 'Welcome pack — получение в офисе',
  welcome_shipping_message: 'Welcome pack — удалённая отправка',
  welcome_visit_message: 'Welcome pack — визит в Ташкент',
}
export function orderMessage(
  content: StoreContent,
  scope: string | null,
  mode: string | null,
  remote = false
) {
  const prefix = scope === 'welcome' ? 'welcome_' : ''
  const kind =
    mode === 'remote_visit'
      ? 'visit'
      : mode === 'remote_shipping' || remote
        ? 'shipping'
        : 'pickup'
  return content[(prefix + kind + '_message') as keyof StoreContent]
}
