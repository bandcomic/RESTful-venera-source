export function getBaseUrlFromRequest(req: Request): string {
  const forwardedProto = req.headers.get('x-forwarded-proto')
  const forwardedHost = req.headers.get('x-forwarded-host')
  const host = forwardedHost || req.headers.get('host')

  if (host) {
    return `${forwardedProto || 'https'}://${host}`
  }

  const url = new URL(req.url)
  return `${url.protocol}//${url.host}`
}

export function getBaseUrlFromFastifyRequest(headers: Record<string, unknown>, protocol: string): string {
  const forwardedProto = String(headers['x-forwarded-proto'] || protocol || 'http')
  const forwardedHost = headers['x-forwarded-host']
  const host = String(forwardedHost || headers.host || 'localhost:3000')
  return `${forwardedProto}://${host}`
}

export function isTruthyParam(value: string | null | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}
