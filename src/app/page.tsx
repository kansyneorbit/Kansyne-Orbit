import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/session'

export default async function Home() {
  if (await getUser()) redirect('/app')
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold tracking-wide text-brand">KANSYNE ORBIT</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight text-ink sm:text-5xl">
        Run every client engagement from one place.
      </h1>
      <p className="mt-4 max-w-xl text-lg text-soft">
        Track work through your own workflow stages, assign your team, log hours and follow every
        invoice to payment — built for consulting firms.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/signup" className="rounded-md bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark">
          Start free trial
        </Link>
        <Link href="/login" className="rounded-md border border-line bg-surface px-5 py-2.5 text-sm font-medium text-ink hover:bg-muted">
          Sign in
        </Link>
      </div>
    </main>
  )
}
