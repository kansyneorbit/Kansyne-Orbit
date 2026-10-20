'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { fail, isUuid, requireMember } from '@/lib/session'
import { LEAD_ACTIVITY_LABELS, LEAD_ROLES, OPEN_LEAD_STATUSES, type LeadStatus } from '@/lib/types'

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim()
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)

// Owner/Admin/Manager work every lead; Business Development their own (RLS).
async function start(companyId: string, back: string) {
  if (!isUuid(companyId)) fail('/app', 'Unknown company.')
  const { member } = await requireMember(companyId)
  if (!LEAD_ROLES.includes(member.role)) fail(`/c/${companyId}`, 'Your role does not work with leads.')
  return { me: member, supabase: await createClient(), back }
}

function readLead(form: FormData, back: string) {
  const contact = str(form, 'contact_name')
  if (!contact) fail(back, 'Enter the contact’s name.')
  const email = str(form, 'email')
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(back, 'Enter a valid email address.')
  const valueRaw = str(form, 'estimated_value').replace(/,/g, '')
  const value = valueRaw ? Number(valueRaw) : null
  if (value !== null && (!Number.isFinite(value) || value < 0)) fail(back, 'Enter a valid estimated value.')
  const followUp = str(form, 'next_follow_up')
  if (followUp && !isDate(followUp)) fail(back, 'Choose a valid follow-up date.')
  const category = str(form, 'category_id')
  return {
    contact_name: contact,
    organisation: str(form, 'organisation') || null,
    phone: str(form, 'phone') || null,
    email: email || null,
    source: str(form, 'source') || null,
    category_id: isUuid(category) ? category : null,
    requirement: str(form, 'requirement') || null,
    estimated_value: value,
    next_follow_up: followUp || null,
  }
}

async function log(supabase: Awaited<ReturnType<typeof createClient>>, companyId: string, leadId: string, memberId: string, kind: string, body: string) {
  await supabase.from('lead_activities').insert({ company_id: companyId, lead_id: leadId, member_id: memberId, kind, body })
}

export async function createLead(companyId: string, form: FormData) {
  const { me, supabase, back } = await start(companyId, `/c/${companyId}/leads/new`)
  const fields = readLead(form, back)
  // Business Development always owns what they add; others may pick an owner.
  const ownerRaw = str(form, 'owner_id')
  const owner = me.role === 'sales' ? me.id : isUuid(ownerRaw) ? ownerRaw : me.id

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase
      .from('leads')
      .insert({ company_id: companyId, ...fields, owner_id: owner, created_by: me.id })
      .select('id')
      .single()
    if (data) {
      revalidatePath(`/c/${companyId}/leads`)
      redirect(`/c/${companyId}/leads/${data.id}`)
    }
    if (error?.code !== '23505') fail(back, error?.message ?? 'Could not save the lead.')
  }
  fail(back, 'Could not save the lead. Please try again.')
}

export async function updateLead(companyId: string, leadId: string, form: FormData) {
  const { me, supabase, back } = await start(companyId, `/c/${companyId}/leads/${leadId}`)
  if (!isUuid(leadId)) fail(back, 'Unknown lead.')
  const fields = readLead(form, back)
  const status = str(form, 'status') as LeadStatus
  if (!OPEN_LEAD_STATUSES.includes(status)) fail(back, 'Choose a stage.')
  const ownerRaw = str(form, 'owner_id')

  const { data: before } = await supabase.from('leads').select('status').eq('company_id', companyId).eq('id', leadId).maybeSingle()
  if (!before) fail(back, 'You can’t edit this lead.')
  if (!OPEN_LEAD_STATUSES.includes(before.status as LeadStatus)) fail(back, 'This lead is closed.')

  const { data, error } = await supabase
    .from('leads')
    .update({ ...fields, status, ...(me.role !== 'sales' && isUuid(ownerRaw) ? { owner_id: ownerRaw } : {}) })
    .eq('company_id', companyId).eq('id', leadId)
    .select('id')
  if (error) fail(back, error.message)
  if (!data?.length) fail(back, 'You can’t edit this lead.')
  if (before.status !== status) {
    const labels = { new: 'New', contacted: 'Contacted', proposal: 'Proposal sent' } as Record<string, string>
    await log(supabase, companyId, leadId, me.id, 'status', `Moved to ${labels[status]}`)
  }
  revalidatePath(`/c/${companyId}/leads`)
  redirect(`${back}?notice=${encodeURIComponent('Saved.')}`)
}

