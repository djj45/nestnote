import type { Editor, Range } from '@tiptap/core'
import { nanoid } from 'nanoid'
import { createPage, type PageType } from '../store/workspace'
import { openPagePicker, requestTitleFocus, setExpanded } from '../app/ui'
import { showToast } from '../app/toast'
import { editorPageId, editorPath } from './pageContext'

/** 在页面 hostId 下新建一个子页面（侧边栏里挂在它下面） */
export function createChildPage(type: PageType, hostId: string | null, title = ''): string {
  const id = createPage({ type, parentId: hostId, title })
  if (hostId) setExpanded(hostId, true)
  return id
}

/** 在文档里插入一个页面嵌入块。pos 不传就插在光标处 */
export function insertPageEmbed(editor: Editor, pageId: string, pos?: number): boolean {
  if (editorPath(editor).includes(pageId)) {
    showToast('不能把页面嵌入到它自己里面', { tone: 'error' })
    return false
  }
  const node = { type: 'pageEmbed', attrs: { pageId, instance: nanoid(8) } }
  if (pos === undefined) return editor.chain().focus().insertContent(node).run()
  return editor.chain().insertContentAt(pos, node).focus().run()
}

/** 新建子文档/子画布并嵌在光标处，标题输入框自动获得焦点 */
export function embedNewPage(editor: Editor, type: PageType, title = '') {
  const id = createChildPage(type, editorPageId(editor), title)
  if (!title) requestTitleFocus(id)
  insertPageEmbed(editor, id)
}

/** 弹出页面选择框，选好后嵌在光标处 */
export function pickPageToEmbed(editor: Editor) {
  openPagePicker({
    title: '嵌入页面',
    exclude: editorPath(editor),
    onPick: (id) => insertPageEmbed(editor, id),
    onCreate: (type, title) => embedNewPage(editor, type, title),
  })
}

/** 用页面链接替换 range 里的文字（[[ 菜单选中后调用） */
export function insertPageLink(editor: Editor, range: Range, pageId: string) {
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      { type: 'pageLink', attrs: { pageId } },
      { type: 'text', text: ' ' },
    ])
    .run()
}
