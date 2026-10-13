import type { JSONContent } from '@tiptap/core'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import { arrowEnds, type CanvasController, type CanvasElement } from '../canvas/controller'
import { assetsMap, getAssetBlobAnywhere, kindForMime } from '../assets/assetStore'
import { getPage } from '../store/workspace'
import { readPageDoc } from '../store/docPool'
import { extractPage } from '../search/extract'
import { cachedStrokePath, isPenColor } from '../canvas/ink'
import { downloadBlob } from '../lib/format'

/**
 * 把画布（或者选中的元素）画成一张 PNG。
 * 自己用 Canvas 2D 重新画一遍：卡片的底色和边框、文字（标题、列表、待办、表格按简单样式排版）、
 * 图片、箭头；嵌入的页面画成带标题的卡片，里面放开头几行文字。颜色跟着当前的浅色 / 深色主题。
 */

interface Palette {
  bg: string
  canvasBg: string
  card: string
  subtle: string
  rule: string
  ink: string
  ink2: string
  ink3: string
  accent: string
  sticky: Record<string, string>
  font: string
  mono: string
  pen: (color: string | null) => string
}

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    bg: v('--bg', '#fff'),
    canvasBg: v('--canvas-bg', '#f6f7f9'),
    card: v('--bg', '#fff'),
    subtle: v('--bg-subtle', '#f6f7fa'),
    rule: v('--rule-strong', '#cfd5df'),
    ink: v('--ink', '#1d2433'),
    ink2: v('--ink-2', '#4c5567'),
    ink3: v('--ink-3', '#8a93a3'),
    accent: v('--accent', '#2e4fd6'),
    sticky: Object.fromEntries(
      ['yellow', 'pink', 'green', 'blue', 'purple'].map((c) => [c, v(`--sticky-${c}`, '#fff1a6')]),
    ),
    pen: (color) => v(`--pen-${isPenColor(color) ? color : 'ink'}`, '#1d2433'),
    font: v('--font-ui', 'system-ui, sans-serif'),
    mono: v('--font-mono', 'monospace'),
  }
}

// ---------------- 文字排版 ----------------

interface TextBlock {
  text: string
  size: number
  weight: number
  mono?: boolean
  color: 'ink' | 'ink2'
  indent: number
  prefix?: string
  gapBefore: number
}

function inlineText(nodes: JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'text') return n.text ?? ''
      if (n.type === 'hardBreak') return '\n'
      if (n.type === 'pageLink') {
        const page = typeof n.attrs?.pageId === 'string' ? getPage(n.attrs.pageId) : undefined
        return page ? page.title || '无标题' : ''
      }
      return inlineText(n.content)
    })
    .join('')
}

function toBlocks(nodes: JSONContent[] | undefined, indent = 0, out: TextBlock[] = [], color: TextBlock['color'] = 'ink'): TextBlock[] {
  for (const node of nodes ?? []) {
    const gap = out.length ? 6 : 0
    switch (node.type) {
      case 'paragraph':
        out.push({ text: inlineText(node.content), size: 15, weight: 400, color, indent, gapBefore: gap })
        break
      case 'heading': {
        const level = Number(node.attrs?.level) || 1
        out.push({ text: inlineText(node.content), size: [22.5, 18.75, 16.5][level - 1] ?? 15, weight: 700, color, indent, gapBefore: out.length ? gap + 4 : 0 })
        break
      }
      case 'codeBlock':
        out.push({ text: inlineText(node.content), size: 13, weight: 400, mono: true, color, indent, gapBefore: gap })
        break
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        ;(node.content ?? []).forEach((item, i) => {
          const marker =
            node.type === 'bulletList'
              ? '•'
              : node.type === 'orderedList'
                ? `${(Number(node.attrs?.start) || 1) + i}.`
                : item.attrs?.checked
                  ? '☑'
                  : '☐'
          const start = out.length
          toBlocks(item.content, indent + 22, out, color)
          if (out[start]) out[start].prefix = marker
        })
        break
      case 'blockquote':
      case 'callout':
        toBlocks(node.content, indent + 12, out, 'ink2')
        break
      case 'table':
        for (const row of node.content ?? []) {
          const cells = (row.content ?? []).map((cell) => (cell.content ?? []).map((p) => inlineText(p.content)).join(' '))
          out.push({
            text: cells.join('  │  '),
            size: 14,
            weight: row.content?.[0]?.type === 'tableHeader' ? 600 : 400,
            color,
            indent,
            gapBefore: out.length ? 4 : 0,
          })
        }
        break
      case 'horizontalRule':
        out.push({ text: '────────', size: 15, weight: 400, color: 'ink2', indent, gapBefore: gap })
        break
      default:
        if (node.content) toBlocks(node.content, indent, out, color)
    }
  }
  return out
}

