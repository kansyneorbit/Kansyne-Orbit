import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isUuid, requireMember } from '@/lib/session'
import { formatDate, getStages, isOverdue } from '@/lib/data'
import { ROLE_LABELS, type Role } from '@/lib/types'
import { Banner, Button, Card, PageHeader, Select } from '@/components/ui'
import { moveTask } from '../actions'

type Task = {
  id: string
  title: string
  description: string | null
  deadline: string | null
  stage_id: string
  created_at: string
  clients: { name: string; code: string; email: string | null; phone: string | null }
  categories: { name: string }
  task_assignees: { task_role: string; status: string; members: { name: string; role: Role } }[]
  stage_history: { from_stage_id: string | null; to_stage_id: string; changed_at: string; members: { name: string } | null }[]
}

export default async function TaskPage({ params, searchParams }: {
  params: Promise<{ companyId: string; taskId: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { companyId, taskId } = await params
  const { error } = await searchParams
  if (!isUuid(taskId)) notFound()
  await requireMember(companyId)

  const supabase = await createClient()
  const [allStages, { data }] = await Promise.all([
    getStages(companyId, { activeOnly: false }),
    supabase
      .from('tasks')
      .select(`id, title, description, deadline, stage_id, created_at,
        clients(name, code, email, phone), categories(name),
        task_assignees(task_role, status, members(name, role)),
        stage_history(from_stage_id, to_stage_id, changed_at, members(name))`)
      .eq('company_id', companyId)
      .eq('id', taskId)
      .order('changed_at', { referencedTable: 'stage_history', ascending: false })
      .maybeSingle(),
  ])
  if (!data) notFound()
  const task = data as unknown as Task
  const stageName = new Map(allStages.map((s) => [s.id, s.name]))
  const current = allStages.find((s) => s.id === task.stage_id)
  const activeStages = allStages.filter((s) => s.is_active)

  return (
    <>
      <PageHeader title={task.title} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-faint">Client</dt><dd className="font-medium">{task.clients.name} <span className="text-faint">· {task.clients.code}</span></dd></div>
              <div><dt className="text-faint">Category</dt><dd className="font-medium">{task.categories.name}</dd></div>
              <div>
                <dt className="text-faint">Deadline</dt>
                <dd className={`font-medium ${current && isOverdue(task.deadline, current.kind) ? 'text-red-600 dark:text-red-400' : ''}`}>
                  {task.deadline ? formatDate(task.deadline) : '—'}
                </dd>
              </div>
              <div><dt className="text-faint">Client contact</dt><dd>{[task.clients.email, task.clients.phone].filter(Boolean).join(' · ') || '—'}</dd></div>
            </dl>
            {task.description && <p className="mt-4 border-t border-line pt-4 text-sm whitespace-pre-wrap">{task.description}</p>}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">History</h2>
            <ol className="space-y-2 text-sm">
              {task.stage_history.map((h, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {h.from_stage_id ? <>{stageName.get(h.from_stage_id)} → </> : 'Created in '}
                    <strong>{stageName.get(h.to_stage_id)}</strong>
                    {h.members && <span className="text-soft"> by {h.members.name}</span>}
                  </span>
                  <span className="text-faint">{new Date(h.changed_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Stage</h2>
            <form action={moveTask.bind(null, companyId, taskId)} className="space-y-3">
              {error && <Banner>{error}</Banner>}
              <Select name="stage_id" defaultValue={task.stage_id}>
                {current && !current.is_active && <option value={current.id}>{current.name} (retired)</option>}
                {activeStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.allowed_roles ? ` — ${s.allowed_roles.map((r) => ROLE_LABELS[r]).join(', ')} only` : ''}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="secondary" className="w-full">Move task</Button>
            </form>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Team</h2>
            {task.task_assignees.length === 0 ? (
              <p className="text-sm text-soft">No one assigned yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {task.task_assignees.map((a, i) => (
                  <li key={i} className="flex justify-between">
                    <span>{a.members.name}</span>
                    <span className="text-faint capitalize">{a.task_role}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
