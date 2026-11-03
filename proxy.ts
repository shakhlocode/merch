import { contentSecurityPolicy } from './lib/security/headers.mjs'
import { NextRequest, NextResponse } from 'next/server'

export async function proxy(request: NextRequest) {
  const headers = new Headers(request.headers)
  const unit = request.nextUrl.searchParams.get('unit') || headers.get('x-merch-unit')
  if (unit) headers.set('x-merch-unit', unit)
  const nonce = crypto.randomUUID().replaceAll('-', '')
  const csp = contentSecurityPolicy(nonce, process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NODE_ENV !== 'production')
  headers.set('x-nonce', nonce)
  headers.set('Content-Security-Policy', csp)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static
     * - _next/image
     * - favicon.ico
     * - image files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
