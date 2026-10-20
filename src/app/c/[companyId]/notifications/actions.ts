'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { fail, isUuid, requireMember } from '@/lib/session'

// RLS limits both to the caller's own notifications.
export async function markAllRead(companyId: string) {
  if (!isUuid(companyId)) fail('/app', 'Unknown company.')
  await requireMember(companyId)
  const supabase = await createClient()
  await supabase.from('notifications').update({ is_read: true }).eq('company_id', companyId).eq('is_read', false)
  revalidatePath(`/c/${companyId}`, 'layout')
  redirect(`/c/${companyId}/notifications`)
}

export async function openNotification(companyId: string, notificationId: string, taskId: string | null) {
  if (!isUuid(companyId) || !isUuid(notificationId)) fail('/app', 'Unknown notification.')
  await requireMember(companyId)
  const supabase = await createClient()
  await supabase.from('notifications').update({ is_read: true }).eq('company_id', companyId).eq('id', notificationId)
  revalidatePath(`/c/${companyId}`, 'layout')
  redirect(taskId && isUuid(taskId) ? `/c/${companyId}/tasks/${taskId}` : `/c/${companyId}/notifications`)
}
