'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { fail, isUuid, requireMember } from '@/lib/session'
import { ROLES, type Role } from '@/lib/types'

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim()

// Owner/Admin only. RLS and the members_guard trigger enforce the real rules
// (only an Owner manages Owners; nobody changes their own role or deactivates
// themselves); checking here gives clear messages.
async function start(companyId: string) {
  if (!isUuid(companyId)) fail('/app', 'Unknown company.')
  const { member } = await requireMember(companyId)
  const back = `/c/${companyId}/team`
  if (member.role !== 'owner' && member.role !== 'admin') fail(back, 'Only an Owner or Admin can manage the team.')
  return { me: member, supabase: await createClient(), back }
}

function readRole(form: FormData, back: string, myRole: Role): Role {
  const role = str(form, 'role') as Role
  if (!ROLES.includes(role)) fail(back, 'Choose a role.')
  if (role === 'owner' && myRole !== 'owner') fail(back, 'Only an Owner can make someone an Owner.')
  return role
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

export async function inviteMember(companyId: string, form: FormData) {
  const { me, supabase, back } = await start(companyId)
  const name = str(form, 'name')
  const email = str(form, 'email').toLowerCase()
  const role = readRole(form, back, me.role)
  if (!name) fail(back, 'Enter their name.')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(back, 'Enter a valid email address.')

  const { error } = await supabase
    .from('members')
    .insert({ company_id: companyId, name, email, role, avatar_initials: initials(name) })
  if (error) {
    fail(back, error.code === '23505'
      ? 'That email is already on your team. If they were deactivated, reactivate them below.'
      : error.message)
  }
  revalidatePath(back)
  redirect(`${back}?invited=${encodeURIComponent(email)}`)
}

export async function updateMember(companyId: string, memberId: string, form: FormData) {
  const { me, supabase, back } = await start(companyId)
  if (!isUuid(memberId)) fail(back, 'Unknown team member.')
  if (memberId === me.id) fail(back, 'You can’t change your own role.')
  const name = str(form, 'name')
  if (!name) fail(back, 'Enter their name.')
  const role = readRole(form, back, me.role)

  const { data, error } = await supabase
    .from('members')
    .update({ name, role, avatar_initials: initials(name) })
    .eq('company_id', companyId).eq('id', memberId)
    .select('id')
  if (error) fail(back, error.message)
  if (!data?.length) fail(back, 'Could not update that team member.')
  revalidatePath(back)
  redirect(back)
}

export async function setMemberActive(companyId: string, memberId: string, active: boolean) {
  const { me, supabase, back } = await start(companyId)
  if (!isUuid(memberId)) fail(back, 'Unknown team member.')
  if (memberId === me.id) fail(back, 'You can’t deactivate yourself.')

  const { data, error } = await supabase
    .from('members')
    .update({ is_active: active })
    .eq('company_id', companyId).eq('id', memberId)
    .select('id')
  if (error) fail(back, error.message)
  if (!data?.length) fail(back, 'Could not update that team member.')
  revalidatePath(back)
  redirect(back)
}
