import { Node, mergeAttributes, type Editor, type NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { PluginKey } from '@tiptap/pm/state'
import { Suggestion } from '@tiptap/suggestion'
import { FilePlus2, FileText, Shapes } from 'lucide-react'
import { getAncestors, getPage, getPagesSnapshot } from '../store/workspace'
import { usePages } from '../store/hooks'
import { paths } from '../lib/router'
import { cls } from '../lib/format'
import { PageIcon } from '../app/PageIcon'
import { menuRender } from '../editor/slash'
import type { SlashItem } from '../editor/slashItems'
import { createChildPage, insertPageLink } from './actions'
import { editorPageId, editorPath } from './pageContext'
import { openPage } from './status'

/**
 * 页面链接：行内的小标签，显示页面当前的标题（改名后自动更新），点击打开。
 * 输入 [[（中文输入法下是【【）弹出页面列表。
 */

const titleOf = (pageId: string | null) => {
  const page = pageId ? getPage(pageId) : undefined
  return page ? page.title || '无标题' : '已删除的页面'
}

function PageLinkView({ node, editor }: NodeViewProps) {
  const pageId = node.attrs.pageId as string | null
  const snap = usePages()
  const page = pageId ? snap.byId.get(pageId) : undefined
  const trashed = !!page && !snap.visible.has(page.id)
  const label = page ? page.title || '无标题' : '已删除的页面'
  return (
    <NodeViewWrapper
      as="span"
      className={cls('page-link', !page && 'is-missing', trashed && 'is-trashed')}
      title={!page ? '这个页面已被永久删除' : trashed ? `${label}（在回收站里）` : `打开“${label}”`}
      onClick={(e: MouseEvent) => {
        e.preventDefault()
        if (page) openPage(page.id, editorPath(editor))
      }}
    >
      <PageIcon type={page?.type ?? 'doc'} />
      <span className="page-link-title">{label}</span>
    </NodeViewWrapper>
  )
}

function matchScore(title: string, query: string): number {
  if (!query) return 0
  if (title === query) return 3
  if (title.startsWith(query)) return 2
  if (title.includes(query)) return 1
  return -1
}

function pageItems(editor: Editor, rawQuery: string): SlashItem[] {
  const query = rawQuery.trim().toLowerCase()
  if (rawQuery.includes(']') || rawQuery.includes('】') || rawQuery.length > 60) return []
  const snap = getPagesSnapshot()
  const host = editorPageId(editor)
  const scored = [...snap.visible]
    .map((id) => snap.byId.get(id)!)
    .filter(Boolean)
    .map((page) => ({ page, score: matchScore((page.title || '无标题').toLowerCase(), query) }))
    .filter((x) => x.score >= 0)
  scored.sort((a, b) => b.score - a.score || b.page.updatedAt - a.page.updatedAt)

  const items: SlashItem[] = scored.slice(0, 8).map(({ page }) => {
    const path = getAncestors(page.id)
      .map((p) => p.title || '无标题')
      .join(' / ')
    return {
      id: `page:${page.id}`,
      title: page.title || '无标题',
      description: path || (page.type === 'canvas' ? '画布' : '文档'),
      keywords: [],
      icon: page.type === 'canvas' ? Shapes : FileText,
      run: (e, range) => insertPageLink(e, range, page.id),
    }
  })

  const title = rawQuery.trim()
  if (title) {
    items.push(
      {
        id: 'new:doc',
        title: `新建文档“${title}”`,
        description: '作为当前页面的子页面',
        keywords: [],
        icon: FilePlus2,
        run: (e, range) => insertPageLink(e, range, createChildPage('doc', host, title)),
      },
      {
        id: 'new:canvas',
        title: `新建画布“${title}”`,
        description: '作为当前页面的子页面',
        keywords: [],
        icon: Shapes,
        run: (e, range) => insertPageLink(e, range, createChildPage('canvas', host, title)),
      },
    )
  }
  return items
}

function createPageSuggestion(editor: Editor, char: string, key: string) {
  return Suggestion<SlashItem, SlashItem>({
    editor,
    char,
    pluginKey: new PluginKey(key),
    startOfLine: false,
    allowedPrefixes: null,
    allowSpaces: true,
    allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== 'codeBlock',
    items: ({ query, editor: e }) => pageItems(e, query),
    command: ({ editor: e, range, props }) => props.run(e, range),
    render: menuRender(),
  })
}

export const PageLink = Node.create({
  name: 'pageLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      pageId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-page-link'),
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-page-link': attrs.pageId }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'a[data-page-link]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const pageId = node.attrs.pageId as string | null
    return ['a', mergeAttributes(HTMLAttributes, { href: paths.page(pageId ?? ''), class: 'page-link' }), titleOf(pageId)]
  },

  renderText({ node }) {
    return titleOf(node.attrs.pageId as string | null)
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageLinkView)
  },

  addProseMirrorPlugins() {
    return [
      createPageSuggestion(this.editor, '[[', 'pageLinkMenu'),
      createPageSuggestion(this.editor, '【【', 'pageLinkMenuCn'),
    ]
  },
})
