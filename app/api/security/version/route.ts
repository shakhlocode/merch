import { NextResponse } from 'next/server'
import { SECURITY_SCHEMA } from '@/lib/security/deployment-check.mjs'
export const dynamic = 'force-dynamic'
export function GET() {
  let backendOrigin: string | null = null
  try { backendOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').origin } catch { /* No credentials or error details exposed. */ }
  const release = /^[a-f0-9]{7,40}$/.test(process.env.MERCH_RELEASE_ID || '') ? process.env.MERCH_RELEASE_ID : null
  return NextResponse.json({ release, securitySchema: SECURITY_SCHEMA, backendOrigin }, { headers: { 'Cache-Control': 'no-store' } })
}
