import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getAppConfig } from '../config'
import { listAvailableSourceKeys } from '../runtime/venera'
import type { SourceConfig } from '../types'

const fallbackNames: Record<string, string> = {
  copy_manga: '拷贝漫画',
  manga_dex: 'MangaDex',
  nhentai: 'nhentai',
  picacg: 'Picacg'
}

export async function getEnabledSourceKeys(): Promise<string[]> {
  const config = getAppConfig()
  const available = listAvailableSourceKeys()
  return config.enabledSources.filter((key: string) => available.includes(key))
}

function readSourceName(sourceKey: string): string {
  const file = path.join(process.cwd(), 'sources', `${sourceKey}.js`)
  if (!existsSync(file)) return fallbackNames[sourceKey] || sourceKey

  const code = readFileSync(file, 'utf8')
  const match = code.match(/this\.name\s*=\s*['"]([^'"]+)['"]/)
  return match?.[1] || fallbackNames[sourceKey] || sourceKey
}

export async function getSourceConfigs(baseUrl: string): Promise<Record<string, SourceConfig>> {
  const result: Record<string, SourceConfig> = {}
  const keys = await getEnabledSourceKeys()

  for (const key of keys) {
    result[key] = {
      name: readSourceName(key),
      apiUrl: baseUrl,
      detailPath: `/api/${key}/album/<id>`,
      photoPath: `/api/${key}/photo/<id>/chapter/<chapter>`,
      searchPath: `/api/${key}/search/<text>/<page>`,
      type: 'venera'
    }
  }

  return result
}
