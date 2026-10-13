import { useEffect, useRef } from 'react'
import type * as Y from 'yjs'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { Selection } from '@tiptap/pm/state'
import { usePageDoc } from '../store/hooks'
import { clearActiveEditor, setActiveEditor, setPrimaryEditor } from '../commands/registry'
import { buildDocExtensions } from './extensions'
import { BubbleToolbar } from './BubbleToolbar'
import { TableToolbar } from './TableToolbar'
import { jumpStore, revealInEditor, takeJump } from '../search/jump'

interface Props {
  pageId: string
  editable: boolean
  onEditor?: (editor: Editor | null) => void
  /** 光标在文档最开头按 ↑ 时调用（回到标题） */
  onExitTop?: () => void
}

export function DocEditor(props: Props) {
  const doc = usePageDoc(props.pageId)
  if (!doc) return <div className="doc-loading" aria-busy="true" />
  return <DocEditorInner {...props} doc={doc} />
}

function DocEditorInner({ doc, pageId, editable, onEditor, onExitTop }: Props & { doc: Y.Doc }) {
  const exitTop = useRef(onExitTop)
  exitTop.current = onExitTop

  const editor = useEditor(
    {
      extensions: buildDocExtensions(doc, { path: [pageId] }),
      editable,
      editorProps: {
        attributes: { class: 'doc-content', spellcheck: 'false' },
        handleKeyDown: (view, event) => {
          if (event.key !== 'ArrowUp' || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false
          const { selection, doc: pmDoc } = view.state
          if (selection.empty && selection.from === Selection.atStart(pmDoc).from && exitTop.current) {
            exitTop.current()
            return true
          }
          return false
        },
      },
      onFocus: ({ editor: e }) => setActiveEditor(e),
    },
    [doc, pageId],
  )

  useEffect(() => {
    if (!editor) return
    // 当前页面的编辑器是"主编辑器"：没有别的编辑器获得焦点时，命令面板、全局拖放文件都作用在它上面
    setPrimaryEditor(editor)
    onEditor?.(editor)
    return () => {
      clearActiveEditor(editor)
      onEditor?.(null)
    }
  }, [editor, onEditor])

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable)
  }, [editor, editable])

  // 从搜索结果跳过来：定位到命中的段落（等内容排好版再滚动）
  useEffect(() => {
    if (!editor) return
    let timer = 0
    const check = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const target = takeJump(pageId, 'doc')
        if (target) revealInEditor(editor, target)
      }, 80)
    }
    check()
    const off = jumpStore.subscribe(check)
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [editor, pageId])

  return (
    <>
      <EditorContent editor={editor} className="doc-editor" />
      {/* 点文档下方的空白处，光标跳到文末 */}
      {editable && (
        <div
          className="doc-tail"
          onMouseDown={(e) => {
            if (!editor) return
            e.preventDefault()
            editor.commands.focus('end')
            editor.view.focus()
          }}
        />
      )}
      {editor && <BubbleToolbar editor={editor} />}
      {editor && <TableToolbar editor={editor} />}
    </>
  )
}

/** 只读预览（历史版本用）：不注册为当前编辑器，不显示工具栏 */
export function DocPreview({ doc, pageId }: { doc: Y.Doc; pageId: string }) {
  const editor = useEditor(
    {
      extensions: buildDocExtensions(doc, { path: [pageId] }),
      editable: false,
      editorProps: { attributes: { class: 'doc-content', spellcheck: 'false' } },
    },
    [doc, pageId],
  )
  return <EditorContent editor={editor} className="doc-editor" />
}
