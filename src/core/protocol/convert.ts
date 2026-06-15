function isMapLike(value: unknown): value is Map<unknown, unknown> {
  return Object.prototype.toString.call(value) === '[object Map]'
}

export function flattenTags(tags: unknown): string[] {
  if (!tags) return []
  if (isMapLike(tags)) {
    return Array.from(tags.values()).flat().map(String)
  }
  if (Array.isArray(tags)) {
    return tags.flat().map(String)
  }
  if (typeof tags === 'object') {
    return Object.values(tags as Record<string, unknown>).flat().map(String)
  }
  return []
}

export function countChapters(chapters: unknown): number {
  if (!chapters) return 0
  if (isMapLike(chapters)) {
    let total = 0
    for (const value of chapters.values()) {
      total += isMapLike(value) ? value.size : 1
    }
    return total
  }
  if (typeof chapters === 'object') {
    return Object.keys(chapters as Record<string, unknown>).length
  }
  return 0
}

export function getChapterIdByIndex(chapters: unknown, chapter: string): string {
  if (!/^\d+$/.test(chapter) || !chapters) return chapter
  const targetIndex = Number(chapter) - 1
  let currentIndex = 0

  if (isMapLike(chapters)) {
    for (const [key, value] of chapters) {
      if (isMapLike(value)) {
        for (const [chapterId] of value) {
          if (currentIndex === targetIndex) return String(chapterId)
          currentIndex++
        }
      } else {
        if (currentIndex === targetIndex) return String(key)
        currentIndex++
      }
    }
  }

  if (typeof chapters === 'object') {
    const keys = Object.keys(chapters as Record<string, unknown>)
    return keys[targetIndex] || chapter
  }

  return chapter
}
