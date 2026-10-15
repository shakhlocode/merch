import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type SettingsPayload = {
  handout_deadline?: string | null
  handout_place?: string | null
  handout_note?: string | null
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Необходимо войти в систему' }, { status: 401 })
    }

    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select('is_admin, is_active')
      .eq('id', user.id)
      .maybeSingle()

    if (employeeError) {
      return NextResponse.json({ error: employeeError.message }, { status: 400 })
    }

    if (!(await supabase.rpc('is_admin', {})).data || !employee || employee.is_active === false) {
      return NextResponse.json(
        { error: 'Доступ разрешён только администратору' },
        { status: 403 }
      )
    }

    const body = (await request.json()) as SettingsPayload

    const { error } = await supabase
      .from('merch_settings')
      .update({
        handout_deadline: cleanText(body.handout_deadline),
        handout_place:    cleanText(body.handout_place),
        handout_note:     cleanText(body.handout_note),
        updated_at:       new Date().toISOString(),
      })
      .eq('id', 1)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function cleanText(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