/** 按宽度折行（中文按字，英文尽量按词） */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    const tokens = para.match(/[A-Za-z0-9_\-.,'"!?:;()]+\s*|\s+|./gu) ?? ['']
    for (const token of tokens) {
      if (ctx.measureText(line + token).width <= width || !line) {
        if (!line && ctx.measureText(token).width > width) {
          // 一个词比整行还长：按字切
          for (const ch of token) {
            if (ctx.measureText(line + ch).width > width && line) {
              lines.push(line)
              line = ''
            }
            line += ch
          }
        } else line += token
      } else {
        lines.push(line.trimEnd())
        line = token.trimStart()
      }
    }
    lines.push(line)
  }
  return lines
}

function drawBlocks(
  ctx: CanvasRenderingContext2D,
  blocks: TextBlock[],
  x: number,
  y: number,
  width: number,
  maxY: number,
  p: Palette,
) {
  let cursor = y
  for (const b of blocks) {
    cursor += b.gapBefore
    ctx.font = `${b.weight} ${b.size}px ${b.mono ? p.mono : p.font}`
    ctx.fillStyle = b.color === 'ink' ? p.ink : p.ink2
    const lineHeight = b.size * (b.weight >= 700 ? 1.35 : 1.6)
    const left = x + b.indent
    const lines = wrap(ctx, b.text, Math.max(20, width - b.indent))
    lines.forEach((line, i) => {
      // 排版和网页上略有出入，最后一行允许超出一点点
      if (cursor + lineHeight > maxY + lineHeight * 0.45) return
      if (i === 0 && b.prefix) {
        ctx.fillStyle = p.ink3
        ctx.fillText(b.prefix, left - 18, cursor + lineHeight * 0.75)
        ctx.fillStyle = b.color === 'ink' ? p.ink : p.ink2
      }
      ctx.fillText(line, left, cursor + lineHeight * 0.75)
      cursor += lineHeight
    })
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

// ---------------- 元素 ----------------

async function drawImage(ctx: CanvasRenderingContext2D, assetId: string, x: number, y: number, w: number, h: number) {
  const blob = await getAssetBlobAnywhere(assetId).catch(() => undefined)
  if (!blob) return false
  try {
    const bitmap = await createImageBitmap(blob)
    ctx.save()
    roundRect(ctx, x, y, w, h, 6)
    ctx.clip()
    ctx.drawImage(bitmap, x, y, w, h)
    ctx.restore()
    bitmap.close()
    return true
  } catch {
    return false
  }
}

async function embedPreview(pageId: string): Promise<string[]> {
  const page = getPage(pageId)
  if (!page) return []
  try {
    const entries = await readPageDoc(pageId, (doc) => extractPage(page.type, doc))
    return entries.slice(0, 20).map((e) => e.text)
  } catch {
    return []
  }
}

async function drawElement(ctx: CanvasRenderingContext2D, c: CanvasController, el: CanvasElement, p: Palette) {
  const { x, y, w, h } = el
  if (el.type === 'text' || el.type === 'sticky') {
    const sticky = el.type === 'sticky'
    ctx.save()
    roundRect(ctx, x, y, w, h, sticky ? 4 : 10)
    ctx.fillStyle = sticky ? (p.sticky[el.color ?? 'yellow'] ?? p.sticky.yellow) : p.card
    if (sticky) {
      ctx.shadowColor = 'rgba(18, 28, 48, 0.12)'
      ctx.shadowBlur = 12
      ctx.shadowOffsetY = 4
    }
    ctx.fill()
    ctx.restore()
    if (!sticky) {
      ctx.strokeStyle = p.rule
      ctx.lineWidth = 1
      roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 10)
      ctx.stroke()
    }
    const fragment = c.fragment(el.id)
    if (fragment) {
      const json = yXmlFragmentToProsemirrorJSON(fragment) as JSONContent
      const padX = sticky ? 16 : 14
      const padY = sticky ? 14 : 10
      ctx.save()
      roundRect(ctx, x, y, w, h, 10)
      ctx.clip()
      drawBlocks(ctx, toBlocks(json.content), x + padX, y + padY, w - padX * 2, y + h - padY, p)
      ctx.restore()
    }
    return
  }

  if (el.type === 'media' && el.assetId) {
    const meta = assetsMap.get(el.assetId)
    if (meta && kindForMime(meta.mime) === 'image' && (await drawImage(ctx, el.assetId, x, y, w, h))) return
    roundRect(ctx, x, y, w, h, 8)
    ctx.fillStyle = p.card
    ctx.fill()
    ctx.strokeStyle = p.rule
    ctx.stroke()
    ctx.font = `500 13px ${p.font}`
    ctx.fillStyle = p.ink
    const icon = meta ? ({ video: '▶', audio: '♪', image: '🖼', file: '📄' } as const)[kindForMime(meta.mime)] : '📄'
    ctx.fillText(`${icon}  ${meta?.name ?? '文件'}`, x + 10, y + 21, w - 20)
    return
  }

  if (el.type === 'draw' && el.points) {
    const path = new Path2D(cachedStrokePath(el.points, { size: el.size, pressure: el.pressure }))
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(el.pw ? w / el.pw : 1, el.ph ? h / el.ph : 1)
    ctx.fillStyle = p.pen(el.color)
    ctx.fill(path)
    ctx.restore()
    return
  }

  if (el.type === 'shape') {
    const sw = el.size
    ctx.save()
    ctx.strokeStyle = p.pen(el.color)
    ctx.lineWidth = sw
    ctx.beginPath()
    if (el.shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, Math.max(0, (w - sw) / 2), Math.max(0, (h - sw) / 2), 0, 0, Math.PI * 2)
    else ctx.roundRect(x + sw / 2, y + sw / 2, Math.max(0, w - sw), Math.max(0, h - sw), Math.min(8, w / 4, h / 4))
    ctx.stroke()
    ctx.restore()
    return
  }

  if (el.type === 'embed') {
    const page = el.pageId ? getPage(el.pageId) : undefined
    roundRect(ctx, x, y, w, h, 10)
    ctx.fillStyle = p.card
    ctx.fill()
    ctx.save()
    roundRect(ctx, x, y, w, h, 10)
    ctx.clip()
    ctx.fillStyle = p.subtle
    ctx.fillRect(x, y, w, 34)
    ctx.fillStyle = p.rule
    ctx.fillRect(x, y + 34, w, 1)
    ctx.font = `600 13px ${p.font}`
    ctx.fillStyle = p.ink
    ctx.fillText(`${page?.type === 'canvas' ? '◇' : '▤'}  ${page ? page.title || '无标题' : '已删除的页面'}`, x + 10, y + 22, w - 20)
    if (page) {
      const lines = await embedPreview(page.id)
      drawBlocks(
        ctx,
        lines.map((text, i) => ({ text, size: 14, weight: 400, color: 'ink2' as const, indent: 0, gapBefore: i ? 4 : 0 })),
        x + 16,
        y + 44,
        w - 32,
        y + h - 10,
        p,
      )
    }
    ctx.restore()
    ctx.strokeStyle = p.rule
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 10)
    ctx.stroke()
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, c: CanvasController, el: CanvasElement, p: Palette) {
  const ends = arrowEnds(el, (id) => c.get(id))
  if (!ends) return
  const [a, b] = ends
  ctx.strokeStyle = p.ink2
  ctx.fillStyle = p.ink2
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  const size = 12
  ctx.beginPath()
  ctx.moveTo(b.x + Math.cos(angle) * 2, b.y + Math.sin(angle) * 2)
  ctx.lineTo(b.x - Math.cos(angle - 0.45) * size, b.y - Math.sin(angle - 0.45) * size)
  ctx.lineTo(b.x - Math.cos(angle + 0.45) * size, b.y - Math.sin(angle + 0.45) * size)
  ctx.closePath()
  ctx.fill()
}

/** 导出画布为 PNG：有选中的元素时只导出选中的部分。返回导出了几个元素 */
export async function exportCanvasImage(c: CanvasController): Promise<{ count: number; selectionOnly: boolean }> {
  const selected = c.selection.get()
  const selectionOnly = selected.size > 0
  const all = c.elements.get()
  const elements = selectionOnly
    ? all.filter(
        (el) =>
          selected.has(el.id) ||
          // 两头都选中的箭头一起带上
          (el.type === 'arrow' && el.fromId && el.toId && selected.has(el.fromId) && selected.has(el.toId)),
      )
    : all
  if (!elements.length) throw new Error('画布上还没有内容')
  const bounds = c.boundsOf(elements.map((el) => el.id))
  if (!bounds) throw new Error('画布上还没有内容')

  const pad = 48
  const width = bounds.w + pad * 2
  const height = bounds.h + pad * 2
  // 默认按 2 倍清晰度；太大时缩小，避免浏览器画不出来
  const scale = Math.max(0.25, Math.min(2, 12000 / width, 12000 / height, Math.sqrt(80_000_000 / (width * height))))
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * scale)
  canvas.height = Math.ceil(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持')
  const p = readPalette()
  ctx.scale(scale, scale)
  ctx.fillStyle = p.canvasBg
  ctx.fillRect(0, 0, width, height)
  ctx.translate(pad - bounds.x, pad - bounds.y)
  ctx.textBaseline = 'alphabetic'

  for (const el of elements) if (el.type === 'arrow') drawArrow(ctx, c, el, p)
  for (const el of elements) if (el.type !== 'arrow') await drawElement(ctx, c, el, p)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('生成图片失败')
  const title = getPage(c.pageId)?.title || '画布'
  downloadBlob(blob, `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || '画布'}${selectionOnly ? '（选中部分）' : ''}.png`)
  return { count: elements.length, selectionOnly }
}
