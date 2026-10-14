'use client'

import { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'

export default function OrderBarcode({ value, size = 320 }: { value: string; size?: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!ref.current) return
    try {
      JsBarcode(ref.current, value, { format: 'CODE128', width: 2, height: 70,
        displayValue: true, fontSize: 17, margin: 16, background: '#ffffff', lineColor: '#111111' })
      setFailed(false)
    } catch { setFailed(true) }
  }, [value])
  return <div className="pickup-barcode" style={{ width: size, maxWidth: '100%' }}>
    <svg ref={ref} role="img" aria-label={`Штрихкод получения ${value}`} style={{ width: '100%', height: 'auto' }} />
    {failed && <p>Код для ручного ввода: {value}</p>}
  </div>
}
