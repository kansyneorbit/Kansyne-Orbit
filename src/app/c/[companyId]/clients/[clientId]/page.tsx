import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isUuid, requireMember } from '@/lib/session'
import { formatDate, getStages, isOverdue } from '@/lib/data'
import { balanceOf, moneyFormatter, one, type PaymentRow } from '@/lib/money'
import { FINANCE_ROLES, TASK_CREATOR_ROLES, TASK_MANAGER_ROLES } from '@/lib/types'
import { Banner, Card, Field, Input, PageHeader, Textarea } from '@/components/ui'
import { SubmitButton } from '@/components/submit-button'
import { updateClient } from '../actions'

type Client = {
  id: string
  code: string
  name: string
  organisation: string | null
  email: string | null
  phone: string | null
  notes: string | null
  created_by: string | null
  created_at: string
}

type TaskRow = {
  id: string
  title: string
  deadline: string | null
  stage_id: string
  created_at: string
  categories: { name: string }
  task_financials?: { total_amount: number } | { total_amount: number }[] | null
  payments?: Pick<PaymentRow, 'kind' | 'amount' | 'status'>[]
}

export default async function ClientPage({ params, searchParams }: {
  params: Promise<{ companyId: string; clientId: string }>
  searchParams: Promise<{ error?: string; notice?: string }>
}) {
  const { companyId, clientId } = await params
  const { error, notice } = await searchParams
  if (!isUuid(clientId)) notFound()
  const { member: me, company } = await requireMember(companyId)
  const seesMoney = FINANCE_ROLES.includes(me.role)

  const supabase = await createClient()
  const [stages, { data: clientData }, { data: taskData }] = await Promise.all([
    getStages(companyId, { activeOnly: false }),
    supabase.from('clients')
      .select('id, code, name, organisation, email, phone, notes, created_by, created_at')
      .eq('company_id', companyId).eq('id', clientId).maybeSingle(),
    supabase.from('tasks')
      .select(seesMoney
        ? 'id, title, deadline, stage_id, created_at, categories(name), task_financials(total_amount), payments(kind, amount, status)'
        : 'id, title, deadline, stage_id, created_at, categories(name)')
      .eq('company_id', companyId).eq('client_id', clientId)
      .order('created_at', { ascending: false }),
  ])
  if (!clientData) notFound()
  const client = clientData as Client
  const tasks = (taskData ?? []) as unknown as TaskRow[]
  const stageById = new Map(stages.map((s) => [s.id, s]))
  const canEdit = TASK_MANAGER_ROLES.includes(me.role) || (me.role === 'sales' && client.created_by === me.id)
  const canCreateTask = TASK_CREATOR_ROLES.includes(me.role)

  const fmt = moneyFormatter(company)
  const money = tasks.reduce((acc, t) => {
    const fin = one(t.task_financials)
    if (!fin) return acc
    const b = balanceOf(fin.total_amount, t.payments ?? [])
    return { owed: acc.owed + b.owed, paid: acc.paid + b.paid, due: acc.due + Math.max(0, b.due) }
  }, { owed: 0, paid: 0, due: 0 })

  return (
    <>
      <PageHeader title={client.name}>
        {canCreateTask && (
          <Link href={`/c/${companyId}/tasks/new?client=${client.id}`} className="rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-dark">
            New task for this client
          </Link>
        )}
      </PageHeader>
      {error && <div className="mb-6"><Banner>{error}</Banner></div>}
      {notice && !error && <div className="mb-6"><Banner tone="info">{notice}</Banner></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {seesMoney && tasks.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <Card className="p-4"><p className="text-xs text-faint">Billed</p><p className="mt-1 text-lg font-semibold tabular-nums">{fmt(money.owed)}</p></Card>
              <Card className="p-4"><p className="text-xs text-faint">Paid</p><p className="mt-1 text-lg font-semibold tabular-nums">{fmt(money.paid)}</p></Card>
              <Card className="p-4">
                <p className="text-xs text-faint">Outstanding</p>
                <p className={`mt-1 text-lg font-semibold tabular-nums ${money.due > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{fmt(money.due)}</p>
              </Card>
            </div>
          )}

          <Card>
            <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Tasks <span className="font-normal text-faint">{tasks.length}</span></h2>
            {tasks.length === 0 ? (
              <p className="px-5 py-4 text-sm text-soft">No tasks you can see for this client.</p>
            ) : (
              <ul className="divide-y divide-line">
                {tasks.map((t) => {
                  const stage = stageById.get(t.stage_id)
                  return (
                    <li key={t.id}>
                      <Link href={`/c/${companyId}/tasks/${t.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-muted">
                        <span className="min-w-0">
                          <span className="block font-medium">{t.title}</span>
                          <span className="text-xs text-faint">{t.categories.name} · added {formatDate(t.created_at.slice(0, 10))}</span>
                        </span>
                        <span className="flex items-center gap-3 text-xs">
                          {t.deadline && (
                            <span className={stage && isOverdue(t.deadline, stage.kind) ? 'font-medium text-red-600 dark:text-red-400' : 'text-faint'}>
                              Due {formatDate(t.deadline)}
                            </span>
                          )}
                          <span className="rounded bg-muted px-1.5 py-0.5 text-soft">{stage?.name ?? '—'}</span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>

        <Card className="h-fit p-5">
          <h2 className="mb-1 text-sm font-semibold">Details</h2>
          <p className="mb-4 text-xs text-faint">{client.code} · added {formatDate(client.created_at.slice(0, 10))}</p>
          {canEdit ? (
            <form action={updateClient.bind(null, companyId, client.id)} className="space-y-3">
              <Field label="Name"><Input name="name" defaultValue={client.name} required maxLength={200} /></Field>
              <Field label="Organisation"><Input name="organisation" defaultValue={client.organisation ?? ''} maxLength={200} /></Field>
              <Field label="Email"><Input name="email" type="email" defaultValue={client.email ?? ''} /></Field>
              <Field label="Phone"><Input name="phone" defaultValue={client.phone ?? ''} maxLength={40} /></Field>
              <Field label="Notes"><Textarea name="notes" rows={3} defaultValue={client.notes ?? ''} /></Field>
              <SubmitButton variant="secondary" className="w-full">Save</SubmitButton>
            </form>
          ) : (
            <dl className="space-y-3 text-sm">
              <div><dt className="text-faint">Organisation</dt><dd>{client.organisation ?? '—'}</dd></div>
              <div><dt className="text-faint">Email</dt><dd>{client.email ?? '—'}</dd></div>
              <div><dt className="text-faint">Phone</dt><dd>{client.phone ?? '—'}</dd></div>
              {client.notes && <div><dt className="text-faint">Notes</dt><dd className="whitespace-pre-wrap">{client.notes}</dd></div>}
            </dl>
          )}
        </Card>
      </div>
    </>
  )
}
