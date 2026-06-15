import { getBaseUrlFromRequest } from '@/core/http'
import { getSourceConfigs } from '@/core/sources/registry'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const baseUrl = getBaseUrlFromRequest(req)
  const data = await getSourceConfigs(baseUrl)
  return Response.json(data)
}
