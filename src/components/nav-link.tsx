'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function NavLink({ href, exact = false, children }: { href: string; exact?: boolean; children: React.ReactNode }) {
  const path = usePathname()
  const active = exact ? path === href : path === href || path.startsWith(href + '/')
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`block rounded-md px-3 py-2 text-sm ${active ? 'bg-brand/10 font-medium text-brand' : 'text-soft hover:bg-muted hover:text-ink'}`}
    >
      {children}
    </Link>
  )
}
