import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isUuid, requireMember } from '@/lib/session'
import { HR_ADMIN_ROLES, ROLE_LABELS, type Role } from '@/lib/types'
import { ACCOUNT_TYPES, DOC_KINDS, GENDERS, PROFILE_COLUMNS, missingFields, type DocKind, type EmployeeProfile } from '@/lib/profile'
import { Banner, Card, Field, Input, PageHeader, Select, Textarea } from '@/components/ui'
import { SubmitButton } from '@/components/submit-button'
import { removeDoc, saveProfile, uploadDoc } from '../actions'

export const metadata = { title: 'Profile' }

function Section({ id, title, hint, children }: { id?: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="mb-1 text-base font-semibold">{title}</h2>
      {hint && <p className="mb-3 text-sm text-soft">{hint}</p>}
      <Card className="grid gap-4 p-4 sm:grid-cols-2">{children}</Card>
    </section>
  )
}

const req = (label: string) => `${label} *`

export default async function ProfilePage({ params, searchParams }: {
  params: Promise<{ companyId: string; memberId: string }>
  searchParams: Promise<{ error?: string; saved?: string }>
}) {
  const { companyId, memberId } = await params
  const sp = await searchParams
  if (!isUuid(memberId)) notFound()
  const { member: me } = await requireMember(companyId)
  const isSelf = me.id === memberId
  if (!isSelf && !HR_ADMIN_ROLES.includes(me.role)) redirect(`/c/${companyId}/profile`)

  const supabase = await createClient()
  const [{ data: person }, { data: profileData }, { data: numberData }] = await Promise.all([
    supabase.from('members').select('id, name, email, role, is_active').eq('company_id', companyId).eq('id', memberId).maybeSingle(),
    supabase.from('employee_profiles').select(PROFILE_COLUMNS).eq('company_id', companyId).eq('member_id', memberId).maybeSingle(),
    // Owner/HR only (RLS); everyone else gets nothing back and sees the last 4 digits.
    supabase.from('employee_bank_numbers').select('account_number').eq('company_id', companyId).eq('member_id', memberId).maybeSingle(),
  ])
  if (!person) notFound()
  const p = (profileData ?? null) as EmployeeProfile | null
  const fullNumber = (numberData as { account_number: string } | null)?.account_number ?? null
  const missing = missingFields(p)
  const v = (k: keyof EmployeeProfile) => (p?.[k] as string | null) ?? ''
  const save = saveProfile.bind(null, companyId, memberId)
  const base = `/c/${companyId}/profile/${memberId}`
  const sameAddress = !!p?.correspondence_address && p.correspondence_address === p.permanent_address

  return (
    <>
      <PageHeader title={isSelf ? 'My profile' : `${person.name}’s profile`}>
        {!isSelf && <Link href={`/c/${companyId}/hr/profiles`} className="text-sm text-soft hover:text-ink">← All profiles</Link>}
      </PageHeader>
      <div className="max-w-3xl space-y-8">
        {sp.error && <Banner>{sp.error}</Banner>}
        {sp.saved && <Banner tone="info">Saved.</Banner>}
        <p className="text-sm text-soft">
          {person.email} · {ROLE_LABELS[person.role as Role]}{person.is_active ? '' : ' · deactivated'}.{' '}
          Only {isSelf ? 'you' : person.name} and the company’s Owner, Admins and HR can see this page.
        </p>
        {missing.length > 0
          ? <Banner tone="info">Incomplete — still needed: {missing.join(', ')}. Fields marked * are required; you can save a partial profile.</Banner>
          : <Banner tone="info">Profile complete.</Banner>}

        <form id="details" action={save} className="scroll-mt-6 space-y-8">
          <Section title="Personal details">
            <Field label={req('First name')}><Input name="first_name" defaultValue={v('first_name')} maxLength={100} autoComplete="given-name" /></Field>
            <Field label="Middle name"><Input name="middle_name" defaultValue={v('middle_name')} maxLength={100} autoComplete="additional-name" /></Field>
            <Field label={req('Last name')}><Input name="last_name" defaultValue={v('last_name')} maxLength={100} autoComplete="family-name" /></Field>
            <Field label={req('Mobile')}><Input name="mobile" type="tel" defaultValue={v('mobile')} maxLength={30} autoComplete="tel" /></Field>
            <Field label="Personal email"><Input name="personal_email" type="email" defaultValue={v('personal_email')} maxLength={200} /></Field>
            <Field label={req('Date of birth')}><Input name="date_of_birth" type="date" defaultValue={v('date_of_birth')} min="1900-01-01" /></Field>
            <Field label="Gender">
              <Select name="gender" defaultValue={v('gender')}>
                <option value="">—</option>
                {GENDERS.map((g) => <option key={g}>{g}</option>)}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label={req('Correspondence address')}><Textarea name="correspondence_address" defaultValue={v('correspondence_address')} rows={3} maxLength={1000} /></Field>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Field label="Permanent address"><Textarea name="permanent_address" defaultValue={v('permanent_address')} rows={3} maxLength={1000} /></Field>
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="same_address" defaultChecked={sameAddress} className="accent-brand" /> Same as correspondence address</label>
            </div>
          </Section>

          <Section title="Emergency contact">
            <Field label={req('Name')}><Input name="emergency_name" defaultValue={v('emergency_name')} maxLength={200} /></Field>
            <Field label={req('Relationship')}><Input name="emergency_relationship" defaultValue={v('emergency_relationship')} maxLength={60} placeholder="e.g. Spouse" /></Field>
            <Field label={req('Phone')}><Input name="emergency_phone" type="tel" defaultValue={v('emergency_phone')} maxLength={30} /></Field>
          </Section>

          <Section title="Bank details" hint="The full account number is visible only to the Owner and HR; everyone else sees the last four digits.">
            <Field label={req('Account holder name')}><Input name="bank_account_name" defaultValue={v('bank_account_name')} maxLength={200} /></Field>
            <Field label={req('Account type')}>
              <Select name="bank_account_type" defaultValue={v('bank_account_type')}>
                <option value="">—</option>
                {ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label={req('Account number')}
              hint={p?.bank_account_last4 ? `Saved: ${fullNumber ?? `•••• ${p.bank_account_last4}`}. Leave blank to keep it.` : undefined}>
              <Input name="bank_account_number" inputMode="text" autoComplete="off" maxLength={40}
                placeholder={p?.bank_account_last4 ? `•••• ${p.bank_account_last4}` : ''} />
            </Field>
            <Field label={req('Bank name')}><Input name="bank_name" defaultValue={v('bank_name')} maxLength={200} /></Field>
            <Field label={req('IFSC')}><Input name="bank_ifsc" defaultValue={v('bank_ifsc')} maxLength={20} className="uppercase" /></Field>
            {p?.bank_account_last4 && (
              <label className="flex items-center gap-1.5 self-end text-sm"><input type="checkbox" name="clear_bank_number" className="accent-brand" /> Remove saved account number</label>
            )}
          </Section>

          <div className="flex items-center gap-3">
            <SubmitButton pendingText="Saving…">Save profile</SubmitButton>
            {p && <span className="text-xs text-faint">Last saved {new Date(p.updated_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
          </div>
        </form>

        <section id="documents" className="scroll-mt-6">
          <h2 className="mb-1 text-base font-semibold">Documents</h2>
          <p className="mb-3 text-sm text-soft">PDF, JPG, PNG or WebP, up to 4 MB. Stored privately; links expire after a minute.</p>
          <Card className="divide-y divide-line">
            {(Object.keys(DOC_KINDS) as DocKind[]).map((kind) => {
              const path = p?.[DOC_KINDS[kind].column]
              return (
                <div key={kind} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="w-32 text-sm font-medium">{DOC_KINDS[kind].label}</span>
                  {path
                    ? <a href={`${base}/doc/${kind}`} target="_blank" rel="noopener" className="text-sm text-brand hover:underline">View</a>
                    : <span className="text-sm text-faint">Not uploaded</span>}
                  <form action={uploadDoc.bind(null, companyId, memberId, kind)} className="flex flex-1 flex-wrap items-center gap-2">
                    <input type="file" name="file" required accept="application/pdf,image/jpeg,image/png,image/webp"
                      className="min-w-0 flex-1 text-sm text-soft file:mr-2 file:rounded-md file:border file:border-line file:bg-surface file:px-2 file:py-1 file:text-sm" aria-label={`${DOC_KINDS[kind].label} file`} />
                    <SubmitButton variant="secondary" pendingText="Uploading…">{path ? 'Replace' : 'Upload'}</SubmitButton>
                  </form>
                  {path && (
                    <form action={removeDoc.bind(null, companyId, memberId, kind)}>
                      <button className="text-xs text-soft hover:text-red-600">Remove</button>
                    </form>
                  )}
                </div>
              )
            })}
          </Card>
        </section>
      </div>
    </>
  )
}
