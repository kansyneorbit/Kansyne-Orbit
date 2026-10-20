'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fail, requireUser } from '@/lib/session'

export async function createCompany(form: FormData) {
  await requireUser()
  const company = String(form.get('company') ?? '').trim()
  const name = String(form.get('name') ?? '').trim()
  if (!company || !name) fail('/app?new=1', 'Enter the company name and your name.')

  const supabase = await createClient()
  const { data: id, error } = await supabase.rpc('create_company', { p_name: company, p_your_name: name })
  if (error || !id) fail('/app?new=1', error?.message ?? 'Could not create the company.')
  redirect(`/c/${id}/home`)
}
