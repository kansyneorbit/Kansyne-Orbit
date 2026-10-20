import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireMember } from '@/lib/session'
import { balanceOf, moneyFormatter, one, type PaymentRow } from '@/lib/money'
import { FINANCE_ROLES, TASK_CREATOR_ROLES } from '@/lib/types'
import { Banner, Card, Field, Input, PageHeader } from '@/components/ui'
import { SubmitButton } from '@/components/submit-button'
import { addClient } from './actions'

export const metadata = { title: 'Clients' }

type Row = {
  id: string
  code: string
  name: string
  organisation: string | null
  email: string | null
  phone: string | null
  tasks: {
    id: string
    task_financials: { total_amount: number } | { total_amount: number }[] | null
    payments: Pick<PaymentRow, 'kind' | 'amount' | 'status'>[]
  }[]
}

export default async function ClientsPage({ params, searchParams }: {
  params: Promise<{ companyId: string }>
  searchParams: Promise<{ q?: string; error?: string }>
}) {
  const { companyId } = await params
  const { q = '', error } = await searchParams
  const { member: me, company } = await requireMember(companyId)
  const seesMoney = FINANCE_ROLES.includes(me.role)
  const canAdd = TASK_CREATOR_ROLES.includes(me.role)

  const supabase = await createClient()
  let query = supabase
    .from('clients')
    .select(seesMoney
      ? 'id, code, name, organisation, email, phone, tasks(id, task_financials(total_amount), payments(kind, amount, status))'
      : 'id, code, name, organisation, email, phone, tasks(id)')
    .eq('company_id', companyId)
    .order('name')
    .limit(500)
  const term = q.trim().replace(/[%,()]/g, ' ').slice(0, 80)
  if (term) query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%,organisation.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`)
  const { data } = await query
  const rows = (data ?? []) as unknown as Row[]
  const fmt = moneyFormatter(company)
  const outstanding = (r: Row) => r.tasks.reduce((sum, t) => {
    const fin = one(t.task_financials)
    return fin ? sum + Math.max(0, balanceOf(fin.total_amount, t.payments ?? []).due) : sum
  }, 0)

  return (
    <>
      <PageHeader title="Clients" />
      <div className="max-w-5xl space-y-6">
        {error && <Banner>{error}</Banner>}

        <form className="flex gap-2" action={`/c/${companyId}/clients`}>
          <Input name="q" defaultValue={q} placeholder="Search by name, code, organisation, email or phone" aria-label="Search clients" />
          <button className="rounded-md border border-line bg-surface px-4 text-sm hover:bg-muted">Search</button>
        </form>

        {rows.length === 0 ? (
          <Card className="p-8 text-center text-sm text-soft">
            {term ? 'No clients match that search.' : 'No clients yet.'}
          </Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="border-b border-line text-left text-xs text-faint">
                <tr>
                  <th className="px-4 py-2 font-medium">Client</th>
                  <th className="px-4 py-2 font-medium">Contact</th>
                  <th className="px-4 py-2 text-right font-medium">Tasks</th>
                  {seesMoney && <th className="px-4 py-2 text-right font-medium">Outstanding</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((c) => {
                  const due = seesMoney ? outstanding(c) : 0
                  return (
                    <tr key={c.id} className="hover:bg-muted">
                      <td className="px-4 py-2">
                        <Link href={`/c/${companyId}/clients/${c.id}`} className="font-medium hover:text-brand">{c.name}</Link>
                        <span className="block text-xs text-faint">{c.code}{c.organisation ? ` · ${c.organisation}` : ''}</span>
                      </td>
                      <td className="px-4 py-2 text-soft">{[c.email, c.phone].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{c.tasks.length}</td>
                      {seesMoney && (
                        <td className={`px-4 py-2 text-right tabular-nums ${due > 0 ? 'font-medium text-red-600 dark:text-red-400' : 'text-faint'}`}>
                          {due > 0 ? fmt(due) : '—'}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}

        {canAdd && (
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold">Add a client</h2>
            <form action={addClient.bind(null, companyId)} className="grid gap-4 sm:grid-cols-2">
              <Field label="Name"><Input name="name" required maxLength={200} /></Field>
              <Field label="Organisation"><Input name="organisation" maxLength={200} placeholder="Company, college, hospital…" /></Field>
              <Field label="Email"><Input name="email" type="email" /></Field>
              <Field label="Phone"><Input name="phone" maxLength={40} /></Field>
              <div className="sm:col-span-2"><SubmitButton pendingText="Adding…">Add client</SubmitButton></div>
            </form>
          </Card>
        )}
      </div>
    </>
  )
}
