import { createClient } from '@/lib/supabase/server'
import { requireMember } from '@/lib/session'
import { moneyFormatter } from '@/lib/money'
import { trialDaysLeft, type Plan } from '@/lib/billing'
import { Banner, Card, Input, PageHeader } from '@/components/ui'
import { SubmitButton } from '@/components/submit-button'
import { saveBillingEmail } from './actions'

export const metadata = { title: 'Billing' }

const STATUS_TEXT = { trialing: 'Free trial', active: 'Active', past_due: 'Payment overdue', cancelled: 'Cancelled' } as const

export default async function BillingPage({ params, searchParams }: {
  params: Promise<{ companyId: string }>
  searchParams: Promise<{ error?: string; notice?: string }>
}) {
  const { companyId } = await params
  const { error, notice } = await searchParams
  const { member: me, company } = await requireMember(companyId)
  if (me.role !== 'owner' && me.role !== 'admin') {
    return (<><PageHeader title="Billing" /><Banner tone="info">Billing is managed by your company’s Owner.</Banner></>)
  }

  const supabase = await createClient()
  const [{ data: planData }, { count: users }, { data: extra }] = await Promise.all([
    supabase.from('plans').select('id, name, price_per_user, currency_code, max_users, description').eq('is_active', true).order('position'),
    supabase.from('members').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('is_active', true).not('user_id', 'is', null),
    supabase.from('companies').select('billing_email, seats_paid').eq('id', companyId).single(),
  ])
  const plans = (planData ?? []) as Plan[]
  const active = Math.max(users ?? 0, 1)
  const left = trialDaysLeft(company)
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <>
      <PageHeader title="Billing" />
      <div className="max-w-4xl space-y-6">
        {error && <Banner>{error}</Banner>}
        {notice && !error && <Banner tone="info">{notice}</Banner>}

        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs text-faint">Status</p>
              <p className="text-lg font-semibold">
                {STATUS_TEXT[company.billing_status]}
                {company.billing_status !== 'trialing' && ` · ${plans.find((p) => p.id === company.plan)?.name ?? company.plan}`}
              </p>
              <p className="mt-1 text-sm text-soft">
                {company.billing_status === 'trialing'
                  ? left >= 0 ? `${left} day${left === 1 ? '' : 's'} left — ends ${day(company.trial_ends_at)}.` : `Ended ${day(company.trial_ends_at)}.`
                  : company.current_period_end ? `Paid until ${day(company.current_period_end)}.` : ''}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-faint">Active users</p>
              <p className="text-lg font-semibold tabular-nums">{users ?? 0}</p>
              {extra?.seats_paid ? <p className="text-xs text-soft">{extra.seats_paid} paid seats</p> : null}
            </div>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          {plans.map((p) => {
            const fmt = moneyFormatter({ currency_code: p.currency_code, locale: company.locale })
            const tooMany = p.max_users !== null && active > p.max_users
            const current = company.billing_status === 'active' && company.plan === p.id
            return (
              <Card key={p.id} className={`flex flex-col p-5 ${current ? 'border-brand' : ''}`}>
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold">{p.name}</h2>
                  {current && <span className="rounded bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">Current plan</span>}
                </div>
                <p className="mt-2 text-2xl font-bold tabular-nums">{fmt(Number(p.price_per_user))}<span className="text-sm font-normal text-soft"> / user / month</span></p>
                <p className="mt-1 text-xs text-faint">{p.max_users ? `Up to ${p.max_users} users` : 'Unlimited users'}</p>
                {p.description && <p className="mt-3 text-sm text-soft">{p.description}</p>}
                <p className="mt-4 text-sm">
                  For your {active} user{active === 1 ? '' : 's'}: <strong className="tabular-nums">{fmt(Number(p.price_per_user) * active)}</strong> a month
                </p>
                {tooMany && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">You have more users than this plan allows.</p>}
                <button disabled className="mt-4 rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-white opacity-50">
                  {current ? 'Your plan' : `Choose ${p.name}`}
                </button>
              </Card>
            )
          })}
        </div>
        <Banner tone="info">
          Online payment is being set up. To subscribe now, contact the Kansyne Orbit team — we’ll activate your plan
          as soon as payment is received.
        </Banner>

        {me.role === 'owner' && (
          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold">Billing email</h2>
            <p className="mb-3 text-xs text-soft">Invoices and payment reminders go here.</p>
            <form action={saveBillingEmail.bind(null, companyId)} className="flex flex-wrap gap-2">
              <Input name="billing_email" type="email" defaultValue={extra?.billing_email ?? ''} placeholder="accounts@yourfirm.com" className="max-w-sm" aria-label="Billing email" />
              <SubmitButton variant="secondary">Save</SubmitButton>
            </form>
          </Card>
        )}
      </div>
    </>
  )
}
