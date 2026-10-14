import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type EmployeeAction = 'create_employee' | 'update_employee' | 'import_employees'

type Payload = {
  action?: EmployeeAction
  id?: string
  email?: string
  full_name?: string
  business_unit?: string | null
  position?: string | null
  external_id?: string | null
  rows?: { email: string; full_name: string; external_id: string | null }[]
  hired_at?: string
  is_active?: boolean
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
      .select('id, is_admin, is_active')
      .eq('id', user.id)
      .maybeSingle()

    if (employeeError) {
      return NextResponse.json({ error: employeeError.message }, { status: 400 })
    }

    if (!employee?.is_admin || employee.is_active === false) {
      return NextResponse.json(
        { error: 'Доступ разрешён только администратору' },
        { status: 403 }
      )
    }

    const body = (await request.json()) as Payload

    if (!body.action) {
      return NextResponse.json({ error: 'Не передано действие' }, { status: 400 })
    }

    if (body.action === 'import_employees') {
      if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 2000) return NextResponse.json({ error: 'Загрузите от 1 до 2000 строк' }, { status: 400 })
      const { data, error } = await supabase.rpc('admin_import_employees', { p_rows: body.rows })
      return error ? NextResponse.json({ error: mapError(error.message) }, { status: 400 }) : NextResponse.json({ ok: true, ...data })
    }

    if (body.action !== 'create_employee' && body.action !== 'update_employee') {
      return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
    }

    const email    = cleanText(body.email)?.toLowerCase()
    const fullName  = cleanText(body.full_name)

    if (!email)    return NextResponse.json({ error: 'Email обязателен' }, { status: 400 })
    if (!fullName) return NextResponse.json({ error: 'ФИО обязательно' }, { status: 400 })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Некорректный email' }, { status: 400 })

    const fields = {
      email,
      full_name:     fullName,
      external_id: cleanText(body.external_id),
      is_active:     body.is_active ?? true,
    }

    if (body.action === 'create_employee') {
      const { data, error } = await supabase
        .from('employee_directory')
        .insert(fields)
        .select('id')
        .single()

      if (error) {
        return NextResponse.json({ error: mapError(error.message) }, { status: 400 })
      }

      return NextResponse.json({ ok: true, employee: data })
    }

    // update_employee
    if (!body.id) {
      return NextResponse.json({ error: 'Не передан id сотрудника' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('employee_directory')
      .update(fields)
      .eq('id', body.id)
      .select('id')
      .single()

    if (error) {
      return NextResponse.json({ error: mapError(error.message) }, { status: 400 })
    }

    return NextResponse.json({ ok: true, employee: data })
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

function mapError(message: string) {
  if (message.includes('employee_directory_external_id_key')) return 'Этот идентификатор уже занят другим сотрудником'
  if (message.includes('employee_directory_email_lower_key') || message.includes('duplicate key')) {
    return 'Сотрудник с таким email уже есть в реестре'
  }
  return message
}
