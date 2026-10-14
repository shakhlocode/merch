import { requireSystemAccess } from '@/lib/system-access'
import { redirect } from 'next/navigation'
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

export default async function CatalogPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  await requireSystemAccess(supabase)

  if (await needsPasswordSetup(supabase, user.id)) {
    redirect('/set-password')
  }

  const { data: employee } = await supabase
    .from('employees')
    .select('full_name, is_admin, phone, city, office, department, business_unit, hired_at, is_active')
    .eq('id', user.id)
    .maybeSingle()

  const { data: accessRows } = await supabase.rpc('get_employee_merch_access', {
    p_email: user.email ?? '',
  })
  const access = Array.isArray(accessRows) ? accessRows[0] : null

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
    .in('placement', ['catalog', 'both'])
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
          ? product.categories[0]?.name ?? null
          : product.categories?.name ?? null,
        variants,
      }
    })
    .filter((product: CatalogProduct) => product.variants.length > 0)

  return (
    <CatalogClient
      products={products}
      userEmail={user.email ?? null}
      userName={employee?.full_name ?? null}
      isAdmin={Boolean(employee?.is_admin)}
      checkoutDefaults={{
        deliveryType: 'office',
        deliveryAddress: defaultDeliveryAddress,
        phone: employee?.phone ?? '',
      }}
      merchAccess={{
        isAllowed: Boolean(access?.is_allowed),
        reason: access?.reason ?? 'employee_not_in_directory',
        hiredAt: access?.hired_at ?? employee?.hired_at ?? null,
        monthsWorked: access?.months_worked ?? null,
      }}
    />
  )
}
