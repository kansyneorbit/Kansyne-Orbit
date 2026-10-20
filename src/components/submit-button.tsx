'use client'

import type { ComponentProps } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui'

// A submit button that locks while its form is being sent, so a second click
// can't submit twice (double sign-ups break the email confirmation link).
export function SubmitButton({ children, pendingText, ...props }: ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} aria-disabled={pending} {...props}>
      {pending ? (pendingText ?? 'Working…') : children}
    </Button>
  )
}
