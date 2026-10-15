
import ShopAnchor from '@/components/ShopAnchor'
import type { OrderContactData } from '@/lib/order-workflow'

export default function OrderContact({
  contact,
}: {
  contact?: OrderContactData | null
}) {
  return (
    <div className="order-contact">
      <b>Ответственный по заказу</b>
      {contact ? (
        <>
          <span>{contact.full_name || contact.email || 'Администратор'}</span>
          {contact.email && (
            <ShopAnchor href={'mailto:' + encodeURIComponent(contact.email)}>
              {contact.email}
            </ShopAnchor>
          )}
          {contact.phone && (
            <ShopAnchor href={'tel:' + contact.phone.replace(/[^\d+]/g, '')}>
              {contact.phone}
            </ShopAnchor>
          )}
          {!contact.email && !contact.phone && (
            <span>Контактные данные пока не заполнены.</span>
          )}
        </>
      ) : (
        <span>
          Ответственный пока не назначен. Администратор добавит его контакт.
        </span>
      )}
    </div>
  )
}
