import { Extension, type Editor, type JSONContent } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { addAsset, kindForMime, type AssetMeta } from '../assets/assetStore'
import { showToast } from '../app/toast'
import { formatBytes } from '../lib/format'

const MAX_SIZE = 1024 ** 3

function nodeForAsset(meta: AssetMeta): JSONContent {
  switch (kindForMime(meta.mime)) {
    case 'image':
      return { type: 'image', attrs: { assetId: meta.id } }
    case 'video':
      return { type: 'video', attrs: { assetId: meta.id } }
    case 'audio':
      return { type: 'audio', attrs: { assetId: meta.id } }
    default:
      return { type: 'fileBlock', attrs: { assetId: meta.id, name: meta.name } }
  }
}

/** 把文件存进资源库，并作为块插入文档。pos 不传就插在光标处。 */
export async function insertFiles(editor: Editor, files: File[], pos?: number) {
  if (!files.length) return
  const total = files.reduce((n, f) => n + f.size, 0)
  if (total > 20 * 1024 * 1024) showToast(`正在保存 ${files.length} 个文件（${formatBytes(total)}）…`)
  const nodes: JSONContent[] = []
  for (const file of files) {
    if (file.size > MAX_SIZE) {
      showToast(`“${file.name}”超过 1 GB，暂时不支持`, { tone: 'error' })
      continue
    }
    try {
      nodes.push(nodeForAsset(await addAsset(file)))
    } catch (err) {
      showToast(`保存“${file.name}”失败：${err instanceof Error ? err.message : String(err)}`, { tone: 'error' })
    }
  }
  if (!nodes.length || editor.isDestroyed) return
  if (pos === undefined) editor.chain().focus().insertContent(nodes).run()
  else editor.chain().insertContentAt(pos, nodes).focus().run()
}

/** 文档末尾的位置（全局拖放、不在编辑器里放下文件时用） */
export function endOfDoc(editor: Editor): number {
  return editor.state.doc.content.size
}

/** 粘贴截图/文件、把文件拖进文档时，存进资源库并插入对应的块 */
export const FileDropPaste = Extension.create({
  name: 'fileDropPaste',
  priority: 200,

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('fileDropPaste'),
        props: {
          handlePaste: (_view, event) => {
            const data = event.clipboardData
            const files = [...(data?.files ?? [])]
            if (!files.length || !editor.isEditable) return false
            // 从 Word、网页复制时剪贴板里也会带一张图片，这时按富文本粘贴
            if (data?.getData('text/html')) return false
            void insertFiles(editor, files)
            return true
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved || !editor.isEditable) return false
            const files = [...(event.dataTransfer?.files ?? [])]
            if (!files.length) return false
            event.preventDefault()
            const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
            let pos: number | undefined
            if (hit) {
              // 放在落点所在的顶层块后面，不把段落从中间劈开
              const $pos = view.state.doc.resolve(hit.pos)
              pos = $pos.depth >= 1 ? $pos.after(1) : hit.pos
            }
            void insertFiles(editor, files, pos)
            return true
          },
        },
      }),
    ]
  },
})
