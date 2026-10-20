'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { fail, isUuid, requireMember } from '@/lib/session'

// Owner only; the guard_billing trigger enforces the same.
export async function saveBillingEmail(companyId: string, form: FormData) {
  if (!isUuid(companyId)) fail('/app', 'Unknown company.')
  const { member } = await requireMember(companyId)
  const back = `/c/${companyId}/billing`
  if (member.role !== 'owner') fail(back, 'Only an Owner can change the billing email.')
  const email = String(form.get('billing_email') ?? '').trim()
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(back, 'Enter a valid email address.')
  const supabase = await createClient()
  const { error } = await supabase.from('companies').update({ billing_email: email || null }).eq('id', companyId)
  if (error) fail(back, error.message)
  revalidatePath(back)
  redirect(`${back}?notice=${encodeURIComponent('Billing email saved.')}`)
}
