import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {},
  output: 'standalone',
  outputFileTracingIncludes: { '/api/**': ['./sources/**'] },
  async rewrites() { return [{ source: '/config', destination: '/api/config' }] }
}

export default nextConfig
