import Link from 'next/link'
import type { ReactNode } from 'react'
import { createClient } from '@/lib/supabase/server'
import { requireMember } from '@/lib/session'
import { formatDate, getStages, isOverdue } from '@/lib/data'
import { balanceOf, moneyFormatter, one, type PaymentRow } from '@/lib/money'
import { dateIn, todayIn } from '@/lib/periods'
import {
  FINANCE_ROLES, LEAD_ROLES, OPEN_LEAD_STATUSES, PEOPLE_ROLES, ROLE_LABELS, STAGE_KIND_LABELS,
  TASK_MANAGER_ROLES, canDecideLeave, type ApproverLevel, type LeadStatus, type StageKind,
} from '@/lib/types'
import { Card } from '@/components/ui'

export const metadata = { title: 'Home' }

type TaskRow = {
  id: string
  title: string
  deadline: string | null
  stage_id: string
  created_by: string | null
  clients: { name: string }
  task_assignees: { member_id: string }[]
}

function Tile({ label, value, href, tone, hint }: { label: string; value: ReactNode; href?: string; tone?: 'bad' | 'good'; hint?: string }) {
  const color = tone === 'bad' ? 'text-red-600 dark:text-red-400' : tone === 'good' ? 'text-green-600 dark:text-green-400' : ''
  const body = (
    <Card className={`h-full p-4 ${href ? 'transition-colors hover:border-brand/50' : ''}`}>
      <p className="text-xs text-faint">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-soft">{hint}</p>}
    </Card>
  )
  return href ? <Link href={href} className="block">{body}</Link> : body
}

