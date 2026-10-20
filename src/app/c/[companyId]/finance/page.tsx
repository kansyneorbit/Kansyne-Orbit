import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireMember } from '@/lib/session'
import { formatDate } from '@/lib/data'
import { balanceOf, moneyFormatter, one, type PaymentRow } from '@/lib/money'
import { PERIODS, dateIn, inRange, resolvePeriod, todayIn } from '@/lib/periods'
import { FINANCE_ROLES, PAYMENT_KIND_LABELS } from '@/lib/types'
import { Banner, Card, Input, PageHeader } from '@/components/ui'

export const metadata = { title: 'Finance' }

type Row = {
  id: string
  title: string
  clients: { id: string; name: string; code: string }
  task_financials: { total_amount: number; invoice_no: string | null; invoice_date: string | null } | { total_amount: number; invoice_no: string | null; invoice_date: string | null }[]
  payments: (Pick<PaymentRow, 'id' | 'kind' | 'amount' | 'status' | 'received_at'> & { reason: string | null })[]
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'bad' | 'good' }) {
  const color = tone === 'bad' ? 'text-red-600 dark:text-red-400' : tone === 'good' ? 'text-green-600 dark:text-green-400' : ''
  return (
    <Card className="p-4">
      <p className="text-xs text-faint">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-soft">{hint}</p>}
    </Card>
  )
}

