import { requireMember } from '@/lib/session'
import { getCategories, getStages } from '@/lib/data'
import { ROLES, ROLE_LABELS, STAGE_KINDS, STAGE_KIND_LABELS, type Stage } from '@/lib/types'
import { Banner, Card, Input, PageHeader, Select } from '@/components/ui'
import { SubmitButton } from '@/components/submit-button'
import { addCategory, addStage, shiftStage, updateCategory, updateStage } from './actions'

export const metadata = { title: 'Workflow settings' }

function StageFields({ stage }: { stage?: Stage }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <Input name="name" defaultValue={stage?.name} placeholder="Stage name" required maxLength={60} aria-label="Stage name" />
        <Select name="kind" defaultValue={stage?.kind ?? 'active'} aria-label="Kind of stage">
          {STAGE_KINDS.map((k) => <option key={k} value={k}>{STAGE_KIND_LABELS[k]}</option>)}
        </Select>
      </div>
      <fieldset className="mt-3">
        <legend className="mb-1.5 text-xs text-faint">Who may move a task into this stage (none ticked = anyone working on the task)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {ROLES.map((r) => (
            <label key={r} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="allowed_roles" value={r} defaultChecked={stage?.allowed_roles?.includes(r)} className="accent-brand" />
              {ROLE_LABELS[r]}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  )
}

export default async function WorkflowSettings({ params, searchParams }: {
  params: Promise<{ companyId: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { companyId } = await params
  const { error } = await searchParams
  const { member } = await requireMember(companyId)
  if (member.role !== 'owner' && member.role !== 'admin') {
    return (
      <>
        <PageHeader title="Workflow settings" />
        <Banner tone="info">Only an Owner or Admin can change the workflow.</Banner>
      </>
    )
  }
  const [stages, categories] = await Promise.all([
    getStages(companyId, { activeOnly: false }),
    getCategories(companyId, { activeOnly: false }),
  ])

  return (
    <>
      <PageHeader title="Workflow settings" />
      {error && <div className="mb-6 max-w-3xl"><Banner>{error}</Banner></div>}

      <section className="max-w-3xl">
        <h2 className="text-base font-semibold">Stages</h2>
        <p className="mb-4 text-sm text-soft">
          Tasks move through these in order. Retire a stage instead of deleting it so past tasks keep their history.
        </p>
        <div className="space-y-3">
          {stages.map((s, i) => (
            <Card key={s.id} className={`p-4 ${s.is_active ? '' : 'opacity-60'}`}>
              <form action={updateStage.bind(null, companyId, s.id)}>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-semibold text-faint">STEP {i + 1}</span>
                  <div className="flex gap-1">
                    <button formAction={shiftStage.bind(null, companyId, s.id, 'up')} disabled={i === 0}
                      className="rounded px-2 py-0.5 text-sm text-soft hover:bg-muted disabled:opacity-30" aria-label={`Move ${s.name} up`}>↑</button>
                    <button formAction={shiftStage.bind(null, companyId, s.id, 'down')} disabled={i === stages.length - 1}
                      className="rounded px-2 py-0.5 text-sm text-soft hover:bg-muted disabled:opacity-30" aria-label={`Move ${s.name} down`}>↓</button>
                  </div>
                </div>
                <StageFields stage={s} />
                <div className="mt-3 flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name="is_active" defaultChecked={s.is_active} className="accent-brand" /> In use
                  </label>
                  <SubmitButton variant="secondary">Save</SubmitButton>
                </div>
              </form>
            </Card>
          ))}
          <Card className="border-dashed p-4">
            <form action={addStage.bind(null, companyId)}>
              <p className="mb-3 text-sm font-medium">Add a stage at the end</p>
              <StageFields />
              <div className="mt-3 flex justify-end"><SubmitButton>Add stage</SubmitButton></div>
            </form>
          </Card>
        </div>
      </section>

      <section className="mt-10 max-w-3xl">
        <h2 className="text-base font-semibold">Categories</h2>
        <p className="mb-4 text-sm text-soft">The types of work you do. Every task has one.</p>
        <Card className="divide-y divide-line">
          {categories.map((c) => (
            <form key={c.id} action={updateCategory.bind(null, companyId, c.id)} className={`flex flex-wrap items-center gap-3 p-3 ${c.is_active ? '' : 'opacity-60'}`}>
              <Input name="name" defaultValue={c.name} required maxLength={60} className="min-w-0 flex-1" aria-label="Category name" />
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="is_active" defaultChecked={c.is_active} className="accent-brand" /> In use
              </label>
              <SubmitButton variant="secondary">Save</SubmitButton>
            </form>
          ))}
          <form action={addCategory.bind(null, companyId)} className="flex flex-wrap items-center gap-3 p-3">
            <Input name="name" placeholder="New category" required maxLength={60} className="min-w-0 flex-1" aria-label="New category name" />
            <SubmitButton>Add</SubmitButton>
          </form>
        </Card>
      </section>
    </>
  )
}
