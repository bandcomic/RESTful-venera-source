import { getBaseUrlFromRequest } from '@/core/http'
import { proxyImage } from '@/core/image/proxy'
import { errorStatus } from '@/core/network'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const imageUrl = url.searchParams.get('url')
    if (!imageUrl) {
      return Response.json({ code: 400, message: 'Missing url' }, { status: 400 })
    }

    const baseUrl = getBaseUrlFromRequest(req)
    const result = await proxyImage(
      {
        url: imageUrl,
        source: url.searchParams.get('source') || undefined,
        comicId: url.searchParams.get('comicId') || undefined,
        epId: url.searchParams.get('epId') || undefined,
        width: url.searchParams.get('width') || url.searchParams.get('w'),
        quality: url.searchParams.get('quality') || url.searchParams.get('q'),
        thumbnail: url.searchParams.get('thumbnail'),
        ifPNG: url.searchParams.get('ifPNG'),
        ifLVGL: url.searchParams.get('ifLVGL')
      },
      {
        baseUrl,
        userAgent: req.headers.get('user-agent') || undefined,
        cookie: req.headers.get('cookie') || undefined
      }
    )

    return new Response(new Uint8Array(result.body), {
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': result.private || req.headers.has('authorization') ? 'private, no-store' : 'public, max-age=86400, s-maxage=86400',
        'Content-Length': String(result.body.length),
        'X-Image-Original-Size': result.originalSize || '',
        'X-Image-Actual-Size': result.actualSize || '',
        'X-Cache': result.cacheHit ? 'HIT' : 'MISS'
      }
    })
  } catch (error) {
    return Response.json({ code: errorStatus(error), message: error instanceof Error ? error.message : String(error) }, { status: errorStatus(error),headers:{'Cache-Control':'no-store','Retry-After':'2'} })
  }
}
