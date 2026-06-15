import cors from '@fastify/cors'
import Fastify from 'fastify'
import { getAppConfig } from './core/config'
import { getBaseUrlFromFastifyRequest } from './core/http'
import { proxyImage } from './core/image/proxy'
import { getComicDetail, getPhotoList, searchComic } from './core/protocol/service'
import { clearRuntimeCache } from './core/runtime/venera'
import { getSourceConfigs } from './core/sources/registry'

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason)
})

async function main() {
  const config = getAppConfig()
  const fastify = Fastify({ logger: true })

  await fastify.register(cors, { origin: true })

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
      return await getComicDetail(req.params.source, decodeURIComponent(req.params.id), {
        baseUrl,
        userAgent: req.headers['user-agent'],
        cookie: req.headers.cookie
      })
    } catch (error) {
      reply.code(500)
      return { code: 500, message: error instanceof Error ? error.message : String(error) }
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
      reply.code(500)
      return { code: 500, message: error instanceof Error ? error.message : String(error) }
    }
  })

  fastify.get<{ Params: { source: string; id: string; chapter: string } }>('/api/:source/photo/:id/chapter/:chapter', async (req, reply) => {
    try {
      const baseUrl = getBaseUrlFromFastifyRequest(req.headers, req.protocol)
      return await getPhotoList(req.params.source, decodeURIComponent(req.params.id), decodeURIComponent(req.params.chapter), {
        baseUrl,
        userAgent: req.headers['user-agent'],
        cookie: req.headers.cookie
      })
    } catch (error) {
      reply.code(500)
      return { code: 500, message: error instanceof Error ? error.message : String(error) }
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
          quality: query.quality,
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
      reply.header('Cache-Control', 'public, max-age=86400')
      reply.header('X-Cache', result.cacheHit ? 'HIT' : 'MISS')
      return reply.send(result.body)
    } catch (error) {
      reply.code(500)
      return { code: 500, message: error instanceof Error ? error.message : String(error) }
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

  await fastify.listen({ port: config.port, host: '0.0.0.0' })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
