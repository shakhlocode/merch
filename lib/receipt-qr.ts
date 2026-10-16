import QRCode from 'qrcode'

export function receiptQrSvg(value: string) {
  if (!/^\d{20}$/.test(value)) throw new Error('Некорректный код получения заказа')
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' }), size = qr.modules.size, margin = 4
  let path = ''
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (qr.modules.get(y, x)) path += `M${x + margin} ${y + margin}h1v1h-1z`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + margin * 2} ${size + margin * 2}" width="256" height="256" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#111"/></svg>`
}
