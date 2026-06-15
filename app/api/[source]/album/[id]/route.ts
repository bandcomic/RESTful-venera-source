import { getBaseUrlFromRequest } from '@/core/http'
import { getComicDetail } from '@/core/protocol/service'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ source: string; id: string }> }) {
  try {
    const { source, id } = await params
    const baseUrl = getBaseUrlFromRequest(req)
    const data = await getComicDetail(source, decodeURIComponent(id), {
      baseUrl,
      userAgent: req.headers.get('user-agent') || undefined,
      cookie: req.headers.get('cookie') || undefined
    })
    return Response.json(data)
  } catch (error) {
    return Response.json({ code: 500, message: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