export async function addLeadActivity(companyId: string, leadId: string, form: FormData) {
  const { me, supabase, back } = await start(companyId, `/c/${companyId}/leads/${leadId}`)
  if (!isUuid(leadId)) fail(back, 'Unknown lead.')
  const kind = str(form, 'kind')
  const body = str(form, 'body')
  if (!(kind in LEAD_ACTIVITY_LABELS) || kind === 'status') fail(back, 'Choose what kind of entry this is.')
  if (!body) fail(back, 'Write what happened.')
  const { error } = await supabase.from('lead_activities').insert({
    company_id: companyId, lead_id: leadId, member_id: me.id, kind, body,
  })
  if (error) fail(back, error.message)
  // Optionally set the next follow-up in the same step.
  const followUp = str(form, 'next_follow_up')
  if (isDate(followUp)) {
    await supabase.from('leads').update({ next_follow_up: followUp }).eq('company_id', companyId).eq('id', leadId)
  }
  revalidatePath(`/c/${companyId}/leads`)
  redirect(`${back}#activity`)
}

export async function convertLead(companyId: string, leadId: string, form: FormData) {
  const { supabase, back } = await start(companyId, `/c/${companyId}/leads/${leadId}`)
  if (!isUuid(leadId)) fail(back, 'Unknown lead.')
  const title = str(form, 'title')
  const category = str(form, 'category_id')
  const deadline = str(form, 'deadline')
  const feeRaw = str(form, 'fee').replace(/,/g, '')
  const fee = feeRaw ? Number(feeRaw) : null
  const client = str(form, 'client_id')
  if (!title) fail(back, 'Enter a title for the task.')
  if (!isUuid(category)) fail(back, 'Choose a category.')
  if (deadline && !isDate(deadline)) fail(back, 'Choose a valid deadline.')
  if (fee !== null && (!Number.isFinite(fee) || fee < 0)) fail(back, 'Enter a valid fee.')

  const { data: taskId, error } = await supabase.rpc('convert_lead', {
    p_lead: leadId,
    p_title: title,
    p_category: category,
    p_deadline: deadline || undefined,
    p_fee: fee ?? undefined,
    p_client: isUuid(client) ? client : undefined,
  })
  if (error || !taskId) fail(back, error?.message ?? 'Could not convert the lead.')
  revalidatePath(`/c/${companyId}`, 'layout')
  redirect(`/c/${companyId}/tasks/${taskId}?notice=${encodeURIComponent('Lead won — task created. Owners and Admins were told if a hand-over is needed.')}`)
}

export async function markLeadLost(companyId: string, leadId: string, form: FormData) {
  const { me, supabase, back } = await start(companyId, `/c/${companyId}/leads/${leadId}`)
  if (!isUuid(leadId)) fail(back, 'Unknown lead.')
  const reason = str(form, 'lost_reason')
  if (!reason) fail(back, 'Say why the lead was lost — it helps later.')
  const { data, error } = await supabase
    .from('leads')
    .update({ status: 'lost', lost_reason: reason, closed_at: new Date().toISOString(), next_follow_up: null })
    .eq('company_id', companyId).eq('id', leadId).in('status', OPEN_LEAD_STATUSES)
    .select('id')
  if (error) fail(back, error.message)
  if (!data?.length) fail(back, 'This lead is already closed, or you can’t edit it.')
  await log(supabase, companyId, leadId, me.id, 'status', `Lost: ${reason}`)
  revalidatePath(`/c/${companyId}/leads`)
  redirect(back)
}

export async function reopenLead(companyId: string, leadId: string) {
  const { me, supabase, back } = await start(companyId, `/c/${companyId}/leads/${leadId}`)
  if (!isUuid(leadId)) fail(back, 'Unknown lead.')
  const { data, error } = await supabase
    .from('leads')
    .update({ status: 'contacted', lost_reason: null, closed_at: null })
    .eq('company_id', companyId).eq('id', leadId).eq('status', 'lost')
    .select('id')
  if (error) fail(back, error.message)
  if (!data?.length) fail(back, 'Only lost leads can be reopened.')
  await log(supabase, companyId, leadId, me.id, 'status', 'Reopened')
  revalidatePath(`/c/${companyId}/leads`)
  redirect(back)
}
