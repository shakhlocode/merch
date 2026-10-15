import {createClient} from '@/lib/supabase/server'
import {requireAdmin} from '@/lib/admin'
import {shopRedirect} from '@/lib/shop-redirect'
import AdminShell from '@/components/AdminShell'
import ShopsClient,{type Roles,type Overview} from './ShopsClient'
import type {ShopContext} from '@/lib/shop-context'
export default async function Page() {
  const s=await createClient(),a=await requireAdmin(s)
  const redirect: (path:string)=>never=await shopRedirect()
  if(!a.ok)redirect('/login')
  if(!(await s.rpc('is_super_admin',{})).data)return <AdminShell adminEmail={a.user.email||''} title="Магазины"><p>Этот раздел доступен суперадминистратору.</p></AdminShell>
  const [context,roles,stock]=await Promise.all([s.rpc('my_shop_context',{}),s.rpc('super_admin_roles',{}),s.rpc('super_stock_overview',{})])
  return <AdminShell adminEmail={a.user.email||''} title="Магазины и администраторы">
    {context.error||roles.error||stock.error?<p role="alert">Не удалось загрузить настройки магазинов.</p>:<ShopsClient context={context.data as ShopContext} roles={roles.data as Roles} overview={stock.data as Overview} email={a.user.email||''}/>}
  </AdminShell>
}
