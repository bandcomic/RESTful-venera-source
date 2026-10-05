import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { getAppConfig } from '../config'
import { loadSource } from '../runtime/venera'
import { ApiError, boundedFetch } from '../network'
import type { RequestContext } from '../types'

export interface ImageProxyParams {
  url: string; source?: string; comicId?: string; epId?: string; thumbnail?: string | null
  width?: string | null; quality?: string | null; ifPNG?: string | null; ifLVGL?: string | null
}
export interface ImageProxyResult { body: Buffer; contentType: string; cacheHit: boolean; originalSize?: string; actualSize?: string; private?: boolean }
const inflight = new Map<string, Promise<ImageProxyResult>>()
const memory = new Map<string, { result: ImageProxyResult; expires: number }>()
let memoryBytes = 0
let active = 0
function integer(value: string | null | undefined, fallback: number, maximum: number) {
  const raw = value == null ? String(fallback) : value
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > maximum) throw new ApiError(400, 'Invalid width/quality')
  return Number(raw)
}
function flag(value: string | null | undefined) {
  if (value == null) return false
  if (!['0','false','no','off','1','true','yes','on'].includes(value.toLowerCase())) throw new ApiError(400, 'Invalid format flag')
  return ['1','true','yes','on'].includes(value.toLowerCase())
}
export function encodeLvgl(rgb: Buffer, width: number, height: number) {
  if (width < 1 || height < 1 || width > 2047 || height > 2047 || rgb.length !== width*height*3) throw new ApiError(413, 'Invalid LVGL dimensions')
  const body = Buffer.alloc(1028 + width*height)
  body.writeUInt32LE((10 | width << 10 | height << 21) >>> 0)
  // Deterministic RGB332 indexed-8 palette, not raw RGBA.
  for (let i = 0; i < 256; i++) {
    body[4+i*4] = Math.round((i&3)*255/3)
    body[5+i*4] = Math.round(((i>>2)&7)*255/7)
    body[6+i*4] = Math.round((i>>5)*255/7)
    body[7+i*4] = 255
  }
  for (let i = 0; i < width*height; i++) body[1028+i] = (rgb[i*3]&224) | (rgb[i*3+1]>>3&28) | (rgb[i*3+2]>>6)
  return body
}
async function diskRead(file: string, ttl: number): Promise<ImageProxyResult | null> {
  try {
    if (Date.now() - (await stat(file)).mtimeMs > ttl) return null
    const packed = await readFile(file)
    const n = packed.readUInt32LE(0)
    if (n > 2048) return null
    const info = JSON.parse(packed.subarray(4,4+n).toString())
    const body = packed.subarray(4+n)
    return body.length ? { ...info, body, cacheHit: true } : null
  } catch { return null }
}
let eviction: Promise<void> | null = null
async function diskWrite(file: string, result: ImageProxyResult) {
  const directory = path.dirname(file), tmp = file + '.' + randomUUID() + '.tmp'
  try {
    await mkdir(directory, { recursive: true })
    const { body, ...info } = result
    const header = Buffer.from(JSON.stringify(info)), size = Buffer.alloc(4)
    size.writeUInt32LE(header.length)
    await writeFile(tmp, Buffer.concat([size,header,body]), { flag: 'wx' })
    await rename(tmp,file)
    if (!eviction) eviction = (async () => {
      const entries = await Promise.all((await readdir(directory)).filter(name => name.endsWith('.cache')).map(async name => {
        const file = path.join(directory,name), info = await stat(file).catch(() => null)
        return { file, bytes: info?.size || 0, time: info?.mtimeMs || 0 }
      }))
      let bytes = entries.reduce((sum,item) => sum+item.bytes,0)
      for (const item of entries.sort((a,b) => a.time-b.time)) {
        if (bytes <= Number(process.env.DISK_CACHE_BYTES || 536870912)) break
        await unlink(item.file).catch(() => {}); bytes -= item.bytes
      }
    })().finally(() => { eviction = null })
    await eviction
  } catch { /* Cache failure leaves the complete response available. */ }
  finally { await unlink(tmp).catch(() => {}) }
}
export async function proxyImage(params: ImageProxyParams, context: RequestContext): Promise<ImageProxyResult> {
  const config = getAppConfig()
  const width = integer(params.width,config.defaultImageWidth,2047), quality = integer(params.quality,config.defaultImageQuality,100)
  const lvgl = flag(params.ifLVGL), png = flag(params.ifPNG), format = lvgl ? 'lvgl' : png ? 'png' : 'jpeg'
  const userCookie = context.cookie || (params.source ? process.env[`${params.source.toUpperCase()}_COOKIE`] : '') || ''
  const privateContent = Boolean(userCookie)
  if (params.source && !config.enabledSources.includes(params.source)) throw new ApiError(404,'Source disabled')
  const key = createHash('sha256').update(JSON.stringify(['indexed8-v2',params.url,params.source,params.comicId,params.epId,params.thumbnail,width,quality,format,createHash('sha256').update(userCookie).digest('hex')])).digest('hex')
  const file = path.resolve(config.imageCacheDir,key+'.cache'), ttl = Number(process.env.IMAGE_CACHE_TTL_MS || 86400000)
  if (!privateContent && config.imageCacheDriver !== 'none') {
    const item = memory.get(key)
    if (item && item.expires > Date.now()) return { ...item.result,cacheHit:true }
    if (item) { memory.delete(key); memoryBytes -= item.result.body.length }
    if (config.imageCacheDriver === 'file') { const hit = await diskRead(file,ttl); if (hit) return hit }
  }
  const pending = inflight.get(key)
  if (pending) return pending
  const job = (async () => {
    if (active >= Number(process.env.IMAGE_CONCURRENCY || 2)) throw new ApiError(503,'Image processing busy')
    active++
    try {
      let url = params.url.startsWith('//') ? 'https:'+params.url : params.url
      let headers: Record<string,string> = {}
      let onResponse: ((data: Uint8Array) => Uint8Array | Promise<Uint8Array>) | undefined
      if (params.source) {
        const source = await loadSource(params.source,context)
        const hook = params.thumbnail === '1' ? source.comic?.onThumbnailLoad : source.comic?.onImageLoad
        const imageConfig = await hook?.(params.url,params.comicId,params.epId)
        if (imageConfig?.url) url = imageConfig.url
        headers = { ...source.headers,...imageConfig?.headers }
        if (typeof imageConfig?.onResponse === 'function') onResponse = imageConfig.onResponse
      }
      if (userCookie && !headers.Cookie && !headers.cookie) headers.Cookie = userCookie
      if (!/^https?:\/\//.test(url)) throw new ApiError(400,'Invalid image URL')
      const response = await boundedFetch(url,{ headers })
      if (response.status !== 200) throw new ApiError(response.status === 429 ? 429 : 502,'Image upstream failed')
      let input = response.body
      if (onResponse) input = Buffer.from(await onResponse(input))
      if (input.length > Number(process.env.MAX_DOWNLOAD_BYTES || 20971520)) throw new ApiError(413,'Hook output too large')
      const pixels = Number(process.env.MAX_IMAGE_PIXELS || 32000000)
      const original = await sharp(input,{limitInputPixels:pixels}).metadata()
      const image = sharp(input,{limitInputPixels:pixels}).flatten({background:'#ffffff'}).removeAlpha().resize({width,height:format==='lvgl'?2047:8192,fit:'inside',withoutEnlargement:true})
      let body: Buffer, actualSize: string
      if (format === 'lvgl') {
        const raw = await image.toColourspace('srgb').raw().toBuffer({resolveWithObject:true})
        body = encodeLvgl(raw.data,raw.info.width,raw.info.height); actualSize = `${raw.info.width}x${raw.info.height}`
      } else {
        const output = await (format==='png'?image.png({palette:true,quality,compressionLevel:9}):image.jpeg({quality})).toBuffer({resolveWithObject:true})
        body = output.data; actualSize = `${output.info.width}x${output.info.height}`
      }
      if (body.length > Number(process.env.MAX_OUTPUT_BYTES || 4194304)) throw new ApiError(413,'Response budget exceeded')
      const result: ImageProxyResult = {body,contentType:format==='lvgl'?'application/octet-stream':`image/${format}`,cacheHit:false,originalSize:`${original.width}x${original.height}`,actualSize,private:privateContent}
      if (!privateContent && config.imageCacheDriver !== 'none') {
        const limit = Number(process.env.MEMORY_CACHE_BYTES || 67108864)
        if (body.length <= limit) { memory.set(key,{result,expires:Date.now()+ttl}); memoryBytes += body.length }
        while (memoryBytes > limit) { const oldest = memory.keys().next().value!; memoryBytes -= memory.get(oldest)!.result.body.length; memory.delete(oldest) }
        if (config.imageCacheDriver==='file') await diskWrite(file,result)
      }
      return result
    } finally { active-- }
  })()
  inflight.set(key,job)
  try { return await job } finally { inflight.delete(key) }
}
