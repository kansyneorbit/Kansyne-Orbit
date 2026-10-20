import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isUuid, requireMember } from '@/lib/session'
import { formatDate, getStages, isOverdue } from '@/lib/data'
import {
  ASSIGNMENT_STATUS_LABELS, FINANCE_ROLES, REVISION_TYPES, ROLE_LABELS, TASK_ROLE_LABELS,
  type Member, type Role,
} from '@/lib/types'
import { Banner, Card, Input, PageHeader, Select, Textarea } from '@/components/ui'
import { SubmitButton } from '@/components/submit-button'
import {
  addAssignee, addComment, deleteTimeLog, logHours, moveTask, removeAssignee,
  requestRevision, setAssignmentStatus, setRevisionResolved,
} from '../actions'
import { MoneyCard } from './money-card'

type Assignee = {
  id: string
  member_id: string
  task_role: keyof typeof TASK_ROLE_LABELS
  status: keyof typeof ASSIGNMENT_STATUS_LABELS
  members: { name: string; role: Role }
}

type Task = {
  id: string
  title: string
  description: string | null
  deadline: string | null
  stage_id: string
  clients: { name: string; code: string; email: string | null; phone: string | null }
  categories: { name: string }
  task_assignees: Assignee[]
  stage_history: { id: string; from_stage_id: string | null; to_stage_id: string; changed_at: string; members: { name: string } | null }[]
  comments: { id: string; body: string; created_at: string; members: { name: string } }[]
  revisions: { id: string; revision_no: number; revision_type: string | null; notes: string | null; status: 'open' | 'resolved'; created_at: string; members: { name: string } | null }[]
}

type TimeLog = { id: string; member_id: string; hours: number; work_date: string; work_description: string | null; members: { name: string } }

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
const hoursText = (n: number) => `${Number(n).toFixed(2).replace(/\.?0+$/, '')} h`

function SectionTitle({ id, children, extra }: { id: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-3 flex scroll-mt-6 items-center justify-between text-sm font-semibold">
      <span>{children}</span>
      {extra && <span className="text-xs font-normal text-faint">{extra}</span>}
    </h2>
  )
}

