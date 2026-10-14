'use client'

import AppNav from '@/components/AppNav'
import ProductImage from '@/components/ProductImage'
import { decline, getProductLetter } from '@/lib/utils'
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
  userDepartment: string | null
  isAdmin: boolean
  checkoutDefaults: CheckoutDefaults
  merchAccess: MerchAccess
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Constants                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

const deliveryLabels: Record<DeliveryType, string> = {
  office:  'В офис',
  pvz:     'ПВЗ / филиал',
  pickup:  'Самовывоз',
  courier: 'Курьер',
}

const MAX_UNIQUE_PRODUCTS = 3

/* ─────────────────────────────────────────────────────────────────────────── */
/*  CatalogClient                                                               */
/* ─────────────────────────────────────────────────────────────────────────── */

export default function CatalogClient({
  products,
  userEmail,
  userName,
  userDepartment,
  isAdmin,
  checkoutDefaults,
  merchAccess,
}: CatalogClientProps) {
  /* Cart */
  const [cart, setCart] = useState<CartItem[]>([])

  /* Checkout form */
  const [deliveryType,    setDeliveryType]    = useState<DeliveryType>(checkoutDefaults.deliveryType)
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
  const categoryCount = Math.max(0, categories.length - 1)

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
    <div>
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
            <span className="brand-sub">внутренний портал</span>
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
                <span className="head-user-team">{userEmail}</span>
              </span>
            </a>

            <LogoutButton />
          </div>

        </div>
      </header>

      {/* ── CATALOG BODY ────────────────────────────────────────────────── */}
      <div className="catalog">

        {/* Hero */}
        <section className="hero">
          <div className="hero-greeting">
            <span className="kicker">Корпоративный магазин · uzum</span>
            <h1 className="display">
              Привет, {firstName}.<br />
              <em>Что-нибудь</em> подберём?
            </h1>
            <p className="lead">
              Здесь корпоративный мерч, канцелярия и подарочные наборы.
              Бесплатно — нужно только оставить заявку.{' '}
              Можно выбрать <b>до трех уникальных позиций</b>; разные размеры одного товара считаются одной позицией.
            </p>
            {!merchAccess.isAllowed && (
              <div className="form-error form-error-hero">
                {getMerchAccessMessage(merchAccess)}
              </div>
            )}
            <div className="hero-actions">
              <button
                type="button"
                className="btn btn-accent btn-lg"
                onClick={() =>
                  document.getElementById('catalog-grid')
                    ?.scrollIntoView({ behavior: 'smooth' })
                }
              >
                Посмотреть каталог ↓
              </button>
              <a href="/orders" className="btn btn-ghost btn-lg">
                Мои заказы →
              </a>
            </div>
          </div>

          <aside className="hero-quota">
            <span className="kicker">Профиль</span>
            <div className="profile-mini">
              <div className="profile-mini-row">
                <span>ФИО</span>
                <b>{userName || '—'}</b>
              </div>
              <div className="profile-mini-row">
                <span>Email</span>
                <b>{userEmail || '—'}</b>
              </div>
              {userDepartment && (
                <div className="profile-mini-row">
                  <span>Отдел</span>
                  <b>{userDepartment}</b>
                </div>
              )}
              <div className="profile-mini-row">
                <span>Город / офис</span>
                <b>{deliveryAddress || '—'}</b>
              </div>
            </div>
            <p className="quota-hint">
              Доставка по умолчанию — в офис. Изменить можно при оформлении заказа.
            </p>
          </aside>
        </section>

        {/* Category nav */}
        <nav className="cat-nav" aria-label="Категории">
          {categories.map(cat => (
            <button
              key={cat}
              type="button"
              className={`cat-pill${selectedCategory === cat ? ' is-on' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </nav>

        {/* Catalog body: filters + grid */}
        <div className="catalog-body">

          {/* Filters sidebar */}
          <aside className="filters">
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

            <div className="filters-note">
              <span className="kicker">Правила</span>
              <p>Один товар = одна штука. Нельзя заказать несколько единиц или несколько вариантов одного товара.</p>
              <p>Максимум — 3 уникальные позиции. Мерч доступен сотрудникам со стажем больше 3 месяцев.</p>
            </div>

            <div className="filters-note">
              <span className="kicker">Каталог</span>
              <p>
                Сейчас доступно {products.length}{' '}
                {decline(products.length, ['товар', 'товара', 'товаров'])} в{' '}
                {categoryCount}{' '}
                {decline(categoryCount, ['категории', 'категориях', 'категориях'])}.
              </p>
            </div>
          </aside>

          {/* Grid area */}
          <main className="grid-wrap">
            <div className="grid-head">
              <div className="grid-count">
                <span className="num">{filteredProducts.length}</span>{' '}
                {decline(filteredProducts.length, ['товар', 'товара', 'товаров'])}
              </div>
              <div className="grid-sort">
                <span className="kicker">Сортировка</span>
                <select
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

              <CartAside
                cart={cart}
                totalQty={totalQty}
                deliveryType={deliveryType}
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
                onDeliveryTypeChange={setDeliveryType}
                onDeliveryAddressChange={setDeliveryAddress}
                onPhoneChange={setPhone}
                onCommentChange={setComment}
                onRemoteChange={setIsRemote}
                onCountryChange={setCountry}
                onCheckout={handleCheckout}
              />
            </div>
          </main>

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
  deliveryType,
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
  deliveryType: DeliveryType
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
  onDeliveryTypeChange: (value: DeliveryType) => void
  onDeliveryAddressChange: (value: string) => void
  onPhoneChange: (value: string) => void
  onCommentChange: (value: string) => void
  onRemoteChange: (value: boolean) => void
  onCountryChange: (value: string) => void
  onCheckout: () => void
}) {
  return (
    <aside className="cart-aside" id="cart-aside">
      <div className="cart-header">
        <div>
          <p className="aside-title">Корзина</p>
          <p className="cart-subtitle">
            {cart.length > 0
              ? `${cart.length} ${decline(cart.length, ['товар', 'товара', 'товаров'])}`
              : 'Пока пусто'}
          </p>
        </div>
        <span className="cart-counter">{totalQty}</span>
      </div>

      {checkoutSuccess && <CheckoutSuccessCard message={checkoutSuccess} />}

      {cart.length === 0 ? (
        <div className="cart-empty">
          <div className="cart-empty-mark">+</div>
          <p className="cart-empty-text">
            Добавьте товары из каталога, чтобы оформить заявку.
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
                  onClick={() => onRemove(item.variant.id)}
                  aria-label={`Удалить ${item.product.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="cart-summary">
            <div className="sum-row"><span>Товаров</span><b>{cart.length}</b></div>
            <div className="sum-row"><span>Лимит</span><b>{cart.length}/{MAX_UNIQUE_PRODUCTS}</b></div>
            <div className="sum-row"><span>Количество</span><b>{cart.length} шт.</b></div>
            <div className="sum-row"><span>Получение</span><b>{deliveryLabels[deliveryType]}</b></div>
          </div>

          <div className="cart-form">
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
          </div>
        </>
      )}
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
