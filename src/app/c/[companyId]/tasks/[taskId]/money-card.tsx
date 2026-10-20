import { createClient } from '@/lib/supabase/server'
import { balanceOf, moneyFormatter, type PaymentRow } from '@/lib/money'
import { formatDate } from '@/lib/data'
import { PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS, type Company, type Role } from '@/lib/types'
import { Card, Input, Select, Textarea } from '@/components/ui'
import { SubmitButton } from '@/components/submit-button'
import { addPayment, deletePayment, saveTaskFinancials, setPaymentStatus } from '../finance-actions'

const STATUS_STYLE = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  received: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  verified: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
} as const

// Shown only to finance roles; RLS returns nothing to anyone else anyway.
export async function MoneyCard({ companyId, taskId, company, myRole }: {
  companyId: string
  taskId: string
  company: Company
  myRole: Role
}) {
  const supabase = await createClient()
  const [{ data: fin }, { data: payData }] = await Promise.all([
    supabase.from('task_financials')
      .select('total_amount, invoice_no, invoice_date, notes')
      .eq('company_id', companyId).eq('task_id', taskId).maybeSingle(),
    supabase.from('payments')
      .select('id, kind, amount, reason, status, received_at, created_at')
      .eq('company_id', companyId).eq('task_id', taskId)
      .order('created_at'),
  ])
  const payments = (payData ?? []) as PaymentRow[]
  const fmt = moneyFormatter(company)
  const { owed, paid, due } = balanceOf(fin?.total_amount ?? 0, payments)
  const canVerify = myRole === 'owner' || myRole === 'admin'

  return (
    <Card className="p-5">
      <h2 id="money" className="mb-3 scroll-mt-6 text-sm font-semibold">Money</h2>

      <dl className="mb-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-muted p-2"><dt className="text-xs text-faint">Owed</dt><dd className="text-sm font-semibold">{fmt(owed)}</dd></div>
        <div className="rounded-md bg-muted p-2"><dt className="text-xs text-faint">Paid</dt><dd className="text-sm font-semibold">{fmt(paid)}</dd></div>
        <div className="rounded-md bg-muted p-2">
          <dt className="text-xs text-faint">Balance</dt>
          <dd className={`text-sm font-semibold ${due > 0 ? 'text-red-600 dark:text-red-400' : due < 0 ? 'text-amber-600' : 'text-green-600 dark:text-green-400'}`}>{fmt(due)}</dd>
        </div>
      </dl>

      <form action={saveTaskFinancials.bind(null, companyId, taskId)} className="space-y-2">
        <label className="block text-xs text-faint">
          Agreed fee
          <Input name="total_amount" type="number" step="0.01" min="0" defaultValue={fin?.total_amount ?? ''} placeholder="0" className="mt-1" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-faint">Invoice no.<Input name="invoice_no" defaultValue={fin?.invoice_no ?? ''} maxLength={60} className="mt-1" /></label>
          <label className="block text-xs text-faint">Invoice date<Input name="invoice_date" type="date" defaultValue={fin?.invoice_date ?? ''} className="mt-1" /></label>
        </div>
        <Textarea name="notes" rows={2} defaultValue={fin?.notes ?? ''} placeholder="Money notes (optional)" aria-label="Money notes" />
        <SubmitButton variant="secondary" className="w-full">Save fee &amp; invoice</SubmitButton>
      </form>

      <div className="mt-4 border-t border-line pt-3">
        <h3 className="mb-2 text-xs font-semibold text-soft uppercase">Payments &amp; extras</h3>
        {payments.length === 0 ? (
          <p className="mb-3 text-sm text-soft">Nothing recorded yet.</p>
        ) : (
          <ul className="mb-3 space-y-2 text-sm">
            {payments.map((p) => (
              <li key={p.id} className="rounded-md border border-line p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{p.kind === 'extra' ? '+' : ''}{fmt(p.amount)}</span>
                  <span className="text-xs text-faint">{PAYMENT_KIND_LABELS[p.kind]}</span>
                </div>
                {p.reason && <p className="text-xs text-soft">{p.reason}</p>}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {p.kind !== 'extra' && (
                    <span className={`rounded px-1.5 py-0.5 font-medium ${STATUS_STYLE[p.status]}`}>
                      {PAYMENT_STATUS_LABELS[p.status]}{p.received_at ? ` ${formatDate(p.received_at.slice(0, 10))}` : ''}
                    </span>
                  )}
                  {p.kind !== 'extra' && p.status === 'pending' && (
                    <form action={setPaymentStatus.bind(null, companyId, taskId, p.id, 'received')}><button className="font-medium text-brand hover:underline">Mark received</button></form>
                  )}
                  {p.kind !== 'extra' && p.status === 'received' && canVerify && (
                    <form action={setPaymentStatus.bind(null, companyId, taskId, p.id, 'verified')}><button className="font-medium text-brand hover:underline">Verify</button></form>
                  )}
                  <form action={deletePayment.bind(null, companyId, taskId, p.id)} className="ml-auto"><button className="text-soft hover:text-red-600">Remove</button></form>
                </div>
              </li>
            ))}
          </ul>
        )}

        <details className="rounded-md border border-line p-3">
          <summary className="cursor-pointer text-sm font-medium">Record a payment or extra charge</summary>
          <form action={addPayment.bind(null, companyId, taskId)} className="mt-3 space-y-2">
            <div className="flex gap-2">
              <Select name="kind" defaultValue="payment" aria-label="Kind" className="w-36">
                {Object.entries(PAYMENT_KIND_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <Input name="amount" type="number" step="0.01" min="0.01" required placeholder="Amount" aria-label="Amount" />
            </div>
            <Input name="reason" maxLength={200} placeholder="Note, e.g. UPI ref or reason for extra" aria-label="Note" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="received" defaultChecked className="accent-brand" /> Money already received
            </label>
            <SubmitButton className="w-full" pendingText="Saving…">Add</SubmitButton>
          </form>
        </details>
      </div>
    </Card>
  )
}
