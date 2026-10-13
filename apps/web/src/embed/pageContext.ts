import { Extension, type Editor } from '@tiptap/core'

/**
 * 记录编辑器属于哪个页面、处在哪条嵌入路径上（从最外层页面到这个页面）。
 * 嵌入块用它判断循环和深度，新建子页面时用它找父页面，打开页面时用它生成面包屑。
 */
export const PageContext = Extension.create<{ path: string[] }>({
  name: 'pageContext',
  addOptions() {
    return { path: [] }
  },
})

export function editorPath(editor: Editor): string[] {
  const ext = editor.extensionManager.extensions.find((e) => e.name === 'pageContext')
  return (ext?.options as { path?: string[] } | undefined)?.path ?? []
}

/** 编辑器所在的页面（画布卡片里的编辑器返回画布页面） */
export function editorPageId(editor: Editor): string | null {
  const path = editorPath(editor)
  return path.length ? path[path.length - 1] : null
}
