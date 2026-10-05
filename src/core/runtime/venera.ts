import { randomUUID, createHash, createHmac, createDecipheriv, privateDecrypt } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import * as cheerio from 'cheerio'
import type { RequestContext } from '../types'
import { getAppConfig } from '../config'
import { ApiError, boundedFetch } from '../network'

export interface VeneraSource {
  name: string
  key: string
  version?: string
  url?: string
  headers?: Record<string, string>
  search?: {
    load?: (keyword: string, options: string[], page: number) => Promise<{ comics: any[]; maxPage?: number }>
  }
  comic?: {
    loadInfo?: (id: string) => Promise<any>
    loadEp?: (comicId: string, epId: string) => Promise<{ images: string[] }>
    onImageLoad?: (url: string, comicId?: string, epId?: string) => any | Promise<any>
    onThumbnailLoad?: (url: string, comicId?: string, epId?: string) => any | Promise<any>
  }
  loadData: (key: string) => any
  saveData: (key: string, value: any) => void
  deleteData: (key: string) => void
  loadSetting: (key: string) => any
  saveSetting: (key: string, value: any) => void
}

const sourceCache = new Map<string, VeneraSource>()
const dataStore = new Map<string, Record<string, any>>()
const settingsStore = new Map<string, Record<string, any>>()
const loading = new Map<string, Promise<VeneraSource>>()
const sourceTimes = new Map<string, number>()

function sourcePath(sourceKey: string): string {
  return path.join(process.cwd(), 'sources', `${sourceKey}.js`)
}

function getStore(store: Map<string, Record<string, any>>, key: string): Record<string, any> {
  const existed = store.get(key)
  if (existed) return existed
  const next: Record<string, any> = {}
  store.set(key, next)
  return next
}

function defaultHeaders(sourceKey: string, extra?: Record<string, string>): Record<string, string> {
  if (sourceKey === 'nhentai') {
    return {
      'User-Agent': process.env.NHENTAI_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...extra
    }
  }

  return {
    ...extra
  }
}

function sourceCookie(sourceKey: string): string | undefined {
  return process.env[`${sourceKey.toUpperCase()}_COOKIE`]
}

class Cookie {
  name: string
  value: string
  domain?: string

  constructor({ name, value, domain }: { name: string; value: string; domain?: string }) {
    this.name = name
    this.value = value
    this.domain = domain
  }
}

class HtmlNode {
  constructor(private node: any) {}

  get type(): string {
    return this.node.type
  }

  get text(): string {
    return 'data' in this.node ? String(this.node.data || '') : cheerio.load(this.node).text()
  }

  toElement(): HtmlElement | null {
    return this.node.type === 'tag' ? new HtmlElement(this.node) : null
  }
}

class HtmlElement {
  constructor(private element: any, private root?: cheerio.CheerioAPI) {}

  private get $(): cheerio.CheerioAPI {
    return this.root || cheerio.load(this.element)
  }

  querySelector(selector: string): HtmlElement | null {
    const el = this.$(this.element).find(selector).first().get(0)
    return el ? new HtmlElement(el, this.$) : null
  }

  querySelectorAll(selector: string): HtmlElement[] {
    return this.$(this.element)
      .find(selector)
      .toArray()
      .map((el) => new HtmlElement(el, this.$))
  }

  getElementById(id: string): HtmlElement | null {
    return this.querySelector(`#${id}`)
  }

  get text(): string {
    return this.$(this.element).text()
  }

  get attributes(): Record<string, string> {
    return { ...(this.element.attribs || {}) }
  }

  get children(): HtmlElement[] {
    return this.$(this.element)
      .children()
      .toArray()
      .map((el) => new HtmlElement(el, this.$))
  }

  get nodes(): HtmlNode[] {
    return (this.element.children || []).map((node: any) => new HtmlNode(node))
  }

  get parent(): HtmlElement | null {
    const parent = this.element.parent
    return parent && parent.type === 'tag' ? new HtmlElement(parent, this.$) : null
  }

  get innerHtml(): string {
    return this.$(this.element).html() || ''
  }

  get innerHTML(): string {
    return this.innerHtml
  }

  get classNames(): string[] {
    return (this.element.attribs?.class || '').split(/\s+/).filter(Boolean)
  }

  get id(): string | null {
    return this.element.attribs?.id || null
  }

  get localName(): string {
    return this.element.tagName || this.element.name || ''
  }

