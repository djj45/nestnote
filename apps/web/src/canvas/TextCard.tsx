import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type * as Y from 'yjs'
import { setActiveEditor, clearActiveEditor } from '../commands/registry'
import { BubbleToolbar } from '../editor/BubbleToolbar'
import { TableToolbar } from '../editor/TableToolbar'
import { editorEvents } from '../editor/events'
import { buildCardExtensions } from './cardExtensions'
import type { CanvasController, Point } from './controller'

/**
 * 文字卡片和便签的内容：一个小 Tiptap 编辑器。
 * 平时只读（点它是选中、拖动），双击或按回车进入编辑，Esc 退出。
 */
export function TextCardBody({
  controller,
  id,
  fragment,
  editing,
}: {
  controller: CanvasController
  id: string
  fragment: Y.XmlFragment
  editing: boolean
}) {
  const wasEditing = useRef(false)
  /** 这次编辑光标放在哪（开发模式下 effect 会跑两次，所以记在 ref 里） */
  const focusWhere = useRef<'start' | 'end' | Point | null>(null)
  const editor = useEditor(
    {
      extensions: buildCardExtensions(fragment, controller.path),
      editable: false,
      editorProps: {
        attributes: { class: 'card-content', spellcheck: 'false' },
        handleKeyDown: (_view, event) => {
          if (event.key === 'Escape' && !event.isComposing) {
            controller.stopEditing()
            return true
          }
          return false
        },
      },
      onFocus: ({ editor: e }) => setActiveEditor(e),
    },
    [fragment],
  )

  useEffect(() => {
    if (!editor) return
    return () => clearActiveEditor(editor)
  }, [editor])

  // 表格卡片里删掉整个表格后卡片空了：退出编辑，空卡片随之删掉（不然会剩一个空的文字框）
  useEffect(() => {
    if (!editor) return
    return editorEvents.on((event) => {
      if (event.type !== 'tableDeleted' || event.editor !== editor) return
      if (editor.isEmpty) {
        editor.commands.blur()
        controller.stopEditing()
      }
    })
  }, [editor, controller])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(editing)
    if (editing) {
      wasEditing.current = true
      focusWhere.current ??= controller.takeFocusStart(id) ? 'start' : (controller.takeEditPoint(id) ?? 'end')
      const where = focusWhere.current
      // 立刻把焦点给编辑器（点完马上打字也不会丢字），再按位置放好光标（双击的话放在双击处）
      if (!editor.isDestroyed) {
        editor.view.dom.focus({ preventScroll: true })
        const hit = typeof where === 'string' ? null : editor.view.posAtCoords({ left: where.x, top: where.y })
        if (hit) editor.chain().setTextSelection(hit.pos).focus(undefined, { scrollIntoView: false }).run()
        else editor.commands.focus(typeof where === 'string' ? where : 'end', { scrollIntoView: false })
      }
    } else if (wasEditing.current) {
      wasEditing.current = false
      focusWhere.current = null
      // 退出编辑时，没写任何东西的卡片、便签自动删掉
      if (editor.isEmpty) controller.removeIfEmpty(id)
    }
  }, [editing, editor, controller, id])

  return (
    <>
      <EditorContent editor={editor} className="card-editor" />
      {editing && editor && <BubbleToolbar editor={editor} />}
      {editing && editor && <TableToolbar editor={editor} />}
    </>
  )
}
