import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Node, mergeAttributes, type Editor, type NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { NodeSelection, Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import { ArrowUpRight, GripVertical, Link2, MoreHorizontal, Trash2 } from 'lucide-react'
import { getPage } from '../store/workspace'
import { usePage } from '../store/hooks'
import { paths } from '../lib/router'
import { cls } from '../lib/format'
import { draggedPageId } from '../lib/dnd'
import { PageIcon } from '../app/PageIcon'
import { Menu, type MenuEntry } from '../app/Menu'
import { getBindings } from '../commands/registry'
import { EmbedPlaceholder, EmbedTitle } from './EmbedParts'
import { EmbeddedDoc } from './EmbeddedDoc'
import { EmbeddedCanvas } from './EmbeddedCanvas'
import { editorPath } from './pageContext'
import { openPage, useEmbedStatus } from './status'
import { insertPageEmbed } from './actions'

/**
 * 文档里的页面嵌入块。
 * - 嵌入文档：直接在这里编辑，和整页打开是同一份内容。
 * - 嵌入画布：固定高度的窗口，点一下进入（可以拖动、缩放、编辑），Esc 或点外面退出；底边可以拖动调高度。
 * 删除嵌入块不会删除页面本身。
 */

const ENTER_EVENT = 'note-embed-enter'
const FLOATING_UI = '.menu, .bubble, .slash-menu, .palette-backdrop, .lightbox, .table-pill, .toasts'

/** 嵌入内容里的事件全部交给内层的编辑器/画布，外层文档不处理；头部交给外层（选中、拖动） */
function embedStopEvent({ event }: { event: Event }): boolean {
  const target = event.target
  const el = target instanceof Element ? target : target instanceof globalThis.Node ? target.parentElement : null
  if (!el) return false
  if (el.closest('.embed-body')) return true
  if (el.closest('input, button, textarea, a')) return true
  return false
}

function PageEmbedView({ node, editor, selected, updateAttributes, deleteNode, getPos }: NodeViewProps) {
  const { pageId, height, instance } = node.attrs as { pageId: string | null; height: number | null; instance: string | null }
  const hostPath = editorPath(editor)
  const status = useEmbedStatus(pageId, hostPath)
  const page = usePage(pageId)
  const editable = editor.isEditable
  const wrapperRef = useRef<HTMLDivElement>(null)
  const innerEditor = useRef<Editor | null>(null)
  const activateCanvas = useRef<(() => void) | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const open = useCallback(() => {
    if (pageId) openPage(pageId, hostPath)
    // hostPath 每次渲染都是新数组，按内容比较
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, hostPath.join('/')])

  // ProseMirror 给可拖动的块整个加了 draggable，会让里面没法选字、画布没法拖。只留头部可以拖（按下时 ProseMirror 会临时加上）
  useLayoutEffect(() => {
    wrapperRef.current?.parentElement?.removeAttribute('draggable')
  }, [])

  /** 进入嵌入的内容：文档把光标放到开头，画布激活 */
  const enter = useCallback(() => {
    if (innerEditor.current && !innerEditor.current.isDestroyed) innerEditor.current.commands.focus('start')
    else activateCanvas.current?.()
  }, [])

  // 选中整个嵌入块时按回车：进入
  useEffect(() => {
    const host = wrapperRef.current?.parentElement
    if (!host) return
    host.addEventListener(ENTER_EVENT, enter)
    return () => host.removeEventListener(ENTER_EVENT, enter)
  }, [enter])

  /** 把外层文档的光标移到嵌入块前面/后面 */
  const exitTo = useCallback(
    (side: 'before' | 'after') => {
      const pos = getPos()
      if (typeof pos !== 'number') return
      const { state } = editor
      const target = side === 'before' ? pos : pos + node.nodeSize
      const sel =
        Selection.findFrom(state.doc.resolve(target), side === 'before' ? -1 : 1, true) ??
        NodeSelection.create(state.doc, pos)
      editor.view.dispatch(state.tr.setSelection(sel).scrollIntoView())
      editor.view.focus()
    },
    [editor, getPos, node.nodeSize],
  )

  /** 选中整个嵌入块（之后可以按 Backspace 删除、拖动、按回车再进去） */
  const selectSelf = useCallback(() => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    editor.chain().setNodeSelection(pos).focus(undefined, { scrollIntoView: false }).run()
  }, [editor, getPos])

  const onInnerEditor = useCallback((e: Editor | null) => {
    innerEditor.current = e
  }, [])

  const convertToLink = () => {
    const pos = getPos()
    if (typeof pos !== 'number' || !pageId) return
    editor
      .chain()
      .focus()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: 'paragraph', content: [{ type: 'pageLink', attrs: { pageId } }] })
      .run()
  }

  const openShortcut = getBindings('editor.openEmbed')[0] ?? null
  const menuItems: MenuEntry[] = [
    { label: '打开页面', icon: ArrowUpRight, shortcut: openShortcut, disabled: !page, onSelect: open },
    { label: '改成页面链接', icon: Link2, disabled: !pageId, onSelect: convertToLink },
    'separator',
    { label: '移除嵌入（页面还在）', icon: Trash2, danger: true, onSelect: deleteNode },
  ]

  const live = status === 'live' && page
  const type = page?.type ?? 'doc'

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      className={cls('page-embed', `page-embed-${type}`, selected && 'is-selected', !live && 'is-placeholder')}
    >
      <div className="embed-head" data-drag-handle="">
        {editable && <GripVertical className="icon embed-grip" aria-hidden />}
        <PageIcon type={type} />
        <EmbedTitle
          page={page}
          editable={editable && !!live}
          onEnter={enter}
          onEscape={selectSelf}
        />
        <span className="embed-actions">
          <button
            className="tool-btn"
            title={openShortcut ? `打开页面` : '打开页面'}
            aria-label="打开页面"
            disabled={!page}
            onClick={open}
          >
            <ArrowUpRight className="icon" />
          </button>
          {editable && (
            <button
              className="tool-btn"
              title="更多操作"
              aria-label="更多操作"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setMenu({ x: rect.right - 200, y: rect.bottom + 4 })
              }}
            >
              <MoreHorizontal className="icon" />
            </button>
          )}
        </span>
      </div>
      <div className="embed-body">
        {!live ? (
          <EmbedPlaceholder status={status === 'live' ? 'missing' : status} page={page} onOpen={open} onRemove={editable ? deleteNode : undefined} />
        ) : page.type === 'doc' ? (
          <EmbeddedDoc
            pageId={page.id}
            path={[...hostPath, page.id]}
            editable={editable}
            onEscape={selectSelf}
            onExitEdge={exitTo}
            onEditor={onInnerEditor}
          />
        ) : (
          <DocCanvasWindow
            pageId={page.id}
            path={[...hostPath, page.id]}
            cameraKey={`${page.id}@${hostPath[hostPath.length - 1] ?? ''}/${instance ?? 'default'}`}
            height={height ?? 420}
            editable={editable}
            onResize={(h) => updateAttributes({ height: h })}
            activateRef={activateCanvas}
          />
        )}
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </NodeViewWrapper>
  )
}

