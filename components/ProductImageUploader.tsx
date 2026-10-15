'use client'

import { unitFetch } from '@/lib/shop-context'

import { useState, type ChangeEvent } from 'react'

type ProductImageUploaderProps = {
  value: string
  onChange: (url: string) => void
  productId?: string
  label?: string
}

export default function ProductImageUploader({
  value,
  onChange,
  productId,
  label = 'Фото товара',
}: ProductImageUploaderProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      if (productId) formData.append('productId', productId)

      const response = await unitFetch('/api/admin/product-image', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (!response.ok) {
        setError(result.error || 'Не удалось загрузить фото')
        return
      }

      onChange(result.url)
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : 'Неизвестная ошибка'
      )
    } finally {
      setIsUploading(false)
      event.target.value = ''
    }
  }

  return (
    <div className="img-uploader">
      <label className="img-uploader-label">
        {label}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={handleFileChange}
          disabled={isUploading}
          className="img-uploader-input"
        />
      </label>

      {value ? (
        <div className="img-uploader-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Фото товара" className="img-uploader-img" loading="lazy" decoding="async" />
          <div className="img-uploader-url-box">
            <div className="img-uploader-url-label">URL изображения</div>
            <input
              type="text"
              value={value}
              onChange={e => onChange(e.target.value)}
              className="img-uploader-url-input"
            />
          </div>
        </div>
      ) : (
        <div className="img-uploader-empty">
          <div className="img-uploader-empty-icon">+</div>
          <div>
            <b>Фото не загружено</b>
            <span className="block-mt-2">
              Выберите файл JPG, PNG, WEBP или GIF до 5 MB.
            </span>
          </div>
        </div>
      )}

      {isUploading && <div className="img-uploader-info">Загружаем фото...</div>}
      {error       && <div className="img-uploader-error">{error}</div>}
    </div>
  )
}
