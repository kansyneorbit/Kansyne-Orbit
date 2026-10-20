'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { fail, isUuid, requireMember } from '@/lib/session'
import { HR_ADMIN_ROLES } from '@/lib/types'
import { DOC_KINDS, DOC_TYPES, HR_DOCS_BUCKET, MAX_DOC_BYTES, PROFILE_TEXT_FIELDS, type DocKind } from '@/lib/profile'

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim()

// The person themselves or Owner/Admin/HR. RLS enforces the same.
async function start(companyId: string, memberId: string) {
  if (!isUuid(companyId)) fail('/app', 'Unknown company.')
  const { member } = await requireMember(companyId)
  const back = `/c/${companyId}/profile/${memberId}`
  if (!isUuid(memberId)) fail(`/c/${companyId}/profile`, 'Unknown person.')
  if (memberId !== member.id && !HR_ADMIN_ROLES.includes(member.role)) fail(`/c/${companyId}/profile`, 'You can only edit your own profile.')
  return { supabase: await createClient(), back }
}

function done(back: string, anchor: string): never {
  revalidatePath(back)
  redirect(`${back}?saved=1#${anchor}`)
}

export async function saveProfile(companyId: string, memberId: string, form: FormData) {
  const { supabase, back } = await start(companyId, memberId)
  const fields: Record<string, string | null> = {}
  for (const k of PROFILE_TEXT_FIELDS) fields[k] = str(form, k) || null
  if (fields.date_of_birth && (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date_of_birth) || fields.date_of_birth > new Date().toISOString().slice(0, 10)))
    fail(back, 'Enter a valid date of birth.')
  if (fields.personal_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.personal_email)) fail(back, 'Enter a valid personal email.')
  if (fields.bank_ifsc) fields.bank_ifsc = fields.bank_ifsc.toUpperCase()
  if (form.get('same_address') === 'on') fields.permanent_address = fields.correspondence_address

  const { error } = await supabase.from('employee_profiles')
    .upsert({ company_id: companyId, member_id: memberId, ...fields }, { onConflict: 'member_id' })
  if (error) fail(back, error.message.includes('check constraint') ? 'Some details are too long or not valid.' : error.message)

  // Blank keeps the saved number; "remove" clears it.
  const number = str(form, 'bank_account_number')
  if (number || form.get('clear_bank_number') === 'on') {
    const { error: numErr } = await supabase.rpc('set_bank_account_number', {
      p_company: companyId, p_member: memberId, p_number: form.get('clear_bank_number') === 'on' ? '' : number,
    })
    if (numErr) fail(back, numErr.message)
  }
  done(back, 'details')
}

export async function uploadDoc(companyId: string, memberId: string, kind: DocKind, form: FormData) {
  const { supabase, back } = await start(companyId, memberId)
  if (!(kind in DOC_KINDS)) fail(back, 'Unknown document.')
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) fail(back, 'Choose a file to upload.')
  const ext = DOC_TYPES[file.type]
  if (!ext) fail(back, 'Upload a PDF, JPG, PNG or WebP file.')
  if (file.size > MAX_DOC_BYTES) fail(back, 'Files can be at most 4 MB.')

  const column = DOC_KINDS[kind].column
  const { data: current } = await supabase.from('employee_profiles').select(column)
    .eq('company_id', companyId).eq('member_id', memberId).maybeSingle()
  const oldPath = (current as Record<string, string | null> | null)?.[column] ?? null

  const path = `${companyId}/${memberId}/${kind}-${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage.from(HR_DOCS_BUCKET).upload(path, file, { contentType: file.type })
  if (upErr) fail(back, `Upload failed: ${upErr.message}`)
  const { error } = await supabase.from('employee_profiles')
    .upsert({ company_id: companyId, member_id: memberId, [column]: path }, { onConflict: 'member_id' })
  if (error) {
    await supabase.storage.from(HR_DOCS_BUCKET).remove([path])
    fail(back, error.message)
  }
  if (oldPath) await supabase.storage.from(HR_DOCS_BUCKET).remove([oldPath])
  done(back, 'documents')
}

export async function removeDoc(companyId: string, memberId: string, kind: DocKind) {
  const { supabase, back } = await start(companyId, memberId)
  if (!(kind in DOC_KINDS)) fail(back, 'Unknown document.')
  const column = DOC_KINDS[kind].column
  const { data: current } = await supabase.from('employee_profiles').select(column)
    .eq('company_id', companyId).eq('member_id', memberId).maybeSingle()
  const oldPath = (current as Record<string, string | null> | null)?.[column] ?? null
  if (!oldPath) done(back, 'documents')
  const { error } = await supabase.from('employee_profiles').update({ [column]: null })
    .eq('company_id', companyId).eq('member_id', memberId)
  if (error) fail(back, error.message)
  await supabase.storage.from(HR_DOCS_BUCKET).remove([oldPath])
  done(back, 'documents')
}
