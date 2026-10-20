import { createClient } from '@/lib/supabase/server'
import { requireMember } from '@/lib/session'
import { getCategories } from '@/lib/data'
import { LEAD_ROLES, type Role } from '@/lib/types'
import { Banner, Card, PageHeader } from '@/components/ui'
import { SubmitButton } from '@/components/submit-button'
import { createLead } from '../actions'
import { LeadFields } from '../lead-fields'

export const metadata = { title: 'Add lead' }

export default async function NewLeadPage({ params, searchParams }: {
  params: Promise<{ companyId: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { companyId } = await params
  const { error } = await searchParams
  const { member: me } = await requireMember(companyId)
  if (!LEAD_ROLES.includes(me.role)) {
    return (<><PageHeader title="Add lead" /><Banner tone="info">Leads are for Owners, Admins, Managers and Business Development.</Banner></>)
  }
  const supabase = await createClient()
  const [categories, { data: people }] = await Promise.all([
    getCategories(companyId),
    me.role === 'sales'
      ? Promise.resolve({ data: null })
      : supabase.from('members').select('id, name, role').eq('company_id', companyId).eq('is_active', true)
          .in('role', LEAD_ROLES).order('name'),
  ])

  return (
    <>
      <PageHeader title="Add lead" />
      <Card className="max-w-3xl p-6">
        <form action={createLead.bind(null, companyId)} className="space-y-5">
          {error && <Banner>{error}</Banner>}
          <LeadFields
            categories={categories}
            values={{ owner_id: me.id }}
            owners={people ? (people as { id: string; name: string; role: Role }[]) : undefined}
          />
          <SubmitButton pendingText="Saving…">Add lead</SubmitButton>
        </form>
      </Card>
    </>
  )
}
