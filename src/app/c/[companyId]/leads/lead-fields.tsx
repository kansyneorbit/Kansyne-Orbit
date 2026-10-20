import { Field, Input, Select, Textarea } from '@/components/ui'
import { LEAD_SOURCES, ROLE_LABELS, type Category, type Role } from '@/lib/types'

export type LeadValues = {
  contact_name?: string
  organisation?: string | null
  phone?: string | null
  email?: string | null
  source?: string | null
  category_id?: string | null
  requirement?: string | null
  estimated_value?: number | null
  next_follow_up?: string | null
  owner_id?: string | null
}

// Shared by "Add lead" and the lead page. Owners are offered only to non-sales users.
export function LeadFields({ values = {}, categories, owners }: {
  values?: LeadValues
  categories: Category[]
  owners?: { id: string; name: string; role: Role }[]
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Contact name"><Input name="contact_name" defaultValue={values.contact_name} required maxLength={200} /></Field>
      <Field label="Organisation"><Input name="organisation" defaultValue={values.organisation ?? ''} maxLength={200} /></Field>
      <Field label="Phone"><Input name="phone" defaultValue={values.phone ?? ''} maxLength={40} /></Field>
      <Field label="Email"><Input name="email" type="email" defaultValue={values.email ?? ''} /></Field>
      <Field label="Source">
        <Select name="source" defaultValue={values.source ?? ''}>
          <option value="">—</option>
          {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          {values.source && !(LEAD_SOURCES as readonly string[]).includes(values.source) && <option value={values.source}>{values.source}</option>}
        </Select>
      </Field>
      <Field label="Type of work">
        <Select name="category_id" defaultValue={values.category_id ?? ''}>
          <option value="">Not sure yet</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Estimated value"><Input name="estimated_value" type="number" step="0.01" min="0" defaultValue={values.estimated_value ?? ''} /></Field>
      <Field label="Next follow-up"><Input name="next_follow_up" type="date" defaultValue={values.next_follow_up ?? ''} /></Field>
      {owners && (
        <Field label="Owner" hint="Who is responsible for this lead.">
          <Select name="owner_id" defaultValue={values.owner_id ?? ''}>
            {owners.map((m) => <option key={m.id} value={m.id}>{m.name} — {ROLE_LABELS[m.role]}</option>)}
          </Select>
        </Field>
      )}
      <div className="sm:col-span-2">
        <Field label="What do they need?"><Textarea name="requirement" rows={3} defaultValue={values.requirement ?? ''} /></Field>
      </div>
    </div>
  )
}
