import { loadSource } from '../runtime/venera'
import type { DetailResponse, PhotoResponse, RequestContext, SearchResponse } from '../types'
import { countChapters, flattenTags, getChapterIdByIndex } from './convert'
import { ApiError } from '../network'

function buildProxyUrl(baseUrl: string, sourceKey: string, imageUrl: string, comicId?: string, epId?: string, thumbnail = false): string {
  const url = new URL(baseUrl.replace(/\/$/, '') + '/api/image/proxy')
  url.searchParams.set('source', sourceKey)
  url.searchParams.set('url', imageUrl)
  if (comicId) url.searchParams.set('comicId', comicId)
  if (epId) url.searchParams.set('epId', epId)
  if (thumbnail) url.searchParams.set('thumbnail', '1')
  return url.toString()
}

function defaultOptions(source: any): string[] {
  const optionList = source.search?.optionList
  if (!Array.isArray(optionList)) return []

  return optionList.map((group: any) => {
    if (group.default != null) return String(group.default)
    const first = Array.isArray(group.options) ? group.options[0] : ''
    return String(first || '').split('-')[0]
  })
}

export async function searchComic(sourceKey: string, keyword: string, page: number, context: RequestContext): Promise<SearchResponse> {
  if (!Number.isInteger(page) || page < 1 || !keyword.trim()) throw new ApiError(400,'Invalid search parameters')
  const source = await loadSource(sourceKey, context)
  if (!source.search?.load) {
    throw new Error(`Source ${sourceKey} does not support search`)
  }

  const data = await source.search.load(keyword, defaultOptions(source), page)
  const comics = Array.isArray(data.comics) ? data.comics : []

  return {
    page,
    has_more: data.maxPage == null ? comics.length > 0 : page < Number(data.maxPage),
    results: comics.map((comic: any) => ({
      comic_id: comic.id,
      title: comic.title || comic.name || '',
      cover_url: comic.cover ? buildProxyUrl(context.baseUrl, sourceKey, comic.cover, String(comic.id), undefined, true) : '',
      pages: Number(comic.maxPage || comic.pages || 0)
    }))
  }
}

export async function getComicDetail(sourceKey: string, id: string, context: RequestContext): Promise<DetailResponse> {
  const source = await loadSource(sourceKey, context)
  if (!source.comic?.loadInfo) {
    throw new Error(`Source ${sourceKey} does not support detail`)
  }

  const detail = await source.comic.loadInfo(id)
  const totalChapters = Math.max(countChapters(detail.chapters), 1)
  const pageCount = totalChapters > 1 ? 0 : Number(detail.maxPage || detail.thumbnails?.length || 0)

  return {
    item_id: detail.id || id,
    name: detail.title || detail.name || id,
    page_count: pageCount,
    views: detail.likesCount || detail.commentCount || 0,
    rate: detail.stars || 0,
    cover: detail.cover ? buildProxyUrl(context.baseUrl, sourceKey, detail.cover, id, undefined, true) : '',
    tags: flattenTags(detail.tags),
    total_chapters: totalChapters
  }
}

export async function getPhotoList(sourceKey: string, id: string, chapter: string, context: RequestContext): Promise<PhotoResponse> {
  const source = await loadSource(sourceKey, context)
  if (!source.comic?.loadEp) {
    throw new Error(`Source ${sourceKey} does not support chapter images`)
  }

  let epId = chapter
  let title = `Chapter ${chapter}`

  if (source.comic.loadInfo) {
    try {
      const detail = await source.comic.loadInfo(id)
      epId = getChapterIdByIndex(detail.chapters, chapter)
      if (Object.prototype.toString.call(detail.chapters) === '[object Map]') {
        const chaptersMap = detail.chapters as Map<unknown, unknown>
        for (const [key, value] of chaptersMap) {
          if (Object.prototype.toString.call(value) === '[object Map]' && (value as Map<unknown, unknown>).has(epId)) {
            title = String((value as Map<unknown, unknown>).get(epId))
          }
          if (key === epId) title = String(value)
        }
      } else if (detail.chapters && typeof detail.chapters === 'object') {
        title = String((detail.chapters as Record<string, unknown>)[epId] || title)
      }
    } catch (error) {
      throw error
    }
  }

  const data = await source.comic.loadEp(id, epId)
  const images = Array.isArray(data.images) ? data.images : []

  return {
    title,
    images: images.map((url: string) => ({
      url: buildProxyUrl(context.baseUrl, sourceKey, String(url), id, epId)
    }))
  }
}