  get previousSibling(): HtmlElement | null {
    const prev = this.$(this.element).prev().get(0)
    return prev ? new HtmlElement(prev, this.$) : null
  }

  get previousElementSibling(): HtmlElement | null {
    return this.previousSibling
  }

  get nextSibling(): HtmlElement | null {
    const next = this.$(this.element).next().get(0)
    return next ? new HtmlElement(next, this.$) : null
  }

  get nextElementSibling(): HtmlElement | null {
    return this.nextSibling
  }

  getAttribute(name: string): string | null {
    return this.element.attribs?.[name] ?? null
  }
}

class HtmlDocument {
  private $: cheerio.CheerioAPI

  constructor(html: string) {
    this.$ = cheerio.load(html)
  }

  querySelector(selector: string): HtmlElement | null {
    const el = this.$(selector).first().get(0)
    return el ? new HtmlElement(el, this.$) : null
  }

  querySelectorAll(selector: string): HtmlElement[] {
    return this.$(selector)
      .toArray()
      .map((el) => new HtmlElement(el, this.$))
  }

  getElementById(id: string): HtmlElement | null {
    return this.querySelector(`#${id}`)
  }

  dispose() {}
}

function createConvert() {
  return {
    encodeUtf8: (str: string) => new Uint8Array(Buffer.from(str, 'utf8')),
    decodeUtf8: (value: ArrayBuffer | Uint8Array) => Buffer.from(value as any).toString('utf8'),
    encodeBase64: (value: ArrayBuffer | Uint8Array) => Buffer.from(value as any).toString('base64'),
    decodeBase64: (value: string) => new Uint8Array(Buffer.from(value, 'base64')),
    md5: (value: ArrayBuffer | Uint8Array) => new Uint8Array(createHash('md5').update(Buffer.from(value as any)).digest()),
    sha1: (value: ArrayBuffer | Uint8Array) => new Uint8Array(createHash('sha1').update(Buffer.from(value as any)).digest()),
    sha256: (value: ArrayBuffer | Uint8Array) => new Uint8Array(createHash('sha256').update(Buffer.from(value as any)).digest()),
    sha512: (value: ArrayBuffer | Uint8Array) => new Uint8Array(createHash('sha512').update(Buffer.from(value as any)).digest()),
    hmac: (key: ArrayBuffer | Uint8Array, value: ArrayBuffer | Uint8Array, hash: string) =>
      new Uint8Array(createHmac(hash, Buffer.from(key as any)).update(Buffer.from(value as any)).digest()),
    hmacString: (key: ArrayBuffer | Uint8Array, value: ArrayBuffer | Uint8Array, hash: string) =>
      createHmac(hash, Buffer.from(key as any)).update(Buffer.from(value as any)).digest('hex'),
    decryptAesEcb: (value: ArrayBuffer | Uint8Array, key: ArrayBuffer | Uint8Array) => {
      const decipher = createDecipheriv('aes-128-ecb', Buffer.from(key as any).subarray(0, 16), null)
      return new Uint8Array(Buffer.concat([decipher.update(Buffer.from(value as any)), decipher.final()]))
    },
    decryptAesCbc: (value: ArrayBuffer | Uint8Array, key: ArrayBuffer | Uint8Array, iv: ArrayBuffer | Uint8Array) => {
      const decipher = createDecipheriv('aes-128-cbc', Buffer.from(key as any).subarray(0, 16), Buffer.from(iv as any).subarray(0, 16))
      return new Uint8Array(Buffer.concat([decipher.update(Buffer.from(value as any)), decipher.final()]))
    },
    decryptAesCfb: (value: ArrayBuffer | Uint8Array, key: ArrayBuffer | Uint8Array, iv: ArrayBuffer | Uint8Array) => {
      const decipher = createDecipheriv('aes-128-cfb', Buffer.from(key as any).subarray(0, 16), Buffer.from(iv as any).subarray(0, 16))
      return new Uint8Array(Buffer.concat([decipher.update(Buffer.from(value as any)), decipher.final()]))
    },
    decryptAesOfb: (value: ArrayBuffer | Uint8Array, key: ArrayBuffer | Uint8Array, iv: ArrayBuffer | Uint8Array) => {
      const decipher = createDecipheriv('aes-128-ofb', Buffer.from(key as any).subarray(0, 16), Buffer.from(iv as any).subarray(0, 16))
      return new Uint8Array(Buffer.concat([decipher.update(Buffer.from(value as any)), decipher.final()]))
    },
    decryptRsa: (value: ArrayBuffer | Uint8Array, key: ArrayBuffer | Uint8Array) => new Uint8Array(privateDecrypt(Buffer.from(key as any), Buffer.from(value as any))),
    hexEncode: (value: ArrayBuffer | Uint8Array) => Buffer.from(value as any).toString('hex'),
    hexDecode: (hex: string) => new Uint8Array(Buffer.from(hex, 'hex'))
  }
}

function normalizeRequestUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.search = parsed.search.replaceAll('[', '%5B').replaceAll(']', '%5D')
    return parsed.toString()
  } catch {
    return url.replaceAll('[', '%5B').replaceAll(']', '%5D')
  }
}

function createNetwork(sourceKey: string, context?: RequestContext) {
  async function request(method: string, url: string, headers: Record<string, string> = {}, data?: any, bytes = false) {
    const mergedHeaders = defaultHeaders(sourceKey, headers)
    const cookie = context?.cookie || sourceCookie(sourceKey)
    if (cookie && !mergedHeaders.Cookie && !mergedHeaders.cookie) {
      mergedHeaders.Cookie = cookie
    }

    let response: Awaited<ReturnType<typeof boundedFetch>>
    try {
      response = await boundedFetch(normalizeRequestUrl(url), {
        method,
        headers: mergedHeaders,
        body: data == null || method === 'GET' ? undefined : typeof data === 'string' ? data : Buffer.from(data)
      })
    } catch (error) {
      throw new Error(`Request failed: ${method} ${url} - ${error instanceof Error ? error.message : String(error)}`)
    }

    const body = bytes ? new Uint8Array(response.body) : response.body.toString('utf8')
    const resultHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      resultHeaders[key] = value
    })

    return { status: response.status, headers: resultHeaders, body }
  }

  return {
    fetchBytes: (method: string, url: string, headers?: Record<string, string>, data?: any) => request(method, url, headers, data, true),
    sendRequest: (method: string, url: string, headers?: Record<string, string>, data?: any) => request(method, url, headers, data, false),
    get: (url: string, headers?: Record<string, string>) => request('GET', url, headers, undefined, false),
    post: (url: string, headers?: Record<string, string>, data?: any) => request('POST', url, headers, data, false),
    put: (url: string, headers?: Record<string, string>, data?: any) => request('PUT', url, headers, data, false),
    delete: (url: string, headers?: Record<string, string>) => request('DELETE', url, headers, undefined, false),
    patch: (url: string, headers?: Record<string, string>, data?: any) => request('PATCH', url, headers, data, false),
    setCookies: () => undefined,
    getCookies: () => [],
    deleteCookies: () => undefined
  }
}

function createFetch(Network: ReturnType<typeof createNetwork>) {
  return async (url: string, options: any = {}) => {
    const result = await Network.fetchBytes(options.method || 'GET', url, options.headers || {}, options.body)
    return {
      status: result.status,
      ok: result.status >= 200 && result.status < 300,
      headers: result.headers,
      arrayBuffer: async () => result.body,
      text: async () => Buffer.from(result.body).toString('utf8'),
      json: async () => JSON.parse(Buffer.from(result.body).toString('utf8'))
    }
  }
}

function createContext(sourceKey: string, requestContext?: RequestContext): vm.Context {
  const storeKey = sourceKey + ':' + createHash('sha256').update(requestContext?.cookie || sourceCookie(sourceKey) || '').digest('hex')
  const Network = createNetwork(sourceKey, requestContext)
  const Convert = createConvert()

  class ComicSource {
    name = ''
    key = ''
    version = '1.0.0'
    minAppVersion = '1.0.0'
    url = ''
    account: any = null
    explore: any[] = []
    category: any = null
    categoryComics: any = null
    search: any = null
    favorites: any = null
    comic: any = null
    translation: any = {}

    loadData(key: string) {
      return getStore(dataStore, storeKey)[key]
    }

    saveData(key: string, value: any) {
      const store = getStore(dataStore, storeKey)
      if (Buffer.byteLength(JSON.stringify({ ...store, [key]: value })) > Number(process.env.SOURCE_DATA_BYTES || 1048576)) throw new ApiError(413, 'Source state budget exceeded')
      store[key] = value
    }

    deleteData(key: string) {
      delete getStore(dataStore, storeKey)[key]
    }

    loadSetting(key: string) {
      return getStore(settingsStore, storeKey)[key]
    }

    saveSetting(key: string, value: any) {
      getStore(settingsStore, storeKey)[key] = value
    }

    get isLogged() {
      return Boolean(this.loadData('token') || requestContext?.cookie)
    }

    static sources: Record<string, any> = {}
  }

  return vm.createContext({
    console,
    Buffer,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    APP: { locale: 'zh_CN', version: '1.6.3' },
    ComicSource,
    Comic: class Comic { constructor(data: any) { Object.assign(this, data) } },
    ComicDetails: class ComicDetails { constructor(data: any) { Object.assign(this, data) } },
    Comment: class Comment { constructor(data: any) { Object.assign(this, data) } },
    Cookie,
    Network,
    fetch: createFetch(Network),
    Convert,
    HtmlDocument,
    HtmlElement,
    HtmlNode,
    createUuid: () => randomUUID(),
    randomInt: (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1)),
    randomDouble: (min: number, max: number) => min + Math.random() * (max - min),
    sendMessage: () => null,
    globalThis: {}
  })
}

