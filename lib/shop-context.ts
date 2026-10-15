export type ShopUnit = { id: string; name: string; slug: string }
export type ShopContext = { unit_id: string | null; is_admin: boolean; is_super_admin: boolean; units: ShopUnit[] }

// Read from this tab's URL/rendered document, never from a shared selection
// cookie: an old form must keep writing to the shop where it was opened.
export function browserUnit() {
  if (typeof window === 'undefined') return null
  return new URL(window.location.href).searchParams.get('unit') || document.documentElement.dataset.merchUnit || null
}
export function withUnit(path: string, unit = browserUnit()) {
  if (!unit || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/templates/') || path.startsWith('/brand/')) return path
  const url = new URL(path, 'https://merch.invalid')
  if (!url.searchParams.has('unit')) url.searchParams.set('unit', unit)
  return url.pathname + url.search + url.hash
}
export function unitFetch(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
  const unit = browserUnit()
  if (unit) headers.set('x-merch-unit', unit)
  return fetch(input, { ...init, headers })
}
