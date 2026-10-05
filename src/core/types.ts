export interface RequestContext {
  baseUrl: string
  userAgent?: string
  cookie?: string
}

export interface SourceConfig {
  name: string
  apiUrl: string
  detailPath: string
  photoPath: string
  searchPath: string
  type: string
  idType?: string
}

export interface ComicSearchResult {
  comic_id: string | number
  title: string
  cover_url: string
  pages?: number
}

export interface SearchResponse {
  page: number
  has_more: boolean
  results: ComicSearchResult[]
}

export interface DetailResponse {
  item_id: string | number
  name: string
  page_count: number
  views?: string | number
  rate?: string | number
  cover: string
  tags?: string[]
  total_chapters: number
}

export interface PhotoResponse {
  title: string
  images: Array<{ url: string }>
}
