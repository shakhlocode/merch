'use client'

import { useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { receiptQrSvg, QR_RECEIPT_NOTICE } from '@/lib/receipt-qr'

export default function OrderQRCode({ value, size = 240, orderNumber, downloadable = false }: {
  value: string; size?: number; orderNumber?: string; downloadable?: boolean
}) {
  const svg = useMemo(() => { try { return receiptQrSvg(value) } catch { return null } }, [value])
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function download() {
    setDownloadError(null); setBusy(true)
    try {
      const code = document.createElement('canvas')
      await QRCode.toCanvas(code, value, { width: 600, margin: 4, errorCorrectionLevel: 'M' })
      const picture = document.createElement('canvas'); picture.width = 680; picture.height = 840
      const context = picture.getContext('2d'); if (!context) throw new Error('Canvas unavailable')
      context.fillStyle = '#fff'; context.fillRect(0, 0, 680, 840); context.fillStyle = '#111'; context.textAlign = 'center'
      context.font = 'bold 28px Arial'; context.fillText('Uzum Merch Shop', 340, 42)
      context.font = '24px Arial'; context.fillText(orderNumber ? `Заказ № ${orderNumber}` : 'QR-код получения заказа', 340, 82, 620)
      context.drawImage(code, 40, 100)
      context.font = '22px Arial'; context.fillText('Не передавайте QR-код другим.', 340, 750)
      context.fillText('По нему можно получить заказ только один раз.', 340, 786, 620)
      const link = document.createElement('a'); link.download = `uzum-merch-qr-${(orderNumber || value).replace(/[^a-zA-Z0-9_-]/g, '_')}.png`
      link.href = picture.toDataURL('image/png'); document.body.appendChild(link); link.click(); link.remove()
    } catch { setDownloadError('Не удалось скачать QR-код. Попробуйте ещё раз или сохраните скриншот.') }
    finally { setBusy(false) }
  }
  return <div className="pickup-barcode pickup-qr" style={{ width: size, maxWidth: '100%' }}>
    {svg ? <div role="img" aria-label="QR-код получения заказа" className="receipt-qr-image" dangerouslySetInnerHTML={{ __html: svg }} /> : <p>Код для ручного ввода: {value}</p>}
    <p className="receipt-qr-notice">{QR_RECEIPT_NOTICE}</p>
    {downloadable && svg && <button type="button" disabled={busy} className="btn btn-ghost btn-sm barcode-download" onClick={download}>{busy ? 'Сохраняем…' : 'Скачать QR-код'}</button>}
    {downloadError && <p role="alert">{downloadError}</p>}
  </div>
}
