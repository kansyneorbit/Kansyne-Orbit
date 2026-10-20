import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isUuid, requireMember } from '@/lib/session'
import { formatDate, getCategories } from '@/lib/data'
import { moneyFormatter } from '@/lib/money'
import { todayIn } from '@/lib/periods'
import {
  LEAD_ACTIVITY_LABELS, LEAD_ROLES, LEAD_STATUS_LABELS, OPEN_LEAD_STATUSES,
  type LeadStatus, type Role,
} from '@/lib/types'
import { Banner, Card, Input, PageHeader, Select, Textarea } from '@/components/ui'
import { SubmitButton } from '@/components/submit-button'
import { addLeadActivity, convertLead, markLeadLost, reopenLead, updateLead } from '../actions'
import { LeadFields } from '../lead-fields'

type Lead = {
  id: string
  lead_no: string
  contact_name: string
  organisation: string | null
  phone: string | null
  email: string | null
  source: string | null
  category_id: string | null
  requirement: string | null
  estimated_value: number | null
  status: LeadStatus
  owner_id: string | null
  next_follow_up: string | null
  lost_reason: string | null
  client_id: string | null
  task_id: string | null
  created_at: string
  lead_activities: { id: string; kind: keyof typeof LEAD_ACTIVITY_LABELS; body: string; created_at: string; members: { name: string } }[]
}

