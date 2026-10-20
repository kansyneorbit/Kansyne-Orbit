'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { fail, isUuid, requireMember } from '@/lib/session'
import { HR_ADMIN_ROLES } from '@/lib/types'

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim()

// Owner/Admin/HR. RLS enforces the same.
async function start(companyId: string) {
  if (!isUuid(companyId)) fail('/app', 'Unknown company.')
  const { member } = await requireMember(companyId)
  const back = `/c/${companyId}/hr`
  if (!HR_ADMIN_ROLES.includes(member.role)) fail(back, 'Only an Owner, Admin or HR can change leave settings.')
  return { supabase: await createClient(), back }
}

function done(companyId: string, back: string, anchor: string): never {
  revalidatePath(`/c/${companyId}`, 'layout')
  redirect(`${back}#${anchor}`)
}

function readDays(raw: string, back: string) {
  const d = Number(raw)
  if (!Number.isFinite(d) || d < 0 || d > 366) fail(back, 'Enter days between 0 and 366.')
  return Math.round(d * 2) / 2 // half days only
}

function friendly(message: string) {
  if (message.includes('leave_types_company_name_key')) return 'There is already a leave type with that name.'
  if (message.includes('holidays_company_date_key')) return 'There is already a holiday on that date.'
  return message
}

export async function saveLeaveType(companyId: string, typeId: string | null, form: FormData) {
  const { supabase, back } = await start(companyId)
  const name = str(form, 'name')
  if (!name) fail(back, 'Enter a name for the leave type.')
  const fields = {
    name,
    yearly_allowance: readDays(str(form, 'yearly_allowance') || '0', back),
    is_paid: form.get('is_paid') === 'on',
    tracks_balance: form.get('tracks_balance') === 'on',
  }
  if (typeId) {
    if (!isUuid(typeId)) fail(back, 'Unknown leave type.')
    const { error } = await supabase.from('leave_types')
      .update({ ...fields, is_active: form.get('is_active') === 'on' })
      .eq('company_id', companyId).eq('id', typeId)
    if (error) fail(back, friendly(error.message))
  } else {
    const { data: last } = await supabase.from('leave_types').select('position')
      .eq('company_id', companyId).order('position', { ascending: false }).limit(1).maybeSingle()
    const { error } = await supabase.from('leave_types')
      .insert({ company_id: companyId, ...fields, position: (last?.position ?? 0) + 1 })
    if (error) fail(back, friendly(error.message))
  }
  done(companyId, back, 'leave-types')
}

export async function addHoliday(companyId: string, form: FormData) {
  const { supabase, back } = await start(companyId)
  const date = str(form, 'holiday_date')
  const name = str(form, 'name')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) fail(back, 'Enter a date and a name.')
  const { error } = await supabase.from('holidays').insert({ company_id: companyId, holiday_date: date, name })
  if (error) fail(back, friendly(error.message))
  done(companyId, back, 'holidays')
}

export async function removeHoliday(companyId: string, holidayId: string) {
  const { supabase, back } = await start(companyId)
  if (!isUuid(holidayId)) fail(back, 'Unknown holiday.')
  const { error } = await supabase.from('holidays').delete().eq('company_id', companyId).eq('id', holidayId)
  if (error) fail(back, error.message)
  done(companyId, back, 'holidays')
}

export async function setAllowance(companyId: string, form: FormData) {
  const { supabase, back } = await start(companyId)
  const memberId = str(form, 'member_id')
  const typeId = str(form, 'leave_type_id')
  const year = Number(str(form, 'year'))
  if (!isUuid(memberId) || !isUuid(typeId)) fail(back, 'Choose a person and a leave type.')
  if (!Number.isInteger(year) || year < 2020 || year > 2100) fail(back, 'Choose a year.')
  const { error } = await supabase.from('leave_allocations').upsert(
    { company_id: companyId, member_id: memberId, leave_type_id: typeId, year, days: readDays(str(form, 'days'), back) },
    { onConflict: 'member_id,leave_type_id,year' },
  )
  if (error) fail(back, error.message)
  done(companyId, back, 'allowances')
}

export async function remindProfile(companyId: string, memberId: string) {
  const { supabase } = await start(companyId)
  const back = `/c/${companyId}/hr/profiles`
  if (!isUuid(memberId)) fail(back, 'Unknown person.')
  const { error } = await supabase.rpc('remind_profile', { p_company: companyId, p_member: memberId })
  if (error) fail(back, error.message)
  const { data } = await supabase.from('members').select('name').eq('company_id', companyId).eq('id', memberId).maybeSingle()
  redirect(`${back}?reminded=${encodeURIComponent(data?.name ?? 'them')}`)
}

export async function removeAllowance(companyId: string, memberId: string, typeId: string, year: number) {
  const { supabase, back } = await start(companyId)
  if (!isUuid(memberId) || !isUuid(typeId)) fail(back, 'Unknown allowance.')
  const { error } = await supabase.from('leave_allocations').delete()
    .eq('company_id', companyId).eq('member_id', memberId).eq('leave_type_id', typeId).eq('year', year)
  if (error) fail(back, error.message)
  done(companyId, back, 'allowances')
}
