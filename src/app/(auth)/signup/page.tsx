import Link from 'next/link'
import { Banner, Button, Card, Field, Input } from '@/components/ui'
import { signUp } from '../actions'

export const metadata = { title: 'Create account' }

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const { error, sent } = await searchParams
  if (sent) {
    return (
      <Card className="p-6">
        <h1 className="mb-2 text-lg font-semibold">Check your email</h1>
        <p className="text-sm text-soft">
          We sent a confirmation link to <strong className="text-ink">{sent}</strong>. Open it on this
          device to finish creating your account.
        </p>
      </Card>
    )
  }
  return (
    <Card className="p-6">
      <h1 className="mb-1 text-lg font-semibold">Create your account</h1>
      <p className="mb-5 text-sm text-soft">You&apos;ll set up your company next. If a colleague invited you, sign up with the email they used.</p>
      <form action={signUp} className="space-y-4">
        {error && <Banner>{error}</Banner>}
        <Field label="Your name">
          <Input name="name" autoComplete="name" required maxLength={120} />
        </Field>
        <Field label="Work email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
        </Field>
        <Button type="submit" className="w-full">Create account</Button>
      </form>
      <p className="mt-5 text-center text-sm text-soft">
        Already have an account? <Link href="/login" className="font-medium text-brand hover:underline">Sign in</Link>
      </p>
    </Card>
  )
}
