'use client'

import { useState } from 'react'

export function CopyButton({ text, label = 'Copy invite link' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch {
          window.prompt('Copy this link:', text)
        }
      }}
      className="text-xs font-medium text-brand hover:underline"
    >
      {copied ? 'Copied ✓' : label}
    </button>
  )
}
