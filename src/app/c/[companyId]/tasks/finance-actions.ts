'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { fail, isUuid, requireMember } from '@/lib/session'
import { FINANCE_ROLES, PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS, type PaymentKind, type PaymentStatus } from '@/lib/types'

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim()

// Owner, Admin, Manager and Accounts. RLS (can_see_financials) enforces the same.
async function start(companyId: string, taskId: string) {
  if (!isUuid(companyId) || !isUuid(taskId)) fail('/app', 'Unknown task.')
  const { member } = await requireMember(companyId)
  const back = `/c/${companyId}/tasks/${taskId}`
  if (!FINANCE_ROLES.includes(member.role)) fail(back, 'Only an Owner, Admin, Manager or Accounts can change money details.')
  return { me: member, supabase: await createClient(), back }
}

function done(companyId: string, back: string): never {
  revalidatePath(back)
  revalidatePath(`/c/${companyId}/finance`)
  redirect(`${back}#money`)
}

function readAmount(raw: string, back: string, { allowZero = false } = {}) {
  const n = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0) || n >= 1e10) fail(back, 'Enter a valid amount.')
  return Math.round(n * 100) / 100
}

export async function saveTaskFinancials(companyId: string, taskId: string, form: FormData) {
  const { supabase, back } = await start(companyId, taskId)
  const invoiceDate = str(form, 'invoice_date')
  if (invoiceDate && !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) fail(back, 'Choose a valid invoice date.')
  const { error } = await supabase.from('task_financials').upsert(
    {
      task_id: taskId,
      company_id: companyId,
      total_amount: readAmount(str(form, 'total_amount') || '0', back, { allowZero: true }),
      invoice_no: str(form, 'invoice_no') || null,
      invoice_date: invoiceDate || null,
      notes: str(form, 'notes') || null,
    },
    { onConflict: 'task_id' },
  )
  if (error) fail(back, error.message)
  done(companyId, back)
}

export async function addPayment(companyId: string, taskId: string, form: FormData) {
  const { me, supabase, back } = await start(companyId, taskId)
  const kind = str(form, 'kind') as PaymentKind
  if (!(kind in PAYMENT_KIND_LABELS)) fail(back, 'Choose what kind of amount this is.')
  // Extras are charges, not money in, so they have no "received" state.
  const status: PaymentStatus = kind === 'extra' ? 'pending' : str(form, 'received') === 'on' ? 'received' : 'pending'

  // A task needs its money row before payments make sense in reports.
  await supabase.from('task_financials').upsert(
    { task_id: taskId, company_id: companyId }, { onConflict: 'task_id', ignoreDuplicates: true },
  )
  const { error } = await supabase.from('payments').insert({
    company_id: companyId,
    task_id: taskId,
    kind,
    amount: readAmount(str(form, 'amount'), back),
    reason: str(form, 'reason') || null,
    status,
    received_at: status === 'received' ? new Date().toISOString() : null,
    recorded_by: me.id,
  })
  if (error) fail(back, error.message)
  done(companyId, back)
}

export async function setPaymentStatus(companyId: string, taskId: string, paymentId: string, status: PaymentStatus) {
  const { supabase, back } = await start(companyId, taskId)
  if (!isUuid(paymentId) || !(status in PAYMENT_STATUS_LABELS)) fail(back, 'Unknown payment.')
  const { data, error } = await supabase
    .from('payments')
    // Verifying keeps the date the money arrived; un-receiving clears it.
    .update(status === 'verified' ? { status }
      : { status, received_at: status === 'pending' ? null : new Date().toISOString() })
    .eq('company_id', companyId).eq('task_id', taskId).eq('id', paymentId).neq('kind', 'extra')
    .select('id')
  if (error) fail(back, error.message)
  if (!data?.length) fail(back, 'Could not update that payment.')
  done(companyId, back)
}

export async function deletePayment(companyId: string, taskId: string, paymentId: string) {
  const { supabase, back } = await start(companyId, taskId)
  if (!isUuid(paymentId)) fail(back, 'Unknown payment.')
  const { data, error } = await supabase
    .from('payments').delete()
    .eq('company_id', companyId).eq('task_id', taskId).eq('id', paymentId)
    .select('id')
  if (error) fail(back, error.message)
  if (!data?.length) fail(back, 'Could not remove that entry.')
  done(companyId, back)
}
