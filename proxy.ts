import { NextRequest, NextResponse } from 'next/server'

export async function proxy(request: NextRequest) {
  const headers = new Headers(request.headers)
  const unit = request.nextUrl.searchParams.get('unit') || headers.get('x-merch-unit')
  if (unit) headers.set('x-merch-unit', unit)
  return NextResponse.next({ request: { headers } })
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
