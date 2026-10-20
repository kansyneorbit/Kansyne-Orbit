import Link from 'next/link'
import { Banner, Button, Card, Field, Input } from '@/components/ui'
import { signIn } from '../actions'

export const metadata = { title: 'Sign in' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return (
    <Card className="p-6">
      <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
      <p className="mb-5 text-sm text-soft">Welcome back.</p>
      <form action={signIn} className="space-y-4">
        {error && <Banner>{error}</Banner>}
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button type="submit" className="w-full">Sign in</Button>
      </form>
      <p className="mt-5 text-center text-sm text-soft">
        New to Orbit? <Link href="/signup" className="font-medium text-brand hover:underline">Create an account</Link>
      </p>
    </Card>
  )
}
