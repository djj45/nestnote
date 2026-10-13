import * as Y from 'yjs'
import { getPage } from '../store/workspace'
import { assetsMap } from '../assets/assetStore'

/**
 * 从页面的 Yjs 文档里取出纯文字，供全文搜索用。
 * 文档：每个段落、标题、代码块（包括列表、表格、标注框里面的）各是一条，记下它在第几个顶层块里；
 * 画布：每张卡片、便签是一条，记下元素 id；图片、文件记文件名。
 */

export interface TextEntry {
  text: string
  /** 文档：所在的顶层块序号 */
  block?: number
  /** 画布：元素 id */
  elementId?: string
}

const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock'])

function inlineText(node: Y.XmlElement | Y.XmlText): string {
  if (node instanceof Y.XmlText) {
    return (node.toDelta() as Array<{ insert: unknown }>).map((d) => (typeof d.insert === 'string' ? d.insert : '')).join('')
  }
  switch (node.nodeName) {
    case 'pageLink': {
      const id = node.getAttribute('pageId')
      const page = typeof id === 'string' ? getPage(id) : undefined
      return page ? page.title || '无标题' : ''
    }
    case 'hardBreak':
      return ' '
    default:
      return node
        .toArray()
        .map((c) => (c instanceof Y.XmlElement || c instanceof Y.XmlText ? inlineText(c) : ''))
        .join('')
  }
}

function atomText(node: Y.XmlElement): string {
  const assetId = node.getAttribute('assetId')
  const meta = typeof assetId === 'string' ? assetsMap.get(assetId) : undefined
  const name = node.getAttribute('name') ?? node.getAttribute('alt')
  return meta?.name ?? (typeof name === 'string' ? name : '')
}

/** 收集一个节点里所有段落的文字 */
function collectBlocks(node: Y.XmlElement, out: string[]) {
  if (TEXTBLOCKS.has(node.nodeName)) {
    const text = inlineText(node).trim()
    if (text) out.push(text)
    return
  }
  if (['image', 'video', 'audio', 'fileBlock'].includes(node.nodeName)) {
    const text = atomText(node).trim()
    if (text) out.push(text)
    return
  }
  for (const child of node.toArray()) if (child instanceof Y.XmlElement) collectBlocks(child, out)
}

export function extractFragment(fragment: Y.XmlFragment): string[][] {
  return fragment.toArray().map((child) => {
    const out: string[] = []
    if (child instanceof Y.XmlElement) collectBlocks(child, out)
    else if (child instanceof Y.XmlText) {
      const text = inlineText(child).trim()
      if (text) out.push(text)
    }
    return out
  })
}

export function extractPage(type: 'doc' | 'canvas', doc: Y.Doc): TextEntry[] {
  const entries: TextEntry[] = []
  if (type === 'doc') {
    extractFragment(doc.getXmlFragment('content')).forEach((texts, block) => {
      for (const text of texts) entries.push({ text, block })
    })
    return entries
  }
  const elements = doc.getMap<Y.Map<unknown>>('elements')
  elements.forEach((m, id) => {
    if (!(m instanceof Y.Map)) return
    const content = m.get('content')
    if (content instanceof Y.XmlFragment) {
      const text = extractFragment(content)
        .flat()
        .join('\n')
        .trim()
      if (text) entries.push({ text, elementId: id })
      return
    }
    const assetId = m.get('assetId')
    const meta = typeof assetId === 'string' ? assetsMap.get(assetId) : undefined
    if (meta?.name) entries.push({ text: meta.name, elementId: id })
  })
  return entries
}

