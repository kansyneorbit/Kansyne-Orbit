import type { Company, PaymentKind, PaymentStatus } from '@/lib/types'

export type PaymentRow = {
  id: string
  kind: PaymentKind
  amount: number
  reason: string | null
  status: PaymentStatus
  received_at: string | null
  created_at: string
}

export function moneyFormatter(company: Pick<Company, 'currency_code' | 'locale'>) {
  const f = new Intl.NumberFormat(company.locale, {
    style: 'currency',
    currency: company.currency_code,
    maximumFractionDigits: 2,
  })
  return (n: number) => f.format(n)
}

// Owed = agreed total + extra charges. Paid = advances and payments that have
// actually arrived (received or verified). Matches the task_balances view.
export function balanceOf(total: number, payments: Pick<PaymentRow, 'kind' | 'amount' | 'status'>[]) {
  let owed = Number(total) || 0
  let paid = 0
  for (const p of payments) {
    if (p.kind === 'extra') owed += Number(p.amount)
    else if (p.status !== 'pending') paid += Number(p.amount)
  }
  return { owed, paid, due: owed - paid }
}

// PostgREST returns a composite-key child as an array even when there is at most one.
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}