export default async function TaskPage({ params, searchParams }: {
  params: Promise<{ companyId: string; taskId: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { companyId, taskId } = await params
  const { error } = await searchParams
  if (!isUuid(taskId)) notFound()
  const { member: me, company } = await requireMember(companyId)

  const supabase = await createClient()
  const [allStages, { data }, { data: logData }, { data: teamData }] = await Promise.all([
    getStages(companyId, { activeOnly: false }),
    supabase
      .from('tasks')
      .select(`id, title, description, deadline, stage_id,
        clients(name, code, email, phone), categories(name),
        task_assignees(id, member_id, task_role, status, members(name, role)),
        stage_history(id, from_stage_id, to_stage_id, changed_at, members(name)),
        comments(id, body, created_at, members(name)),
        revisions(id, revision_no, revision_type, notes, status, created_at, members(name))`)
      .eq('company_id', companyId)
      .eq('id', taskId)
      .order('changed_at', { referencedTable: 'stage_history', ascending: false })
      .order('created_at', { referencedTable: 'comments', ascending: true })
      .order('revision_no', { referencedTable: 'revisions', ascending: false })
      .maybeSingle(),
    supabase
      .from('time_logs')
      .select('id, member_id, hours, work_date, work_description, members(name)')
      .eq('company_id', companyId)
      .eq('task_id', taskId)
      .order('work_date', { ascending: false })
      .order('logged_at', { ascending: false }),
    supabase
      .from('members')
      .select('id, name, role')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('name'),
  ])
  if (!data) notFound()
  const task = data as unknown as Task
  const logs = (logData ?? []) as unknown as TimeLog[]
  const team = (teamData ?? []) as Pick<Member, 'id' | 'name' | 'role'>[]

  const stageName = new Map(allStages.map((s) => [s.id, s.name]))
  const current = allStages.find((s) => s.id === task.stage_id)
  const activeStages = allStages.filter((s) => s.is_active)

  const canManage = ['owner', 'admin', 'manager'].includes(me.role)
  const mine = task.task_assignees.find((a) => a.member_id === me.id)
  const canEdit = canManage || !!mine
  const seesAllHours = ['owner', 'admin', 'manager', 'hr'].includes(me.role)
  const unassigned = team.filter((m) => !task.task_assignees.some((a) => a.member_id === m.id))
  const totalHours = logs.reduce((sum, l) => sum + Number(l.hours), 0)
  const openRevisions = task.revisions.filter((r) => r.status === 'open').length
  const today = new Date().toISOString().slice(0, 10)

  return (
    <>
      <PageHeader title={task.title} />
      {error && <div className="mb-6"><Banner>{error}</Banner></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---------- main column ---------- */}
        <div className="min-w-0 space-y-6 lg:col-span-2">
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

          {/* comments */}
          <Card className="p-5">
            <SectionTitle id="comments" extra={task.comments.length || undefined}>Comments</SectionTitle>
            {task.comments.length === 0 ? (
              <p className="mb-4 text-sm text-soft">No comments yet.</p>
            ) : (
              <ul className="mb-4 space-y-4">
                {task.comments.map((c) => (
                  <li key={c.id} className="text-sm">
                    <p className="mb-1 text-xs text-faint"><span className="font-medium text-ink">{c.members.name}</span> · {when(c.created_at)}</p>
                    <p className="whitespace-pre-wrap">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <form action={addComment.bind(null, companyId, taskId)} className="space-y-2">
              <Textarea name="body" rows={3} required maxLength={10000} placeholder="Write a comment…" aria-label="New comment" />
              <div className="flex justify-end"><SubmitButton variant="secondary" pendingText="Posting…">Post comment</SubmitButton></div>
            </form>
          </Card>

          {/* revisions */}
          <Card className="p-5">
            <SectionTitle id="revisions" extra={task.revisions.length ? `${openRevisions} open of ${task.revisions.length}` : undefined}>
              Revisions
            </SectionTitle>
            {task.revisions.length === 0 ? (
              <p className="mb-4 text-sm text-soft">No revisions requested.</p>
            ) : (
              <ul className="mb-4 divide-y divide-line">
                {task.revisions.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0">
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">
                        #{r.revision_no} · {r.revision_type ?? 'Revision'}{' '}
                        <span className={`ml-1 rounded px-1.5 py-0.5 text-xs font-medium ${r.status === 'open'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'}`}>
                          {r.status === 'open' ? 'Open' : 'Resolved'}
                        </span>
                      </p>
                      {r.notes && <p className="mt-1 whitespace-pre-wrap text-soft">{r.notes}</p>}
                      <p className="mt-1 text-xs text-faint">{r.members?.name ?? 'Someone'} · {when(r.created_at)}</p>
                    </div>
                    {canEdit && (
                      <form action={setRevisionResolved.bind(null, companyId, taskId, r.id, r.status === 'open')}>
                        <SubmitButton variant="secondary">{r.status === 'open' ? 'Mark resolved' : 'Reopen'}</SubmitButton>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <details className="rounded-md border border-line p-3">
                <summary className="cursor-pointer text-sm font-medium">Record a revision request</summary>
                <form action={requestRevision.bind(null, companyId, taskId)} className="mt-3 space-y-3">
                  <Select name="revision_type" required defaultValue="" aria-label="Kind of revision">
                    <option value="" disabled>What kind of change?</option>
                    {REVISION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                  <Textarea name="notes" rows={3} required placeholder="What does the client want changed?" aria-label="Revision details" />
                  <div className="flex justify-end"><SubmitButton>Add revision</SubmitButton></div>
                </form>
              </details>
            )}
          </Card>

          {/* history */}
          <Card className="p-5">
            <SectionTitle id="history">History</SectionTitle>
            <ol className="space-y-2 text-sm">
              {task.stage_history.map((h) => (
                <li key={h.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {h.from_stage_id ? <>{stageName.get(h.from_stage_id)} → </> : 'Created in '}
                    <strong>{stageName.get(h.to_stage_id)}</strong>
                    {h.members && <span className="text-soft"> by {h.members.name}</span>}
                  </span>
                  <span className="text-faint">{when(h.changed_at)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        {/* ---------- side column ---------- */}
        <div className="min-w-0 space-y-6">
          <Card className="p-5">
            <SectionTitle id="stage">Stage</SectionTitle>
            {canEdit ? (
              <form action={moveTask.bind(null, companyId, taskId)} className="space-y-3">
                <Select name="stage_id" defaultValue={task.stage_id} aria-label="Stage">
                  {current && !current.is_active && <option value={current.id}>{current.name} (retired)</option>}
                  {activeStages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.allowed_roles ? ` — ${s.allowed_roles.map((r) => ROLE_LABELS[r]).join(', ')} only` : ''}
                    </option>
                  ))}
                </Select>
                <SubmitButton variant="secondary" className="w-full">Move task</SubmitButton>
              </form>
            ) : (
              <p className="text-sm font-medium">{current?.name}</p>
            )}
          </Card>

          {/* team */}
          <Card className="p-5">
            <SectionTitle id="team">People on this task</SectionTitle>
            {task.task_assignees.length === 0 ? (
              <p className="mb-3 text-sm text-soft">No one assigned yet.</p>
            ) : (
              <ul className="mb-3 space-y-3 text-sm">
                {task.task_assignees.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{a.members.name}{a.member_id === me.id && <span className="text-faint"> (you)</span>}</p>
                      <p className="text-xs text-faint">{TASK_ROLE_LABELS[a.task_role]} · {ASSIGNMENT_STATUS_LABELS[a.status]}</p>
                    </div>
                    {canManage && (
                      <form action={removeAssignee.bind(null, companyId, taskId, a.id)}>
                        <button className="text-xs text-soft hover:text-red-600" aria-label={`Remove ${a.members.name}`}>Remove</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {mine && (
              <form action={setAssignmentStatus.bind(null, companyId, taskId, mine.id)} className="mb-3 flex gap-2 border-t border-line pt-3">
                <Select name="status" defaultValue={mine.status} aria-label="Your status on this task">
                  {Object.entries(ASSIGNMENT_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>My part: {l}</option>)}
                </Select>
                <SubmitButton variant="secondary">Update</SubmitButton>
              </form>
            )}

            {canManage && unassigned.length > 0 && (
              <form action={addAssignee.bind(null, companyId, taskId)} className="space-y-2 border-t border-line pt-3">
                <Select name="member_id" required defaultValue="" aria-label="Person to add">
                  <option value="" disabled>Add a person…</option>
                  {unassigned.map((m) => <option key={m.id} value={m.id}>{m.name} — {ROLE_LABELS[m.role]}</option>)}
                </Select>
                <div className="flex gap-2">
                  <Select name="task_role" defaultValue={task.task_assignees.length ? 'contributor' : 'lead'} aria-label="Their part">
                    {Object.entries(TASK_ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                  <SubmitButton>Add</SubmitButton>
                </div>
              </form>
            )}
          </Card>

          {FINANCE_ROLES.includes(me.role) && <MoneyCard companyId={companyId} taskId={taskId} company={company} myRole={me.role} />}

          {/* hours */}
          <Card className="p-5">
            <SectionTitle id="hours" extra={logs.length ? `${hoursText(totalHours)}${seesAllHours ? ' total' : ' by you'}` : undefined}>
              Hours
            </SectionTitle>
            <form action={logHours.bind(null, companyId, taskId)} className="mb-4 space-y-2">
              <div className="flex gap-2">
                <Input name="hours" type="number" step="0.25" min="0.25" max="24" required placeholder="Hours" aria-label="Hours worked" className="w-24" />
                <Input name="work_date" type="date" required defaultValue={today} max={today} aria-label="Date worked" />
              </div>
              <Input name="work_description" maxLength={500} placeholder="What did you work on? (optional)" aria-label="Work description" />
              <SubmitButton variant="secondary" className="w-full" pendingText="Saving…">Log hours</SubmitButton>
            </form>
            {logs.length > 0 && (
              <ul className="space-y-2 border-t border-line pt-3 text-sm">
                {logs.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p><span className="font-medium">{hoursText(l.hours)}</span> <span className="text-faint">· {formatDate(l.work_date)}{seesAllHours && ` · ${l.members.name}`}</span></p>
                      {l.work_description && <p className="truncate text-xs text-soft" title={l.work_description}>{l.work_description}</p>}
                    </div>
                    {l.member_id === me.id && (
                      <form action={deleteTimeLog.bind(null, companyId, taskId, l.id)}>
                        <button className="text-xs text-soft hover:text-red-600" aria-label="Remove this entry">Remove</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!seesAllHours && <p className="mt-3 text-xs text-faint">You see only your own hours.</p>}
          </Card>
        </div>
      </div>
    </>
  )
}
