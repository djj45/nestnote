import * as Y from 'yjs'
import type { JSONContent } from '@tiptap/core'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import { getPage, getPagesSnapshot, type PageMeta } from '../store/workspace'
import { readPageDoc } from '../store/docPool'
import { assetsMap, getAssetBlobAnywhere } from '../assets/assetStore'
import { makeZip, type ZipEntry } from '../lib/zip'
import { downloadBlob } from '../lib/format'

/**
 * 导出成 Markdown：
 * - 文档按标准 Markdown（GFM）写：标题、列表、待办、表格、代码块、引用、标注框（> [!NOTE]）。
 * - 画布按位置从上到下、从左到右把卡片依次写出来，卡片之间用分割线隔开。
 * - 页面里嵌入的其它页面一起导出成单独的 .md，用链接连起来；图片和文件放在 assets/ 里。
 * - 只有一个 .md、没有图片时直接下载 .md，否则打成 .zip。
 */

interface CanvasItem {
  id: string
  type: string
  x: number
  y: number
  color: string | null
  assetId: string | null
  pageId: string | null
  content: JSONContent | null
}

interface Loaded {
  page: PageMeta
  doc?: JSONContent
  canvas?: CanvasItem[]
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

async function loadPage(page: PageMeta): Promise<Loaded> {
  return readPageDoc(page.id, (doc) => {
    if (page.type === 'doc') {
      return { page, doc: yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('content')) as JSONContent }
    }
    const items: CanvasItem[] = []
    doc.getMap<Y.Map<unknown>>('elements').forEach((m, id) => {
      if (!(m instanceof Y.Map)) return
      const content = m.get('content')
      items.push({
        id,
        type: str(m.get('type')) ?? 'text',
        x: num(m.get('x')),
        y: num(m.get('y')),
        color: str(m.get('color')),
        assetId: str(m.get('assetId')),
        pageId: str(m.get('pageId')),
        content: content instanceof Y.XmlFragment ? (yXmlFragmentToProsemirrorJSON(content) as JSONContent) : null,
      })
    })
    return { page, canvas: items }
  })
}

/** 找出页面里嵌入的其它页面 */
function embeddedIds(loaded: Loaded): string[] {
  const ids: string[] = []
  const walk = (node: JSONContent) => {
    if (node.type === 'pageEmbed' && typeof node.attrs?.pageId === 'string') ids.push(node.attrs.pageId)
    node.content?.forEach(walk)
  }
  if (loaded.doc) walk(loaded.doc)
  for (const item of loaded.canvas ?? []) if (item.type === 'embed' && item.pageId) ids.push(item.pageId)
  return ids
}

// ---------------- 转换 ----------------

interface Ctx {
  /** 页面 id -> 导出的文件名（只包括一起导出的页面） */
  files: Map<string, string>
  /** 资源 id -> 文件路径 */
  assets: Map<string, string>
  usedAssetNames: Set<string>
}

function safeName(name: string, fallback: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').trim().slice(0, 80)
  return cleaned || fallback
}

function uniqueName(base: string, ext: string, used: Set<string>): string {
  let name = `${base}${ext}`
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} ${i}${ext}`
  used.add(name.toLowerCase())
  return name
}

function assetPath(ctx: Ctx, assetId: string): string {
  const existing = ctx.assets.get(assetId)
  if (existing) return existing
  const meta = assetsMap.get(assetId)
  const original = meta?.name ?? assetId
  const dot = original.lastIndexOf('.')
  const base = safeName(dot > 0 ? original.slice(0, dot) : original, 'file')
  const ext = dot > 0 ? original.slice(dot) : ''
  const path = `assets/${uniqueName(base, ext, ctx.usedAssetNames)}`
  ctx.assets.set(assetId, path)
  return path
}

/** 链接里的路径：空格等要编码，否则很多软件认不出来 */
const href = (path: string) => path.split('/').map(encodeURIComponent).join('/')

const escapeText = (text: string) => text.replace(/([\\`*_[\]<>])/g, '\\$1')

