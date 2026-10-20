'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fail } from '@/lib/session'

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim()

export async function signIn(form: FormData) {
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: str(form, 'email'),
    password: String(form.get('password') ?? ''),
  })
  if (error) fail('/login', error.message === 'Email not confirmed'
    ? 'Confirm your email first — check your inbox for the link.'
    : 'Wrong email or password.')
  redirect('/app')
}

export async function signUp(form: FormData) {
  const name = str(form, 'name')
  const email = str(form, 'email')
  const password = String(form.get('password') ?? '')
  if (!name) fail('/signup', 'Enter your name.')
  if (password.length < 8) fail('/signup', 'Use a password of at least 8 characters.')

  const h = await headers()
  const origin = h.get('origin') ?? `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`
  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback`, data: { full_name: name } },
  })
  if (error) fail('/signup', error.message)
  redirect(`/signup?sent=${encodeURIComponent(email)}`)
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
