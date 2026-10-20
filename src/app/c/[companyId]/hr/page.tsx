import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireMember } from '@/lib/session'
import { formatDate } from '@/lib/data'
import { PERIODS, resolvePeriod, todayIn } from '@/lib/periods'
import { HR_ADMIN_ROLES, PEOPLE_ROLES, ROLE_LABELS, type Role } from '@/lib/types'
import { Banner, Card, Input, PageHeader, Select } from '@/components/ui'
import { SubmitButton } from '@/components/submit-button'
import { addHoliday, removeAllowance, removeHoliday, saveLeaveType, setAllowance } from './actions'

export const metadata = { title: 'HR' }

type LeaveType = { id: string; name: string; is_paid: boolean; tracks_balance: boolean; yearly_allowance: number; is_active: boolean }
type Person = { id: string; name: string; role: Role; is_active: boolean }
type Log = { member_id: string; task_id: string; hours: number; work_date: string }
type Taken = { member_id: string; days: number; start_date: string }

export default async function HrPage({ params, searchParams }: {
  params: Promise<{ companyId: string }>
  searchParams: Promise<{ error?: string; period?: string; from?: string; to?: string }>
}) {
  const { companyId } = await params
  const sp = await searchParams
  const { member: me, company } = await requireMember(companyId)
  if (!PEOPLE_ROLES.includes(me.role)) {
    return (<><PageHeader title="HR" /><Banner tone="info">HR is for Owners, Admins, Managers and HR.</Banner></>)
  }
  const configures = HR_ADMIN_ROLES.includes(me.role)
  const today = todayIn(company.timezone)
  const year = Number(today.slice(0, 4))
  const range = resolvePeriod(sp.period, sp.from, sp.to, company.timezone)

  const supabase = await createClient()
  let logsQuery = supabase.from('time_logs').select('member_id, task_id, hours, work_date').eq('company_id', companyId)
  if (range.from) logsQuery = logsQuery.gte('work_date', range.from)
  if (range.to) logsQuery = logsQuery.lte('work_date', range.to)
  let leaveQuery = supabase.from('leave_requests').select('member_id, days, start_date').eq('company_id', companyId).eq('status', 'approved')
  if (range.from) leaveQuery = leaveQuery.gte('end_date', range.from)
  if (range.to) leaveQuery = leaveQuery.lte('start_date', range.to)

  const [{ data: typeData }, { data: holidayData }, { data: allocData }, { data: peopleData }, { data: logData }, { data: leaveData }] = await Promise.all([
    supabase.from('leave_types').select('id, name, is_paid, tracks_balance, yearly_allowance, is_active').eq('company_id', companyId).order('position'),
    supabase.from('holidays').select('id, holiday_date, name').eq('company_id', companyId)
      .gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year + 1}-12-31`).order('holiday_date'),
    supabase.from('leave_allocations').select('member_id, leave_type_id, year, days').eq('company_id', companyId).gte('year', year).order('year'),
    supabase.from('members').select('id, name, role, is_active').eq('company_id', companyId).order('name'),
    logsQuery.limit(20000),
    leaveQuery.limit(5000),
  ])
  const types = (typeData ?? []) as LeaveType[]
  const holidays = (holidayData ?? []) as { id: string; holiday_date: string; name: string }[]
  const allocations = (allocData ?? []) as { member_id: string; leave_type_id: string; year: number; days: number }[]
  const people = (peopleData ?? []) as Person[]
  const logs = (logData ?? []) as Log[]
  // Whole requests that overlap the period (a request spanning the edge counts in full).
  const leave = (leaveData ?? []) as Taken[]
  const nameOf = new Map(people.map((p) => [p.id, p.name]))
  const typeName = new Map(types.map((t) => [t.id, t.name]))

  // hours per person in the period
  const perPerson = new Map<string, { hours: number; tasks: Set<string>; days: Set<string> }>()
  for (const l of logs) {
    const row = perPerson.get(l.member_id) ?? { hours: 0, tasks: new Set(), days: new Set() }
    row.hours += Number(l.hours); row.tasks.add(l.task_id); row.days.add(l.work_date)
    perPerson.set(l.member_id, row)
  }
  const leaveDays = new Map<string, number>()
  for (const l of leave) leaveDays.set(l.member_id, (leaveDays.get(l.member_id) ?? 0) + Number(l.days))
  const report = people
    .filter((p) => p.is_active || perPerson.has(p.id))
    .map((p) => ({ ...p, ...(perPerson.get(p.id) ?? { hours: 0, tasks: new Set(), days: new Set() }), leave: leaveDays.get(p.id) ?? 0 }))
    .sort((a, b) => b.hours - a.hours)
  const totalHours = report.reduce((s, r) => s + r.hours, 0)
  const base = `/c/${companyId}/hr`
  const h = (n: number) => (Math.round(n * 100) / 100).toString()

  return (
    <>
      <PageHeader title="HR">
        {configures && <Link href={`${base}/profiles`} className="rounded-md border border-line px-3 py-1.5 text-sm text-soft hover:bg-muted">Employee profiles</Link>}
      </PageHeader>
      <div className="max-w-5xl space-y-8">
        {sp.error && <Banner>{sp.error}</Banner>}

        {/* hours report */}
        <section id="hours" className="scroll-mt-6">
          <h2 className="mb-1 text-base font-semibold">Hours report</h2>
          <p className="mb-3 text-sm text-soft">Hours logged on tasks, and approved leave overlapping the period.</p>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {Object.entries(PERIODS).map(([k, label]) => (
              <Link key={k} href={`${base}?period=${k}#hours`}
                className={`rounded-full border px-3 py-1 text-sm ${range.key === k ? 'border-brand bg-brand/10 font-medium text-brand' : 'border-line text-soft hover:bg-muted'}`}>{label}</Link>
            ))}
            <form className="flex flex-wrap items-center gap-2" action={base}>
              <input type="hidden" name="period" value="custom" />
              <Input type="date" name="from" defaultValue={range.key === 'custom' ? range.from ?? '' : ''} aria-label="From" className="w-auto py-1" />
              <span className="text-sm text-faint">to</span>
              <Input type="date" name="to" defaultValue={range.key === 'custom' ? range.to ?? '' : ''} aria-label="To" className="w-auto py-1" />
              <button className="rounded-full border border-line px-3 py-1 text-sm text-soft hover:bg-muted">Apply</button>
            </form>
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="border-b border-line text-left text-xs text-faint">
                <tr>
                  <th className="px-4 py-2 font-medium">Person</th>
                  <th className="px-4 py-2 text-right font-medium">Hours</th>
                  <th className="px-4 py-2 text-right font-medium">Days with hours</th>
                  <th className="px-4 py-2 text-right font-medium">Tasks</th>
                  <th className="px-4 py-2 text-right font-medium">Leave days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2"><span className="font-medium">{r.name}</span> <span className="text-xs text-faint">{ROLE_LABELS[r.role]}{r.is_active ? '' : ' · deactivated'}</span></td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{h(r.hours)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.days.size}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.tasks.size}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.leave ? h(r.leave) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-line text-sm">
                <tr><td className="px-4 py-2 font-medium">Total</td><td className="px-4 py-2 text-right font-semibold tabular-nums">{h(totalHours)}</td><td colSpan={3} /></tr>
              </tfoot>
            </table>
          </Card>
        </section>

        {configures && (
          <>
            {/* leave types */}
            <section id="leave-types" className="scroll-mt-6">
              <h2 className="mb-1 text-base font-semibold">Leave types</h2>
              <p className="mb-3 text-sm text-soft">Yearly allowance per person. Untick “Counts against a balance” for unlimited types like Loss of Pay.</p>
              <Card className="divide-y divide-line">
                {[...types, null].map((t) => (
                  <form key={t?.id ?? 'new'} action={saveLeaveType.bind(null, companyId, t?.id ?? null)}
                    className={`flex flex-wrap items-center gap-3 p-3 ${t && !t.is_active ? 'opacity-60' : ''}`}>
                    <Input name="name" defaultValue={t?.name ?? ''} placeholder={t ? '' : 'New leave type'} required maxLength={60} className="min-w-0 flex-1" aria-label="Leave type name" />
                    <label className="flex items-center gap-1.5 text-sm">
                      <Input name="yearly_allowance" type="number" step="0.5" min="0" max="366" defaultValue={t?.yearly_allowance ?? 0} className="w-20" aria-label="Days per year" /> days/yr
                    </label>
                    <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="is_paid" defaultChecked={t?.is_paid ?? true} className="accent-brand" /> Paid</label>
                    <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="tracks_balance" defaultChecked={t?.tracks_balance ?? true} className="accent-brand" /> Counts against a balance</label>
                    {t && <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="is_active" defaultChecked={t.is_active} className="accent-brand" /> In use</label>}
                    <SubmitButton variant={t ? 'secondary' : 'primary'}>{t ? 'Save' : 'Add'}</SubmitButton>
                  </form>
                ))}
              </Card>
            </section>

            {/* holidays */}
            <section id="holidays" className="scroll-mt-6">
              <h2 className="mb-1 text-base font-semibold">Holidays</h2>
              <p className="mb-3 text-sm text-soft">Not counted as leave days. Showing {year} and {year + 1}.</p>
              <Card className="divide-y divide-line">
                {holidays.map((hd) => (
                  <div key={hd.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span><span className="font-medium">{hd.name}</span> <span className="text-faint">· {formatDate(hd.holiday_date)} {hd.holiday_date.slice(0, 4)}</span></span>
                    <form action={removeHoliday.bind(null, companyId, hd.id)}><button className="text-xs text-soft hover:text-red-600">Remove</button></form>
                  </div>
                ))}
                <form action={addHoliday.bind(null, companyId)} className="flex flex-wrap items-center gap-3 p-3">
                  <Input name="holiday_date" type="date" required className="w-auto" aria-label="Holiday date" />
                  <Input name="name" required maxLength={100} placeholder="e.g. Diwali" className="min-w-0 flex-1" aria-label="Holiday name" />
                  <SubmitButton>Add holiday</SubmitButton>
                </form>
              </Card>
            </section>

            {/* per-person allowances */}
            <section id="allowances" className="scroll-mt-6">
              <h2 className="mb-1 text-base font-semibold">Individual allowances</h2>
              <p className="mb-3 text-sm text-soft">Give one person a different allowance for a year (e.g. a mid-year joiner).</p>
              <Card className="divide-y divide-line">
                {allocations.map((a) => (
                  <div key={`${a.member_id}-${a.leave_type_id}-${a.year}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span><span className="font-medium">{nameOf.get(a.member_id)}</span> · {typeName.get(a.leave_type_id)} {a.year}: <strong>{Number(a.days)}</strong> days</span>
                    <form action={removeAllowance.bind(null, companyId, a.member_id, a.leave_type_id, a.year)}><button className="text-xs text-soft hover:text-red-600">Remove</button></form>
                  </div>
                ))}
                <form action={setAllowance.bind(null, companyId)} className="flex flex-wrap items-center gap-3 p-3">
                  <Select name="member_id" required defaultValue="" className="w-auto" aria-label="Person">
                    <option value="" disabled>Person…</option>
                    {people.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                  <Select name="leave_type_id" required defaultValue="" className="w-auto" aria-label="Leave type">
                    <option value="" disabled>Leave type…</option>
                    {types.filter((t) => t.is_active && t.tracks_balance).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                  <Select name="year" defaultValue={String(year)} className="w-24" aria-label="Year">
                    {[year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
                  </Select>
                  <Input name="days" type="number" step="0.5" min="0" max="366" required placeholder="Days" className="w-24" aria-label="Days" />
                  <SubmitButton>Set</SubmitButton>
                </form>
              </Card>
            </section>
          </>
        )}
      </div>
    </>
  )
}
