import { useCallback, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import { usePage } from '../store/hooks'
import { PageTitle } from './PageTitle'
import { DocEditor } from '../editor/DocEditor'
import { CanvasPage } from '../canvas/CanvasPage'
import { getCommandContext } from '../commands/registry'
import { consumeTitleFocus } from '../app/ui'
import { deleteForever, restoreFromTrash } from '../app/actions'
import { navigate, paths } from '../lib/router'
import { cls } from '../lib/format'
import { markdownToHtml } from '../editor/markdown'
import { useReadOnly } from '../app/readOnly'

export function PageView({ pageId }: { pageId: string }) {
  const page = usePage(pageId)
  const readOnlyMode = useReadOnly()
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const editorRef = useRef<Editor | null>(null)

  useEffect(() => {
    if (consumeTitleFocus(pageId)) titleRef.current?.focus()
  }, [pageId])

  const focusEditorStart = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.commands.focus('start')
    // Tiptap 的 focus 要等下一帧才生效，这里立刻聚焦，避免紧接着输入的字落到标题里
    editor.view.focus()
  }, [])
  const focusTitleEnd = useCallback(() => {
    const el = titleRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  const onEditor = useCallback((editor: Editor | null) => {
    editorRef.current = editor
  }, [])
  const pasteIntoBody = useCallback((text: string) => {
    const editor = editorRef.current
    if (!editor) return
    editor.chain().insertContentAt(0, markdownToHtml(text)).focus().run()
  }, [])

  if (!page) {
    return (
      <div className="view-scroll">
        <div className="panel-view">
          <h1>找不到这个页面</h1>
          <p className="panel-desc">它可能已被永久删除，或者链接有误。</p>
          <button className="btn" onClick={() => navigate(paths.home)}>
            回到首页
          </button>
        </div>
      </div>
    )
  }

  const trashed = page.trashedAt !== null
  /** 在回收站里，或者开了只读模式 */
  const locked = trashed || readOnlyMode
  const banner = trashed && (
    <div className="trash-banner">
      <span>这个页面在回收站里，内容只读。</span>
      <button className="btn sm" onClick={() => restoreFromTrash(page.id)}>
        恢复
      </button>
      <button className="btn sm danger" onClick={() => deleteForever(page.id)}>
        永久删除
      </button>
    </div>
  )

  if (page.type === 'canvas') {
    // 画布占满整个内容区，标题是上面一条窄栏
    return (
      <div className="canvas-page">
        {banner}
        <div className="canvas-head">
          <PageTitle
            ref={titleRef}
            page={page}
            readOnly={locked}
            onExitDown={() => getCommandContext().canvas?.focusViewport()}
          />
        </div>
        <CanvasPage pageId={page.id} readOnly={locked} />
      </div>
    )
  }

  return (
    <div className={cls('view-scroll', `page-view-${page.type}`)}>
      {banner}
      <article className={cls('page', `page-${page.type}`)}>
        <PageTitle
          ref={titleRef}
          page={page}
          readOnly={locked}
          onExitDown={focusEditorStart}
          onPasteBody={pasteIntoBody}
        />
        <DocEditor key={page.id} pageId={page.id} editable={!locked} onEditor={onEditor} onExitTop={focusTitleEnd} />
      </article>
    </div>
  )
}
