'use client'

import { unitFetch } from '@/lib/shop-context'

import { hasStockAlert, stockThreshold } from '@/lib/stock-alerts'
import AdminShell from '@/components/AdminShell'
import StockTransferButton from '@/components/StockTransferButton'
import ProductImage from '@/components/ProductImage'
import ProductImageUploader from '@/components/ProductImageUploader'
import { decline, getExportDate, getProductLetter, toCsv } from '@/lib/utils'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type AdminCategory = {
  id: string
  name: string
  sort: number
}

export type AdminVariant = {
  id: string
  product_id: string
  size: string | null
  color: string | null
  sku: string | null
  total_qty: number
  reserved_qty: number
  low_stock_threshold: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type AdminProduct = {
  id: string
  name: string
  description: string | null
  placement: string
  material: string | null
  category_id: string | null
  image_url: string | null
  images: string[]
  is_active: boolean
  created_at: string
  updated_at: string
  categories: AdminCategory | AdminCategory[] | null
  product_variants: AdminVariant[]
}

type Props = {
  products: AdminProduct[]
  categories: AdminCategory[]
  adminEmail: string
  orderCount: number
}

type StockFilter = 'all' | 'low' | 'zero' | 'normal'

export default function AdminProductsClient({
  products,
  categories,
  adminEmail,
  orderCount,
}: Props) {
  const searchParams  = useSearchParams()
  const isCardsMode   = searchParams.get('mode') === 'cards'
  const queryFromUrl  = searchParams.get('q') ?? ''

  const [search,            setSearch]           = useState(queryFromUrl)
  const [selectedCategory,  setSelectedCategory] = useState<string>('all')
  const [stockFilter,       setStockFilter]      = useState<StockFilter>('all')
  const [productStatus, setProductStatus] = useState('active')
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null)
  const [editingProductId,  setEditingProductId]  = useState<string | null>(null)
  const [isCreateOpen,      setIsCreateOpen]      = useState(false)

  useEffect(() => { setSearch(queryFromUrl) }, [queryFromUrl])

  const filteredProducts = useMemo(() => {
    const value = search.trim().toLowerCase()

    return products.filter((product) => {
      const stats = getProductStats(product)

      const activeMatch = productStatus === 'all' || (productStatus === 'archive' ? !product.is_active : product.is_active)
      const categoryMatch = selectedCategory === 'all' || product.category_id === selectedCategory
      const stockMatch    =
        stockFilter === 'all' ||
        (stockFilter === 'low'    && stats.lowVariants > 0) ||
        (stockFilter === 'zero'   && stats.zeroVariants > 0) ||
        (stockFilter === 'normal' && stats.lowVariants === 0 && stats.zeroVariants === 0 && stats.availableQty > 0)

      const searchMatch =
        value.length === 0 ||
        product.name.toLowerCase().includes(value) ||
        product.description?.toLowerCase().includes(value) ||
        product.material?.toLowerCase().includes(value) ||
        getCategoryName(product).toLowerCase().includes(value) ||
        product.product_variants.some((v) =>
          [v.size, v.color, v.sku].filter(Boolean).join(' ').toLowerCase().includes(value)
        )

      return activeMatch && categoryMatch && stockMatch && searchMatch
    })
  }, [products, search, selectedCategory, stockFilter, productStatus])

  const totals = useMemo(() => {
    const scoped = products.filter(product => productStatus === 'all' || (productStatus === 'archive' ? !product.is_active : product.is_active))
    const totalProducts  = scoped.length
    const activeProducts = scoped.filter((p) => p.is_active).length
    const totalVariants  = scoped.reduce((s, p) => s + p.product_variants.length, 0)
    const totalQty       = scoped.reduce((s, p) => s + getProductStats(p).totalQty, 0)
    const reservedQty    = scoped.reduce((s, p) => s + getProductStats(p).reservedQty, 0)
    const availableQty   = Math.max(0, totalQty - reservedQty)
    const lowVariants    = scoped.reduce((s, p) => s + getProductStats(p).lowVariants, 0)
    return { totalProducts, activeProducts, totalVariants, totalQty, reservedQty, availableQty, lowVariants }
  }, [products, productStatus])

  function handleExportStockCsv() {
    const rows = filteredProducts.flatMap((product) => {
      const productStats = getProductStats(product)
      const baseRow = {
        product_name:          product.name,
        category:              getCategoryName(product),
        material:              product.material || '',
        product_status:        product.is_active ? 'Активен' : 'В архиве',
        product_total_qty:     String(productStats.totalQty),
        product_reserved_qty:  String(productStats.reservedQty),
        product_available_qty: String(productStats.availableQty),
        product_low_variants:  String(productStats.lowVariants),
        product_zero_variants: String(productStats.zeroVariants),
      }

      if (product.product_variants.length === 0) {
        return [{ ...baseRow, variant_size: '', variant_color: '', sku: '', variant_status: '', total_qty: '', reserved_qty: '', available_qty: '', low_stock_threshold: '', stock_status: 'Нет вариантов' }]
      }

      return product.product_variants.map((variant) => {
        const totalQty     = Number(variant.total_qty)
        const reservedQty  = Number(variant.reserved_qty)
        const availableQty = Math.max(0, totalQty - reservedQty)
        const stockStatus  = availableQty <= 0 ? 'Нет в наличии' : hasStockAlert(variant) ? 'Мало осталось' : 'Достаточно'
        return { ...baseRow, variant_size: variant.size || 'ONE SIZE', variant_color: variant.color || 'Без цвета', sku: variant.sku || '', variant_status: variant.is_active ? 'Активен' : 'В архиве', total_qty: String(totalQty), reserved_qty: String(reservedQty), available_qty: String(availableQty), low_stock_threshold: String(stockThreshold(variant)), stock_status: stockStatus }
      })
    })

    const csv  = toCsv(rows)
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href     = url
    link.download = `uzum-merch-stock-${getExportDate()}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <AdminShell
      adminEmail={adminEmail}
      title={isCardsMode ? 'Карточки товара' : 'Товары и остатки'}
      subtitle="Админ-панель · merch.uzum.tech"
      orderCount={orderCount}
      stockAlertCount={products.filter(p => p.is_active).reduce((sum,p) => sum + getProductStats(p).lowVariants,0)}
    >
      <section className="ap-page">

        <section className="ap-filter-panel" aria-label="Фильтры товаров">
          <label className="ap-filter-field ap-filter-search">Поиск
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Название, размер или SKU" className="ap-input" type="search" />
          </label>
          {categories.length > 0 && <label className="ap-filter-field">Категория
            <select aria-label="Категория" className="ap-input" value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}>
              <option value="all">Все категории</option>
              {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>}
          <label className="ap-filter-field">Остатки
            <select aria-label="Остатки" className="ap-input" value={stockFilter} onChange={e => setStockFilter(e.target.value as StockFilter)}>
              <option value="all">Все остатки</option>
              <option value="low">Мало осталось · по порогам</option>
              <option value="zero">Нет в наличии</option>
              <option value="normal">Достаточно · выше порога</option>
            </select>
          </label>
          <label className="ap-filter-field">Показывать
            <select aria-label="Показывать" className="ap-input" value={productStatus} onChange={e => setProductStatus(e.target.value)}>
              <option value="active">Действующие товары</option>
              <option value="archive">Архив</option>
              <option value="all">Все товары</option>
            </select>
          </label>
        </section>
        <div className="ap-list-actions">
          <span aria-live="polite">Показано {filteredProducts.length} из {products.length} товаров</span>
          <div>
            {!isCardsMode&&<StockTransferButton/>}
            <button type="button" className="ap-export-btn" onClick={handleExportStockCsv} disabled={filteredProducts.length === 0}>Экспорт CSV</button>
            <button type="button" className="ap-new-btn" onClick={() => setIsCreateOpen(v => !v)}>+ Новый товар</button>
          </div>
        </div>

        {/* Create product panel */}
        {isCreateOpen && (
          <CreateProductCard onClose={() => setIsCreateOpen(false)} />
        )}

        {/* Summary strip */}
        <section className="ap-summary-strip ap-summary-compact" aria-label="Сводка выбранного раздела">
          <SummaryMetric label="Всего товаров" value={String(totals.totalProducts)} hint={`Включено: ${totals.activeProducts} · Вариантов: ${totals.totalVariants}`} />
          <SummaryMetric label="На складе" value={`${totals.totalQty} шт.`} />
          <SummaryMetric label="Зарезервировано" value={`${totals.reservedQty} шт.`} />
          <SummaryMetric label="Доступно" value={`${totals.availableQty} шт.`} hint={`Мало осталось: ${totals.lowVariants} ${decline(totals.lowVariants, ['вариант', 'варианта', 'вариантов'])} по настроенным порогам`} />
        </section>

        {/* Content */}
        {filteredProducts.length === 0 ? (
          <section className="ap-empty-card">
            <div className="ap-empty-mark">∅</div>
            <h2 className="ap-empty-title">Товары не найдены</h2>
            <p className="ap-empty-text">Измените поиск, категорию или складской фильтр.</p>
          </section>

        ) : isCardsMode ? (
          <>
            <section className="ap-cards-grid">
              {filteredProducts.map((product) => {
                const isEditing = editingProductId === product.id
                return (
                  <ProductCardMode
                    key={product.id}
                    product={product}
                    isEditing={isEditing}
                    onEdit={() => {
                      setExpandedProductId(null)
                      setEditingProductId(isEditing ? null : product.id)
                    }}
                  />
                )
              })}
            </section>


          </>

        ) : (
          <section className="ap-product-list">
            {filteredProducts.map((product) => {
              const isExpanded = expandedProductId === product.id
              const isEditing  = editingProductId  === product.id

              return (
                <div key={product.id} className="ap-product-group">
                  <ProductRow
                    product={product}
                    isExpanded={isExpanded}
                    isEditing={isEditing}
                    onToggle={() => {
                      setEditingProductId(null)
                      setExpandedProductId(isExpanded ? null : product.id)
                    }}
                    onEdit={() => {
                      setExpandedProductId(null)
                      setEditingProductId(isEditing ? null : product.id)
                    }}
                  />

                </div>
              )
            })}
          </section>
        )}

      </section>
      {products.find(product => product.id === editingProductId) && (
        <ProductEditDialog
          key={editingProductId}
          product={products.find(product => product.id === editingProductId)!}
          onClose={() => setEditingProductId(null)}
        />
      )}
    </AdminShell>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  CreateProductCard                                                            */
/* ─────────────────────────────────────────────────────────────────────────── */

function PlacementSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="ap-label">Где будет отображаться товар?
    <select aria-label="Где будет отображаться товар?" value={value} onChange={e => onChange(e.target.value)} className="ap-input">
      <option value="catalog">В основном каталоге</option>
      <option value="welcome">В Welcome-pack</option>
      <option value="both">В каталоге и Welcome-pack</option>
    </select>
  </label>
}

function CreateProductCard({ onClose }: { onClose: () => void }) {
  const router = useRouter()

  const [name,        setName]        = useState('')
  const [description, setDescription] = useState('')
  const [placement, setPlacement] = useState('catalog')
  const [sizeMode, setSizeMode] = useState('single')
  const [sizes, setSizes] = useState([{ size: 'ONE SIZE', color: '', qty: '' }])
  const total = sizes.reduce((sum, row) => sum + (Number(row.qty) || 0), 0)
  const [imageUrl,    setImageUrl]    = useState('')
  const [isSaving,    setIsSaving]    = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  async function handleCreate() {
    if (!name.trim()) { setError('Укажите название товара'); return }
    if (sizes.some(row => !row.size.trim() || row.qty === '' || !Number.isInteger(Number(row.qty)) || Number(row.qty) < 0)) {
      setError('Укажите каждый размер и целое количество от 0'); return
    }
    setIsSaving(true)
    setError(null)

    try {
      const response = await unitFetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_product',
          name,
          description,
          placement,
          variants: sizes.map(row => ({ ...row, qty: Number(row.qty) })),
          image_url: imageUrl,
          is_active: true,
        }),
      })

      const result = await response.json()
      if (!response.ok) { setError(result.error || 'Не удалось создать товар'); return }

      setName(''); setDescription(''); setImageUrl('')
      onClose()
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="ap-create-card">
      <div className="ap-create-head">
        <div>
          <h2 className="ap-panel-title">Новый товар</h2>
          <p className="ap-panel-hint">Укажите, где показывать товар, его размеры и начальные остатки.</p>
        </div>
        <button type="button" onClick={onClose} className="ap-light-btn">Свернуть</button>
      </div>

      <div className="ap-edit-grid">
        <label className="ap-label">
          Название
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Худи «Команда»" className="ap-input" />
        </label>

        <PlacementSelect value={placement} onChange={setPlacement} />
        <div className="ap-label-wide ap-size-setup">
          <label className="ap-label">Размеры
            <select aria-label="Размеры" className="ap-input" value={sizeMode} onChange={e => {
              setSizeMode(e.target.value)
              setSizes(e.target.value === 'single' ? [{ size: 'ONE SIZE', color: '', qty: '' }] : ['S','M','L'].map(size => ({ size, color: '', qty: '' })))
            }}><option value="single">Один размер</option><option value="range">Размерный ряд</option></select>
          </label>
          <p className="ap-panel-hint">{sizeMode === 'single' ? 'Для товаров без размерного ряда оставьте ONE SIZE.' : 'Укажите каждый размер и количество на складе. Нулевой остаток допустим.'}</p>
          {sizes.map((row, index) => <div key={index} className="ap-size-row">
            <label className="ap-label">Размер<input className="ap-input" aria-label={`Размер ${index + 1}`} value={row.size} onChange={e => setSizes(current => current.map((r, i) => i === index ? { ...r, size: e.target.value } : r))} /></label>
            <label className="ap-label">Цвет · необязательно<input className="ap-input" aria-label={`Цвет ${index + 1}`} value={row.color} onChange={e => setSizes(current => current.map((r, i) => i === index ? { ...r, color: e.target.value } : r))} /></label>
            <label className="ap-label">Количество, шт.<input className="ap-input" type="number" min="0" max="2147483647" step="1" aria-label={`Количество ${index + 1}`} value={row.qty} onChange={e => setSizes(current => current.map((r, i) => i === index ? { ...r, qty: e.target.value } : r))} /></label>
            {sizeMode === 'range' && sizes.length > 1 && <button type="button" className="ap-light-btn" aria-label={`Удалить размер ${index + 1}`} onClick={() => setSizes(current => current.filter((_, i) => i !== index))}>×</button>}
          </div>)}
          {sizeMode === 'range' && <button type="button" className="ap-light-btn" disabled={sizes.length >= 100} onClick={() => setSizes(current => [...current, { size: '', color: '', qty: '' }])}>+ Добавить размер</button>}
          <p className="ap-size-total" aria-live="polite">Всего на складе: <strong>{total} шт.</strong></p>
        </div>

        <label className="ap-label-wide">
          Описание · необязательно
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Описание товара" className="ap-textarea" />
        </label>

        <div className="ap-label-wide">
          <ProductImageUploader value={imageUrl} onChange={setImageUrl} label="Фото товара" />
        </div>
      </div>

      {error && <div className="ap-error">{error}</div>}

      <button type="button" onClick={handleCreate} disabled={isSaving} className="ap-save-btn">
        {isSaving ? 'Создаём...' : 'Создать товар'}
      </button>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  ProductCardMode                                                              */
/* ─────────────────────────────────────────────────────────────────────────── */

function ProductArchiveButton({ product }: { product: AdminProduct }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return <span className="ap-archive-action">
    <button type="button" className="ap-light-btn" disabled={busy} onClick={async event => {
      event.stopPropagation(); setBusy(true); setError(null)
      try {
        const response = await unitFetch('/api/admin/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'archive_product', product_id: product.id, is_active: !product.is_active }) })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Не удалось изменить архив')
        router.refresh()
      } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка') } finally { setBusy(false) }
    }}>{busy ? 'Сохраняем…' : product.is_active ? 'В архив' : 'Восстановить из архива'}</button>
    {error && <span role="alert" className="ap-error">{error}</span>}
  </span>
}

function ProductCardMode({
  product,
  isEditing,
  onEdit,
}: {
  product: AdminProduct
  isEditing: boolean
  onEdit: () => void
}) {
  const stats    = getProductStats(product)
  const imageUrl = product.image_url || product.images?.[0] || ''

  return (
    <article className={`ap-card${isEditing ? ' ap-card-active' : ''}`}>
      <div className="ap-card-img-wrap">
        {imageUrl ? (
          <ProductImage
            src={imageUrl}
            alt={product.name}
            className="ap-card-img"
            sizes="(max-width: 760px) 100vw, 250px"
          />
        ) : (
          <div className="ap-card-placeholder">{getProductLetter(product.name)}</div>
        )}
        <span className={`ap-card-status ${product.is_active ? 'ap-card-status-active' : 'ap-card-status-inactive'}`}>
          {product.is_active ? 'Опубликован' : 'В архиве'}
        </span>
      </div>

      <div className="ap-card-body">
        <div className="ap-card-category">{getCategoryName(product)}</div>
        <h3 className="ap-card-title">{product.name}</h3>
        <p className="ap-card-description">
          {product.description || 'Описание товара пока не заполнено.'}
        </p>

        <div className="ap-card-meta">
          <div className="ap-card-meta-item"><span>Раздел</span><b>{product.placement === 'both' ? 'Каталог и Welcome-pack' : product.placement === 'welcome' ? 'Welcome-pack' : 'Основной каталог'}</b></div>
          <div className="ap-card-meta-item"><span>Вариантов</span><b>{product.product_variants.length}</b></div>
          <div className="ap-card-meta-item"><span>Доступно</span><b>{stats.availableQty} шт.</b></div>
        </div>

        <button
          type="button"
          onClick={onEdit}
          className={`ap-card-btn${isEditing ? ' ap-card-btn-active' : ''}`}
        >
          {isEditing ? 'Редактируется' : 'Редактировать карточку'}
        </button>
        <ProductArchiveButton product={product} />
      </div>
    </article>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  ProductRow                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function ProductRow({
  product,
  isExpanded,
  isEditing,
  onToggle,
  onEdit,
}: {
  product: AdminProduct
  isExpanded: boolean
  isEditing: boolean
  onToggle: () => void
  onEdit: () => void
}) {
  const stats    = getProductStats(product)
  const imageUrl = product.image_url || product.images?.[0] || ''

  return (
    <article className={`ap-product-card${isExpanded ? ' ap-product-card-expanded' : ''}${isEditing ? ' ap-product-card-editing' : ''}`}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        className={`ap-product-row${isExpanded || isEditing ? ' ap-product-row-active' : ''}`}
      >
        <div className="ap-product-art">
          {imageUrl ? (
            <ProductImage
              src={imageUrl}
              alt={product.name}
              className="ap-product-image"
              sizes="64px"
            />
          ) : (
            <div className="ap-product-placeholder">{getProductLetter(product.name)}</div>
          )}
        </div>

        <div className="ap-product-name-cell">
          <span>{getCategoryName(product)}</span>
          <b>{product.name}</b>
          {!product.is_active && <small>Отключён</small>}
        </div>

        <Metric label="Всего на складе"    value={`${stats.totalQty} шт.`} />
        <Metric label="Нет в наличии"   value={String(stats.zeroVariants)} tone="pink" />
        <Metric label="Мало осталось"     value={String(stats.lowVariants)} tone="pink" />
        <Metric label="Вариантов"          value={String(product.product_variants.length)} />

        <div className="ap-row-actions">
          <button
            type="button"
            className={`ap-light-btn${isExpanded ? ' ap-light-btn-active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggle() }}
          >
            Остатки
          </button>

          <button
            type="button"
            className={`ap-light-btn${isEditing ? ' ap-light-btn-active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onEdit() }}
          >
            Редактировать
          </button>

          <ProductArchiveButton product={product} />
          <span className="ap-chevron">{isExpanded ? '⌃' : '⌄'}</span>
        </div>
      </div>

      {isExpanded && (
        <section className="ap-inventory-expanded">
          <VariantsEditor product={product} />
        </section>
      )}
    </article>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  ProductEditPanel                                                             */
/* ─────────────────────────────────────────────────────────────────────────── */

function ProductEditDialog({ product, onClose }: { product: AdminProduct; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousOverflow = document.body.style.overflow
    const previousFocus = document.activeElement
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <dialog ref={dialogRef} className="ap-edit-dialog" aria-labelledby="product-edit-dialog-title"
      onClose={event => {
        // Strict Mode may reopen the dialog before a queued close event arrives.
        if (!event.currentTarget.open) onClose()
      }}
      onKeyDown={event => {
        if (event.key !== 'Tab') return
        const fields = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'))
          .filter(field => !field.matches(':disabled') && field.getClientRects().length > 0)
        const first = fields[0], last = fields[fields.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }}>

      <div className="ap-dialog-header">
        <h2 id="product-edit-dialog-title">Редактирование товара</h2>
        <button type="button" className="ap-dialog-close" aria-label="Закрыть редактирование товара" onClick={onClose}>×</button>
      </div>
      <div className="ap-dialog-body"><ProductEditPanel product={product} /></div>
    </dialog>,
    document.body
  )
}

function ProductEditPanel({ product }: { product: AdminProduct }) {
  const stats    = getProductStats(product)
  const imageUrl = product.image_url || product.images?.[0] || ''

  return (
    <section className="ap-edit-panel">
      <div className="ap-edit-hero">
        <div className="ap-edit-hero-left">
          <div className="ap-product-art">
            {imageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={imageUrl} alt={product.name} className="ap-product-image" />
            ) : (
              <div className="ap-product-placeholder">{getProductLetter(product.name)}</div>
            )}
          </div>
          <div>
            <div className="ap-edit-breadcrumb">Склад / {product.name}</div>
            <h2 className="ap-edit-title">{product.name}</h2>
            <div className="ap-edit-metrics">
              <Metric label="Всего на складе" value={`${stats.totalQty} шт.`} />
              <Metric label="Зарезервировано"          value={`${stats.reservedQty} шт.`} />
              <Metric label="Доступно"        value={`${stats.availableQty} шт.`} />
              <Metric label="Вариантов"       value={String(product.product_variants.length)} />
            </div>
          </div>
        </div>

      </div>

      <section className="ap-expanded">
        <ProductMainEditor product={product} />
        <VariantsEditor product={product} />
      </section>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  ProductMainEditor                                                            */
/* ─────────────────────────────────────────────────────────────────────────── */

function ProductMainEditor({ product }: { product: AdminProduct }) {
  const router = useRouter()

  const [name,        setName]        = useState(product.name)
  const [description, setDescription] = useState(product.description ?? '')
  const [placement, setPlacement] = useState(product.placement ?? 'catalog')
  const [imageUrl,    setImageUrl]    = useState(product.image_url ?? '')
  const [isActive,    setIsActive]    = useState(product.is_active)
  const [isSaving,    setIsSaving]    = useState(false)
  const [message,     setMessage]     = useState<string | null>(null)
  const [error,       setError]       = useState<string | null>(null)

  async function handleUpdateProduct() {
    setIsSaving(true); setMessage(null); setError(null)

    try {
      const response = await unitFetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_product',
          product_id: product.id,
          name, description, placement,
          image_url: imageUrl,
          is_active: isActive,
        }),
      })

      const result = await response.json()
      if (!response.ok) { setError(result.error || 'Не удалось обновить товар'); return }

      setMessage('Товар обновлён')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="ap-editor-card">
      <div className="ap-panel-head">
        <div>
          <h3 className="ap-panel-title">Основное</h3>
          <p className="ap-panel-hint">Измените данные товара и сохраните изменения.</p>
        </div>
        <label className="ap-switch-label">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Товар доступен (не в архиве)
        </label>
      </div>

      <div className="ap-edit-grid">
        <label className="ap-label-wide">
          Название
          <input value={name} onChange={(e) => setName(e.target.value)} className="ap-input" />
        </label>

        <label className="ap-label-wide">
          Описание · необязательно
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="ap-textarea" />
        </label>

        <PlacementSelect value={placement} onChange={setPlacement} />

        <div className="ap-label-wide">
          <ProductImageUploader value={imageUrl} onChange={setImageUrl} productId={product.id} label="Фото товара" />
        </div>
      </div>

      {error   && <div className="ap-error">{error}</div>}
      {message && <div className="ap-success">{message}</div>}

      <button type="button" onClick={handleUpdateProduct} disabled={isSaving} className="ap-save-btn">
        {isSaving ? 'Сохраняем...' : 'Сохранить товар'}
      </button>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  VariantsEditor                                                               */
/* ─────────────────────────────────────────────────────────────────────────── */

function VariantsEditor({ product }: { product: AdminProduct }) {
  const router = useRouter()

  const [size,       setSize]       = useState('')
  const [color,      setColor]      = useState('')
  const [sku,        setSku]        = useState('')
  const [initialQty, setInitialQty] = useState('0')
  const [isCreating, setIsCreating] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const sortedVariants = [...product.product_variants].sort((a, b) =>
    String(a.sku ?? '').localeCompare(String(b.sku ?? ''))
  )

  async function handleCreateVariant() {
    setIsCreating(true); setError(null)

    try {
      const response = await unitFetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_variant',
          product_id: product.id,
          size, color, sku,
          initial_qty: Number(initialQty),
          is_active: true,
        }),
      })

      const result = await response.json()
      if (!response.ok) { setError(result.error || 'Не удалось создать вариант'); return }

      setSize(''); setColor(''); setSku(''); setInitialQty('0')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <section className="ap-editor-card">
      <div className="ap-panel-head">
        <div>
          <h3 className="ap-panel-title">Варианты и остатки</h3>
          <p className="ap-panel-hint">Управляйте вариантами, SKU и остатками товара.</p>
        </div>
      </div>

      <div className="ap-create-variant-box">
        <label className="ap-label">Размер<input aria-label="Размер нового варианта" value={size} onChange={e => setSize(e.target.value)} placeholder="ONE SIZE или M" className="ap-input" /></label>
        <label className="ap-label">Цвет<input aria-label="Цвет нового варианта" value={color} onChange={e => setColor(e.target.value)} placeholder="Необязательно" className="ap-input" /></label>
        <label className="ap-label">SKU<input aria-label="SKU нового варианта" value={sku} onChange={e => setSku(e.target.value)} className="ap-input" /></label>
        <label className="ap-label">Начальный остаток<input aria-label="Начальный остаток" value={initialQty} onChange={e => setInitialQty(e.target.value)} className="ap-input" type="number" min="0" step="1" /></label>
        <button
          type="button"
          onClick={handleCreateVariant}
          disabled={isCreating || sku.trim().length === 0}
          className="ap-dark-btn"
        >
          + Вариант
        </button>
      </div>

      {error && <div className="ap-error">{error}</div>}

      {sortedVariants.length === 0 ? (
        <div className="ap-empty-variant">Вариантов пока нет.</div>
      ) : (
        <div className="ap-variant-cards">
          {sortedVariants.map((variant) => (
            <VariantRow key={variant.id} variant={variant} />
          ))}
        </div>
      )}
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  VariantRow                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function VariantRow({ variant }: { variant: AdminVariant }) {
  const router = useRouter()

  const [size,         setSize]         = useState(variant.size ?? '')
  const [color,        setColor]        = useState(variant.color ?? '')
  const [sku,          setSku]          = useState(variant.sku ?? '')
  const [isActive,     setIsActive]     = useState(variant.is_active)
  const [threshold,setThreshold]=useState(String(stockThreshold(variant)))
  const [movementType, setMovementType] = useState<'income' | 'adjustment'>('income')
  const [qty,          setQty]          = useState('')
  const [comment,      setComment]      = useState('')
  const [isSaving,     setIsSaving]     = useState(false)
  const [message,      setMessage]      = useState<string | null>(null)
  const [error,        setError]        = useState<string | null>(null)

  const availableQty = Math.max(0, Number(variant.total_qty) - Number(variant.reserved_qty))

  async function handleUpdateVariant() {
    if (!threshold.trim() || !Number.isInteger(Number(threshold)) || Number(threshold)<0 || Number(threshold)>1000000) {setError('Порог должен быть целым числом от 0 до 1000000.');return}
    setIsSaving(true); setMessage(null); setError(null)

    try {
      const response = await unitFetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_variant', variant_id: variant.id, size, color, sku, is_active: isActive, low_stock_threshold: Number(threshold) }),
      })
      const result = await response.json()
      if (!response.ok) { setError(result.error || 'Не удалось обновить вариант'); return }
      setMessage('Вариант обновлён')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleAddStock() {
    setIsSaving(true); setMessage(null); setError(null)

    try {
      const response = await unitFetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_stock', variant_id: variant.id, movement_type: movementType, qty: Number(qty), comment }),
      })
      const result = await response.json()
      if (!response.ok) { setError(result.error || 'Не удалось изменить остаток'); return }
      setQty(''); setComment(''); setMessage('Остаток обновлён')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неизвестная ошибка')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="ap-variant-row-wrap">
      <div className="ap-variant-fields">
        <label>Размер<input aria-label="Размер варианта" value={size} onChange={e => setSize(e.target.value)} className="ap-input" /></label>
        <label>Цвет<input aria-label="Цвет варианта" value={color} onChange={e => setColor(e.target.value)} className="ap-input" /></label>
        <label className="ap-variant-wide">SKU<textarea aria-label="SKU варианта" rows={2} value={sku} onChange={e => setSku(e.target.value)} className="ap-input ap-sku-field" /></label>
      </div>
      <div className="ap-variant-stock">
        <Metric label="Всего" value={String(variant.total_qty)} />
        <Metric label="Зарезервировано" value={String(variant.reserved_qty)} />
        <Metric label="Доступно" value={String(availableQty)} />
      </div>
      <label className="stock-threshold-field">Предупреждать при остатке ≤, шт.<input aria-label="Порог предупреждения" type="number" min="0" max="1000000" step="1" value={threshold} onChange={e=>setThreshold(e.target.value)} className="ap-input"/><small>Для этого размера и цвета. 0 — предупреждать, когда товар закончился.</small></label>
      {variant.is_active&&hasStockAlert(variant)&&<p className="stock-alert-note">{availableQty===0?'Товар закончился.':`Осталось ${availableQty} шт. доступно.`} Порог: {stockThreshold(variant)} шт.</p>}
      <div className="ap-variant-save">
        <label className="ap-active-label"><input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />Вариант доступен</label>
        <button type="button" onClick={handleUpdateVariant} disabled={isSaving} className="ap-small-action">Сохранить вариант</button>
      </div>
      <div className="ap-stock-fields">
        <label>Изменение остатка<select aria-label="Изменение остатка" value={movementType} onChange={e => setMovementType(e.target.value as 'income' | 'adjustment')} className="ap-input"><option value="income">Поступление</option><option value="adjustment">Корректировка</option></select></label>
        <label>Количество<input aria-label="Количество для изменения" value={qty} onChange={e => setQty(e.target.value)} type="number" placeholder={movementType === 'income' ? 'Добавить' : '+ добавить / − убрать'} className="ap-input" /></label>
        <label className="ap-variant-wide">Причина<input value={comment} onChange={e => setComment(e.target.value)} placeholder="Причина изменения остатка" className="ap-input" /></label>
        <button type="button" onClick={handleAddStock} disabled={isSaving || !qty.trim()} className="ap-small-action-dark ap-variant-wide">Изменить остаток</button>
      </div>

      {error   && <div className="ap-error">{error}</div>}
      {message && <div className="ap-success">{message}</div>}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  SummaryMetric · Metric                                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

function SummaryMetric({ label, value, tone, hint }: { label: string; value: string; tone?: 'pink'; hint?: string }) {
  return (
    <div className="ap-summary-metric">
      <span>{label}</span>
      <b className={tone === 'pink' ? 'ap-pink' : ''}>{value}</b>
      {hint && <small>{hint}</small>}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'pink' }) {
  return (
    <div className="ap-metric">
      <span>{label}</span>
      <b className={tone === 'pink' ? 'ap-pink' : ''}>{value}</b>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Pure helpers                                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

function getProductStats(product: AdminProduct) {
  const totalQty    = product.product_variants.reduce((s, v) => s + Number(v.total_qty), 0)
  const reservedQty = product.product_variants.reduce((s, v) => s + Number(v.reserved_qty), 0)
  const active      = product.product_variants.filter((v) => v.is_active)

  const zeroVariants = active.filter((v) => Number(v.total_qty) - Number(v.reserved_qty) <= 0).length
  const lowVariants = active.filter(hasStockAlert).length

  return { totalQty, reservedQty, availableQty: Math.max(0, totalQty - reservedQty), zeroVariants, lowVariants }
}

function getCategoryName(product: AdminProduct): string {
  if (Array.isArray(product.categories)) return product.categories[0]?.name ?? 'Без категории'
  return product.categories?.name ?? 'Без категории'
}
