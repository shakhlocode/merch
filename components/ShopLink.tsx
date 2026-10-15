'use client'
import Link from 'next/link'
import { useContext } from 'react'
import { ShopContextValue } from './ShopProvider'
import { withUnit } from '@/lib/shop-context'
export default function ShopLink(props: React.ComponentProps<typeof Link>) {
  const context = useContext(ShopContextValue)
  return <Link {...props} href={typeof props.href === 'string' ? withUnit(props.href, context.unit_id) : props.href} />
}
