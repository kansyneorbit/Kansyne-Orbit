'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { fail, isUuid, requireMember } from '@/lib/session'

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
