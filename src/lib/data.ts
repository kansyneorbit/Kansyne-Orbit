import { createClient } from '@/lib/supabase/server'
import type { Category, Stage } from '@/lib/types'

export async function getStages(companyId: string, { activeOnly = true } = {}) {
  const supabase = await createClient()
  let q = supabase
    .from('workflow_stages')
    .select('id, name, position, kind, allowed_roles, is_active')
    .eq('company_id', companyId)
    .order('position')
  if (activeOnly) q = q.eq('is_active', true)
  const { data } = await q
  return (data ?? []) as Stage[]
}

export async function getCategories(companyId: string, { activeOnly = true } = {}) {
  const supabase = await createClient()
  let q = supabase
    .from('categories')
    .select('id, name, position, is_active')
    .eq('company_id', companyId)
    .order('position')
  if (activeOnly) q = q.eq('is_active', true)
  const { data } = await q
  return (data ?? []) as Category[]
}

export function formatDate(value: string | null) {
  if (!value) return ''
  return new Date(value + (value.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  })
}

export function isOverdue(deadline: string | null, kind: string) {
  if (!deadline || kind === 'closed' || kind === 'billing') return false
  return deadline < new Date().toISOString().slice(0, 10)
}
