import Link from 'next/link'
import { Banner, Card, Field, Input } from '@/components/ui'
import { SubmitButton } from '@/components/submit-button'
import { signUp } from '../actions'

export const metadata = { title: 'Create account' }

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string; email?: string }> }) {
  const { error, sent, email: invitedEmail } = await searchParams
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
      {invitedEmail ? (
        <>
          <h1 className="mb-1 text-lg font-semibold">Join your team</h1>
          <p className="mb-5 text-sm text-soft">
            You&apos;ve been invited to Kansyne Orbit as <strong className="text-ink">{invitedEmail}</strong>.
            Create your account to join. Already use Orbit with this email?{' '}
            <Link href="/login" className="font-medium text-brand hover:underline">Sign in</Link> instead.
          </p>
        </>
      ) : (
        <>
          <h1 className="mb-1 text-lg font-semibold">Create your account</h1>
          <p className="mb-5 text-sm text-soft">You&apos;ll set up your company next. If a colleague invited you, sign up with the email they used.</p>
        </>
      )}
      <form action={signUp} className="space-y-4">
        {error && <Banner>{error}</Banner>}
        <Field label="Your name">
          <Input name="name" autoComplete="name" required maxLength={120} />
        </Field>
        <Field label="Work email">
          <Input name="email" type="email" autoComplete="email" required defaultValue={invitedEmail} />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
        </Field>
        <SubmitButton className="w-full" pendingText="Creating account…">Create account</SubmitButton>
      </form>
      <p className="mt-5 text-center text-sm text-soft">
        Already have an account? <Link href="/login" className="font-medium text-brand hover:underline">Sign in</Link>
      </p>
    </Card>
  )
}
