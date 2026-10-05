export class ApiError extends Error {
  constructor(public status: number, message: string, public retryAfter = 2) { super(message) }
}
let active = 0
export async function boundedFetch(url: string, init: RequestInit = {}) {
  if (active >= Number(process.env.NETWORK_CONCURRENCY || 8)) throw new ApiError(503, 'Upstream busy')
  active++
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(process.env.NETWORK_TIMEOUT_MS || 8000))
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const limit = Number(process.env.MAX_DOWNLOAD_BYTES || 20971520)
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      if (Number(response.headers.get('content-length')) > limit) throw new ApiError(413, 'Download budget exceeded')
      while (reader) {
        const item = await reader.read()
        if (item.done) break
        size += item.value.byteLength
        if (size > limit) throw new ApiError(413, 'Download budget exceeded')
        chunks.push(item.value)
      }
    } finally { await reader?.cancel().catch(() => {}) }
    return { status: response.status, headers: response.headers, body: Buffer.concat(chunks, size) }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(502, 'Upstream network timeout or connection failure')
  } finally { clearTimeout(timer); active-- }
}
export function errorStatus(error: unknown) { return error instanceof ApiError ? error.status : 502 }
