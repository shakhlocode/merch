'use client'
import { useContext } from 'react'
import { ShopContextValue } from './ShopProvider'
import { withUnit } from '@/lib/shop-context'
export default function ShopAnchor(props: React.ComponentProps<'a'>) {
  const context = useContext(ShopContextValue)
  return <a {...props} href={props.href ? withUnit(props.href, context.unit_id) : props.href} />
}
