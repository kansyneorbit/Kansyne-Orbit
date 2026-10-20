import { createClient } from '@/lib/supabase/server'
import { requireMember } from '@/lib/session'
import { Card, PageHeader } from '@/components/ui'
import { SubmitButton } from '@/components/submit-button'
import { markAllRead, openNotification } from './actions'

export const metadata = { title: 'Notifications' }

type Note = { id: string; message: string; is_read: boolean; created_at: string; task_id: string | null }

export default async function NotificationsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params
  await requireMember(companyId)
  const supabase = await createClient()
  const { data } = await supabase
    .from('notifications')
    .select('id, message, is_read, created_at, task_id')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(100)
  const notes = (data ?? []) as Note[]
  const unread = notes.filter((n) => !n.is_read).length

  return (
    <>
      <PageHeader title="Notifications">
        {unread > 0 && (
          <form action={markAllRead.bind(null, companyId)}>
            <SubmitButton variant="secondary">Mark all as read</SubmitButton>
          </form>
        )}
      </PageHeader>
      {notes.length === 0 ? (
        <Card className="max-w-3xl p-8 text-center text-sm text-soft">Nothing yet. You&apos;ll be told here when you&apos;re added to a task or asked to raise an invoice.</Card>
      ) : (
        <Card className="max-w-3xl divide-y divide-line">
          {notes.map((n) => (
            <form key={n.id} action={openNotification.bind(null, companyId, n.id, n.task_id)}>
              <button className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted ${n.is_read ? 'text-soft' : ''}`}>
                <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.is_read ? 'bg-transparent' : 'bg-brand'}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${n.is_read ? '' : 'font-medium text-ink'}`}>{n.message}</span>
                  <span className="text-xs text-faint">
                    {new Date(n.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    {!n.is_read && <span className="sr-only"> (unread)</span>}
                  </span>
                </span>
              </button>
            </form>
          ))}
        </Card>
      )}
    </>
  )
}
