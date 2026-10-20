'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { fail, isUuid, requireUser } from '@/lib/session'

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim()

// The admin_* RPCs check that the caller is a platform admin; these actions
// only shape the input.
export async function setCompanyBilling(companyId: string, form: FormData) {
  await requireUser()
  if (!isUuid(companyId)) fail('/admin', 'Unknown company.')
  const plan = str(form, 'plan')
  const status = str(form, 'billing_status')
  const until = str(form, 'period_end')
  const trialEnds = str(form, 'trial_ends')
  const seats = str(form, 'seats')
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_set_billing', {
    p_company: companyId,
    p_plan: plan,
    p_status: status,
    p_period_end: /^\d{4}-\d{2}-\d{2}$/.test(until) ? `${until}T23:59:59+05:30` : undefined,
    p_seats: seats ? Number(seats) : undefined,
    p_trial_ends: /^\d{4}-\d{2}-\d{2}$/.test(trialEnds) ? `${trialEnds}T23:59:59+05:30` : undefined,
  })
  if (error) fail('/admin', error.message)
  revalidatePath('/admin')
  redirect(`/admin?notice=${encodeURIComponent('Saved.')}`)
}

export async function setPlanPrice(planId: string, form: FormData) {
  await requireUser()
  const price = Number(str(form, 'price'))
  const max = str(form, 'max_users')
  if (!Number.isFinite(price) || price < 0) fail('/admin', 'Enter a valid price.')
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_set_plan_price', {
    p_plan: planId, p_price: price, p_max_users: max ? Number(max) : undefined,
  })
  if (error) fail('/admin', error.message)
  revalidatePath('/admin')
  redirect(`/admin?notice=${encodeURIComponent('Price saved.')}`)
}
