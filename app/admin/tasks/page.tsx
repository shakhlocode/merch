import { shopRedirect } from '@/lib/shop-redirect'
export default async function Page(){
  const redirect: (path: string) => never = await shopRedirect()
redirect('/admin/orders?work=attention')}
