'use client'
import { createContext, type ReactNode } from 'react'
import type { ShopContext } from '@/lib/shop-context'
export const ShopContextValue = createContext<ShopContext>({ unit_id: null, is_admin: false, is_super_admin: false, units: [] })
export default function ShopProvider({ context, children }: { context: ShopContext; children: ReactNode }) {
  return <ShopContextValue.Provider value={context}>{children}</ShopContextValue.Provider>
}
