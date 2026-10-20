import type { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

export type ClientFields = {
  name: string
  email?: string | null
  phone?: string | null
  organisation?: string | null
  notes?: string | null
}

// Creates a client with the company's next code (e.g. CL-0007). Retries once if
// two people add a client at the same moment and get the same number.
export async function insertClient(supabase: Supabase, companyId: string, memberId: string, fields: ClientFields) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: code, error: codeErr } = await supabase.rpc('next_client_code', { p_company: companyId })
    if (codeErr || !code) return { error: codeErr?.message ?? 'Could not number the client.' }
    const { data, error } = await supabase
      .from('clients')
      .insert({
        company_id: companyId,
        code,
        name: fields.name,
        email: fields.email || null,
        phone: fields.phone || null,
        organisation: fields.organisation || null,
        notes: fields.notes || null,
        created_by: memberId,
      })
      .select('id')
      .single()
    if (data) return { id: data.id as string }
    if (error?.code !== '23505') return { error: error?.code === '42501' ? 'Your role cannot add clients.' : error?.message ?? 'Could not save the client.' }
  }
  return { error: 'Could not save the client. Please try again.' }
}
