import { createClient } from '@/lib/supabase/server'
import { needsPasswordSetup } from '@/lib/auth'
import { redirect } from 'next/navigation'

type HomePageProps = {
  searchParams: Promise<{
    token_hash?: string
    type?: string
    next?: string
  }>
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams

  if (params.token_hash) {
    const callbackParams = new URLSearchParams({
      token_hash: params.token_hash,
      type: params.type ?? 'email',
      next: params.next ?? '/set-password?reset=1',
    })

    redirect(`/auth/hash-callback?${callbackParams.toString()}`)
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    if (await needsPasswordSetup(supabase, user.id)) {
      redirect('/set-password')
    }

    const {data:scope}=await supabase.rpc('my_store_scope',{})
    redirect(scope==='welcome'?'/welcome':'/catalog')
  }

  redirect('/login')
}
