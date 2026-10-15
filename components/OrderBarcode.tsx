'use client'

import { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'

export default function OrderBarcode({ value, size = 320, orderNumber, downloadable = false }: {
  value: string
  size?: number
  orderNumber?: string
  downloadable?: boolean
}) {
  const ref = useRef<SVGSVGElement>(null)
  const [failed, setFailed] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  useEffect(() => {
    setDownloadError(null)
    if (!ref.current) return
    try {
      JsBarcode(ref.current, value, { format: 'CODE128', width: 2, height: 70,
        displayValue: true, fontSize: 17, margin: 16, background: '#ffffff', lineColor: '#111111' })
      setFailed(false)
    } catch { setFailed(true) }
  }, [value])

  function downloadBarcode() {
    setDownloadError(null)
    try {
      // Render at full resolution, independently of the screen/phone size.
      const barcode = document.createElement('canvas')
      JsBarcode(barcode, value, {
        format: 'CODE128', width: 3, height: 160, displayValue: true,
        fontSize: 28, margin: 40, background: '#ffffff', lineColor: '#111111',
      })
      const picture = document.createElement('canvas')
      picture.width = barcode.width
      picture.height = barcode.height + 100
      const context = picture.getContext('2d')
      if (!context) throw new Error('Canvas unavailable')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, picture.width, picture.height)
      context.fillStyle = '#111111'
      context.textAlign = 'center'
      context.font = 'bold 28px Arial, sans-serif'
      context.fillText('Uzum Merch Shop', picture.width / 2, 40, picture.width - 80)
      context.font = '24px Arial, sans-serif'
      context.fillText(orderNumber ? `Заказ № ${orderNumber}` : 'Код получения заказа', picture.width / 2, 80, picture.width - 80)
      context.drawImage(barcode, 0, 100)

      const link = document.createElement('a')
      link.download = `uzum-merch-${(orderNumber || value).replace(/[^a-zA-Z0-9_-]/g, '_')}.png`
      link.href = picture.toDataURL('image/png')
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch {
      setDownloadError('Не удалось скачать штрихкод. Попробуйте ещё раз или сохраните скриншот.')
    }
  }

  return <div className="pickup-barcode" style={{ width: size, maxWidth: '100%' }}>
    <svg ref={ref} role="img" aria-label={`Штрихкод получения ${value}`} style={{ width: '100%', height: 'auto' }} />
    {failed && <p>Код для ручного ввода: {value}</p>}
    {downloadable && !failed && <button type="button" className="btn btn-ghost btn-sm barcode-download" onClick={downloadBarcode}>Скачать штрихкод</button>}
    {downloadError && <p role="alert">{downloadError}</p>}
  </div>
}
