import Link from 'next/link'
import { Banner, Card, Field, Input } from '@/components/ui'
import { SubmitButton } from '@/components/submit-button'
import { signIn } from '../actions'

export const metadata = { title: 'Sign in' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams
  return (
    <Card className="p-6">
      <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
      <p className="mb-5 text-sm text-soft">Welcome back.</p>
      <form action={signIn} className="space-y-4">
        {error && <Banner>{error}</Banner>}
        {notice && !error && <Banner tone="info">{notice}</Banner>}
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton className="w-full" pendingText="Signing in…">Sign in</SubmitButton>
      </form>
      <p className="mt-5 text-center text-sm text-soft">
        New to Orbit? <Link href="/signup" className="font-medium text-brand hover:underline">Create an account</Link>
      </p>
    </Card>
  )
}
