import { useEffect, useRef } from 'react'
import { ArrowUpRight, FileX2, Layers, RotateCcw, Repeat2 } from 'lucide-react'
import { renamePage, trashedRootOf, type PageMeta } from '../store/workspace'
import { consumeTitleFocus, wantsTitleFocus } from '../app/ui'
import { restoreFromTrash } from '../app/actions'
import type { EmbedStatus } from './status'

/** 嵌入块头部的标题：可以直接改名（改的是被嵌入页面的标题） */
export function EmbedTitle({
  page,
  editable,
  onEnter,
  onEscape,
}: {
  page: PageMeta | undefined
  editable: boolean
  /** 回车或 ↓：进入正文 */
  onEnter?: () => void
  onEscape?: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const pageId = page?.id

  // 新建的嵌入页面：标题输入框自动获得焦点（放到下一轮，排在正文编辑器的自动聚焦之后）
  useEffect(() => {
    if (!pageId || !editable || !wantsTitleFocus(pageId)) return
    const timer = window.setTimeout(() => {
      if (!consumeTitleFocus(pageId)) return
      ref.current?.focus({ preventScroll: true })
      ref.current?.scrollIntoView({ block: 'nearest' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [pageId, editable])

  if (!page) return <span className="embed-title is-missing">已删除的页面</span>
  if (!editable) return <span className="embed-title">{page.title || '无标题'}</span>
  return (
    <input
      ref={ref}
      className="embed-title"
      value={page.title}
      placeholder="无标题"
      aria-label="页面标题"
      spellCheck={false}
      onChange={(e) => renamePage(page.id, e.target.value.replace(/[\r\n]+/g, ' '))}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault()
          onEnter?.()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onEscape?.()
        }
      }}
    />
  )
}

/** 不能实时显示时的占位：页面已删除、在回收站、循环引用、嵌套太深 */
export function EmbedPlaceholder({
  status,
  page,
  onOpen,
  onRemove,
}: {
  status: Exclude<EmbedStatus, 'live'> | 'compact'
  page: PageMeta | undefined
  onOpen: () => void
  onRemove?: () => void
}) {
  const title = page?.title || '无标题'
  switch (status) {
    case 'missing':
      return (
        <div className="embed-placeholder">
          <FileX2 className="icon" />
          <span>这个页面已被永久删除</span>
          {onRemove && (
            <button className="btn sm" data-interactive="" onClick={onRemove}>
              移除嵌入
            </button>
          )}
        </div>
      )
    case 'trashed':
      return (
        <div className="embed-placeholder">
          <FileX2 className="icon" />
          <span>“{title}”在回收站里</span>
          <button
            className="btn sm"
            data-interactive=""
            onClick={() => {
              const root = page ? trashedRootOf(page.id) : null
              if (root) restoreFromTrash(root)
            }}
          >
            <RotateCcw className="icon" />
            恢复
          </button>
        </div>
      )
    case 'cycle':
      return (
        <div className="embed-placeholder">
          <Repeat2 className="icon" />
          <span>循环嵌入：“{title}”已经在外层出现过</span>
          <button className="btn sm" data-interactive="" onClick={onOpen}>
            打开
          </button>
        </div>
      )
    case 'deep':
      return (
        <button className="embed-placeholder is-button" data-interactive="" onClick={onOpen}>
          <Layers className="icon" />
          <span>嵌套超过 3 层，点击打开“{title}”</span>
          <ArrowUpRight className="icon" />
        </button>
      )
    case 'compact':
      return (
        <div className="embed-placeholder is-compact">
          <span>{title}</span>
        </div>
      )
  }
}
