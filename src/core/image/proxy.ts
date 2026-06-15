import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { getAppConfig } from '../config'
import { isTruthyParam } from '../http'
import { loadSource } from '../runtime/venera'
import type { RequestContext } from '../types'

export interface ImageProxyParams {
  url: string
  source?: string
  comicId?: string
  epId?: string
  width?: string | null
  quality?: string | null
  ifPNG?: string | null
  ifLVGL?: string | null
}

export interface ImageProxyResult {
  body: Buffer
  contentType: string
  cacheHit: boolean
}

function cacheKey(params: ImageProxyParams): string {
  return createHash('sha256').update(JSON.stringify(params)).digest('hex')
}

function cacheFile(key: string, ext: string): string {
  const config = getAppConfig()
  return path.join(process.cwd(), config.imageCacheDir, `${key}.${ext}`)
}

async function readCache(key: string, ext: string): Promise<Buffer | null> {
  const config = getAppConfig()
  if (config.imageCacheDriver !== 'file') return null
  const file = cacheFile(key, ext)
  return existsSync(file) ? readFileSync(file) : null
}

async function writeCache(key: string, ext: string, body: Buffer): Promise<void> {
  const config = getAppConfig()
  if (config.imageCacheDriver !== 'file') return
  const dir = path.join(process.cwd(), config.imageCacheDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(cacheFile(key, ext), body)
}

function normalizeUrl(url: string): string {
  if (url.startsWith('//')) return `https:${url}`
  if (!url.startsWith('http://') && !url.startsWith('https://')) return `https://${url}`
  return url
}

export async function proxyImage(params: ImageProxyParams, context: RequestContext): Promise<ImageProxyResult> {
  const config = getAppConfig()
  const width = Number(params.width || config.defaultImageWidth)
  const quality = Number(params.quality || config.defaultImageQuality)
  const returnPng = isTruthyParam(params.ifPNG)
  const returnLvgl = isTruthyParam(params.ifLVGL)
  const ext = returnLvgl ? 'bin' : returnPng ? 'png' : 'jpg'
  const key = cacheKey({ ...params, width: String(width), quality: String(quality), ifPNG: returnPng ? '1' : '', ifLVGL: returnLvgl ? '1' : '' })

  const cached = await readCache(key, ext)
  if (cached) {
    return {
      body: cached,
      contentType: returnLvgl ? 'application/octet-stream' : returnPng ? 'image/png' : 'image/jpeg',
      cacheHit: true
    }
  }

  let requestUrl = normalizeUrl(params.url)
  let headers: Record<string, string> = {}
  let onResponse: ((data: Uint8Array) => Uint8Array | Promise<Uint8Array>) | undefined

  if (params.source) {
    const source = await loadSource(params.source, context)
    const imageConfig = await source.comic?.onImageLoad?.(params.url, params.comicId, params.epId)
    if (imageConfig?.url) requestUrl = normalizeUrl(imageConfig.url)
    if (imageConfig?.headers) headers = imageConfig.headers
    if (typeof imageConfig?.onResponse === 'function') onResponse = imageConfig.onResponse
  }

  if (context.cookie && !headers.Cookie && !headers.cookie) {
    headers.Cookie = context.cookie
  }

  const response = await fetch(requestUrl, { headers })
  if (!response.ok) {
    throw new Error(`Image download failed: ${response.status}`)
  }

  let input = Buffer.from(await response.arrayBuffer())
  if (onResponse) {
    input = Buffer.from(await onResponse(input))
  }

  let image = sharp(input, { limitInputPixels: 268402689 }).resize({
    width: width > 0 ? width : undefined,
    fit: 'inside',
    withoutEnlargement: true
  })

  let body: Buffer
  let contentType: string

  if (returnLvgl) {
    const raw = await image.ensureAlpha().raw().toBuffer()
    body = raw
    contentType = 'application/octet-stream'
  } else if (returnPng) {
    body = await image.flatten({ background: '#ffffff' }).png({ compressionLevel: 9 }).toBuffer()
    contentType = 'image/png'
  } else {
    body = await image.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer()
    contentType = 'image/jpeg'
  }

  await writeCache(key, ext, body)
  return { body, contentType, cacheHit: false }
}