function TaskList({ title, tasks, companyId, kindOf, empty, more }: {
  title: string
  tasks: TaskRow[]
  companyId: string
  kindOf: (t: TaskRow) => StageKind | undefined
  empty: string
  more?: { href: string; label: string }
}) {
  return (
    <Card>
      <h2 className="flex items-center justify-between border-b border-line px-5 py-3 text-sm font-semibold">
        <span>{title} <span className="font-normal text-faint">{tasks.length}</span></span>
        {more && <Link href={more.href} className="text-xs font-normal text-brand hover:underline">{more.label}</Link>}
      </h2>
      {tasks.length === 0 ? (
        <p className="px-5 py-4 text-sm text-soft">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {tasks.slice(0, 6).map((t) => {
            const kind = kindOf(t)
            return (
              <li key={t.id}>
                <Link href={`/c/${companyId}/tasks/${t.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-muted">
                  <span className="min-w-0 truncate"><span className="font-medium">{t.title}</span> <span className="text-faint">· {t.clients.name}</span></span>
                  {t.deadline && (
                    <span className={`shrink-0 text-xs ${kind && isOverdue(t.deadline, kind) ? 'font-medium text-red-600 dark:text-red-400' : 'text-faint'}`}>
                      {formatDate(t.deadline)}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
          {tasks.length > 6 && <li className="px-5 py-2 text-xs text-faint">and {tasks.length - 6} more</li>}
        </ul>
      )}
    </Card>
  )
}

export default async function HomePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params
  const { member: me, company } = await requireMember(companyId)
  const today = todayIn(company.timezone)
  const in7 = new Date(Date.parse(today) + 7 * 86400000).toISOString().slice(0, 10)
  const monthStart = today.slice(0, 8) + '01'
  const isManager = TASK_MANAGER_ROLES.includes(me.role)
  const seesMoney = FINANCE_ROLES.includes(me.role)
  const worksLeads = LEAD_ROLES.includes(me.role)
  const seesPeople = PEOPLE_ROLES.includes(me.role)
  const base = `/c/${companyId}`

  const supabase = await createClient()
  const [stages, { data: taskData }, { count: unread }, moneyRes, leadRes, leaveRes] = await Promise.all([
    getStages(companyId, { activeOnly: false }),
    supabase.from('tasks')
      .select('id, title, deadline, stage_id, created_by, clients(name), task_assignees(member_id)')
      .eq('company_id', companyId).order('deadline', { ascending: true, nullsFirst: false }).limit(2000),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('is_read', false),
    seesMoney
      ? supabase.from('tasks').select('task_financials!inner(total_amount), payments(kind, amount, status, received_at)').eq('company_id', companyId)
      : Promise.resolve({ data: null }),
    worksLeads
      ? supabase.from('leads').select('status, estimated_value, next_follow_up, won_at').eq('company_id', companyId)
      : Promise.resolve({ data: null }),
    seesPeople
      ? supabase.from('leave_requests').select('approver_level, member_id').eq('company_id', companyId).eq('status', 'pending')
      : Promise.resolve({ data: null }),
  ])

  const kindById = new Map(stages.map((s) => [s.id, s.kind]))
  const kindOf = (t: TaskRow) => kindById.get(t.stage_id)
  const tasks = (taskData ?? []) as unknown as TaskRow[]
  const live = tasks.filter((t) => kindOf(t) !== 'closed')

  const mine = live.filter((t) => t.task_assignees.some((a) => a.member_id === me.id) && kindOf(t) !== 'billing')
  const myOverdue = mine.filter((t) => isOverdue(t.deadline, kindOf(t) ?? 'active'))
  const myDueSoon = mine.filter((t) => t.deadline && t.deadline >= today && t.deadline <= in7)
  const broughtIn = live.filter((t) => t.created_by === me.id)

  const overdue = live.filter((t) => isOverdue(t.deadline, kindOf(t) ?? 'active'))
  const unassigned = live.filter((t) => t.task_assignees.length === 0)
  const byKind = (['open', 'active', 'waiting', 'billing'] as StageKind[]).map((k) => ({ k, n: live.filter((t) => kindOf(t) === k).length }))

  const fmt = moneyFormatter(company)
  let outstanding = 0, receivedMonth = 0
  for (const t of (moneyRes.data ?? []) as unknown as { task_financials: { total_amount: number } | { total_amount: number }[]; payments: PaymentRow[] }[]) {
    const fin = one(t.task_financials)
    if (fin) outstanding += Math.max(0, balanceOf(fin.total_amount, t.payments).due)
    for (const p of t.payments) {
      if (p.kind !== 'extra' && p.status !== 'pending' && p.received_at && dateIn(company.timezone, p.received_at) >= monthStart) receivedMonth += Number(p.amount)
    }
  }

  const leads = (leadRes.data ?? []) as { status: LeadStatus; estimated_value: number | null; next_follow_up: string | null; won_at: string | null }[]
  const openLeads = leads.filter((l) => OPEN_LEAD_STATUSES.includes(l.status))
  const followUps = openLeads.filter((l) => l.next_follow_up && l.next_follow_up <= today).length
  const pipeline = openLeads.reduce((s, l) => s + Number(l.estimated_value ?? 0), 0)
  const wonMonth = leads.filter((l) => l.status === 'won' && l.won_at && l.won_at.slice(0, 10) >= monthStart).length

  const toDecide = ((leaveRes.data ?? []) as { approver_level: ApproverLevel; member_id: string }[])
    .filter((r) => r.member_id !== me.id && canDecideLeave(me.role, r.approver_level)).length

  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: company.timezone, hour: 'numeric', hour12: false }).format(new Date()))
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{greeting}, {me.name.split(' ')[0]}</h1>
        <p className="text-sm text-soft">
          {new Date(today + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · {ROLE_LABELS[me.role]}
        </p>
      </div>

      {/* things that need you */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {me.role !== 'sales' && <Tile label="My overdue tasks" value={myOverdue.length} tone={myOverdue.length ? 'bad' : undefined} href={base} />}
        {me.role !== 'sales' && <Tile label="My tasks due in 7 days" value={myDueSoon.length} href={base} />}
        {me.role === 'sales' && <Tile label="Work I brought in, in progress" value={broughtIn.length} href={base} />}
        <Tile label="Unread notifications" value={unread ?? 0} href={`${base}/notifications`} tone={unread ? 'bad' : undefined} />
        {seesPeople && toDecide > 0 && <Tile label="Leave waiting for you" value={toDecide} href={`${base}/leave`} tone="bad" />}
        {isManager && <Tile label="Unassigned tasks" value={unassigned.length} hint="Need a Manager or team" tone={unassigned.length ? 'bad' : undefined} href={`#unassigned`} />}
        {worksLeads && <Tile label="Lead follow-ups due" value={followUps} tone={followUps ? 'bad' : undefined} href={`${base}/leads?view=due`} />}
      </div>

      {(seesMoney || worksLeads) && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {seesMoney && <Tile label="Outstanding" value={fmt(outstanding)} tone={outstanding ? 'bad' : undefined} href={`${base}/finance`} />}
          {seesMoney && <Tile label="Received this month" value={fmt(receivedMonth)} tone="good" href={`${base}/finance`} />}
          {worksLeads && <Tile label="Pipeline" value={fmt(pipeline)} hint={`${openLeads.length} open lead${openLeads.length === 1 ? '' : 's'}`} href={`${base}/leads`} />}
          {worksLeads && <Tile label="Leads won this month" value={wonMonth} tone={wonMonth ? 'good' : undefined} href={`${base}/leads?view=won`} />}
        </div>
      )}

      {isManager && (
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold">Work in progress</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {byKind.map(({ k, n }) => (
              <div key={k} className="rounded-md bg-muted p-3">
                <p className="text-xs text-faint">{STAGE_KIND_LABELS[k]}</p>
                <p className="text-xl font-semibold tabular-nums">{n}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {me.role === 'sales' ? (
          <TaskList title="Work I brought in" tasks={broughtIn} companyId={companyId} kindOf={kindOf} empty="Nothing in progress. Add a lead or a task." more={{ href: `${base}/leads`, label: 'Leads →' }} />
        ) : (
          <TaskList title="My tasks" tasks={mine} companyId={companyId} kindOf={kindOf} empty="Nothing assigned to you right now." more={{ href: base, label: 'All tasks →' }} />
        )}
        {isManager && <TaskList title="Overdue" tasks={overdue} companyId={companyId} kindOf={kindOf} empty="Nothing overdue." />}
        {isManager && (
          <div id="unassigned" className="scroll-mt-6">
            <TaskList title="Unassigned — hand to a Manager or team" tasks={unassigned} companyId={companyId} kindOf={kindOf} empty="Every open task has someone on it." />
          </div>
        )}
      </div>
    </div>
  )
}
