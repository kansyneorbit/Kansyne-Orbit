import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/session'
import type { Plan } from '@/lib/billing'
import { Banner, Card, Input, Select } from '@/components/ui'
import { SubmitButton } from '@/components/submit-button'
import { setCompanyBilling, setPlanPrice } from './actions'

export const metadata = { title: 'Orbit admin' }

type Row = {
  id: string
  name: string
  created_at: string
  owner_email: string | null
  active_users: number
  plan: string
  billing_status: string
  trial_ends_at: string
  current_period_end: string | null
  seats_paid: number | null
  billing_email: string | null
}

const d = (iso: string | null) => (iso ? iso.slice(0, 10) : '')

// Kansyne Orbit operators only (private.platform_admins). Everyone else gets a 404.
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams
  await requireUser()
  const supabase = await createClient()
  const { data: isAdmin } = await supabase.rpc('am_platform_admin')
  if (!isAdmin) notFound()

  const [{ data: companyData, error: listError }, { data: planData }] = await Promise.all([
    supabase.rpc('admin_list_companies'),
    supabase.from('plans').select('id, name, price_per_user, currency_code, max_users, description').order('position'),
  ])
  const companies = (companyData ?? []) as Row[]
  const plans = (planData ?? []) as Plan[]
  const now = Date.now()

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold tracking-wide text-brand">KANSYNE ORBIT</p>
          <h1 className="text-xl font-semibold">Orbit admin</h1>
        </div>
        <Link href="/app" className="text-sm text-soft hover:text-ink">← Back to app</Link>
      </div>
      {(error || listError) && <Banner>{error ?? listError?.message}</Banner>}
      {notice && !error && <Banner tone="info">{notice}</Banner>}

      <section>
        <h2 className="mb-1 text-base font-semibold">Companies <span className="font-normal text-faint">{companies.length}</span></h2>
        <p className="mb-3 text-sm text-soft">Activate a company after a manual payment, extend a trial, or mark it overdue. This page never shows a company’s own data.</p>
        <div className="space-y-3">
          {companies.map((c) => {
            const trialLeft = Math.ceil((Date.parse(c.trial_ends_at) - now) / 86400000)
            return (
              <Card key={c.id} className="p-4">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <p><span className="font-semibold">{c.name}</span> <span className="text-sm text-faint">· {c.owner_email ?? 'no owner email'} · since {d(c.created_at)}</span></p>
                  <p className="text-sm text-soft">
                    {c.active_users} active user{Number(c.active_users) === 1 ? '' : 's'} · {c.billing_status}
                    {c.billing_status === 'trialing' && ` (${trialLeft >= 0 ? `${trialLeft}d left` : 'ended'})`}
                    {c.billing_email && ` · bills to ${c.billing_email}`}
                  </p>
                </div>
                <form action={setCompanyBilling.bind(null, c.id)} className="flex flex-wrap items-end gap-3 text-xs text-faint">
                  <label>Plan
                    <Select name="plan" defaultValue={c.plan} className="mt-1 w-32">
                      <option value="trial">Trial</option>
                      {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      <option value="cancelled">Cancelled</option>
                    </Select>
                  </label>
                  <label>Status
                    <Select name="billing_status" defaultValue={c.billing_status} className="mt-1 w-32">
                      {['trialing', 'active', 'past_due', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </label>
                  <label>Trial ends<Input name="trial_ends" type="date" defaultValue={d(c.trial_ends_at)} className="mt-1 w-auto" /></label>
                  <label>Paid until<Input name="period_end" type="date" defaultValue={d(c.current_period_end)} className="mt-1 w-auto" /></label>
                  <label>Seats<Input name="seats" type="number" min="1" defaultValue={c.seats_paid ?? ''} className="mt-1 w-20" /></label>
                  <SubmitButton variant="secondary">Save</SubmitButton>
                </form>
              </Card>
            )
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-base font-semibold">Prices</h2>
        <p className="mb-3 text-sm text-soft">Per active user per month. Changes show on every company’s Billing page straight away.</p>
        <Card className="divide-y divide-line">
          {plans.map((p) => (
            <form key={p.id} action={setPlanPrice.bind(null, p.id)} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <span className="w-24 font-medium">{p.name}</span>
              <label className="flex items-center gap-1.5">{p.currency_code}<Input name="price" type="number" step="1" min="0" defaultValue={Number(p.price_per_user)} className="w-28" aria-label={`${p.name} price`} /></label>
              <label className="flex items-center gap-1.5">max users<Input name="max_users" type="number" min="1" defaultValue={p.max_users ?? ''} placeholder="∞" className="w-20" aria-label={`${p.name} max users`} /></label>
              <SubmitButton variant="secondary">Save</SubmitButton>
            </form>
          ))}
        </Card>
      </section>
    </main>
  )
}
