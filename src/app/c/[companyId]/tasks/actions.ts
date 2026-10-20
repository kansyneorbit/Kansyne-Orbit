'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { fail, isUuid, requireMember } from '@/lib/session'
import { REVISION_TYPES } from '@/lib/types'

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim()

export async function createTask(companyId: string, form: FormData) {
  if (!isUuid(companyId)) fail('/app', 'Unknown company.')
  const { member } = await requireMember(companyId)
  const back = `/c/${companyId}/tasks/new`
  const supabase = await createClient()

  const title = str(form, 'title')
  const categoryId = str(form, 'category_id')
  if (!title) fail(back, 'Enter a title.')
  if (!isUuid(categoryId)) fail(back, 'Choose a category.')

  // Client: pick an existing one or create a new one with the next code.
  let clientId = str(form, 'client_id')
  if (clientId === 'new') {
    const clientName = str(form, 'client_name')
    if (!clientName) fail(back, 'Enter the new client’s name.')
    let created: string | null = null
    for (let attempt = 0; attempt < 2 && !created; attempt++) {
      const { data: code, error: codeErr } = await supabase.rpc('next_client_code', { p_company: companyId })
      if (codeErr || !code) fail(back, codeErr?.message ?? 'Could not number the client.')
      const { data, error } = await supabase
        .from('clients')
        .insert({
          company_id: companyId,
          code,
          name: clientName,
          email: str(form, 'client_email') || null,
          phone: str(form, 'client_phone') || null,
          created_by: member.id,
        })
        .select('id')
        .single()
      if (data) created = data.id
      else if (error?.code !== '23505') fail(back, error?.message ?? 'Could not save the client.')
    }
    if (!created) fail(back, 'Could not save the client. Please try again.')
    clientId = created
  } else if (!isUuid(clientId)) {
    fail(back, 'Choose a client.')
  }

  const { data: first } = await supabase
    .from('workflow_stages')
    .select('id')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('position')
    .limit(1)
    .single()
  if (!first) fail(back, 'Your workflow has no active stages. Add one in Workflow settings.')

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      company_id: companyId,
      title,
      description: str(form, 'description') || null,
      client_id: clientId,
      category_id: categoryId,
      stage_id: first.id,
      deadline: str(form, 'deadline') || null,
      created_by: member.id,
    })
    .select('id')
    .single()
  if (error || !task) fail(back, error?.message ?? 'Could not create the task.')

  const leadId = str(form, 'lead_id')
  if (isUuid(leadId)) {
    await supabase.from('task_assignees').insert({
      company_id: companyId,
      task_id: task.id,
      member_id: leadId,
      task_role: 'lead',
      is_primary: true,
    })
  }

  revalidatePath(`/c/${companyId}`)
  redirect(`/c/${companyId}/tasks/${task.id}`)
}

export async function moveTask(companyId: string, taskId: string, form: FormData) {
  if (!isUuid(companyId) || !isUuid(taskId)) fail('/app', 'Unknown task.')
  await requireMember(companyId)
  const back = `/c/${companyId}/tasks/${taskId}`
  const stageId = str(form, 'stage_id')
  if (!isUuid(stageId)) fail(back, 'Choose a stage.')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tasks')
    .update({ stage_id: stageId })
    .eq('company_id', companyId)
    .eq('id', taskId)
    .select('id')
  if (error) fail(back, error.message)
  if (!data?.length) fail(back, 'You can’t change this task. Ask a manager to assign you to it.')

  revalidatePath(`/c/${companyId}`)
  redirect(back)
}

// ---------- shared ----------

async function startTask(companyId: string, taskId: string) {
  if (!isUuid(companyId) || !isUuid(taskId)) fail('/app', 'Unknown task.')
  const { member } = await requireMember(companyId)
  return { me: member, supabase: await createClient(), back: `/c/${companyId}/tasks/${taskId}` }
}

function finish(back: string, anchor: string): never {
  revalidatePath(back)
  redirect(`${back}#${anchor}`)
}

// ---------- team on a task (owner/admin/manager; assignees update their own status) ----------

const TASK_ROLES = ['lead', 'contributor', 'reviewer'] as const
const ASSIGNMENT_STATUSES = ['pending', 'in_progress', 'completed'] as const

export async function addAssignee(companyId: string, taskId: string, form: FormData) {
  const { supabase, back } = await startTask(companyId, taskId)
  const memberId = str(form, 'member_id')
  const taskRole = str(form, 'task_role') as (typeof TASK_ROLES)[number]
  if (!isUuid(memberId)) fail(back, 'Choose a person.')
  if (!TASK_ROLES.includes(taskRole)) fail(back, 'Choose their part on this task.')

  const { error } = await supabase.from('task_assignees').insert({
    company_id: companyId, task_id: taskId, member_id: memberId,
    task_role: taskRole, is_primary: taskRole === 'lead',
  })
  if (error) fail(back, error.code === '23505' ? 'That person is already on this task.'
    : error.code === '42501' ? 'Only an Owner, Admin or Manager can assign people.' : error.message)
  revalidatePath(`/c/${companyId}`)
  finish(back, 'team')
}

