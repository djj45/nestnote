import type { Editor } from '@tiptap/core'
import { createEmitter } from '../lib/store'

/** 编辑器内部的事件，例如快捷键请求打开链接输入框 */
export type EditorEvent =
  | { type: 'link'; editor: Editor }
  /** 用菜单删掉了整个表格（画布上的表格卡片删空了就整张卡片一起删） */
  | { type: 'tableDeleted'; editor: Editor }

export const editorEvents = createEmitter<EditorEvent>()
