import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/session'
import { Banner, Button, Card, Field, Input } from '@/components/ui'
import { ROLE_LABELS, type Role } from '@/lib/types'
import { createCompany } from './actions'
import { signOut } from '../(auth)/actions'

export const metadata = { title: 'Your companies' }

// After sign-in: link pending invites, then go to the company (or set one up).
export default async function AppHome({ searchParams }: { searchParams: Promise<{ error?: string; new?: string }> }) {
  const { error, new: wantsNew } = await searchParams
  const user = await requireUser()
  const supabase = await createClient()
  await supabase.rpc('accept_invites')

  const { data: seats } = await supabase
    .from('members')
    .select('role, companies!inner(id, name)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('created_at')
  const companies = (seats ?? []) as unknown as { role: Role; companies: { id: string; name: string } }[]

  if (companies.length === 1 && !wantsNew && !error) redirect(`/c/${companies[0].companies.id}`)

  const defaultName = String(user.user_metadata?.full_name ?? '')

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <div className="mb-8 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-wide text-brand">KANSYNE ORBIT</span>
        <form action={signOut}><button className="text-sm text-soft hover:text-ink">Sign out</button></form>
      </div>

      {companies.length > 0 && (
        <Card className="mb-6 divide-y divide-line">
          {companies.map(({ role, companies: c }) => (
            <Link key={c.id} href={`/c/${c.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-muted">
              <span className="font-medium">{c.name}</span>
              <span className="text-xs text-faint">{ROLE_LABELS[role]}</span>
            </Link>
          ))}
        </Card>
      )}

      <Card className="p-6">
        <h1 className="mb-1 text-lg font-semibold">{companies.length ? 'Set up another company' : 'Set up your company'}</h1>
        <p className="mb-5 text-sm text-soft">
          You&apos;ll be its Owner. We&apos;ll start you with a standard consulting workflow and categories —
          you can change them any time in Settings.
        </p>
        <form action={createCompany} className="space-y-4">
          {error && <Banner>{error}</Banner>}
          <Field label="Company name">
            <Input name="company" required maxLength={120} placeholder="e.g. Acme Consulting" />
          </Field>
          <Field label="Your name">
            <Input name="name" required maxLength={120} defaultValue={defaultName} />
          </Field>
          <Button type="submit" className="w-full">Create company</Button>
        </form>
        {companies.length === 0 && (
          <p className="mt-4 text-xs text-faint">
            Joining an existing company instead? Ask its Owner or Admin to invite {user.email}, then sign in again.
          </p>
        )}
      </Card>
    </main>
  )
}
