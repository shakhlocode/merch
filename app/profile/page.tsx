import { requireSystemAccess } from '@/lib/system-access'
import AppNav from '@/components/AppNav'
import { createClient } from '@/lib/supabase/server'
import { needsPasswordSetup } from '@/lib/auth'
import { redirect } from 'next/navigation'
import ProfileClient, { type EmployeeProfile } from './ProfileClient'

export default async function ProfilePage() {
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
    email: employee?.email ?? user.email ?? '',
    phone: employee?.phone ?? '',
    department: employee?.department ?? '',
    position: employee?.position ?? '',
    city: employee?.city ?? '',
    office: employee?.office ?? '',
    is_admin: Boolean(employee?.is_admin),
  }

  return (
    <div>
      <header className="site-head">
        <div className="site-head-glass" aria-hidden="true" />
        <div className="head-inner">
          <a href="/catalog" className="brand">
            <span className="brand-mark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/uzum-big-logo.webp" alt="Uzum" />
            </span>
            <span className="brand-name">
              uzum <span className="brand-name-soft">мерч</span>
            </span>
            <span className="brand-sub">личный кабинет</span>
          </a>

          <AppNav isAdmin={profile.is_admin} showLogout />
        </div>
      </header>

      <ProfileClient profile={profile} />
    </div>
  )
}