/** 文档里的画布窗口：平时只是看，点一下进入后才能操作，免得滚动文档时误拖画布 */
function DocCanvasWindow({
  pageId,
  path,
  cameraKey,
  height,
  editable,
  onResize,
  activateRef,
}: {
  pageId: string
  path: string[]
  cameraKey: string
  height: number
  editable: boolean
  onResize: (height: number) => void
  activateRef: { current: (() => void) | null }
}) {
  const [active, setActive] = useState(false)
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const coverRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activateRef.current = () => setActive(true)
    return () => {
      activateRef.current = null
    }
  }, [activateRef])

  // 点到窗口外面就退出（弹出菜单、格式工具栏等浮层除外）
  useEffect(() => {
    if (!active) return
    const onDown = (e: PointerEvent) => {
      const t = e.target
      if (t instanceof globalThis.Node && ref.current?.contains(t)) return
      if (t instanceof Element && t.closest(FLOATING_UI)) return
      setActive(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [active])

  const exit = useCallback(() => {
    setActive(false)
    // 焦点放回窗口上，再按回车可以重新进入
    requestAnimationFrame(() => coverRef.current?.focus({ preventScroll: true }))
  }, [])

  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const startH = ref.current?.getBoundingClientRect().height ?? height
    let current = startH
    const move = (ev: PointerEvent) => {
      current = Math.max(180, Math.min(1600, startH + ev.clientY - startY))
      setDragHeight(current)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragHeight(null)
      if (Math.abs(current - startH) >= 1) onResize(Math.round(current))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div ref={ref} className={cls('embed-canvas', active && 'is-active')} style={{ height: dragHeight ?? height }}>
      <EmbeddedCanvas pageId={pageId} path={path} cameraKey={cameraKey} readOnly={!editable} active={active} onExit={exit} />
      {!active && (
        <button ref={coverRef} className="embed-canvas-cover" aria-label="进入画布" onClick={() => setActive(true)}>
          <span className="embed-canvas-hint">点击进入画布</span>
        </button>
      )}
      {editable && <span className="embed-resize-y" onPointerDown={startResize} title="拖动调整高度" />}
    </div>
  )
}

export const PageEmbed = Node.create({
  name: 'pageEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      pageId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-page-embed'),
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-page-embed': attrs.pageId }),
      },
      /** 嵌入画布时窗口的高度 */
      height: {
        default: null,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-height')) || null,
        renderHTML: (attrs: Record<string, unknown>) => (attrs.height ? { 'data-height': attrs.height } : {}),
      },
      /** 这个嵌入实例的 id（每个嵌入各自记住画布视角） */
      instance: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-instance'),
        renderHTML: (attrs: Record<string, unknown>) => (attrs.instance ? { 'data-instance': attrs.instance } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-page-embed]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const pageId = node.attrs.pageId as string | null
    const title = (pageId && getPage(pageId)?.title) || '无标题'
    return ['div', mergeAttributes(HTMLAttributes), ['a', { href: paths.page(pageId ?? '') }, title]]
  },

  renderText({ node }) {
    const pageId = node.attrs.pageId as string | null
    return (pageId && getPage(pageId)?.title) || '无标题'
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageEmbedView, { stopEvent: embedStopEvent })
  },

  addKeyboardShortcuts() {
    return {
      // 选中整个嵌入块时按回车：进入里面编辑
      Enter: ({ editor }) => {
        const { selection } = editor.state
        if (!(selection instanceof NodeSelection) || selection.node.type.name !== this.name) return false
        const dom = editor.view.nodeDOM(selection.from)
        if (!(dom instanceof HTMLElement)) return false
        dom.dispatchEvent(new CustomEvent(ENTER_EVENT))
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('pageEmbedDrop'),
        props: {
          // 从侧边栏把页面拖进来：嵌入
          handleDrop: (view, event, _slice, moved) => {
            const id = draggedPageId(event.dataTransfer)
            if (!id || moved || !editor.isEditable) return false
            event.preventDefault()
            const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
            let pos: number | undefined
            if (hit) {
              const $pos = view.state.doc.resolve(hit.pos)
              pos = $pos.depth >= 1 ? $pos.after(1) : hit.pos
            }
            insertPageEmbed(editor, id, pos)
            return true
          },
        },
      }),
    ]
  },
})
