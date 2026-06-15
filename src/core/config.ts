export type DeployTarget = 'vercel' | 'server'

export interface AppConfig {
  deployTarget: DeployTarget
  enabledSources: string[]
  defaultImageWidth: number
  defaultImageQuality: number
  cacheDriver: 'memory' | 'file' | 'none'
  imageCacheDriver: 'memory' | 'file' | 'none'
  cacheDir: string
  imageCacheDir: string
  storageDir: string
  enableReload: boolean
  port: number
}

function readList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function readNumber(value: string | undefined, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

export function getAppConfig(): AppConfig {
  const deployTarget = (process.env.DEPLOY_TARGET === 'server' ? 'server' : 'vercel') as DeployTarget

  return {
    deployTarget,
    enabledSources: readList(process.env.ENABLED_SOURCES, ['copy_manga', 'manga_dex', 'nhentai', 'picacg']),
    defaultImageWidth: readNumber(process.env.DEFAULT_IMAGE_WIDTH, 600),
    defaultImageQuality: readNumber(process.env.DEFAULT_IMAGE_QUALITY, 50),
    cacheDriver: (process.env.CACHE_DRIVER as AppConfig['cacheDriver']) || (deployTarget === 'server' ? 'file' : 'memory'),
    imageCacheDriver: (process.env.IMAGE_CACHE_DRIVER as AppConfig['imageCacheDriver']) || (deployTarget === 'server' ? 'file' : 'none'),
    cacheDir: process.env.CACHE_DIR || './data/cache',
    imageCacheDir: process.env.IMAGE_CACHE_DIR || './data/images',
    storageDir: process.env.STORAGE_DIR || './data/storage',
    enableReload: readBoolean(process.env.ENABLE_RELOAD, deployTarget === 'server'),
    port: readNumber(process.env.PORT, 3000)
  }
}
