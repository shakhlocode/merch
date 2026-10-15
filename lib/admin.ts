import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export async function requireAdmin(supabase: SupabaseServerClient) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      ok: false as const,
      status: 401,
      error: 'Необходимо войти в систему',
    }
  }

  const { data: employee, error: employeeError } = await supabase
    .from('employees')
    .select('id, email, is_admin, is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (employeeError) {
    return {
      ok: false as const,
      status: 400,
      error: employeeError.message,
    }
  }

  if (!(await supabase.rpc('is_admin', {})).data || !employee || employee.is_active === false) {
    return {
      ok: false as const,
      status: 403,
      error: 'Доступ разрешен только администраторам',
    }
  }

  return {
    ok: true as const,
    user,
    employee,
  }
}
