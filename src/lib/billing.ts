import type { Company } from '@/lib/types'

export type Plan = {
  id: string
  name: string
  price_per_user: number
  currency_code: string
  max_users: number | null
  description: string | null
}

// Whole days left in the trial (0 on the last day, negative once it has ended).
export function trialDaysLeft(company: Pick<Company, 'trial_ends_at'>) {
  return Math.ceil((Date.parse(company.trial_ends_at) - Date.now()) / 86400000)
}

// What the sidebar banner should say, if anything. Not enforced yet: access
// is not blocked until payments are connected.
export function billingNotice(company: Pick<Company, 'billing_status' | 'trial_ends_at'>) {
  if (company.billing_status === 'past_due') return { tone: 'bad' as const, text: 'Payment overdue' }
  if (company.billing_status === 'cancelled') return { tone: 'bad' as const, text: 'Subscription cancelled' }
  if (company.billing_status === 'trialing') {
    const left = trialDaysLeft(company)
    if (left < 0) return { tone: 'bad' as const, text: 'Trial ended' }
    if (left <= 7) return { tone: 'warn' as const, text: left === 0 ? 'Trial ends today' : `Trial: ${left} day${left === 1 ? '' : 's'} left` }
  }
  return null
}