export default async function LeadPage({ params, searchParams }: {
  params: Promise<{ companyId: string; leadId: string }>
  searchParams: Promise<{ error?: string; notice?: string }>
}) {
  const { companyId, leadId } = await params
  const { error, notice } = await searchParams
  if (!isUuid(leadId)) notFound()
  const { member: me, company } = await requireMember(companyId)
  if (!LEAD_ROLES.includes(me.role)) notFound()

  const supabase = await createClient()
  const [categories, { data }, { data: people }, { data: clients }] = await Promise.all([
    getCategories(companyId),
    supabase.from('leads')
      .select(`id, lead_no, contact_name, organisation, phone, email, source, category_id, requirement,
        estimated_value, status, owner_id, next_follow_up, lost_reason, client_id, task_id, created_at,
        lead_activities(id, kind, body, created_at, members(name))`)
      .eq('company_id', companyId).eq('id', leadId)
      .order('created_at', { referencedTable: 'lead_activities', ascending: false })
      .maybeSingle(),
    me.role === 'sales'
      ? Promise.resolve({ data: null })
      : supabase.from('members').select('id, name, role').eq('company_id', companyId).eq('is_active', true).in('role', LEAD_ROLES).order('name'),
    supabase.from('clients').select('id, name, code').eq('company_id', companyId).order('name').limit(500),
  ])
  if (!data) notFound()
  const lead = data as unknown as Lead
  const isOpen = OPEN_LEAD_STATUSES.includes(lead.status)
  const today = todayIn(company.timezone)
  const fmt = moneyFormatter(company)
  const late = isOpen && lead.next_follow_up && lead.next_follow_up <= today

  return (
    <>
      <PageHeader title={`${lead.contact_name}${lead.organisation ? ` · ${lead.organisation}` : ''}`} />
      <p className="-mt-4 mb-6 text-sm text-soft">
        {lead.lead_no} · <span className="font-medium">{LEAD_STATUS_LABELS[lead.status]}</span>
        {lead.estimated_value ? ` · ${fmt(Number(lead.estimated_value))}` : ''}
        {late && <span className="font-medium text-red-600 dark:text-red-400"> · follow-up due {lead.next_follow_up === today ? 'today' : formatDate(lead.next_follow_up!)}</span>}
      </p>
      {error && <div className="mb-6"><Banner>{error}</Banner></div>}
      {notice && !error && <div className="mb-6"><Banner tone="info">{notice}</Banner></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {lead.status === 'won' && (
            <Banner tone="info">
              Won. {lead.task_id && <Link href={`/c/${companyId}/tasks/${lead.task_id}`} className="font-medium underline">Open the task</Link>}
              {lead.client_id && <> · <Link href={`/c/${companyId}/clients/${lead.client_id}`} className="font-medium underline">Open the client</Link></>}
            </Banner>
          )}
          {lead.status === 'lost' && (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm"><span className="font-medium">Lost:</span> {lead.lost_reason}</p>
              <form action={reopenLead.bind(null, companyId, lead.id)}><SubmitButton variant="secondary">Reopen</SubmitButton></form>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold">Details</h2>
            {isOpen ? (
              <form action={updateLead.bind(null, companyId, lead.id)} className="space-y-4">
                <label className="block max-w-xs space-y-1.5">
                  <span className="text-sm font-medium">Stage</span>
                  <Select name="status" defaultValue={lead.status}>
                    {OPEN_LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}
                  </Select>
                </label>
                <LeadFields values={lead} categories={categories} owners={people ? (people as { id: string; name: string; role: Role }[]) : undefined} />
                <SubmitButton variant="secondary">Save</SubmitButton>
              </form>
            ) : (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-faint">Phone</dt><dd>{lead.phone ?? '—'}</dd></div>
                <div><dt className="text-faint">Email</dt><dd>{lead.email ?? '—'}</dd></div>
                <div><dt className="text-faint">Source</dt><dd>{lead.source ?? '—'}</dd></div>
                <div><dt className="text-faint">Type of work</dt><dd>{categories.find((c) => c.id === lead.category_id)?.name ?? '—'}</dd></div>
                {lead.requirement && <div className="sm:col-span-2"><dt className="text-faint">Need</dt><dd className="whitespace-pre-wrap">{lead.requirement}</dd></div>}
              </dl>
            )}
          </Card>

          <Card className="p-5">
            <h2 id="activity" className="mb-4 scroll-mt-6 text-sm font-semibold">Activity</h2>
            {isOpen && (
              <form action={addLeadActivity.bind(null, companyId, lead.id)} className="mb-5 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Select name="kind" defaultValue="call" className="w-32" aria-label="Kind">
                    {(['call', 'email', 'meeting', 'note'] as const).map((k) => <option key={k} value={k}>{LEAD_ACTIVITY_LABELS[k]}</option>)}
                  </Select>
                  <label className="flex items-center gap-2 text-xs text-faint">
                    Next follow-up <Input name="next_follow_up" type="date" min={today} className="w-auto py-1.5" />
                  </label>
                </div>
                <Textarea name="body" rows={2} required placeholder="What happened? e.g. Called, sent proposal, waiting for approval" aria-label="Activity" />
                <SubmitButton variant="secondary">Log</SubmitButton>
              </form>
            )}
            {lead.lead_activities.length === 0 ? (
              <p className="text-sm text-soft">Nothing logged yet.</p>
            ) : (
              <ol className="space-y-3">
                {lead.lead_activities.map((a) => (
                  <li key={a.id} className="text-sm">
                    <p className="text-xs text-faint">
                      <span className="font-medium text-ink">{LEAD_ACTIVITY_LABELS[a.kind]}</span> · {a.members.name} ·{' '}
                      {new Date(a.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                    <p className="whitespace-pre-wrap">{a.body}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        {isOpen && (
          <div className="min-w-0 space-y-6">
            <Card className="border-green-300 p-5 dark:border-green-900">
              <h2 className="mb-1 text-sm font-semibold">Won it?</h2>
              <p className="mb-4 text-xs text-soft">Creates the client (or uses an existing one) and the task in one step.</p>
              <form action={convertLead.bind(null, companyId, lead.id)} className="space-y-3">
                <label className="block text-xs text-faint">Task title
                  <Input name="title" required maxLength={200} defaultValue={lead.organisation ? `${lead.organisation} — ${lead.contact_name}` : lead.contact_name} className="mt-1" />
                </label>
                <label className="block text-xs text-faint">Category
                  <Select name="category_id" required defaultValue={lead.category_id ?? ''} className="mt-1">
                    <option value="" disabled>Choose…</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </label>
                <label className="block text-xs text-faint">Client
                  <Select name="client_id" defaultValue="" className="mt-1">
                    <option value="">New client from this lead</option>
                    {(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} · {c.code}</option>)}
                  </Select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-faint">Agreed fee<Input name="fee" type="number" step="0.01" min="0" defaultValue={lead.estimated_value ?? ''} className="mt-1" /></label>
                  <label className="block text-xs text-faint">Deadline<Input name="deadline" type="date" className="mt-1" /></label>
                </div>
                <SubmitButton className="w-full" pendingText="Converting…">Mark won &amp; create task</SubmitButton>
              </form>
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold">Lost it?</h2>
              <form action={markLeadLost.bind(null, companyId, lead.id)} className="space-y-2">
                <Input name="lost_reason" required maxLength={300} placeholder="Reason, e.g. price, chose someone else" aria-label="Why it was lost" />
                <SubmitButton variant="danger" className="w-full">Mark lost</SubmitButton>
              </form>
            </Card>
          </div>
        )}
      </div>
    </>
  )
}