function applyDefaultSettings(source: VeneraSource) {
  const sourceClass = source.constructor as any
  const defaults: Record<string, any> = {
    base_url: sourceClass.defaultApiUrl,
    region: sourceClass.defaultCopyRegion,
    image_quality: sourceClass.defaultImageQuality,
    appChannel: '3',
    imageQuality: 'original',
    favoriteSort: 'dd'
  }

  for (const [key, value] of Object.entries(defaults)) {
    if (value != null && source.loadSetting(key) == null) {
      source.saveSetting(key, value)
    }
  }
}

export function clearRuntimeCache() {
  sourceCache.clear()
  dataStore.clear()
  settingsStore.clear()
  sourceTimes.clear()
}

export async function loadSource(sourceKey: string, context?: RequestContext): Promise<VeneraSource> {
  if (!/^[a-z_]+$/.test(sourceKey) || !getAppConfig().enabledSources.includes(sourceKey)) throw new ApiError(404, 'Source disabled or unknown')
  const cacheKey = `${sourceKey}:${createHash('sha256').update(context?.cookie || sourceCookie(sourceKey) || '').digest('hex')}`
  for (const [key, time] of sourceTimes) {
    if (Date.now()-time > Number(process.env.SOURCE_TTL_MS || 1800000)) { sourceCache.delete(key); sourceTimes.delete(key); dataStore.delete(key); settingsStore.delete(key) }
  }
  const cached = sourceCache.get(cacheKey)
  if (cached) return cached
  const pending = loading.get(cacheKey)
  if (pending) return pending
  if (loading.size >= Number(process.env.SOURCE_CACHE_ENTRIES || 64)) throw new ApiError(503,'Source initialization busy')
  const job = instantiateSource(sourceKey,context,cacheKey)
  loading.set(cacheKey,job)
  try { return await job } catch(error) {
    dataStore.delete(cacheKey); settingsStore.delete(cacheKey); throw error
  } finally { loading.delete(cacheKey) }
}

async function instantiateSource(sourceKey: string, context: RequestContext | undefined, cacheKey: string): Promise<VeneraSource> {

  const file = sourcePath(sourceKey)
  if (!existsSync(file)) {
    throw new Error(`Source not found: ${sourceKey}`)
  }

  const code = readFileSync(file, 'utf8')
  const className = code.match(/class\s+(\w+)\s+extends\s+ComicSource/)?.[1]
  if (!className) {
    throw new Error(`Invalid source file: ${sourceKey}`)
  }

  const contextObject = createContext(sourceKey, context)
  const script = new vm.Script(`${code}\nglobalThis.__SourceClass = ${className};`, { filename: file })
  script.runInContext(contextObject, { timeout: 10_000 })
  const SourceClass = (contextObject.globalThis as any).__SourceClass
  const source = new SourceClass() as VeneraSource

  if (!source.key) source.key = sourceKey
  applyDefaultSettings(source)

  if (typeof (source as any).init === 'function') {
    await Promise.resolve((source as any).init())
  }

  sourceCache.set(cacheKey, source)
  sourceTimes.set(cacheKey, Date.now())
  while (sourceCache.size > Number(process.env.SOURCE_CACHE_ENTRIES || 64)) {
    const oldest = sourceCache.keys().next().value!
    sourceCache.delete(oldest); sourceTimes.delete(oldest); dataStore.delete(oldest); settingsStore.delete(oldest)
  }
  return source
}

export function listAvailableSourceKeys(): string[] {
  return ['copy_manga', 'manga_dex', 'nhentai', 'picacg'].filter((key) => existsSync(sourcePath(key)))
}
