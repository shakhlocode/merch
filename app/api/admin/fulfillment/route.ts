import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { defaultStoreContent, type StoreContent } from '@/lib/store-content'
import { requireAdmin } from '@/lib/admin'
import type { FulfillmentChoice } from '@/lib/fulfillment'
export async function POST(request: NextRequest) {
  const s = await createClient(),
    a = await requireAdmin(s)
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })
  const b = await request.json()
  if (b.action === 'office_delete' || b.action === 'choice_delete') {
    if (typeof b.id !== 'string')
      return NextResponse.json(
        { error: 'Выберите вариант для удаления' },
        { status: 400 }
      )
    const table =
      b.action === 'office_delete' ? 'pickup_offices' : 'fulfillment_choices'
    const { error } = await s
      .from(table)
      .update({ is_active: false, deleted_at: new Date().toISOString() })
      .eq('id', b.id)
      .is('deleted_at', null)
      .select('id')
      .single()
    return NextResponse.json(
      error ? { error: 'Вариант не найден или уже удалён' } : { ok: true },
      { status: error ? 400 : 200 }
    )
  }
  if (b.action === 'choice') {
    if (
      typeof b.name !== 'string' ||
      !b.name.trim() ||
      b.name.length > 120 ||
      !['remote_shipping', 'remote_visit', 'placeholder'].includes(b.mode) ||
      typeof b.is_active !== 'boolean'
    )
      return NextResponse.json(
        { error: 'Проверьте название, тип и доступность варианта' },
        { status: 400 }
      )
    if (b.mode === 'placeholder' && b.is_active)
      return NextResponse.json(
        {
          error:
            'Этот вариант можно показывать только неактивным: процесс получения ещё не подключён',
        },
        { status: 400 }
      )
    const fields = { name: b.name.trim(), is_active: b.is_active }
    const q = b.id
      ? s
          .from('fulfillment_choices')
          .update(fields)
          .eq('id', b.id)
          .is('deleted_at', null)
      : s
          .from('fulfillment_choices')
          .insert({ ...fields, mode: b.mode as FulfillmentChoice['mode'] })
    const { data: record, error } = await q.select('id').single()
    return NextResponse.json(
      error
        ? {
            error:
              error.code === '23505'
                ? 'Такой тип получения уже есть. Измените существующий вариант.'
                : 'Не удалось сохранить вариант. Проверьте его тип и доступность.',
          }
        : { ok: true, id: record?.id },
      { status: error ? 400 : 200 }
    )
  }
  if (b.action === 'text') {
    if (
      typeof b.key !== 'string' ||
      !Object.prototype.hasOwnProperty.call(defaultStoreContent, b.key) ||
      typeof b.text !== 'string' ||
      !b.text.trim() ||
      b.text.length > 4000
    )
      return NextResponse.json(
        { error: 'Проверьте название поля и текст (до 4000 символов)' },
        { status: 400 }
      )
    const key = b.key as keyof StoreContent
    const changes: Partial<StoreContent> & { updated_at: string } = {
      updated_at: new Date().toISOString(),
    }
    changes[key] = b.text.trim()
    const { error } = await s.from('merch_settings').update(changes).eq('id', 1)
    return NextResponse.json(error ? { error: error.message } : { ok: true }, {
      status: error ? 400 : 200,
    })
  }
  if (b.action === 'message') {
    if (
      typeof b.message !== 'string' ||
      !b.message.trim() ||
      b.message.length > 4000
    )
      return NextResponse.json(
        { error: 'Введите текст до 4000 символов' },
        { status: 400 }
      )
    const { error } = await s
      .from('merch_settings')
      .update({
        pickup_message: b.message.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
    return NextResponse.json(error ? { error: error.message } : { ok: true }, {
      status: error ? 400 : 200,
    })
  }
  if (b.action === 'office') {
    if (
      typeof b.name !== 'string' ||
      !b.name.trim() ||
      b.name.length > 120 ||
      typeof b.address !== 'string' ||
      b.address.length > 1000
    )
      return NextResponse.json(
        { error: 'Проверьте название и адрес офиса' },
        { status: 400 }
      )
    const fields = {
      name: b.name.trim(),
      address: b.address.trim(),
      is_active: b.is_active !== false,
    }
    const q = b.id
      ? s
          .from('pickup_offices')
          .update(fields)
          .eq('id', b.id)
          .is('deleted_at', null)
      : s.from('pickup_offices').insert(fields)
    const { data: record, error } = await q.select('id').single()
    return NextResponse.json(error ? { error: error.message } : { ok: true, id:record?.id }, {
      status: error ? 400 : 200,
    })
  }
  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
}