export default async function FinancePage({ params, searchParams }: {
  params: Promise<{ companyId: string }>
  searchParams: Promise<{ period?: string; from?: string; to?: string }>
}) {
  const { companyId } = await params
  const sp = await searchParams
  const { member: me, company } = await requireMember(companyId)
  if (!FINANCE_ROLES.includes(me.role)) {
    return (<><PageHeader title="Finance" /><Banner tone="info">Only an Owner, Admin, Manager or Accounts can see finance.</Banner></>)
  }

  const range = resolvePeriod(sp.period, sp.from, sp.to, company.timezone)
  const fmt = moneyFormatter(company)
  const today = todayIn(company.timezone)

  const supabase = await createClient()
  const { data } = await supabase
    .from('tasks')
    .select(`id, title, clients(id, name, code),
      task_financials!inner(total_amount, invoice_no, invoice_date),
      payments(id, kind, amount, status, received_at, reason)`)
    .eq('company_id', companyId)
  const rows = ((data ?? []) as unknown as Row[]).map((t) => {
    const fin = one(t.task_financials)!
    return { ...t, fin, ...balanceOf(fin.total_amount, t.payments) }
  })

  // ----- figures -----
  const invoiced = rows.filter((r) => inRange(r.fin.invoice_date, range))
  const invoicedTotal = invoiced.reduce((s, r) => s + r.owed, 0)

  const received = rows.flatMap((r) =>
    r.payments
      .filter((p) => p.kind !== 'extra' && p.status !== 'pending' && p.received_at)
      .map((p) => ({ ...p, day: dateIn(company.timezone, p.received_at!), task: r })),
  ).filter((p) => inRange(p.day, range)).sort((a, b) => b.day.localeCompare(a.day))
  const receivedTotal = received.reduce((s, p) => s + Number(p.amount), 0)

  const outstanding = rows.filter((r) => r.due > 0.004)
    .sort((a, b) => (a.fin.invoice_date ?? '9999').localeCompare(b.fin.invoice_date ?? '9999'))
  const outstandingTotal = outstanding.reduce((s, r) => s + r.due, 0)
  const notInvoiced = outstanding.filter((r) => !r.fin.invoice_date)

  const expected = rows.flatMap((r) => r.payments.filter((p) => p.kind !== 'extra' && p.status === 'pending'))
  const expectedTotal = expected.reduce((s, p) => s + Number(p.amount), 0)

  // ----- by client -----
  const byClient = new Map<string, { name: string; code: string; invoiced: number; received: number; outstanding: number }>()
  const client = (r: (typeof rows)[number]) => {
    const c = byClient.get(r.clients.id) ?? { name: r.clients.name, code: r.clients.code, invoiced: 0, received: 0, outstanding: 0 }
    byClient.set(r.clients.id, c)
    return c
  }
  invoiced.forEach((r) => { client(r).invoiced += r.owed })
  received.forEach((p) => { client(p.task).received += Number(p.amount) })
  outstanding.forEach((r) => { client(r).outstanding += r.due })
  const clients = [...byClient.values()].sort((a, b) => b.outstanding - a.outstanding || b.invoiced - a.invoiced)

  const daysSince = (d: string) => Math.round((Date.parse(today) - Date.parse(d)) / 86400000)
  const base = `/c/${companyId}/finance`

  return (
    <>
      <PageHeader title="Finance" />

      {/* period picker */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {Object.entries(PERIODS).map(([k, label]) => (
          <Link key={k} href={`${base}?period=${k}`}
            className={`rounded-full border px-3 py-1 text-sm ${range.key === k ? 'border-brand bg-brand/10 font-medium text-brand' : 'border-line text-soft hover:bg-muted'}`}>
            {label}
          </Link>
        ))}
        <form className="flex flex-wrap items-center gap-2" action={base}>
          <input type="hidden" name="period" value="custom" />
          <Input type="date" name="from" defaultValue={range.key === 'custom' ? range.from ?? '' : ''} aria-label="From" className="w-auto py-1" />
          <span className="text-sm text-faint">to</span>
          <Input type="date" name="to" defaultValue={range.key === 'custom' ? range.to ?? '' : ''} aria-label="To" className="w-auto py-1" />
          <button className={`rounded-full border px-3 py-1 text-sm ${range.key === 'custom' ? 'border-brand bg-brand/10 font-medium text-brand' : 'border-line text-soft hover:bg-muted'}`}>Apply</button>
        </form>
      </div>
      <p className="-mt-3 mb-5 text-xs text-faint">
        {range.label}{range.from || range.to ? `: ${range.from ? formatDate(range.from) : '…'} – ${range.to ? formatDate(range.to) : '…'}` : ''}
      </p>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Invoiced" value={fmt(invoicedTotal)} hint={`${invoiced.length} task${invoiced.length === 1 ? '' : 's'} invoiced in period`} />
        <Stat label="Received" value={fmt(receivedTotal)} hint={`${received.length} payment${received.length === 1 ? '' : 's'} in period`} tone="good" />
        <Stat label="Outstanding now" value={fmt(outstandingTotal)} hint={`${outstanding.length} task${outstanding.length === 1 ? '' : 's'} with a balance`} tone={outstandingTotal > 0 ? 'bad' : undefined} />
        <Stat label="Expected payments" value={fmt(expectedTotal)} hint="Recorded but not yet received" />
      </div>

      {rows.length === 0 && (
        <Card className="mb-8 p-8 text-center text-sm text-soft">
          No money recorded yet. Open a task and fill in its <strong>Money</strong> section to see it here.
        </Card>
      )}

      {/* outstanding */}
      {outstanding.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-base font-semibold">Outstanding</h2>
          {notInvoiced.length > 0 && (
            <p className="mb-2 text-xs text-soft">{notInvoiced.length} with a balance but no invoice date yet — listed last.</p>
          )}
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b border-line text-left text-xs text-faint">
                <tr><th className="px-4 py-2 font-medium">Task</th><th className="px-4 py-2 font-medium">Client</th><th className="px-4 py-2 font-medium">Invoice</th><th className="px-4 py-2 text-right font-medium">Owed</th><th className="px-4 py-2 text-right font-medium">Paid</th><th className="px-4 py-2 text-right font-medium">Balance</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {outstanding.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2"><Link href={`/c/${companyId}/tasks/${r.id}#money`} className="font-medium hover:text-brand">{r.title}</Link></td>
                    <td className="px-4 py-2 text-soft">{r.clients.name}</td>
                    <td className="px-4 py-2 text-soft">
                      {r.fin.invoice_no ?? '—'}
                      {r.fin.invoice_date && <span className="block text-xs text-faint">{formatDate(r.fin.invoice_date)} · {daysSince(r.fin.invoice_date)} days</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(r.owed)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(r.paid)}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-red-600 dark:text-red-400">{fmt(r.due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}

      {/* by client */}
      {clients.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-base font-semibold">By client</h2>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="border-b border-line text-left text-xs text-faint">
                <tr><th className="px-4 py-2 font-medium">Client</th><th className="px-4 py-2 text-right font-medium">Invoiced (period)</th><th className="px-4 py-2 text-right font-medium">Received (period)</th><th className="px-4 py-2 text-right font-medium">Outstanding now</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {clients.map((c) => (
                  <tr key={c.code}>
                    <td className="px-4 py-2"><span className="font-medium">{c.name}</span> <span className="text-xs text-faint">{c.code}</span></td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(c.invoiced)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(c.received)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${c.outstanding > 0 ? 'font-medium text-red-600 dark:text-red-400' : ''}`}>{fmt(c.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}

      {/* payments received */}
      <section>
        <h2 className="mb-2 text-base font-semibold">Payments received in period</h2>
        {received.length === 0 ? (
          <p className="text-sm text-soft">None.</p>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="border-b border-line text-left text-xs text-faint">
                <tr><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Task</th><th className="px-4 py-2 font-medium">Client</th><th className="px-4 py-2 font-medium">Kind</th><th className="px-4 py-2 text-right font-medium">Amount</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {received.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 whitespace-nowrap text-soft">{formatDate(p.day)}</td>
                    <td className="px-4 py-2"><Link href={`/c/${companyId}/tasks/${p.task.id}#money`} className="hover:text-brand">{p.task.title}</Link></td>
                    <td className="px-4 py-2 text-soft">{p.task.clients.name}</td>
                    <td className="px-4 py-2 text-soft">{PAYMENT_KIND_LABELS[p.kind]}{p.status === 'verified' ? ' ✓' : ''}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(Number(p.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </>
  )
}
