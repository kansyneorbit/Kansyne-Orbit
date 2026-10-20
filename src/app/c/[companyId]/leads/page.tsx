import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireMember } from '@/lib/session'
import { formatDate } from '@/lib/data'
import { moneyFormatter } from '@/lib/money'
import { todayIn } from '@/lib/periods'
import { LEAD_ROLES, LEAD_STATUS_LABELS, OPEN_LEAD_STATUSES, type LeadStatus } from '@/lib/types'
import { Banner, Card, PageHeader } from '@/components/ui'

export const metadata = { title: 'Leads' }

type Lead = {
  id: string
  lead_no: string
  contact_name: string
  organisation: string | null
  status: LeadStatus
  estimated_value: number | null
  next_follow_up: string | null
  won_at: string | null
  owner: { name: string } | null
}

const VIEWS = { open: 'Open', due: 'Follow-ups due', won: 'Won', lost: 'Lost', all: 'All' } as const
type View = keyof typeof VIEWS

const STATUS_STYLE: Record<LeadStatus, string> = {
  new: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  contacted: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
  proposal: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  won: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  lost: 'bg-muted text-faint',
}

export default async function LeadsPage({ params, searchParams }: {
  params: Promise<{ companyId: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { companyId } = await params
  const sp = await searchParams
  const { member: me, company } = await requireMember(companyId)
  if (!LEAD_ROLES.includes(me.role)) {
    return (<><PageHeader title="Leads" /><Banner tone="info">Leads are for Owners, Admins, Managers and Business Development.</Banner></>)
  }
  const view: View = sp.view && sp.view in VIEWS ? (sp.view as View) : 'open'
  const today = todayIn(company.timezone)
  const fmt = moneyFormatter(company)

  const supabase = await createClient()
  const { data } = await supabase
    .from('leads')
    .select('id, lead_no, contact_name, organisation, status, estimated_value, next_follow_up, won_at, owner:members!leads_company_id_owner_id_fkey(name)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1000)
  const all = (data ?? []) as unknown as Lead[]

  const open = all.filter((l) => OPEN_LEAD_STATUSES.includes(l.status))
  const due = open.filter((l) => l.next_follow_up && l.next_follow_up <= today)
  const monthStart = today.slice(0, 8) + '01'
  const wonThisMonth = all.filter((l) => l.status === 'won' && l.won_at && l.won_at.slice(0, 10) >= monthStart)
  const pipeline = open.reduce((s, l) => s + Number(l.estimated_value ?? 0), 0)

  const shown = {
    open,
    due,
    won: all.filter((l) => l.status === 'won'),
    lost: all.filter((l) => l.status === 'lost'),
    all,
  }[view].slice().sort((a, b) =>
    view === 'open' || view === 'due'
      ? (a.next_follow_up ?? '9999').localeCompare(b.next_follow_up ?? '9999')
      : 0)

  return (
    <>
      <PageHeader title="Leads">
        <Link href={`/c/${companyId}/leads/new`} className="rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-dark">Add lead</Link>
      </PageHeader>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-faint">Open leads</p><p className="mt-1 text-xl font-semibold">{open.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-faint">Pipeline value</p><p className="mt-1 text-xl font-semibold tabular-nums">{fmt(pipeline)}</p></Card>
        <Card className="p-4">
          <p className="text-xs text-faint">Follow-ups due</p>
          <p className={`mt-1 text-xl font-semibold ${due.length ? 'text-red-600 dark:text-red-400' : ''}`}>{due.length}</p>
        </Card>
        <Card className="p-4"><p className="text-xs text-faint">Won this month</p><p className="mt-1 text-xl font-semibold">{wonThisMonth.length}</p></Card>
      </div>

      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Lead views">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link key={v} href={`/c/${companyId}/leads?view=${v}`} aria-current={view === v ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${view === v ? 'border-brand bg-brand/10 font-medium text-brand' : 'border-line text-soft hover:bg-muted'}`}>
            {VIEWS[v]}{v === 'due' && due.length ? ` (${due.length})` : ''}
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? (
        <Card className="p-8 text-center text-sm text-soft">
          {all.length === 0 ? 'No leads yet. Add your first enquiry to start tracking it.' : 'Nothing here.'}
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-line text-left text-xs text-faint">
              <tr>
                <th className="px-4 py-2 font-medium">Lead</th>
                <th className="px-4 py-2 font-medium">Stage</th>
                <th className="px-4 py-2 font-medium">Owner</th>
                <th className="px-4 py-2 font-medium">Next follow-up</th>
                <th className="px-4 py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((l) => {
                const late = OPEN_LEAD_STATUSES.includes(l.status) && l.next_follow_up && l.next_follow_up <= today
                return (
                  <tr key={l.id} className="hover:bg-muted">
                    <td className="px-4 py-2">
                      <Link href={`/c/${companyId}/leads/${l.id}`} className="font-medium hover:text-brand">{l.contact_name}</Link>
                      <span className="block text-xs text-faint">{l.lead_no}{l.organisation ? ` · ${l.organisation}` : ''}</span>
                    </td>
                    <td className="px-4 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[l.status]}`}>{LEAD_STATUS_LABELS[l.status]}</span></td>
                    <td className="px-4 py-2 text-soft">{l.owner?.name ?? '—'}</td>
                    <td className={`px-4 py-2 ${late ? 'font-medium text-red-600 dark:text-red-400' : 'text-soft'}`}>
                      {l.next_follow_up ? (l.next_follow_up === today ? 'Today' : formatDate(l.next_follow_up)) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.estimated_value ? fmt(Number(l.estimated_value)) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  )
}
