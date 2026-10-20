import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // HR document uploads (4 MB max) go through Server Actions; Vercel caps request bodies at 4.5 MB.
  experimental: { serverActions: { bodySizeLimit: '4.5mb' } },
}

export default nextConfig