export async function removeAssignee(companyId: string, taskId: string, assigneeId: string) {
  const { supabase, back } = await startTask(companyId, taskId)
  if (!isUuid(assigneeId)) fail(back, 'Unknown assignment.')
  const { data, error } = await supabase
    .from('task_assignees').delete()
    .eq('company_id', companyId).eq('task_id', taskId).eq('id', assigneeId)
    .select('id')
  if (error) fail(back, error.message)
  if (!data?.length) fail(back, 'Only an Owner, Admin or Manager can remove people.')
  revalidatePath(`/c/${companyId}`)
  finish(back, 'team')
}

export async function setAssignmentStatus(companyId: string, taskId: string, assigneeId: string, form: FormData) {
  const { supabase, back } = await startTask(companyId, taskId)
  const status = str(form, 'status') as (typeof ASSIGNMENT_STATUSES)[number]
  if (!isUuid(assigneeId) || !ASSIGNMENT_STATUSES.includes(status)) fail(back, 'Choose a status.')
  const { data, error } = await supabase
    .from('task_assignees')
    .update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null })
    .eq('company_id', companyId).eq('task_id', taskId).eq('id', assigneeId)
    .select('id')
  if (error) fail(back, error.message)
  if (!data?.length) fail(back, 'You can only update your own part of a task.')
  finish(back, 'team')
}

// ---------- comments (anyone who can see the task) ----------

export async function addComment(companyId: string, taskId: string, form: FormData) {
  const { me, supabase, back } = await startTask(companyId, taskId)
  const body = str(form, 'body')
  if (!body) fail(back, 'Write a comment first.')
  if (body.length > 10000) fail(back, 'That comment is too long.')
  const { error } = await supabase.from('comments').insert({
    company_id: companyId, task_id: taskId, author_id: me.id, body,
  })
  if (error) fail(back, error.message)
  finish(back, 'comments')
}

// ---------- revisions (people who can edit the task) ----------

export async function requestRevision(companyId: string, taskId: string, form: FormData) {
  const { me, supabase, back } = await startTask(companyId, taskId)
  const type = str(form, 'revision_type')
  const notes = str(form, 'notes')
  if (!(REVISION_TYPES as readonly string[]).includes(type)) fail(back, 'Choose what kind of revision this is.')
  if (!notes) fail(back, 'Describe what the client wants changed.')

  // Number revisions 1, 2, 3 per task; retry once if two people add one at the same moment.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: last } = await supabase
      .from('revisions').select('revision_no')
      .eq('company_id', companyId).eq('task_id', taskId)
      .order('revision_no', { ascending: false }).limit(1).maybeSingle()
    const revisionNo = (last?.revision_no ?? 0) + 1
    const { error } = await supabase.from('revisions').insert({
      company_id: companyId, task_id: taskId, revision_no: revisionNo,
      requested_by: me.id, revision_type: type, notes,
    })
    if (!error) {
      await supabase.from('tasks').update({ revision_count: revisionNo })
        .eq('company_id', companyId).eq('id', taskId)
      revalidatePath(`/c/${companyId}`)
      finish(back, 'revisions')
    }
    if (error.code === '42501') fail(back, 'Only people working on this task, or a Manager, can add revisions.')
    if (error.code !== '23505') fail(back, error.message)
  }
  fail(back, 'Could not save the revision. Please try again.')
}

export async function setRevisionResolved(companyId: string, taskId: string, revisionId: string, resolved: boolean) {
  const { supabase, back } = await startTask(companyId, taskId)
  if (!isUuid(revisionId)) fail(back, 'Unknown revision.')
  const { data, error } = await supabase
    .from('revisions')
    .update({ status: resolved ? 'resolved' : 'open', resolved_at: resolved ? new Date().toISOString() : null })
    .eq('company_id', companyId).eq('task_id', taskId).eq('id', revisionId)
    .select('id')
  if (error) fail(back, error.message)
  if (!data?.length) fail(back, 'Only people working on this task, or a Manager, can update revisions.')
  finish(back, 'revisions')
}

// ---------- hours (log your own, on tasks you can see) ----------

export async function logHours(companyId: string, taskId: string, form: FormData) {
  const { me, supabase, back } = await startTask(companyId, taskId)
  const hours = Number(str(form, 'hours'))
  const workDate = str(form, 'work_date')
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) fail(back, 'Enter hours between 0.25 and 24.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) fail(back, 'Choose the date you did the work.')

  const { data: task } = await supabase
    .from('tasks').select('stage_id').eq('company_id', companyId).eq('id', taskId).maybeSingle()
  const { error } = await supabase.from('time_logs').insert({
    company_id: companyId, task_id: taskId, member_id: me.id,
    stage_id: task?.stage_id ?? null,
    hours: Math.round(hours * 100) / 100,
    work_date: workDate,
    work_description: str(form, 'work_description') || null,
  })
  if (error) fail(back, error.message)
  finish(back, 'hours')
}

export async function deleteTimeLog(companyId: string, taskId: string, logId: string) {
  const { supabase, back } = await startTask(companyId, taskId)
  if (!isUuid(logId)) fail(back, 'Unknown entry.')
  const { data, error } = await supabase
    .from('time_logs').delete()
    .eq('company_id', companyId).eq('task_id', taskId).eq('id', logId)
    .select('id')
  if (error) fail(back, error.message)
  if (!data?.length) fail(back, 'You can only remove your own hours.')
  finish(back, 'hours')
}
