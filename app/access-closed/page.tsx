import AccessClosedLogout from '@/components/AccessClosedLogout'
import Link from 'next/link'
export default function AccessClosedPage(){
 return <main className="page-error"><section className="error-card">
  <h1 className="error-title">Доступ к магазину закрыт</h1>
  <p className="error-text">Возможно, срок доступа закончился, разовый заказ уже получен или ваша почта ещё не добавлена в реестр. Для продления обратитесь к администратору.</p>
  <p><a href="mailto:s.xamrayeva@uzum.com">Связаться с нами</a></p>
  <p><Link href="/catalog">Проверить доступ ещё раз</Link></p>
  <AccessClosedLogout />
 </section></main>
}
