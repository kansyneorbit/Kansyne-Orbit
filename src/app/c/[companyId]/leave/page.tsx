import { createClient } from '@/lib/supabase/server'
import { requireMember } from '@/lib/session'
import { formatDate } from '@/lib/data'
import { todayIn } from '@/lib/periods'
import {
  LEAVE_STATUS_LABELS, PEOPLE_ROLES, canDecideLeave,
  type ApproverLevel, type LeaveStatus,
} from '@/lib/types'
import { Banner, Card, Input, PageHeader, Select } from '@/components/ui'
import { SubmitButton } from '@/components/submit-button'
import { applyLeave, cancelLeave, decideLeave } from './actions'

export const metadata = { title: 'Leave' }

type Balance = { leave_type_id: string; name: string; is_paid: boolean; tracks_balance: boolean; allowance: number; used: number; pending: number; remaining: number }
type Request = {
  id: string
  member_id: string
  start_date: string
  end_date: string
  half_day: boolean
  days: number
  reason: string | null
  status: LeaveStatus
  approver_level: ApproverLevel
  exceeds_balance: boolean
  decision_note: string | null
  leave_types: { name: string }
  members: { name: string }
}

const STATUS_STYLE: Record<LeaveStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  approved: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  cancelled: 'bg-muted text-faint',
}

const n = (v: number) => Number(v).toString()
const range = (r: Pick<Request, 'start_date' | 'end_date' | 'half_day'>) =>
  r.start_date === r.end_date ? `${formatDate(r.start_date)}${r.half_day ? ' (half day)' : ''}` : `${formatDate(r.start_date)} – ${formatDate(r.end_date)}`

