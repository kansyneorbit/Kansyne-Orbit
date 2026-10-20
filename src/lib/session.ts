import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Company, Member } from '@/lib/types'

export const getUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

export async function requireUser() {
  const user = await getUser()
  if (!user) redirect('/login')
  return user
}

// The signed-in user's seat in a company, or back to the company picker.
export const requireMember = cache(async (companyId: string) => {
  const user = await requireUser()
  const supabase = await createClient()
  const { data } = await supabase
    .from('members')
    .select('id, company_id, name, email, role, avatar_initials, companies!inner(id, name, short_name, client_code_prefix, currency_code, locale, timezone)')
    .eq('company_id', companyId)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()
  if (!data) redirect('/app')
  const { companies, ...member } = data as unknown as Member & { companies: Company }
  return { member: member as Member, company: companies }
})

// Redirect back to a form with a message shown in an error banner.
export function fail(path: string, message: string): never {
  const sep = path.includes('?') ? '&' : '?'
  redirect(`${path}${sep}error=${encodeURIComponent(message)}`)
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
