import { securityHeaders } from './lib/security/headers.mjs'
/** @type {import('next').NextConfig} */

// Derive the Supabase Storage host from the public env var so next/image is
// allowed to optimise product photos served from Supabase. Env files are
// loaded before this config is evaluated, both locally and on Vercel.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : undefined

const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders(process.env.NODE_ENV === 'production') }]
  },
  images: {
    remotePatterns: supabaseHost
      ? [
          {
            protocol: 'https',
            hostname: supabaseHost,
            pathname: '/storage/v1/object/public/**',
          },
        ]
      : [],
  },
}

export default nextConfig