function inline(nodes: JSONContent[] | undefined, ctx: Ctx): string {
  let out = ''
  for (const node of nodes ?? []) {
    if (node.type === 'text') {
      const marks = node.marks ?? []
      const isCode = marks.some((m) => m.type === 'code')
      let text = isCode ? '`' + (node.text ?? '').replace(/`/g, 'ˋ') + '`' : escapeText(node.text ?? '')
      for (const mark of marks) {
        if (mark.type === 'bold') text = `**${text}**`
        else if (mark.type === 'italic') text = `*${text}*`
        else if (mark.type === 'strike') text = `~~${text}~~`
        else if (mark.type === 'underline') text = `<u>${text}</u>`
        else if (mark.type === 'link' && mark.attrs?.href) text = `[${text}](${mark.attrs.href})`
      }
      out += text
    } else if (node.type === 'hardBreak') {
      out += '  \n'
    } else if (node.type === 'pageLink') {
      const id = node.attrs?.pageId as string | undefined
      const page = id ? getPage(id) : undefined
      const title = page ? page.title || '无标题' : '已删除的页面'
      const file = id ? ctx.files.get(id) : undefined
      out += file ? `[${escapeText(title)}](${href(file)})` : `[[${title}]]`
    } else {
      out += inline(node.content, ctx)
    }
  }
  return out
}

const indent = (text: string, prefix: string, first = prefix) =>
  text
    .split('\n')
    .map((line, i) => (i === 0 ? first : line ? prefix : '') + line)
    .join('\n')

function tableToMd(node: JSONContent, ctx: Ctx): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      (cell.content ?? [])
        .map((p) => inline(p.content, ctx))
        .join('<br>')
        .replace(/\|/g, '\\|')
        .replace(/\n/g, ' '),
    ),
  )
  if (!rows.length) return ''
  const cols = Math.max(...rows.map((r) => r.length))
  const line = (cells: string[]) => `| ${Array.from({ length: cols }, (_, i) => cells[i] ?? '').join(' | ')} |`
  return [line(rows[0]), `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n')
}

function listItem(node: JSONContent, marker: string, ctx: Ctx): string {
  const children = node.content ?? []
  const [first, ...rest] = children
  const head = first && first.type === 'paragraph' ? inline(first.content, ctx) : first ? blockToMd(first, ctx) : ''
  const tail = (first && first.type !== 'paragraph' ? rest : rest).map((c) => blockToMd(c, ctx)).filter(Boolean)
  const pad = ' '.repeat(marker.length)
  let out = indent(head, pad, marker)
  if (tail.length) out += '\n' + indent(tail.join('\n'), pad, pad)
  return out
}

function mediaToMd(node: JSONContent, ctx: Ctx): string {
  const assetId = node.attrs?.assetId as string | null
  const meta = assetId ? assetsMap.get(assetId) : undefined
  const name = (node.attrs?.name as string | undefined) ?? meta?.name ?? '文件'
  const path = assetId ? href(assetPath(ctx, assetId)) : ((node.attrs?.src as string | undefined) ?? '')
  if (node.type === 'image') return `![${escapeText((node.attrs?.alt as string | undefined) ?? meta?.name ?? '')}](${path})`
  return `[${escapeText(name)}](${path})`
}

function embedToMd(pageId: string | null, ctx: Ctx): string {
  const page = pageId ? getPage(pageId) : undefined
  if (!page) return '> （嵌入的页面已被删除）'
  const file = ctx.files.get(page.id)
  const title = escapeText(page.title || '无标题')
  const kind = page.type === 'canvas' ? '画布' : '文档'
  return file ? `> 嵌入的${kind}：[${title}](${href(file)})` : `> 嵌入的${kind}：${title}`
}

function blockToMd(node: JSONContent, ctx: Ctx): string {
  switch (node.type) {
    case 'paragraph':
      return inline(node.content, ctx)
    case 'heading':
      return `${'#'.repeat(Math.min(6, Number(node.attrs?.level) || 1))} ${inline(node.content, ctx)}`
    case 'blockquote':
      return indent(blocksToMd(node.content, ctx), '> ', '> ')
    case 'callout':
      return indent(`[!NOTE]\n${blocksToMd(node.content, ctx)}`, '> ', '> ')
    case 'codeBlock': {
      const code = (node.content ?? []).map((t) => t.text ?? '').join('')
      const fence = code.includes('```') ? '````' : '```'
      return `${fence}${(node.attrs?.language as string | null) ?? ''}\n${code}\n${fence}`
    }
    case 'horizontalRule':
      return '---'
    case 'bulletList':
      return (node.content ?? []).map((item) => listItem(item, '- ', ctx)).join('\n')
    case 'orderedList': {
      const start = Number(node.attrs?.start) || 1
      return (node.content ?? []).map((item, i) => listItem(item, `${start + i}. `, ctx)).join('\n')
    }
    case 'taskList':
      return (node.content ?? []).map((item) => listItem(item, item.attrs?.checked ? '- [x] ' : '- [ ] ', ctx)).join('\n')
    case 'table':
      return tableToMd(node, ctx)
    case 'image':
    case 'video':
    case 'audio':
    case 'fileBlock':
      return mediaToMd(node, ctx)
    case 'pageEmbed':
      return embedToMd((node.attrs?.pageId as string | null) ?? null, ctx)
    default:
      return node.content ? blocksToMd(node.content, ctx) : ''
  }
}

function blocksToMd(nodes: JSONContent[] | undefined, ctx: Ctx): string {
  return (nodes ?? [])
    .map((n) => blockToMd(n, ctx))
    .filter((s) => s.trim() !== '')
    .join('\n\n')
}

function canvasToMd(items: CanvasItem[], ctx: Ctx): string {
  const cards = items.filter((it) => it.type !== 'arrow').sort((a, b) => a.y - b.y || a.x - b.x)
  const parts: string[] = []
  for (const it of cards) {
    if (it.type === 'media' && it.assetId) {
      const meta = assetsMap.get(it.assetId)
      parts.push(mediaToMd({ type: meta?.mime.startsWith('image/') ? 'image' : 'fileBlock', attrs: { assetId: it.assetId } }, ctx))
    } else if (it.type === 'embed') {
      parts.push(embedToMd(it.pageId, ctx))
    } else if (it.content) {
      const text = blocksToMd(it.content.content, ctx)
      if (!text.trim()) continue
      parts.push(it.type === 'sticky' ? indent(`[!NOTE] 便签\n${text}`, '> ', '> ') : text)
    }
  }
  return parts.join('\n\n---\n\n')
}

// ---------------- 导出 ----------------

export async function exportMarkdown(pageId: string): Promise<{ files: number; assets: number }> {
  const snap = getPagesSnapshot()
  const root = snap.byId.get(pageId)
  if (!root) throw new Error('页面不存在')

  // 1. 读出这个页面和它嵌入的所有页面（防止循环）
  const loaded: Loaded[] = []
  const seen = new Set<string>()
  const queue = [pageId]
  while (queue.length && loaded.length < 200) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const page = snap.byId.get(id)
    if (!page) continue
    const item = await loadPage(page)
    loaded.push(item)
    queue.push(...embeddedIds(item))
  }

  // 2. 分配文件名
  const ctx: Ctx = { files: new Map(), assets: new Map(), usedAssetNames: new Set() }
  const usedFiles = new Set<string>()
  for (const item of loaded) ctx.files.set(item.page.id, uniqueName(safeName(item.page.title, '无标题'), '.md', usedFiles))

  // 3. 转换
  const entries: ZipEntry[] = []
  for (const item of loaded) {
    const body = item.doc ? blocksToMd(item.doc.content, ctx) : canvasToMd(item.canvas ?? [], ctx)
    const text = `# ${item.page.title || '无标题'}\n\n${body}\n`
    entries.push({ name: ctx.files.get(item.page.id)!, data: text })
  }

  // 4. 图片和文件
  let missing = 0
  for (const [assetId, path] of ctx.assets) {
    const blob = await getAssetBlobAnywhere(assetId).catch(() => undefined)
    if (blob) entries.push({ name: path, data: blob })
    else missing++
  }

  const rootName = ctx.files.get(pageId)!
  if (entries.length === 1) {
    downloadBlob(new Blob([entries[0].data as string], { type: 'text/markdown;charset=utf-8' }), rootName)
  } else {
    downloadBlob(await makeZip(entries), rootName.replace(/\.md$/, '.zip'))
  }
  return { files: loaded.length, assets: ctx.assets.size - missing }
}
