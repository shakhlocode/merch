import { createClient } from '@/lib/supabase/server'
import { shopRedirect } from '@/lib/shop-redirect'
import SetPasswordClient from './SetPasswordClient'

type SetPasswordPageProps = {
  searchParams: Promise<{
    reset?: string
  }>
}

export default async function SetPasswordPage({ searchParams }: SetPasswordPageProps) {
  const redirect: (path: string) => never = await shopRedirect()

  const params = await searchParams
  const isReset = params.reset === '1'
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  if (user.email?.endsWith('@guest.merch.invalid')) redirect('/catalog')

  const { data: employee } = await supabase
    .from('employees')
    .select('password_set_at')
    .eq('id', user.id)
    .maybeSingle()

  if (employee?.password_set_at && !isReset) {
    redirect('/catalog')
  }

  return (
    <SetPasswordClient
      email={user.email ?? ''}
      mode={employee?.password_set_at ? 'reset' : 'create'}
    />
  )
}
