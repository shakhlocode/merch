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
            <a href={'mailto:' + encodeURIComponent(contact.email)}>
              {contact.email}
            </a>
          )}
          {contact.phone && (
            <a href={'tel:' + contact.phone.replace(/[^\d+]/g, '')}>
              {contact.phone}
            </a>
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
