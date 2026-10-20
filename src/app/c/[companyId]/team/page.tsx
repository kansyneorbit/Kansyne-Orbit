import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { requireMember } from '@/lib/session'
import { ROLES, ROLE_LABELS, type Role } from '@/lib/types'
import { Banner, Card, Field, Input, PageHeader, Select } from '@/components/ui'
import { SubmitButton } from '@/components/submit-button'
import { CopyButton } from '@/components/copy-button'
import { inviteMember, setMemberActive, updateMember } from './actions'

export const metadata = { title: 'Team' }

type Row = {
  id: string
  name: string
  email: string
  role: Role
  is_active: boolean
  user_id: string | null
}

const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including billing and managing Owners.',
  admin: 'Everything except managing Owners.',
  manager: 'Creates and assigns tasks; sees all tasks and money.',
  sales: 'Brings in work: creates clients and tasks, sets the fee and sees payments on their own tasks only.',
  consultant: 'Works on tasks assigned to them.',
  analyst: 'Works on tasks assigned to them.',
  accounts: 'Sees all tasks; handles invoices and payments.',
  hr: 'Sees everyone’s logged hours.',
}

function status(m: Row) {
  if (!m.is_active) return { label: 'Deactivated', cls: 'bg-muted text-faint' }
  if (!m.user_id) return { label: 'Invited', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' }
  return { label: 'Active', cls: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300' }
}

export default async function TeamPage({ params, searchParams }: {
  params: Promise<{ companyId: string }>
  searchParams: Promise<{ error?: string; invited?: string }>
}) {
  const { companyId } = await params
  const { error, invited } = await searchParams
  const { member: me } = await requireMember(companyId)
  const canManage = me.role === 'owner' || me.role === 'admin'

  const supabase = await createClient()
  const { data } = await supabase
    .from('members')
    .select('id, name, email, role, is_active, user_id')
    .eq('company_id', companyId)
    .order('is_active', { ascending: false })
    .order('name')
  const members = (data ?? []) as Row[]

  const h = await headers()
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`
  const inviteLink = (email: string) => `${origin}/signup?email=${encodeURIComponent(email)}`
  // Roles this person may hand out: only an Owner can create Owners.
  const assignable = ROLES.filter((r) => r !== 'owner' || me.role === 'owner')
  // Rows this person may edit: not themselves, and not an Owner unless they are one.
  const editable = (m: Row) => canManage && m.id !== me.id && (m.role !== 'owner' || me.role === 'owner')

  return (
    <>
      <PageHeader title="Team" />
      <div className="max-w-4xl space-y-6">
        {error && <Banner>{error}</Banner>}
        {invited && (
          <Banner tone="info">
            <strong>{invited}</strong> is invited. Send them their invite link (use “Copy invite link” below) — they
            sign up with that email and land in this company. If they already use Orbit, they just sign in.
          </Banner>
        )}

        {canManage && (
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold">Invite someone</h2>
            <form action={inviteMember.bind(null, companyId)} className="grid gap-4 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end">
              <Field label="Name"><Input name="name" required maxLength={120} /></Field>
              <Field label="Email"><Input name="email" type="email" required /></Field>
              <Field label="Role">
                <Select name="role" defaultValue="consultant">
                  {assignable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </Select>
              </Field>
              <SubmitButton pendingText="Inviting…">Invite</SubmitButton>
            </form>
          </Card>
        )}

        <Card className="divide-y divide-line">
          {members.map((m) => {
            const s = status(m)
            return (
              <div key={m.id} className={`p-4 ${m.is_active ? '' : 'opacity-70'}`}>
                {editable(m) ? (
                  <form action={updateMember.bind(null, companyId, m.id)} className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-center">
                    <div className="min-w-0">
                      <Input name="name" defaultValue={m.name} required maxLength={120} aria-label={`Name of ${m.name}`} />
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-soft">
                        <span className="truncate">{m.email}</span>
                        <span className={`rounded px-1.5 py-0.5 font-medium ${s.cls}`}>{s.label}</span>
                        {m.is_active && !m.user_id && <CopyButton text={inviteLink(m.email)} />}
                      </p>
                    </div>
                    <Select name="role" defaultValue={m.role} aria-label={`Role of ${m.name}`}>
                      {assignable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </Select>
                    <div className="flex gap-2">
                      <SubmitButton variant="secondary">Save</SubmitButton>
                      <SubmitButton
                        variant={m.is_active ? 'danger' : 'secondary'}
                        formAction={setMemberActive.bind(null, companyId, m.id, !m.is_active)}
                      >
                        {m.is_active ? (m.user_id ? 'Deactivate' : 'Cancel invite') : 'Reactivate'}
                      </SubmitButton>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{m.name}{m.id === me.id && <span className="text-faint"> (you)</span>}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-soft">
                        <span className="truncate">{m.email}</span>
                        <span className={`rounded px-1.5 py-0.5 font-medium ${s.cls}`}>{s.label}</span>
                      </p>
                    </div>
                    <span className="text-sm text-soft">{ROLE_LABELS[m.role]}</span>
                  </div>
                )}
              </div>
            )
          })}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold">What each role can do</h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {ROLES.map((r) => (
              <div key={r}>
                <dt className="inline font-medium">{ROLE_LABELS[r]}: </dt>
                <dd className="inline text-soft">{ROLE_HELP[r]}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  )
}
