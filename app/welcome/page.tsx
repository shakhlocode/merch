import ProductImage from '@/components/ProductImage'
import AppNav from '@/components/AppNav'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { needsPasswordSetup } from '@/lib/auth'

export default async function WelcomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (await needsPasswordSetup(supabase, user.id)) redirect('/set-password')

  const { data: employee } = await supabase
    .from('employees')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle()

  const isAdmin = Boolean(employee?.is_admin)
  const { data: products, error } = await supabase.from('products')
    .select('id, name, description, image_url, images, product_variants(size, is_active)')
    .eq('is_active', true).in('placement', ['welcome', 'both']).order('name')


  return (
    <div>
      {/* ── Header ── */}
      <header className="site-head">
        <div className="site-head-glass" aria-hidden="true" />
        <div className="head-inner">
          <Link href="/catalog" className="brand">
            <span className="brand-mark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/uzum-big-logo.webp" alt="Uzum" />
            </span>
            <span className="brand-name">
              uzum <span className="brand-name-soft">мерч</span>
            </span>
            <span className="brand-sub">welcome-pack</span>
          </Link>

          <AppNav isAdmin={isAdmin} showLogout />
        </div>
      </header>

      <div className="welcome">

        <section className="welcome-intro">
          <span className="kicker">Для новых сотрудников</span>
          <h1 className="section-title">Welcome-pack</h1>
          <p className="lead">Здесь — товары стартового набора. Получение и нужные размеры согласуйте с администратором.</p>
        </section>

        {/* ── Box contents ── */}
        <section className="welcome-section">
          <h2 className="section-title">Внутри коробки</h2>
          <div className="welcome-grid">
            {error ? <p role="alert">Не удалось загрузить товары. Обновите страницу.</p> : !products?.length ? <p>Состав Welcome-pack скоро появится.</p> : products.map(item => {
              const image = item.image_url || item.images?.[0]
              const sizes = [...new Set(item.product_variants.filter(v => v.is_active).map(v => v.size).filter(Boolean))]
              return <article key={item.id} className="welcome-card">
                <div className="welcome-card-art welcome-product-art">{image ? <ProductImage src={image} alt={item.name} sizes="(max-width: 640px) 50vw, 240px" /> : <span aria-hidden="true">🎁</span>}</div>
                <h3>{item.name}</h3>
                {item.description && <p>{item.description}</p>}
                {sizes.length > 0 && <p>Размеры: {sizes.join(', ')}</p>}
              </article>
            })}
          </div>
        </section>

        {/* ── CTA ── */}
        <div className="welcome-cta">
          <p>
            Другой мерч можно выбрать в основном каталоге.
          </p>
          <Link href="/catalog" className="btn btn-accent btn-lg">
            Перейти в каталог
          </Link>
        </div>

      </div>
    </div>
  )
}
