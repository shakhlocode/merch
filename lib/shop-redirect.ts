import { headers } from 'next/headers'
import { redirect as nextRedirect } from 'next/navigation'
import { withUnit } from '@/lib/shop-context'
export async function shopRedirect() {
  const unit = (await headers()).get('x-merch-unit')
  return (path: string): never => nextRedirect(withUnit(path, unit))
}
