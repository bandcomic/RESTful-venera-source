import cors from '@fastify/cors'
import Fastify from 'fastify'
import { getAppConfig } from './core/config'
import { getBaseUrlFromFastifyRequest } from './core/http'
import { proxyImage } from './core/image/proxy'
import { getComicDetail, getPhotoList, searchComic } from './core/protocol/service'
import { clearRuntimeCache } from './core/runtime/venera'
import { getSourceConfigs } from './core/sources/registry'
import { errorStatus } from './core/network'
import { ApiError } from './core/network'

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason)
})

export async function createServer() {
  const config = getAppConfig()
  const fastify = Fastify({ logger: true })

  await fastify.register(cors, { origin: true })
  fastify.addHook('onSend', async (req,reply,payload) => {
    const policy = req.headers.cookie || req.headers.authorization ? 'private, no-store' : reply.statusCode >= 400 ? 'no-store' : reply.getHeader('Cache-Control') || 'private, no-cache'
    reply.header('Cache-Control',policy).header('CDN-Cache-Control',policy)
    if ([429,503].includes(reply.statusCode)) reply.header('Retry-After','2')
    return payload
  })
  fastify.get('/health', async () => ({status:'ok'}))
  const aliases: Record<string,string> = {'拷贝漫画':'copy_manga',MangaDex:'manga_dex',nhentai:'nhentai',Picacg:'picacg'}
  const legacySource = (query: Record<string,string>) => {
    const key = aliases[query.source] || query.source
    if (!key) throw new ApiError(400,'Missing source')
    return key
  }
  // Saved pre-TypeScript source configurations and offline identities continue working.
  for (const route of ['/comic/:id','/photo/:id/chapter/:chapter','/search/:text/:page']) {
    fastify.get(route, async (req,reply) => {
      try {
        const params = req.params as Record<string,string>, query = req.query as Record<string,string>
        const context = {baseUrl:getBaseUrlFromFastifyRequest(req.headers,req.protocol),cookie:req.headers.cookie,userAgent:req.headers['user-agent']}
        const key = legacySource(query)
        if (params.text) return await searchComic(key,params.text,Number(params.page),context)
        if (params.chapter) return await getPhotoList(key,params.id,params.chapter,context)
        return await getComicDetail(key,params.id,context)
      } catch(error) { reply.code(errorStatus(error)); return {code:errorStatus(error),message:error instanceof Error?error.message:String(error)} }
    })
  }
  for (const route of ['/proxy','/image/proxy']) {
    fastify.get(route,async(req,reply)=>{
      try {
        const query=req.query as Record<string,string>
        const result=await proxyImage({...query,url:query.url,width:query.width||query.w,quality:query.quality||query.q,source:query.source?legacySource(query):undefined},
          {baseUrl:getBaseUrlFromFastifyRequest(req.headers,req.protocol),cookie:req.headers.cookie,userAgent:req.headers['user-agent']})
        reply.header('Content-Type',result.contentType).header('Cache-Control',result.private?'private, no-store':'public, max-age=86400')
        return reply.send(result.body)
      } catch(error) { reply.code(errorStatus(error)); return {code:errorStatus(error),message:error instanceof Error?error.message:String(error)} }
    })
  }

  fastify.get('/', async () => ({
    status: 'ok',
    name: 'venera-source-converter',
    deployTarget: config.deployTarget
  }))

  fastify.get('/config', async (req) => {
    const baseUrl = getBaseUrlFromFastifyRequest(req.headers, req.protocol)
    return getSourceConfigs(baseUrl)
  })

  fastify.get<{ Params: { source: string; id: string } }>('/api/:source/album/:id', async (req, reply) => {
    try {
      const baseUrl = getBaseUrlFromFastifyRequest(req.headers, req.protocol)
      return await getComicDetail(req.params.source, req.params.id, {
        baseUrl,
        userAgent: req.headers['user-agent'],
        cookie: req.headers.cookie
      })
    } catch (error) {
      reply.code(errorStatus(error))
      return { code: errorStatus(error), message: error instanceof Error ? error.message : String(error) }
    }
  })

  fastify.get<{ Params: { source: string; text: string; page: string } }>('/api/:source/search/:text/:page', async (req, reply) => {
    try {
      const baseUrl = getBaseUrlFromFastifyRequest(req.headers, req.protocol)
      return await searchComic(req.params.source, req.params.text, Number(req.params.page) || 1, {
        baseUrl,
        userAgent: req.headers['user-agent'],
        cookie: req.headers.cookie
      })
    } catch (error) {
      reply.code(errorStatus(error))
      return { code: errorStatus(error), message: error instanceof Error ? error.message : String(error) }
    }
  })

  fastify.get<{ Params: { source: string; id: string; chapter: string } }>('/api/:source/photo/:id/chapter/:chapter', async (req, reply) => {
    try {
      const baseUrl = getBaseUrlFromFastifyRequest(req.headers, req.protocol)
      return await getPhotoList(req.params.source, req.params.id, req.params.chapter, {
        baseUrl,
        userAgent: req.headers['user-agent'],
        cookie: req.headers.cookie
      })
    } catch (error) {
      reply.code(errorStatus(error))
      return { code: errorStatus(error), message: error instanceof Error ? error.message : String(error) }
    }
  })

  fastify.get('/api/image/proxy', async (req, reply) => {
    try {
      const query = req.query as Record<string, string | undefined>
      if (!query.url) {
        reply.code(400)
        return { code: 400, message: 'Missing url' }
      }

      const baseUrl = getBaseUrlFromFastifyRequest(req.headers, req.protocol)
      const result = await proxyImage(
        {
          url: query.url,
          source: query.source,
          comicId: query.comicId,
          epId: query.epId,
          width: query.width || query.w,
          quality: query.quality || query.q,
          thumbnail: query.thumbnail,
          ifPNG: query.ifPNG,
          ifLVGL: query.ifLVGL
        },
        {
          baseUrl,
          userAgent: req.headers['user-agent'],
          cookie: req.headers.cookie
        }
      )

      reply.header('Content-Type', result.contentType)
      reply.header('Cache-Control', result.private ? 'private, no-store' : 'public, max-age=86400')
      reply.header('Content-Length',result.body.length)
      reply.header('X-Image-Original-Size',result.originalSize || '')
      reply.header('X-Image-Actual-Size',result.actualSize || '')
      reply.header('X-Cache', result.cacheHit ? 'HIT' : 'MISS')
      return reply.send(result.body)
    } catch (error) {
      reply.code(errorStatus(error))
      return { code: errorStatus(error), message: error instanceof Error ? error.message : String(error) }
    }
  })

  fastify.post('/reload', async (req, reply) => {
    if (!config.enableReload) {
      reply.code(403)
      return { code: 403, message: 'Reload is disabled' }
    }

    clearRuntimeCache()
    return { status: 'ok' }
  })

  return fastify
}

if (require.main === module) createServer().then(server => server.listen({port:getAppConfig().port,host:'0.0.0.0'})).catch((error) => {
  console.error(error)
  process.exit(1)
})
