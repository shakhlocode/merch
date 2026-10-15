import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin'
import { redirect } from 'next/navigation'
import AdminShell from '@/components/AdminShell'
import InterfaceSettings from './InterfaceSettings'
import { defaultStoreContent, type StoreContent } from '@/lib/store-content'
export default async function Page() {
  const s = await createClient(),
    a = await requireAdmin(s)
  if (!a.ok) redirect('/login')
  const [
    { data: offices, error },
    { data: settings, error: settingsError },
    { data: choices, error: choicesError },
  ] = await Promise.all([
    s
      .from('pickup_offices')
      .select('*')
      .is('deleted_at', null)
      .order('sort')
      .order('name'),
    s.from('merch_settings').select('*').eq('id', 1).single(),
    s
      .from('fulfillment_choices')
      .select('*')
      .is('deleted_at', null)
      .order('sort')
      .order('name'),
  ])
  const content = Object.fromEntries(
    Object.keys(defaultStoreContent).map((k) => [
      k,
      settings?.[k as keyof StoreContent] ||
        defaultStoreContent[k as keyof StoreContent],
    ])
  ) as StoreContent
  return (
    <AdminShell adminEmail={a.user.email || ''} title="Тексты и настройки">
      {error || settingsError || choicesError ? (
        <p role="alert">Не удалось загрузить настройки. Обновите страницу.</p>
      ) : (
        <InterfaceSettings
          offices={offices || []}
          choices={choices || []}
          content={content}
        />
      )}
    </AdminShell>
  )
}
