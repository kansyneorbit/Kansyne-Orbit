import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireMember } from '@/lib/session'
import { HR_ADMIN_ROLES, ROLE_LABELS, type Role } from '@/lib/types'
import { PROFILE_COLUMNS, missingFields, type EmployeeProfile } from '@/lib/profile'
import { Banner, Card, PageHeader } from '@/components/ui'
import { remindProfile } from '../actions'

export const metadata = { title: 'Employee profiles' }

type Person = { id: string; name: string; email: string; role: Role; is_active: boolean; user_id: string | null }

export default async function ProfilesPage({ params, searchParams }: {
  params: Promise<{ companyId: string }>
  searchParams: Promise<{ error?: string; reminded?: string; show?: string }>
}) {
  const { companyId } = await params
  const sp = await searchParams
  const { member: me } = await requireMember(companyId)
  if (!HR_ADMIN_ROLES.includes(me.role)) {
    return (<><PageHeader title="Employee profiles" /><Banner tone="info">Employee profiles are for Owners, Admins and HR.</Banner></>)
  }
  const supabase = await createClient()
  const [{ data: peopleData }, { data: profileData }] = await Promise.all([
    supabase.from('members').select('id, name, email, role, is_active, user_id').eq('company_id', companyId).order('name'),
    supabase.from('employee_profiles').select(PROFILE_COLUMNS).eq('company_id', companyId),
  ])
  const profiles = new Map(((profileData ?? []) as EmployeeProfile[]).map((p) => [p.member_id, p]))
  const showAll = sp.show === 'all'
  const rows = ((peopleData ?? []) as Person[])
    .filter((m) => showAll || m.is_active)
    .map((m) => {
      const p = profiles.get(m.id)
      return { ...m, missing: missingFields(p), docs: [p?.id_proof_path, p?.address_proof_path].filter(Boolean).length }
    })
    .sort((a, b) => Number(a.missing.length === 0) - Number(b.missing.length === 0) || a.name.localeCompare(b.name))
  const complete = rows.filter((r) => r.missing.length === 0).length
  const base = `/c/${companyId}/hr/profiles`

  return (
    <>
      <PageHeader title="Employee profiles">
        <Link href={`/c/${companyId}/hr`} className="text-sm text-soft hover:text-ink">← HR</Link>
      </PageHeader>
      <div className="max-w-5xl space-y-4">
        {sp.error && <Banner>{sp.error}</Banner>}
        {sp.reminded && <Banner tone="info">Reminder sent to {sp.reminded}.</Banner>}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-soft">
          <span>{complete} of {rows.length} complete. Documents are optional.</span>
          <Link href={showAll ? base : `${base}?show=all`} className="hover:text-ink">{showAll ? 'Hide deactivated' : 'Show deactivated'}</Link>
        </div>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-line text-left text-xs text-faint">
              <tr>
                <th className="px-4 py-2 font-medium">Person</th>
                <th className="px-4 py-2 font-medium">Profile</th>
                <th className="px-4 py-2 text-right font-medium">Documents</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className={r.is_active ? '' : 'opacity-60'}>
                  <td className="px-4 py-2">
                    <Link href={`/c/${companyId}/profile/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                    <span className="block text-xs text-faint">{ROLE_LABELS[r.role]}{r.is_active ? '' : ' · deactivated'}{r.user_id ? '' : ' · not joined'}</span>
                  </td>
                  <td className="px-4 py-2">
                    {r.missing.length === 0
                      ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">Complete</span>
                      : (<>
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">Incomplete</span>
                          <span className="mt-1 block text-xs text-faint">Missing: {r.missing.join(', ')}</span>
                        </>)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.docs} / 2</td>
                  <td className="px-4 py-2 text-right">
                    {r.missing.length > 0 && r.is_active && r.user_id && r.id !== me.id && (
                      <form action={remindProfile.bind(null, companyId, r.id)}>
                        <button className="text-xs text-soft hover:text-brand">Send reminder</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  )
}
