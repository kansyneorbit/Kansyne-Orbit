import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

// Landing point for email confirmation links: turns the link into a session.
export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as EmailOtpType | null
  const supabase = await createClient()

  let ok = false
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error
  } else if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error
  }

  const dest = url.clone()
  dest.search = ''
  if (ok) {
    dest.pathname = '/app'
  } else {
    dest.pathname = '/login'
    // With the default email template, Supabase confirms the address before
    // redirecting here, so a failed exchange usually still means "confirmed".
    dest.searchParams.set('notice', 'If you just opened your confirmation link, your email is confirmed — sign in below.')
  }
  return NextResponse.redirect(dest)
}