export default async function LeavePage({ params, searchParams }: {
  params: Promise<{ companyId: string }>
  searchParams: Promise<{ error?: string; notice?: string }>
}) {
  const { companyId } = await params
  const { error, notice } = await searchParams
  const { member: me, company } = await requireMember(companyId)
  const today = todayIn(company.timezone)
  const year = Number(today.slice(0, 4))
  const seesTeam = PEOPLE_ROLES.includes(me.role)

  const supabase = await createClient()
  const in30 = new Date(Date.parse(today) + 30 * 86400000).toISOString().slice(0, 10)
  const [{ data: bal }, { data: mine }, { data: team }, { data: holidays }] = await Promise.all([
    supabase.rpc('leave_balance', { p_company: companyId, p_member: me.id, p_year: year }),
    supabase.from('leave_requests')
      .select('id, member_id, start_date, end_date, half_day, days, reason, status, approver_level, exceeds_balance, decision_note, leave_types(name), members!leave_requests_company_id_member_id_fkey(name)')
      .eq('company_id', companyId).eq('member_id', me.id)
      .order('start_date', { ascending: false }).limit(50),
    seesTeam
      ? supabase.from('leave_requests')
          .select('id, member_id, start_date, end_date, half_day, days, reason, status, approver_level, exceeds_balance, decision_note, leave_types(name), members!leave_requests_company_id_member_id_fkey(name)')
          .eq('company_id', companyId).neq('member_id', me.id)
          .or(`status.eq.pending,and(status.eq.approved,end_date.gte.${today},start_date.lte.${in30})`)
          .order('start_date')
      : Promise.resolve({ data: [] }),
    supabase.from('holidays').select('holiday_date, name').eq('company_id', companyId)
      .gte('holiday_date', today).order('holiday_date').limit(5),
  ])
  const balances = (bal ?? []) as Balance[]
  const myRequests = (mine ?? []) as unknown as Request[]
  const teamRequests = (team ?? []) as unknown as Request[]
  const toDecide = teamRequests.filter((r) => r.status === 'pending' && canDecideLeave(me.role, r.approver_level))
  const waitingOthers = teamRequests.filter((r) => r.status === 'pending' && !canDecideLeave(me.role, r.approver_level))
  const away = teamRequests.filter((r) => r.status === 'approved')

  return (
    <>
      <PageHeader title="Leave" />
      <div className="max-w-5xl space-y-6">
        {error && <Banner>{error}</Banner>}
        {notice && !error && <Banner tone="info">{notice}</Banner>}

        {toDecide.length > 0 && (
          <Card className="border-brand/50">
            <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Waiting for you <span className="font-normal text-faint">{toDecide.length}</span></h2>
            <ul className="divide-y divide-line">
              {toDecide.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">{r.members.name} · {r.leave_types.name} · {n(r.days)} day{Number(r.days) === 1 ? '' : 's'}</p>
                    <p className="text-soft">{range(r)}</p>
                    {r.reason && <p className="mt-1 text-soft">“{r.reason}”</p>}
                    {r.exceeds_balance && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">More than their remaining balance</p>}
                  </div>
                  <form className="flex flex-wrap items-center gap-2" action={decideLeave.bind(null, companyId, r.id, true)}>
                    <Input name="note" placeholder="Note (optional)" maxLength={300} className="w-48" aria-label="Note" />
                    <SubmitButton>Approve</SubmitButton>
                    <SubmitButton variant="danger" formAction={decideLeave.bind(null, companyId, r.id, false)}>Reject</SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {balances.map((b) => (
                <Card key={b.leave_type_id} className="p-4">
                  <p className="text-xs text-faint">{b.name}{!b.is_paid && ' (unpaid)'}</p>
                  {b.tracks_balance ? (
                    <>
                      <p className="mt-1 text-xl font-semibold tabular-nums">{n(b.remaining)}<span className="text-sm font-normal text-faint"> / {n(b.allowance)}</span></p>
                      <p className="text-xs text-soft">{n(b.used)} used{Number(b.pending) ? `, ${n(b.pending)} waiting` : ''}</p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-soft">{n(b.used)} taken {year}</p>
                  )}
                </Card>
              ))}
            </div>

            <Card>
              <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">My requests</h2>
              {myRequests.length === 0 ? (
                <p className="px-5 py-4 text-sm text-soft">No leave requested yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {myRequests.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                      <div className="min-w-0">
                        <p><span className="font-medium">{r.leave_types.name}</span> · {range(r)} · {n(r.days)} day{Number(r.days) === 1 ? '' : 's'}</p>
                        {r.decision_note && <p className="text-xs text-soft">Note: {r.decision_note}</p>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>{LEAVE_STATUS_LABELS[r.status]}</span>
                        {(r.status === 'pending' || (r.status === 'approved' && r.start_date > today)) && (
                          <form action={cancelLeave.bind(null, companyId, r.id)}><button className="text-xs text-soft hover:text-red-600">Cancel</button></form>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {seesTeam && (
              <Card>
                <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Team away in the next 30 days</h2>
                {away.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-soft">Nobody.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {away.map((r) => (
                      <li key={r.id} className="flex flex-wrap justify-between gap-2 px-5 py-2.5 text-sm">
                        <span><span className="font-medium">{r.members.name}</span> · {r.leave_types.name}</span>
                        <span className="text-soft">{range(r)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {waitingOthers.length > 0 && (
                  <p className="border-t border-line px-5 py-3 text-xs text-faint">
                    {waitingOthers.length} other request{waitingOthers.length === 1 ? '' : 's'} waiting for a more senior approver.
                  </p>
                )}
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold">Request leave</h2>
              <form action={applyLeave.bind(null, companyId)} className="space-y-3">
                <Select name="leave_type_id" required defaultValue="" aria-label="Leave type">
                  <option value="" disabled>Type of leave…</option>
                  {balances.map((b) => <option key={b.leave_type_id} value={b.leave_type_id}>{b.name}</option>)}
                </Select>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-faint">From<Input name="start_date" type="date" required defaultValue={today} className="mt-1" /></label>
                  <label className="block text-xs text-faint">To<Input name="end_date" type="date" className="mt-1" /></label>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="half_day" className="accent-brand" /> Half day (uses the From date)
                </label>
                <Input name="reason" maxLength={300} placeholder="Reason (optional)" aria-label="Reason" />
                <SubmitButton className="w-full" pendingText="Sending…">Request</SubmitButton>
                <p className="text-xs text-faint">Weekends and company holidays aren’t counted.</p>
              </form>
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold">Upcoming holidays</h2>
              {(holidays ?? []).length === 0 ? (
                <p className="text-sm text-soft">None added yet.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {(holidays ?? []).map((h) => (
                    <li key={h.holiday_date} className="flex justify-between gap-2"><span>{h.name}</span><span className="text-faint">{formatDate(h.holiday_date)}</span></li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}
