import type { Metadata, Viewport } from 'next'
import './globals.css'
import SystemAccessMonitor from '@/components/SystemAccessMonitor'
import ShopProvider from '@/components/ShopProvider'
import { createClient } from '@/lib/supabase/server'
import type { ShopContext } from '@/lib/shop-context'

export const metadata: Metadata = {
  title: 'Uzum Merch',
  description: 'Внутренний магазин корпоративного мерча',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const context: ShopContext = user ? (await supabase.rpc('my_shop_context', {})).data as unknown as ShopContext : { unit_id: null, is_admin: false, is_super_admin: false, units: [] }
  return (
    <html lang="ru" data-merch-unit={context?.unit_id || undefined}>
      <body><ShopProvider context={context || { unit_id: null, is_admin: false, is_super_admin: false, units: [] }}>{children}<SystemAccessMonitor /></ShopProvider></body>
    </html>
  )
}
