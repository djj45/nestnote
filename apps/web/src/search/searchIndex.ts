import { getAncestors, getPagesSnapshot, type PageMeta } from '../store/workspace'
import { readPageDoc } from '../store/docPool'
import { extractPage, type TextEntry } from './extract'

/**
 * 全文搜索：在浏览器里给所有页面建一个纯文字的索引（标题 + 正文 + 画布卡片），
 * 页面改过以后（updatedAt 变了）下次搜索时重新读。中文直接按子串匹配，空格分开的几个词都要出现。
 */

interface Indexed {
  updatedAt: number
  type: PageMeta['type']
  entries: TextEntry[]
  lower: string[]
}

const cache = new Map<string, Indexed>()

/** 把所有可见页面读进索引；onProgress 报告进度。已经是最新的页面不再读 */
export async function refreshIndex(onProgress?: (done: number, total: number) => void): Promise<void> {
  const snap = getPagesSnapshot()
  const pages = [...snap.visible].map((id) => snap.byId.get(id)!).filter(Boolean)
  for (const id of [...cache.keys()]) if (!snap.visible.has(id)) cache.delete(id)
  const stale = pages.filter((p) => {
    const c = cache.get(p.id)
    return !c || c.updatedAt !== p.updatedAt || c.type !== p.type
  })
  let done = pages.length - stale.length
  onProgress?.(done, pages.length)
  // 同时读几个，太多会让浏览器卡
  const queue = [...stale]
  const worker = async () => {
    for (let page = queue.shift(); page; page = queue.shift()) {
      try {
        const entries = await readPageDoc(page.id, (doc) => extractPage(page!.type, doc))
        cache.set(page.id, {
          updatedAt: page.updatedAt,
          type: page.type,
          entries,
          lower: entries.map((e) => e.text.toLowerCase()),
        })
      } catch {
        /* 读不了的页面跳过 */
      }
      done++
      onProgress?.(done, pages.length)
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
}

export interface Snippet {
  /** 片段文字，按匹配处切开：奇数项是命中的词 */
  parts: string[]
  block?: number
  elementId?: string
  /** 用来在页面里定位的词（第一个搜索词） */
  term: string
}

export interface SearchResult {
  page: PageMeta
  path: string
  titleParts: string[]
  snippets: Snippet[]
  /** 命中的段落总数 */
  hits: number
}

export function parseQuery(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))]
}

/** 把文字按搜索词切开（不分大小写），奇数项是命中的部分 */
export function splitByTerms(text: string, terms: string[]): string[] {
  if (!terms.length) return [text]
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length)
  return text.split(new RegExp(`(${escaped.join('|')})`, 'gi'))
}

function makeSnippet(text: string, lower: string, terms: string[]): { parts: string[]; term: string } {
  let first = -1
  let term = terms[0]
  for (const t of terms) {
    const i = lower.indexOf(t)
    if (i >= 0 && (first < 0 || i < first)) {
      first = i
      term = t
    }
  }
  const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' · ')
  const start = Math.max(0, first - 24)
  const end = Math.min(text.length, Math.max(first, 0) + 90)
  const piece = (start > 0 ? '…' : '') + oneLine(text.slice(start, end)) + (end < text.length ? '…' : '')
  return { parts: splitByTerms(piece, terms), term: text.slice(first, first + term.length) }
}

export function search(query: string, limit = 40): SearchResult[] {
  const terms = parseQuery(query)
  if (!terms.length) return []
  const snap = getPagesSnapshot()
  const results: Array<SearchResult & { score: number }> = []
  for (const id of snap.visible) {
    const page = snap.byId.get(id)
    const indexed = cache.get(id)
    if (!page) continue
    const title = page.title || '无标题'
    const titleLower = title.toLowerCase()
    const lower = indexed?.lower ?? []
    // 每个词都要在标题或正文里出现
    if (!terms.every((t) => titleLower.includes(t) || lower.some((l) => l.includes(t)))) continue
    const snippets: Snippet[] = []
    let hits = 0
    lower.forEach((l, i) => {
      if (!terms.some((t) => l.includes(t))) return
      hits++
      if (snippets.length >= 3) return
      const entry = indexed!.entries[i]
      const { parts, term } = makeSnippet(entry.text, l, terms)
      snippets.push({ parts, term, block: entry.block, elementId: entry.elementId })
    })
    const titleAll = terms.every((t) => titleLower.includes(t))
    const titleAny = terms.some((t) => titleLower.includes(t))
    const score = (titleAll ? 1000 : titleAny ? 300 : 0) + Math.min(hits, 50) * 10 + page.updatedAt / 1e13
    results.push({
      page,
      path: getAncestors(id)
        .map((p) => p.title || '无标题')
        .join(' / '),
      titleParts: splitByTerms(title, terms),
      snippets,
      hits,
      score,
    })
  }
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}
