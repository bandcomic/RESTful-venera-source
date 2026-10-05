import { createServer } from '../src/server'
const server = createServer()
export async function onRequest({ request }: { request: Request }) {
  const app = await server
  const url = new URL(request.url)
  const response = await app.inject({method:request.method as 'GET',url:url.pathname+url.search,headers:Object.fromEntries(request.headers)})
  return new Response(new Uint8Array(response.rawPayload),{status:response.statusCode,headers:response.headers as Record<string,string>})
}
