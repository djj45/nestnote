import { useEffect, useRef } from 'react'
import type * as Y from 'yjs'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { Selection } from '@tiptap/pm/state'
import { usePageDoc } from '../store/hooks'
import { clearActiveEditor, setActiveEditor } from '../commands/registry'
import { buildDocExtensions } from '../editor/extensions'
import { BubbleToolbar } from '../editor/BubbleToolbar'
import { TableToolbar } from '../editor/TableToolbar'
import { isSlashMenuOpen } from '../editor/slash'
import type { Point } from '../canvas/controller'

export interface EmbeddedDocProps {
  pageId: string
  /** 从最外层页面到这个页面的路径（包括它自己） */
  path: string[]
  editable: boolean
  /** 在正文里按 Esc */
  onEscape?: () => void
  /** 光标在最开头按 ↑ / 最末尾按 ↓：离开这个嵌入 */
  onExitEdge?: (side: 'before' | 'after') => void
  /** 变成可编辑时把光标放在哪（屏幕坐标、开头或结尾）；返回 null 不自动聚焦 */
  focusOnEdit?: () => Point | 'start' | 'end' | null
  onEditor?: (editor: Editor | null) => void
}

/** 嵌在别处的文档：和整页打开时用同一份数据，改动实时同步 */
export function EmbeddedDoc(props: EmbeddedDocProps) {
  const doc = usePageDoc(props.pageId)
  if (!doc) return <div className="embed-loading" aria-busy="true" />
  return <EmbeddedDocInner {...props} doc={doc} />
}

function EmbeddedDocInner({ doc, path, editable, onEscape, onExitEdge, focusOnEdit, onEditor }: EmbeddedDocProps & { doc: Y.Doc }) {
  const handlers = useRef({ onEscape, onExitEdge, focusOnEdit })
  handlers.current = { onEscape, onExitEdge, focusOnEdit }
  const pathKey = path.join('/')

  const editor = useEditor(
    {
      extensions: buildDocExtensions(doc, { path: pathKey.split('/') }),
      editable,
      editorProps: {
        attributes: { class: 'doc-content', spellcheck: 'false' },
        handleKeyDown: (view, event) => {
          if (event.isComposing) return false
          const { onEscape: esc, onExitEdge: exit } = handlers.current
          if (event.key === 'Escape' && esc && !isSlashMenuOpen()) {
            esc()
            return true
          }
          if (!exit || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false
          const { selection, doc: pmDoc } = view.state
          if (!selection.empty) return false
          const $head = selection.$head
          if (event.key === 'ArrowUp' && view.endOfTextblock('up')) {
            const before = $head.depth ? Selection.findFrom(pmDoc.resolve($head.before()), -1, true) : null
            if (!before) {
              exit('before')
              return true
            }
          }
          if (event.key === 'ArrowDown' && view.endOfTextblock('down')) {
            const after = $head.depth ? Selection.findFrom(pmDoc.resolve($head.after()), 1, true) : null
            if (!after) {
              exit('after')
              return true
            }
          }
          return false
        },
      },
      onFocus: ({ editor: e }) => setActiveEditor(e),
    },
    [doc, pathKey],
  )

  useEffect(() => {
    if (!editor) return
    onEditor?.(editor)
    return () => {
      clearActiveEditor(editor)
      onEditor?.(null)
    }
  }, [editor, onEditor])

  // 变成可编辑时（画布里双击进入）把光标放好
  const focusDone = useRef(false)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (editor.isEditable !== editable) editor.setEditable(editable)
    if (!editable) {
      focusDone.current = false
      return
    }
    if (focusDone.current) return
    const where = handlers.current.focusOnEdit?.()
    if (!where) return
    focusDone.current = true
    editor.view.dom.focus({ preventScroll: true })
    if (typeof where === 'string') {
      editor.commands.focus(where, { scrollIntoView: false })
      return
    }
    const hit = editor.view.posAtCoords({ left: where.x, top: where.y })
    if (hit) editor.chain().setTextSelection(hit.pos).focus(undefined, { scrollIntoView: false }).run()
    else editor.commands.focus('end', { scrollIntoView: false })
  }, [editor, editable])

  return (
    <>
      <EditorContent editor={editor} className="doc-editor embed-doc" />
      {editable && editor && <BubbleToolbar editor={editor} />}
      {editable && editor && <TableToolbar editor={editor} />}
    </>
  )
}
