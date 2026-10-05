import { getBaseUrlFromRequest } from '@/core/http'
import { searchComic } from '@/core/protocol/service'
import { errorStatus } from '@/core/network'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ source: string; text: string; page: string }> }) {
  try {
    const { source, text, page } = await params
    const baseUrl = getBaseUrlFromRequest(req)
    const data = await searchComic(source, text, Number(page) || 1, {
      baseUrl,
      userAgent: req.headers.get('user-agent') || undefined,
      cookie: req.headers.get('cookie') || undefined
    })
    return Response.json(data,{headers:{'Cache-Control':'private, no-store'}})
  } catch (error) {
    return Response.json({ code: errorStatus(error), message: error instanceof Error ? error.message : String(error) }, { status: errorStatus(error),headers:{'Cache-Control':'no-store','Retry-After':'2'} })
  }
}
