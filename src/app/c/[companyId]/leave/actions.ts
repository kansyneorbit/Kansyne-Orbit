'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { fail, isUuid, requireMember } from '@/lib/session'

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim()
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)

// All rules (who approves, working days, overlaps) live in the database RPCs.
async function start(companyId: string) {
  if (!isUuid(companyId)) fail('/app', 'Unknown company.')
  await requireMember(companyId)
  return { supabase: await createClient(), back: `/c/${companyId}/leave` }
}

function done(companyId: string, back: string, notice?: string): never {
  revalidatePath(`/c/${companyId}`, 'layout')
  redirect(notice ? `${back}?notice=${encodeURIComponent(notice)}` : back)
}

export async function applyLeave(companyId: string, form: FormData) {
  const { supabase, back } = await start(companyId)
  const type = str(form, 'leave_type_id')
  const startDate = str(form, 'start_date')
  const half = form.get('half_day') === 'on'
  const endDate = half ? startDate : str(form, 'end_date') || startDate
  if (!isUuid(type)) fail(back, 'Choose a leave type.')
  if (!isDate(startDate) || !isDate(endDate)) fail(back, 'Choose the dates.')
  const { error } = await supabase.rpc('apply_leave', {
    p_company: companyId, p_type: type, p_start: startDate, p_end: endDate,
    p_half: half, p_reason: str(form, 'reason') || undefined,
  })
  if (error) fail(back, error.message)
  done(companyId, back, 'Leave requested.')
}

export async function decideLeave(companyId: string, requestId: string, approve: boolean, form: FormData) {
  const { supabase, back } = await start(companyId)
  if (!isUuid(requestId)) fail(back, 'Unknown request.')
  const { error } = await supabase.rpc('decide_leave', {
    p_request: requestId, p_approve: approve, p_note: str(form, 'note') || undefined,
  })
  if (error) fail(back, error.message)
  done(companyId, back, approve ? 'Approved.' : 'Rejected.')
}

export async function cancelLeave(companyId: string, requestId: string) {
  const { supabase, back } = await start(companyId)
  if (!isUuid(requestId)) fail(back, 'Unknown request.')
  const { error } = await supabase.rpc('cancel_leave', { p_request: requestId })
  if (error) fail(back, error.message)
  done(companyId, back, 'Cancelled.')
}
