import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isUuid, requireMember } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
import { NavLink } from '@/components/nav-link'
import { FINANCE_ROLES, ROLE_LABELS, TASK_CREATOR_ROLES } from '@/lib/types'
import { signOut } from '@/app/(auth)/actions'

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ companyId: string }> }) {
  const { companyId } = await params
  if (!isUuid(companyId)) notFound()
  const { member, company } = await requireMember(companyId)
  const base = `/c/${companyId}`
  const canConfigure = member.role === 'owner' || member.role === 'admin'
  const canCreateTasks = TASK_CREATOR_ROLES.includes(member.role)
  const supabase = await createClient()
  const { count: unread } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('is_read', false)

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:flex md:h-screen md:w-60 md:flex-col md:border-r md:border-b-0">
        <div className="px-4 py-4">
          <Link href="/app" className="block text-xs font-semibold tracking-wide text-brand">KANSYNE ORBIT</Link>
          <p className="mt-1 truncate font-semibold" title={company.name}>{company.short_name}</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:overflow-visible">
          <NavLink href={base} exact>Tasks</NavLink>
          <NavLink href={`${base}/notifications`}>
            <span className="flex items-center justify-between gap-2">
              Notifications
              {!!unread && (
                <span className="rounded-full bg-brand px-1.5 text-xs font-semibold text-white" aria-label={`${unread} unread`}>{unread}</span>
              )}
            </span>
          </NavLink>
          {canCreateTasks && <NavLink href={`${base}/tasks/new`}>New task</NavLink>}
          {FINANCE_ROLES.includes(member.role) && <NavLink href={`${base}/finance`}>Finance</NavLink>}
          <NavLink href={`${base}/team`}>Team</NavLink>
          {canConfigure && <NavLink href={`${base}/settings/workflow`}>Workflow settings</NavLink>}
        </nav>
        <div className="hidden border-t border-line px-4 py-3 md:block">
          <p className="truncate text-sm font-medium">{member.name}</p>
          <p className="text-xs text-faint">{ROLE_LABELS[member.role]}</p>
          <form action={signOut} className="mt-2"><button className="text-xs text-soft hover:text-ink">Sign out</button></form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  )
}
