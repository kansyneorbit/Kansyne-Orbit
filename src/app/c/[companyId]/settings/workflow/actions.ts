'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { fail, isUuid, requireMember } from '@/lib/session'
import { ROLES, STAGE_KINDS, type Role, type StageKind } from '@/lib/types'

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim()

// Owner/Admin only. RLS enforces this too; checking here gives a clear message.
async function start(companyId: string) {
  if (!isUuid(companyId)) fail('/app', 'Unknown company.')
  const { member } = await requireMember(companyId)
  const back = `/c/${companyId}/settings/workflow`
  if (member.role !== 'owner' && member.role !== 'admin') fail(back, 'Only an Owner or Admin can change the workflow.')
  return { supabase: await createClient(), back }
}

function done(companyId: string, back: string): never {
  revalidatePath(`/c/${companyId}`, 'layout')
  redirect(back)
}

function friendly(message: string) {
  return message.includes('_company_name_key') ? 'That name is already used.' : message
}

function readStage(form: FormData, back: string) {
  const name = str(form, 'name')
  const kind = str(form, 'kind') as StageKind
  if (!name) fail(back, 'Enter a stage name.')
  if (!STAGE_KINDS.includes(kind)) fail(back, 'Choose what kind of stage this is.')
  const roles = form.getAll('allowed_roles').map(String).filter((r): r is Role => (ROLES as readonly string[]).includes(r))
  return { name, kind, allowed_roles: roles.length ? roles : null }
}

export async function addStage(companyId: string, form: FormData) {
  const { supabase, back } = await start(companyId)
  const fields = readStage(form, back)
  const { data: last } = await supabase
    .from('workflow_stages').select('position').eq('company_id', companyId)
    .order('position', { ascending: false }).limit(1).maybeSingle()
  const { error } = await supabase
    .from('workflow_stages')
    .insert({ company_id: companyId, ...fields, position: (last?.position ?? 0) + 1 })
  if (error) fail(back, friendly(error.message))
  done(companyId, back)
}

export async function updateStage(companyId: string, stageId: string, form: FormData) {
  const { supabase, back } = await start(companyId)
  if (!isUuid(stageId)) fail(back, 'Unknown stage.')
  const fields = readStage(form, back)
  const { error } = await supabase
    .from('workflow_stages')
    .update({ ...fields, is_active: form.get('is_active') === 'on' })
    .eq('company_id', companyId).eq('id', stageId)
  if (error) fail(back, friendly(error.message))
  done(companyId, back)
}

export async function shiftStage(companyId: string, stageId: string, direction: 'up' | 'down') {
  const { supabase, back } = await start(companyId)
  const { data: stages } = await supabase
    .from('workflow_stages').select('id, position').eq('company_id', companyId).order('position')
  const list = stages ?? []
  const i = list.findIndex((s) => s.id === stageId)
  const j = direction === 'up' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= list.length) done(companyId, back)
  const [a, b] = [list[i], list[j]]
  await supabase.from('workflow_stages').update({ position: b.position }).eq('company_id', companyId).eq('id', a.id)
  await supabase.from('workflow_stages').update({ position: a.position }).eq('company_id', companyId).eq('id', b.id)
  done(companyId, back)
}

export async function addCategory(companyId: string, form: FormData) {
  const { supabase, back } = await start(companyId)
  const name = str(form, 'name')
  if (!name) fail(back, 'Enter a category name.')
  const { data: last } = await supabase
    .from('categories').select('position').eq('company_id', companyId)
    .order('position', { ascending: false }).limit(1).maybeSingle()
  const { error } = await supabase
    .from('categories').insert({ company_id: companyId, name, position: (last?.position ?? 0) + 1 })
  if (error) fail(back, friendly(error.message))
  done(companyId, back)
}

export async function updateCategory(companyId: string, categoryId: string, form: FormData) {
  const { supabase, back } = await start(companyId)
  if (!isUuid(categoryId)) fail(back, 'Unknown category.')
  const name = str(form, 'name')
  if (!name) fail(back, 'Enter a category name.')
  const { error } = await supabase
    .from('categories')
    .update({ name, is_active: form.get('is_active') === 'on' })
    .eq('company_id', companyId).eq('id', categoryId)
  if (error) fail(back, friendly(error.message))
  done(companyId, back)
}
