import { useCallback, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import { ArrowUpRight } from 'lucide-react'
import { usePage } from '../store/hooks'
import { PageIcon } from '../app/PageIcon'
import { wantsTitleFocus } from '../app/ui'
import { EmbedPlaceholder, EmbedTitle } from '../embed/EmbedParts'
import { EmbeddedDoc } from '../embed/EmbeddedDoc'
import { EmbeddedCanvas } from '../embed/EmbeddedCanvas'
import { openPage, useEmbedStatus } from '../embed/status'
import type { CanvasController, CanvasElement } from './controller'

/**
 * 画布上嵌入的页面：一张固定大小的卡片，上面一条标题栏。
 * 平时只是预览（点它是选中、拖动），双击或按回车进入：文档可以直接编辑，画布可以拖动缩放；Esc 退出。
 * 缩得太小时只显示标题。
 */
export function EmbedCardBody({
  controller,
  el,
  editing,
  compact,
}: {
  controller: CanvasController
  el: CanvasElement
  editing: boolean
  compact: boolean
}) {
  const pageId = el.pageId
  const page = usePage(pageId)
  const status = useEmbedStatus(pageId, controller.path)
  const innerEditor = useRef<Editor | null>(null)
  const live = status === 'live' && page
  const editable = editing && !controller.readOnly

  const open = useCallback(() => {
    if (pageId) openPage(pageId, controller.path)
  }, [pageId, controller])

  const stop = useCallback(() => controller.stopEditing(), [controller])
  const rootRef = useRef<HTMLDivElement>(null)
  // 正文加载完后自动聚焦；但新建的页面正在输标题时不抢焦点
  const focusOnEdit = useCallback(() => {
    const point = controller.takeEditPoint(el.id)
    const title = rootRef.current?.querySelector('.embed-title')
    if ((pageId && wantsTitleFocus(pageId)) || (title && title === document.activeElement)) return null
    return point ?? 'end'
  }, [controller, el.id, pageId])
  const onEditor = useCallback((e: Editor | null) => {
    innerEditor.current = e
  }, [])

  const enterBody = () => {
    const e = innerEditor.current
    if (e && !e.isDestroyed) e.commands.focus('start')
    else controller.viewport?.querySelector<HTMLElement>(`[data-el-id="${el.id}"] .canvas-viewport`)?.focus()
  }

  return (
    <div ref={rootRef} className="embed-card">
      <div className="embed-head">
        <PageIcon type={page?.type ?? 'doc'} />
        <EmbedTitle page={page} editable={editable && !!live} onEnter={enterBody} onEscape={stop} />
        <button className="tool-btn" data-interactive="" title="打开页面" aria-label="打开页面" disabled={!page} onClick={open}>
          <ArrowUpRight className="icon" />
        </button>
      </div>
      <div className="embed-body">
        {!live ? (
          <EmbedPlaceholder status={status === 'live' ? 'missing' : status} page={page} onOpen={open} />
        ) : compact && !editing ? (
          <EmbedPlaceholder status="compact" page={page} onOpen={open} />
        ) : page.type === 'doc' ? (
          <div className="embed-scroll">
            <EmbeddedDoc
              pageId={page.id}
              path={[...controller.path, page.id]}
              editable={editable}
              onEscape={stop}
              focusOnEdit={focusOnEdit}
              onEditor={onEditor}
            />
          </div>
        ) : (
          <EmbeddedCanvas
            pageId={page.id}
            path={[...controller.path, page.id]}
            cameraKey={`${page.id}@${controller.pageId}/${el.id}`}
            readOnly={controller.readOnly}
            active={editing}
            onExit={stop}
          />
        )}
      </div>
    </div>
  )
}
