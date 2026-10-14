'use client'

import AppNav from '@/components/AppNav'
import ProductImage from '@/components/ProductImage'
import { getProductLetter } from '@/lib/utils'
import { useMemo, useState } from 'react'

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Types                                                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

export type CatalogVariant = {
  id: string
  size: string | null
  color: string | null
  sku: string | null
  total_qty: number
  reserved_qty: number
  available_qty: number
}

export type CatalogProduct = {
  id: string
  name: string
  description: string | null
  material: string | null
  image_url: string | null
  images: string[]
  category_name: string | null
  variants: CatalogVariant[]
}

type CartItem = {
  product: CatalogProduct
  variant: CatalogVariant
  qty: number
}

type SortMode = 'rec' | 'abc'

type DeliveryType = 'office' | 'pvz' | 'pickup' | 'courier'

type CheckoutDefaults = {
  deliveryType: DeliveryType
  deliveryAddress: string
  phone: string
}

type MerchAccess = {
  isAllowed: boolean
  reason: string
  hiredAt: string | null
  monthsWorked: number | null
}

type CatalogClientProps = {
  products: CatalogProduct[]
  userEmail: string | null
  userName: string | null
  isAdmin: boolean
  checkoutDefaults: CheckoutDefaults
  merchAccess: MerchAccess
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Constants                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

const MAX_UNIQUE_PRODUCTS = 3

/* ─────────────────────────────────────────────────────────────────────────── */
/*  CatalogClient                                                               */
/* ─────────────────────────────────────────────────────────────────────────── */

export default function CatalogClient({
  products,
  userEmail,
  userName,
  isAdmin,
  checkoutDefaults,
  merchAccess,
}: CatalogClientProps) {
  /* Cart */
  const [cart, setCart] = useState<CartItem[]>([])

  /* Checkout form */
  const [deliveryAddress, setDeliveryAddress] = useState(checkoutDefaults.deliveryAddress)
  const [phone,           setPhone]           = useState(checkoutDefaults.phone)
  const [comment,         setComment]         = useState('')
  const [isRemote,        setIsRemote]        = useState(false)
  const [country,         setCountry]         = useState('')
  const [isSubmitting,    setIsSubmitting]    = useState(false)
  const [checkoutError,   setCheckoutError]   = useState<string | null>(null)
  const [checkoutSuccess, setCheckoutSuccess] = useState<string | null>(null)

  /* Filters */
  const [selectedCategory, setSelectedCategory] = useState<string>('Все')
  const [search,           setSearch]           = useState('')
  const [sortMode,         setSortMode]         = useState<SortMode>('rec')

  /* Derived */
  const categories = useMemo(() => {
    const unique = Array.from(
      new Set(products.map(p => p.category_name).filter(Boolean) as string[])
    )
    return ['Все', ...unique]
  }, [products])

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = products.filter(p => {
      const catMatch = selectedCategory === 'Все' || p.category_name === selectedCategory
      const srchMatch =
        q.length === 0 ||
        p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.category_name?.toLowerCase().includes(q) ||
        p.material?.toLowerCase().includes(q)
      return catMatch && srchMatch
    })
    if (sortMode === 'abc') {
      return [...filtered].sort((a, b) =>
        a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' })
      )
    }
    return filtered
  }, [products, selectedCategory, search, sortMode])

  const totalQty      = cart.length
  const firstName     = getUserFirstName(userName, userEmail)
  const initials      = getInitials(userName, userEmail)

  /* Cart actions */
  function isProductInCart(productId: string) {
    return cart.some(item => item.product.id === productId)
  }

  function addToCart(product: CatalogProduct, variant: CatalogVariant) {
    setCheckoutError(null)
    setCheckoutSuccess(null)
    if (variant.available_qty <= 0) {
      alert('Этот товар сейчас недоступен для заказа')
      return
    }
    if (isProductInCart(product.id)) {
      alert('Этот товар уже добавлен в корзину. Можно заказать только 1 единицу одного товара.')
      return
    }
    if (cart.length >= MAX_UNIQUE_PRODUCTS) {
      alert('Можно выбрать не больше трех уникальных позиций мерча.')
      return
    }
    setCart(cur => [...cur, { product, variant, qty: 1 }])
  }

  function removeFromCart(variantId: string) {
    setCart(cur => cur.filter(item => item.variant.id !== variantId))
  }

  /* Checkout */
  async function handleCheckout() {
    if (cart.length === 0) { setCheckoutError('Корзина пустая'); return }
    if (!merchAccess.isAllowed) {
      setCheckoutError(getMerchAccessMessage(merchAccess))
      return
    }
    if (cart.length > MAX_UNIQUE_PRODUCTS) {
      setCheckoutError('Можно выбрать не больше трех уникальных позиций мерча.')
      return
    }

    setIsSubmitting(true)
    setCheckoutError(null)
    setCheckoutSuccess(null)

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items:            cart.map(item => ({ variant_id: item.variant.id, qty: 1 })),
          delivery_type:    'office',
          delivery_address: deliveryAddress,
          phone,
          comment,
          is_remote:        isRemote,
          country:          isRemote ? country : null,
        }),
      })

      const result = await res.json()

      if (!res.ok) {
        setCheckoutError(getCheckoutErrorMessage(result.error))
        return
      }

      setCart([])
      setDeliveryAddress(checkoutDefaults.deliveryAddress)
      setPhone(checkoutDefaults.phone)
      setComment('')
      setCountry('')
      setCheckoutSuccess(
        result.order?.order_number
          ? (isRemote ? `Заказ #${result.order.order_number} принят. Ответственный сотрудник свяжется с вами и сообщит, как получить мерч.` : `Заказ #${result.order.order_number} создан. Ваш штрихкод — в разделе «Мои заказы».`)
          : 'Заказ успешно создан'
      )
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Неизвестная ошибка')
    } finally {
      setIsSubmitting(false)
    }
  }

  /* ── Render ───────────────────────────────────────────────────────────── */

  return (
    <div className="catalog-page">
      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <header className="site-head">
        <div className="site-head-glass" aria-hidden="true" />
        <div className="head-inner">

          <a href="/catalog" className="brand">
            <span className="brand-mark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/uzum-big-logo.webp" alt="Uzum" />
            </span>
            <span className="brand-name">
              uzum <span className="brand-name-soft">мерч</span>
            </span>
          </a>

          <AppNav isAdmin={isAdmin} />

          <div className="head-side">
            {totalQty > 0 && (
              <button
                type="button"
                className="head-cart"
                onClick={() =>
                  document.getElementById('cart-aside')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                }
              >
                Корзина
                <span className="head-cart-badge">{totalQty}</span>
              </button>
            )}

            <a href="/profile" className="head-user">
              <span className="head-user-avatar">{initials}</span>
              <span className="head-user-info">
                <span className="head-user-name">{firstName}</span>
              </span>
            </a>

            <LogoutButton />
          </div>

        </div>
      </header>

      {/* ── CATALOG BODY ────────────────────────────────────────────────── */}
      <div className="catalog">

        <h1 className="sr-only">Каталог Uzum Merch Shop</h1>
        {/* Filters, products and cart */}
        <div className="catalog-body">

          {/* Filters sidebar */}
          <aside className="filters">
            {/* Category nav */}
            <nav className="cat-nav" aria-label="Категории">
              {categories.map(cat => (
                <button
                  key={cat}
                  type="button"
                  className={`cat-pill${selectedCategory === cat ? ' is-on' : ''}`}
                  aria-pressed={selectedCategory === cat}
              onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </nav>


            <div className="filters-block">
              <label className="filters-label" htmlFor="catalog-search">Поиск</label>
              <input
                id="catalog-search"
                className="filters-input"
                placeholder="Худи, шоппер, блокнот…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <details className="filters-note catalog-rules" open>
              <summary className="kicker">Правила</summary>
              <ol>
                <li>До 3 уникальных товаров.</li>
                <li>По 1 штуке каждого товара.</li>
                <li>Один товар — один размер и цвет.</li>
                <li>Получение — в офисе. Для удалённых сотрудников — по согласованию.</li>
              </ol>
            </details>
            {!merchAccess.isAllowed && <div className="form-error" role="status">{getMerchAccessMessage(merchAccess)}</div>}
          </aside>

          {/* Grid area */}
          <main className="grid-wrap">
            <div className="grid-head">
              <div className="grid-count" aria-live="polite">Выбрано <b>{totalQty}</b> из <b className="accent">{MAX_UNIQUE_PRODUCTS}</b></div>
              <div className="grid-sort">
                <label htmlFor="catalog-sort">Сортировка</label>
                <select
                  id="catalog-sort"
                  className="sort-select"
                  value={sortMode}
                  onChange={e => setSortMode(e.target.value as SortMode)}
                >
                  <option value="rec">Рекомендуем</option>
                  <option value="abc">По алфавиту</option>
                </select>
              </div>
            </div>

            <div id="catalog-grid" className="grid-layout">
              <div className="grid grid-cols">
                {filteredProducts.length === 0 ? (
                  <div className="empty">
                    <div className="empty-mark">∅</div>
                    <h3>Товары не найдены</h3>
                    <p>Сбросьте поиск или выберите другую категорию.</p>
                  </div>
                ) : (
                  filteredProducts.map(product => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      isInCart={isProductInCart(product.id)}
                      isBlocked={!merchAccess.isAllowed || cart.length >= MAX_UNIQUE_PRODUCTS}
                      onAddToCart={addToCart}
                    />
                  ))
                )}
              </div>

            </div>
          </main>

              <CartAside
                key={checkoutSuccess ?? 'cart'}
                cart={cart}
                totalQty={totalQty}
                deliveryAddress={deliveryAddress}
                phone={phone}
                comment={comment}
                isRemote={isRemote}
                country={country}
                isSubmitting={isSubmitting}
                checkoutError={checkoutError}
                checkoutSuccess={checkoutSuccess}
                merchAccess={merchAccess}
                onRemove={removeFromCart}
                onDeliveryAddressChange={setDeliveryAddress}
                onPhoneChange={setPhone}
                onCommentChange={setComment}
                onRemoteChange={setIsRemote}
                onCountryChange={setCountry}
                onCheckout={handleCheckout}
              />
        </div>{/* /catalog-body */}
      </div>{/* /catalog */}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  ProductCard                                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

function ProductCard({
  product,
  isInCart,
  isBlocked,
  onAddToCart,
}: {
  product: CatalogProduct
  isInCart: boolean
  isBlocked: boolean
  onAddToCart: (product: CatalogProduct, variant: CatalogVariant) => void
}) {
  const [selectedVariantId, setSelectedVariantId] = useState(
    product.variants[0]?.id ?? ''
  )

  const selectedVariant =
    product.variants.find(v => v.id === selectedVariantId) ??
    product.variants[0]

  const imageUrl = product.image_url || product.images?.[0] || ''
  const hasMultipleVariants = product.variants.length > 1

  const totalAvail  = product.variants.reduce((s, v) => s + v.available_qty, 0)
  const stockClass  = totalAvail > 4 ? 'card-stock-ok' : totalAvail > 0 ? 'card-stock-low' : 'card-stock-out'
  const stockText   = totalAvail > 0 ? `${totalAvail} шт.` : 'Нет в наличии'

  const canAdd = !isBlocked && !isInCart && !!selectedVariant && selectedVariant.available_qty > 0

  return (
    <article className="card">
      <div className="card-art">
        {imageUrl ? (
          <ProductImage
            src={imageUrl}
            alt={product.name}
            sizes="(max-width: 640px) 50vw, (max-width: 900px) 33vw, 300px"
          />
        ) : (
          <div className="card-art-placeholder">
            <div className="card-art-letter">{getProductLetter(product.name)}</div>
          </div>
        )}
        {isInCart && <span className="card-badge card-badge-cart">В корзине</span>}
      </div>

      <div className="card-body">
        <div className="card-top">
          <span className="card-kind">{product.category_name || 'Мерч'}</span>
          <span className={`card-stock ${stockClass}`}>{stockText}</span>
        </div>

        <h3 className="card-name">{product.name}</h3>

        {product.description && (
          <p className="card-desc">{product.description}</p>
        )}

        <label className="variant-label">
          {hasMultipleVariants ? 'Вариант' : 'Размер'}
          <select
            className="variant-select"
            value={selectedVariantId}
            onChange={e => setSelectedVariantId(e.target.value)}
            disabled={isInCart}
          >
            {product.variants.map(v => (
              <option key={v.id} value={v.id}>{formatVariant(v)}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={`card-btn${isInCart ? ' in-cart' : ''}`}
          disabled={!canAdd}
          onClick={() => selectedVariant && onAddToCart(product, selectedVariant)}
        >
          {isInCart ? 'Уже в корзине' : 'Добавить'}
        </button>
      </div>
    </article>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  CartAside                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function CartAside({
  cart,
  totalQty,
  deliveryAddress,
  phone,
  comment,
  isRemote,
  country,
  isSubmitting,
  checkoutError,
  checkoutSuccess,
  merchAccess,
  onRemove,
  onDeliveryAddressChange,
  onPhoneChange,
  onCommentChange,
  onRemoteChange,
  onCountryChange,
  onCheckout,
}: {
  cart: CartItem[]
  totalQty: number
  deliveryAddress: string
  phone: string
  comment: string
  isRemote: boolean
  country: string
  isSubmitting: boolean
  checkoutError: string | null
  checkoutSuccess: string | null
  merchAccess: MerchAccess
  onRemove: (variantId: string) => void
  onDeliveryAddressChange: (value: string) => void
  onPhoneChange: (value: string) => void
  onCommentChange: (value: string) => void
  onRemoteChange: (value: boolean) => void
  onCountryChange: (value: string) => void
  onCheckout: () => void
}) {
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  return (
    <aside className="cart-aside" id="cart-aside">
      <div className="cart-header">
        <div>
          <p className="aside-title">Корзина</p>
        </div>
        <span className="cart-counter">{totalQty} / {MAX_UNIQUE_PRODUCTS} позиции</span>
      </div>

      {checkoutSuccess && <CheckoutSuccessCard message={checkoutSuccess} />}

      {cart.length === 0 ? (
        <div className="cart-empty">
          <svg className="cart-empty-art" width="112" height="112" viewBox="0 0 112 112" fill="none" aria-hidden="true"><path d="m20 44 36-15 36 15-36 16Z" fill="#e9ddff"/><path d="M20 44v39l36 17V60Z" fill="#f1e9ff"/><path d="M92 44v39l-36 17V60Z" fill="#e3d3ff"/><path d="m20 44-12 16 35 15 13-15 13 15 35-15-12-16-36 16Z" fill="#f5efff"/><circle cx="56" cy="26" r="15" fill="#eee4ff"/><path d="M56 19v14m-7-7h14" stroke="#7000ff" strokeWidth="2" strokeLinecap="round"/></svg>
          <strong>Пока пусто</strong>
          <p className="cart-empty-text">
            Добавьте от 1 до 3 товаров из каталога.
          </p>
        </div>
      ) : (
        <>
          <div className="cart-lines">
            {cart.map(item => (
              <div key={item.variant.id} className="cart-line">
                <div className="cart-line-info">
                  <b>{item.product.name}</b>
                  <span className="cart-line-variant">
                    {formatVariant(item.variant)} · 1 шт.
                  </span>
                </div>
                <button
                  type="button"
                  className="cart-line-remove"
                  onClick={() => {
                    if (cart.length === 1) setIsCheckoutOpen(false)
                    onRemove(item.variant.id)
                  }}
                  aria-label={`Удалить ${item.product.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {!isCheckoutOpen && (
            <div className="cart-next-step">
              <p>Контакты и способ получения укажете при оформлении.</p>
              <button type="button" className="checkout-btn" disabled={!merchAccess.isAllowed} onClick={() => setIsCheckoutOpen(true)}>Оформить заказ →</button>
            </div>
          )}
          {isCheckoutOpen && <div className="cart-form">
            <button type="button" className="login-text-button" disabled={isSubmitting} onClick={() => setIsCheckoutOpen(false)}>← Назад к выбору</button>

            <p>Получение в офисе. Для удалённых сотрудников получение согласует ответственный администратор.</p>
            <label className="form-label">
              Адрес / офис / точка получения
              <input
                type="text"
                className="form-input"
                value={deliveryAddress}
                onChange={e => onDeliveryAddressChange(e.target.value)}
                placeholder="Например: Ташкент, офис Сергели"
              />
            </label>

            <label className="form-label">
              Телефон
              <input
                type="tel"
                className="form-input"
                value={phone}
                onChange={e => onPhoneChange(e.target.value)}
                placeholder="+998..."
              />
            </label>

            <label className="form-check">
              <input
                type="checkbox"
                checked={isRemote}
                onChange={e => onRemoteChange(e.target.checked)}
              />
              Я удаленщик (получаю мерч не в офисе)
            </label>

            {isRemote && (
              <label className="form-label">
                Страна
                <input
                  type="text"
                  className="form-input"
                  value={country}
                  onChange={e => onCountryChange(e.target.value)}
                  placeholder="Например: Казахстан"
                />
              </label>
            )}

            <label className="form-label">
              Комментарий
              <textarea
                className="form-textarea"
                value={comment}
                onChange={e => onCommentChange(e.target.value)}
                placeholder="Комментарий к заказу"
              />
            </label>

            {checkoutError && (
              <div className="form-error">{checkoutError}</div>
            )}
            {!merchAccess.isAllowed && (
              <div className="form-error">{getMerchAccessMessage(merchAccess)}</div>
            )}

            <button
              type="button"
              className="checkout-btn"
              disabled={isSubmitting || !merchAccess.isAllowed}
              onClick={onCheckout}
            >
              {isSubmitting ? 'Оформляем…' : 'Оформить заказ'}
            </button>
          </div>}
        </>
      )}
      {cart.length === 0 && <div className="cart-next-step"><p>Контакты и способ получения укажете при оформлении.</p><button type="button" className="checkout-btn" disabled>Оформить заказ →</button></div>}
    </aside>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  CheckoutSuccessCard                                                         */
/* ─────────────────────────────────────────────────────────────────────────── */

function CheckoutSuccessCard({ message }: { message: string }) {
  return (
    <div className="confirm-card">
      <div className="confirm-icon">✓</div>
      <div>
        <div className="confirm-kicker">Заявка оформлена</div>
        <h3 className="confirm-title">{message}</h3>
        <p className="confirm-text">
          Мы сохранили вашу заявку. Статус обработки можно отслеживать в разделе «Мои заказы».
        </p>
        <div className="confirm-actions">
          <a href="/orders" className="confirm-primary-link">Перейти в мои заказы</a>
          <a href="#catalog-grid" className="confirm-ghost-link">Продолжить выбор</a>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  LogoutButton                                                                */
/* ─────────────────────────────────────────────────────────────────────────── */

function LogoutButton() {
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      window.location.href = '/login'
    }
  }

  return (
    <button
      type="button"
      disabled={loggingOut}
      onClick={handleLogout}
      className="logout-btn"
    >
      {loggingOut ? 'Выходим…' : 'Выйти'}
    </button>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Helper functions                                                            */
/* ─────────────────────────────────────────────────────────────────────────── */

function formatVariant(variant: CatalogVariant) {
  const size  = variant.size  || 'ONE SIZE'
  const color = variant.color || 'Без цвета'
  return `${size} · ${color}`
}

function getUserFirstName(fullName: string | null, email: string | null): string {
  const cleaned = fullName?.trim()
  if (cleaned) {
    const parts = cleaned.split(/\s+/).filter(Boolean)
    // ФИО = Фамилия Имя Отчество — берём второе слово как имя
    if (parts.length >= 2) return parts[1]!
    return parts[0] || 'коллега'
  }
  if (!email) return 'коллега'
  const local = email.split('@')[0] ?? 'коллега'
  return (
    local.split(/[._-]/).filter(Boolean)[0]
      ?.replace(/^./, l => l.toUpperCase()) ?? 'коллега'
  )
}

function getInitials(fullName: string | null, email: string | null): string {
  const cleaned = fullName?.trim()
  if (cleaned) {
    const parts = cleaned.split(/\s+/).filter(Boolean)
    // Фамилия Имя → берём первые буквы фамилии и имени
    const a = parts[0]?.[0] ?? ''
    const b = parts[1]?.[0] ?? ''
    const result = `${a}${b}`.toUpperCase()
    if (result) return result
  }
  if (!email) return 'U'
  const local = email.split('@')[0] ?? 'U'
  const parts  = local.split(/[._-]/).filter(Boolean)
  const a = parts[0]?.[0] ?? 'U'
  const b = parts[1]?.[0] ?? ''
  return `${a}${b}`.toUpperCase()
}

function getCheckoutErrorMessage(error: string): string {
  if (error.includes('single_order_pending')) return 'У вас уже есть заказ. Разовый доступ позволяет получить только один заказ.'
  if (error.includes('access_expired') || error.includes('access_order_received')) return 'Доступ закрыт: срок закончился или разовый заказ уже получен.'
  if (error.includes('product_already_ordered'))
    return 'Один из выбранных товаров уже был заказан ранее. Повторный заказ недоступен.'
  if (error.includes('one_unit_per_product_only'))
    return 'Можно заказать только 1 единицу одного товара.'
  if (error.includes('one_variant_per_product_only'))
    return 'Нельзя выбрать несколько вариантов одного товара.'
  if (error.includes('max_unique_products_exceeded'))
    return 'Можно выбрать не больше трех уникальных позиций мерча.'
  if (error.includes('employee_tenure_too_short'))
    return 'Мерч доступен сотрудникам, отработавшим больше 3 месяцев.'
  if (error.includes('employee_not_in_directory') || error.includes('employee_inactive'))
    return 'Ваш доступ к мерчу не найден в HR-реестре. Обратитесь к HR или администратору.'
  if (error.includes('product_is_not_available'))
    return 'Один из выбранных товаров сейчас недоступен для заказа.'
  return error || 'Не удалось оформить заказ'
}

function getMerchAccessMessage(access: MerchAccess) {
  if (access.reason === 'employee_tenure_too_short') {
    return 'Мерч доступен сотрудникам, отработавшим больше 3 месяцев.'
  }

  if (access.reason === 'employee_not_in_directory') {
    return 'Ваш email не найден в HR-реестре сотрудников.'
  }

  if (access.reason === 'employee_inactive') {
    return 'Ваш доступ к мерчу отключен. Обратитесь к HR или администратору.'
  }

  return 'Сейчас оформление мерча недоступно. Обратитесь к HR или администратору.'
}
