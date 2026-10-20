import { createClient } from '@/lib/supabase/server'
import { requireMember } from '@/lib/session'
import { getCategories } from '@/lib/data'
import { ROLE_LABELS, type Role } from '@/lib/types'
import { Banner, Card, Field, Input, PageHeader, Select, Textarea } from '@/components/ui'
import { SubmitButton } from '@/components/submit-button'
import { createTask } from '../actions'

export const metadata = { title: 'New task' }

export default async function NewTaskPage({ params, searchParams }: {
  params: Promise<{ companyId: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { companyId } = await params
  const { error } = await searchParams
  const { member } = await requireMember(companyId)

  if (!['owner', 'admin', 'manager'].includes(member.role)) {
    return (
      <>
        <PageHeader title="New task" />
        <Banner tone="info">Only an Owner, Admin or Manager can create tasks.</Banner>
      </>
    )
  }

  const supabase = await createClient()
  const [categories, { data: clients }, { data: members }] = await Promise.all([
    getCategories(companyId),
    supabase.from('clients').select('id, code, name').eq('company_id', companyId).order('name'),
    supabase.from('members').select('id, name, role').eq('company_id', companyId).eq('is_active', true).order('name'),
  ])

  return (
    <>
      <PageHeader title="New task" />
      <Card className="max-w-2xl p-6">
        <form action={createTask.bind(null, companyId)} className="space-y-5">
          {error && <Banner>{error}</Banner>}
          <Field label="Title">
            <Input name="title" required maxLength={200} placeholder="e.g. Market sizing study" />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Category">
              <Select name="category_id" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Deadline">
              <Input name="deadline" type="date" />
            </Field>
          </div>

          <fieldset className="space-y-3 rounded-md border border-line p-4">
            <legend className="px-1 text-sm font-medium">Client</legend>
            <Select name="client_id" required defaultValue={clients?.length ? '' : 'new'}>
              <option value="" disabled>Choose a client…</option>
              <option value="new">+ New client (fill in below)</option>
              {(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} · {c.code}</option>)}
            </Select>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input name="client_name" placeholder="New client name" maxLength={200} aria-label="New client name" />
              <Input name="client_email" type="email" placeholder="Email (optional)" aria-label="New client email" />
              <Input name="client_phone" placeholder="Phone (optional)" aria-label="New client phone" />
            </div>
          </fieldset>

          <Field label="Lead" hint="The person mainly responsible. You can add more people later.">
            <Select name="lead_id" defaultValue="">
              <option value="">Unassigned</option>
              {(members ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.name} — {ROLE_LABELS[m.role as Role]}</option>
              ))}
            </Select>
          </Field>

          <Field label="Description">
            <Textarea name="description" rows={4} />
          </Field>

          <SubmitButton>Create task</SubmitButton>
        </form>
      </Card>
    </>
  )
}
