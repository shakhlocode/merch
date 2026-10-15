
import ShopAnchor from '@/components/ShopAnchor'
import { requireSystemAccess } from '@/lib/system-access'
import AppNav from '@/components/AppNav'
import { createClient } from '@/lib/supabase/server'
import { needsPasswordSetup } from '@/lib/auth'
import { shopRedirect } from '@/lib/shop-redirect'
import ProfileClient, { type EmployeeProfile } from './ProfileClient'

export default async function ProfilePage() {
  const redirect: (path: string) => never = await shopRedirect()

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  await requireSystemAccess(supabase)

  if (await needsPasswordSetup(supabase, user.id)) {
    redirect('/set-password')
  }

  const { data: employee } = await supabase
    .from('employees')
    .select(
      `
      id,
      full_name,
      email,
      phone,
      department,
      position,
      city,
      office,
      is_admin
    `
    )
    .eq('id', user.id)
    .maybeSingle()

  const profile: EmployeeProfile = {
    id: user.id,
    full_name: employee?.full_name ?? '',
    email: user.email?.endsWith('@guest.merch.invalid') ? 'Вход по личному приглашению' : employee?.email ?? user.email ?? '',
    phone: employee?.phone ?? '',
    department: employee?.department ?? '',
    position: employee?.position ?? '',
    city: employee?.city ?? '',
    office: employee?.office ?? '',
    is_admin: Boolean((await supabase.rpc('is_admin', {})).data),
  }

  return (
    <div>
      <header className="site-head">
        <div className="site-head-glass" aria-hidden="true" />
        <div className="head-inner">
          <ShopAnchor href="/" className="brand">
            <span className="brand-mark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/uzum-big-logo.webp" alt="Uzum" />
            </span>
            <span className="brand-name">
              uzum <span className="brand-name-soft">мерч</span>
            </span>
            <span className="brand-sub">личный кабинет</span>
          </ShopAnchor>

          <AppNav isAdmin={profile.is_admin} showLogout />
        </div>
      </header>

      <ProfileClient profile={profile} />
    </div>
  )
}
