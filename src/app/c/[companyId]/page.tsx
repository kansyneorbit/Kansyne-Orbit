import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireMember } from '@/lib/session'
import { formatDate, getStages, isOverdue } from '@/lib/data'
import { Card, PageHeader } from '@/components/ui'
import { TASK_CREATOR_ROLES } from '@/lib/types'

export const metadata = { title: 'Tasks' }

type TaskRow = {
  id: string
  title: string
  deadline: string | null
  stage_id: string
  clients: { name: string; code: string }
  categories: { name: string }
}

export default async function TasksBoard({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params
  const { member } = await requireMember(companyId)
  const supabase = await createClient()
  const [stages, { data }] = await Promise.all([
    getStages(companyId),
    supabase
      .from('tasks')
      .select('id, title, deadline, stage_id, clients(name, code), categories(name)')
      .eq('company_id', companyId)
      .order('deadline', { ascending: true, nullsFirst: false }),
  ])
  const tasks = (data ?? []) as unknown as TaskRow[]
  const canCreate = TASK_CREATOR_ROLES.includes(member.role)

  return (
    <>
      <PageHeader title="Tasks">
        {canCreate && (
          <Link href={`/c/${companyId}/tasks/new`} className="rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-dark">
            New task
          </Link>
        )}
      </PageHeader>

      {tasks.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="font-medium">No tasks yet</p>
          <p className="mt-1 text-sm text-soft">
            {member.role === 'sales' ? 'Tasks you bring in will appear here.' : canCreate ? 'Create your first task to see it move through your workflow.' : 'Tasks assigned to you will appear here.'}
          </p>
        </Card>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {stages.map((stage) => {
            const inStage = tasks.filter((t) => t.stage_id === stage.id)
            return (
              <section key={stage.id} className="w-64 shrink-0">
                <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold tracking-wide text-soft uppercase">
                  <span className="truncate">{stage.name}</span>
                  <span className="text-faint">{inStage.length}</span>
                </h2>
                <div className="space-y-2">
                  {inStage.map((t) => (
                    <Link key={t.id} href={`/c/${companyId}/tasks/${t.id}`} className="block rounded-lg border border-line bg-surface p-3 hover:border-brand/50">
                      <p className="text-sm font-medium leading-snug">{t.title}</p>
                      <p className="mt-1 truncate text-xs text-soft">{t.clients.name} · {t.clients.code}</p>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-soft">{t.categories.name}</span>
                        {t.deadline && (
                          <span className={isOverdue(t.deadline, stage.kind) ? 'font-medium text-red-600 dark:text-red-400' : 'text-faint'}>
                            {formatDate(t.deadline)}
                          </span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
