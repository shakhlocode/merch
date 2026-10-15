import { defaultStoreContent, type StoreScope } from '@/lib/store-content'
import { requireSystemAccess } from '@/lib/system-access'
import { shopRedirect } from '@/lib/shop-redirect'
import { createClient } from '@/lib/supabase/server'
import { needsPasswordSetup } from '@/lib/auth'
import CatalogClient, {
  type CatalogProduct,
  type CatalogVariant,
} from './CatalogClient'

type CatalogQueryVariant = {
  id: string
  size: string | null
  color: string | null
  sku: string | null
  total_qty: number | null
  reserved_qty: number | null
  is_active: boolean | null
}

type CatalogQueryProduct = {
  id: string
  name: string
  description: string | null
  material: string | null
  image_url: string | null
  images: string[] | null
  categories: { name: string | null } | Array<{ name: string | null }> | null
  product_variants: CatalogQueryVariant[] | null
}

export default async function ShopPage({ scope }: { scope: StoreScope }) {
  const redirect: (path: string) => never = await shopRedirect()

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  await requireSystemAccess(supabase)
  const { data: currentScope } = await supabase.rpc('my_store_scope', {})
  const { data: shopAllowed, error: shopError } = await supabase.rpc(
    'has_shop_access',
    { p_scope: scope }
  )
  if (shopError) throw new Error('Не удалось проверить доступ к разделу')
  if (!shopAllowed)
    redirect(currentScope === 'welcome' ? '/welcome' : '/catalog')

  if (await needsPasswordSetup(supabase, user.id)) {
    redirect('/set-password')
  }

  const { data: employee } = await supabase
    .from('employees')
    .select(
      'full_name, is_admin, phone, city, office, department, business_unit, hired_at, is_active'
    )
    .eq('id', user.id)
    .maybeSingle()

  const { data: accessRows } = await supabase.rpc('get_employee_merch_access', {
    p_email: user.email ?? '',
  })
  const access = Array.isArray(accessRows) ? accessRows[0] : null

  const [{ data: offices, error: officesError }, { data: identity }, { data: content }, {data: choices,error:choicesError}] =
    await Promise.all([
      supabase
        .from('pickup_offices')
        .select('*')
        .is('deleted_at', null)
        .order('sort')
        .order('name'),
      supabase.rpc('my_checkout_identity', {}),
      supabase.from('merch_settings').select('*').eq('id', 1).single(),
      supabase.from('fulfillment_choices').select('*').is('deleted_at',null).order('sort').order('name'),
    ])
  if(officesError||choicesError)throw new Error('Не удалось загрузить варианты получения. Обновите страницу.')

  const defaultDeliveryAddress = [employee?.city, employee?.office]
    .filter(Boolean)
    .join(', ')

  const { data, error } = await supabase
    .from('products')
    .select(
      `
      id,
      name,
      description,
      material,
      image_url,
      images,
      is_active,
      categories (
        id,
        name,
        sort
      ),
      product_variants (
        id,
        size,
        color,
        sku,
        total_qty,
        reserved_qty,
        is_active
      )
    `
    )
    .eq('is_active', true)
    .in('placement', [scope, 'both'])
    .order('name', { ascending: true })

  if (error) {
    return (
      <main className="page-error">
        <section className="error-card">
          <div className="error-card-icon">!</div>
          <h1 className="error-title">Не удалось загрузить каталог</h1>
          <p className="error-text">{error.message}</p>
        </section>
      </main>
    )
  }

  const products: CatalogProduct[] = ((data ?? []) as CatalogQueryProduct[])
    .map((product) => {
      const variants: CatalogVariant[] = (product.product_variants ?? [])
        .filter((variant) => variant.is_active)
        .map((variant) => {
          const totalQty = Number(variant.total_qty ?? 0)
          const reservedQty = Number(variant.reserved_qty ?? 0)

          return {
            id: variant.id,
            size: variant.size,
            color: variant.color,
            sku: variant.sku,
            total_qty: totalQty,
            reserved_qty: reservedQty,
            available_qty: Math.max(0, totalQty - reservedQty),
          }
        })
        .filter((variant: CatalogVariant) => variant.available_qty > 0)

      return {
        id: product.id,
        name: product.name,
        description: product.description,
        material: product.material,
        image_url: product.image_url,
        images: Array.isArray(product.images) ? product.images : [],
        category_name: Array.isArray(product.categories)
          ? (product.categories[0]?.name ?? null)
          : (product.categories?.name ?? null),
        variants,
      }
    })
    .filter((product: CatalogProduct) => product.variants.length > 0)

  return (
    <CatalogClient
      scope={scope}
      rules={
        scope === 'welcome'
          ? content?.welcome_rules || defaultStoreContent.welcome_rules
          : content?.catalog_rules || defaultStoreContent.catalog_rules
      }
      products={products}
      offices={offices ?? []}
      choices={choices ?? []}
      identity={{
        full_name: identity?.full_name ?? employee?.full_name ?? null,
        legal_entity: identity?.legal_entity ?? null,
      }}
      userEmail={user.email ?? null}
      userName={employee?.full_name ?? null}
      isAdmin={Boolean((await supabase.rpc('is_admin', {})).data)}
      checkoutDefaults={{
        deliveryType: 'office',
        deliveryAddress: defaultDeliveryAddress,
        phone: employee?.phone ?? '',
      }}
      merchAccess={{
        isAllowed: Boolean(access?.is_allowed && currentScope === scope),
        reason:
          currentScope !== scope
            ? 'scope_not_allowed'
            : (access?.reason ?? 'employee_not_in_directory'),
        hiredAt: access?.hired_at ?? employee?.hired_at ?? null,
        monthsWorked: access?.months_worked ?? null,
      }}
    />
  )
}
