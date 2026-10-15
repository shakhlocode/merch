import { redirect } from 'next/navigation'

export default function Page() {
  redirect('/admin/employees?welcome=1')
}
