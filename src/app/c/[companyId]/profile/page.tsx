import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/session'

export default async function MyProfilePage({ params, searchParams }: {
  params: Promise<{ companyId: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { companyId } = await params
  const { error } = await searchParams
  const { member } = await requireMember(companyId)
  redirect(`/c/${companyId}/profile/${member.id}${error ? `?error=${encodeURIComponent(error)}` : ''}`)
}
