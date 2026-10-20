import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isUuid } from '@/lib/session'
import { DOC_KINDS, HR_DOCS_BUCKET, type DocKind } from '@/lib/profile'

// Opens an uploaded HR document through a short-lived signed URL. Both the
// profile row and the file are read as the signed-in user, so RLS decides.
export async function GET(_req: Request, { params }: { params: Promise<{ companyId: string; memberId: string; kind: string }> }) {
  const { companyId, memberId, kind } = await params
  if (!isUuid(companyId) || !isUuid(memberId) || !(kind in DOC_KINDS)) return new NextResponse('Not found', { status: 404 })
  const supabase = await createClient()
  const column = DOC_KINDS[kind as DocKind].column
  const { data } = await supabase.from('employee_profiles').select(column)
    .eq('company_id', companyId).eq('member_id', memberId).maybeSingle()
  const path = (data as Record<string, string | null> | null)?.[column]
  if (!path) return new NextResponse('Not found', { status: 404 })
  const { data: signed } = await supabase.storage.from(HR_DOCS_BUCKET).createSignedUrl(path, 60)
  if (!signed?.signedUrl) return new NextResponse('Not found', { status: 404 })
  return NextResponse.redirect(signed.signedUrl, { headers: { 'Cache-Control': 'no-store' } })
}
