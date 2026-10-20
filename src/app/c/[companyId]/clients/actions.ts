'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { fail, isUuid, requireMember } from '@/lib/session'
import { insertClient, type ClientFields } from '@/lib/clients'
import { TASK_CREATOR_ROLES } from '@/lib/types'

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim()

function readFields(form: FormData, back: string): ClientFields {
  const name = str(form, 'name')
  if (!name) fail(back, 'Enter the client’s name.')
  const email = str(form, 'email')
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(back, 'Enter a valid email address.')
  return {
    name,
    email: email || null,
    phone: str(form, 'phone') || null,
    organisation: str(form, 'organisation') || null,
    notes: str(form, 'notes') || null,
  }
}

// Owner/Admin/Manager/Business Development (RLS: clients_insert).
export async function addClient(companyId: string, form: FormData) {
  if (!isUuid(companyId)) fail('/app', 'Unknown company.')
  const { member } = await requireMember(companyId)
  const back = `/c/${companyId}/clients`
  if (!TASK_CREATOR_ROLES.includes(member.role)) fail(back, 'Your role cannot add clients.')
  const supabase = await createClient()
  const created = await insertClient(supabase, companyId, member.id, readFields(form, back))
  if (!created.id) fail(back, created.error ?? 'Could not save the client.')
  revalidatePath(back)
  redirect(`${back}/${created.id}`)
}

// Owner/Admin/Manager, or Business Development for clients they added (RLS: clients_update).
export async function updateClient(companyId: string, clientId: string, form: FormData) {
  if (!isUuid(companyId) || !isUuid(clientId)) fail('/app', 'Unknown client.')
  await requireMember(companyId)
  const back = `/c/${companyId}/clients/${clientId}`
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clients')
    .update(readFields(form, back))
    .eq('company_id', companyId).eq('id', clientId)
    .select('id')
  if (error) fail(back, error.message)
  if (!data?.length) fail(back, 'You can’t edit this client.')
  revalidatePath(`/c/${companyId}/clients`)
  redirect(`${back}?notice=${encodeURIComponent('Saved.')}`)
}
