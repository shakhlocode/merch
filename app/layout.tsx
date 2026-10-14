import type { Metadata, Viewport } from 'next'
import './globals.css'
import SystemAccessMonitor from '@/components/SystemAccessMonitor'

export const metadata: Metadata = {
  title: 'Uzum Merch',
  description: 'Внутренний магазин корпоративного мерча',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ru">
      <body>{children}<SystemAccessMonitor /></body>
    </html>
  )
}