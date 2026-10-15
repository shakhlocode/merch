import Link from '@/components/ShopLink'
import { shopRedirect } from '@/lib/shop-redirect'
import { createClient } from '@/lib/supabase/server'
import { needsPasswordSetup } from '@/lib/auth'
import AdminProductsClient, {
  type AdminCategory,
  type AdminProduct,
} from './AdminProductsClient'

export default async function AdminProductsPage() {
  const redirect: (path: string) => never = await shopRedirect()

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  if (await needsPasswordSetup(supabase, user.id)) {
    redirect('/set-password')
  }

  const { error: employeeError } = await supabase
    .from('employees')
    .select('id, email, full_name, is_admin')
    .eq('id', user.id)
    .maybeSingle()

  if (employeeError) {
    return (
      <main className="page-error">
        <section className="error-card">
          <div className="error-card-icon">!</div>
          <h1 className="error-title">Не удалось проверить роль</h1>
          <p className="error-text">{employeeError.message}</p>
        </section>
      </main>
    )
  }

  if (!(await supabase.rpc('is_admin', {})).data) {
    return (
      <main className="page-error">
        <section className="error-card">
          <div className="error-card-icon">🔒</div>
          <h1 className="error-title">Доступ запрещён</h1>
          <p className="error-text">
            Эта страница доступна только администраторам.
          </p>
          <Link href="/catalog" className="error-back-link">
            ← Вернуться в каталог
          </Link>
        </section>
      </main>
    )
  }

  const { data: categories, error: categoriesError } = await supabase
    .from('categories')
    .select('id, name, sort')
    .order('sort', { ascending: true })

  if (categoriesError) {
    return (
      <main className="page-error">
        <section className="error-card">
          <div className="error-card-icon">!</div>
          <h1 className="error-title">Не удалось загрузить категории</h1>
          <p className="error-text">{categoriesError.message}</p>
        </section>
      </main>
    )
  }

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select(
      `
      id,
      name,
      description,
      material,
      placement,
      category_id,
      image_url,
      images,
      is_active,
      created_at,
      updated_at,
      categories (
        id,
        name,
        sort
      ),
      product_variants (
        id,
        product_id,
        size,
        color,
        sku,
        total_qty,
        reserved_qty,
        low_stock_threshold,
        is_active,
        created_at,
        updated_at
      )
    `
    )
    .order('name', { ascending: true })

  const { count: orderCount } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })

  if (productsError) {
    return (
      <main className="page-error">
        <section className="error-card">
          <div className="error-card-icon">!</div>
          <h1 className="error-title">Не удалось загрузить товары</h1>
          <p className="error-text">{productsError.message}</p>
        </section>
      </main>
    )
  }

  return (
    <AdminProductsClient
      products={(products ?? []) as AdminProduct[]}
      categories={(categories ?? []) as AdminCategory[]}
      adminEmail={user.email ?? ''}
      orderCount={orderCount ?? 0}
    />
  )
}
