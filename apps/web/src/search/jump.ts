import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { createStore } from '../lib/store'
import { navigate, paths } from '../lib/router'

/**
 * 从搜索结果跳到页面里的具体位置：文档滚到对应段落并选中命中的文字，画布移到对应元素并闪一下。
 * 先记下目标再打开页面，页面里的编辑器 / 画布准备好后自己来取。
 */
export interface JumpTarget {
  pageId: string
  /** 文档：顶层块序号 */
  block?: number
  /** 画布：元素 id */
  elementId?: string
  /** 要选中的文字 */
  text?: string
}

export const jumpStore = createStore<JumpTarget | null>(null)

export function jumpTo(target: JumpTarget) {
  jumpStore.set({ ...target })
  navigate(paths.page(target.pageId))
}

/** 取走发给这个页面的跳转目标（取一次就没了） */
export function takeJump(pageId: string, kind: 'doc' | 'canvas'): JumpTarget | null {
  const j = jumpStore.get()
  if (!j || j.pageId !== pageId) return null
  if (kind === 'doc' ? j.block === undefined : !j.elementId) {
    jumpStore.set(null)
    return null
  }
  jumpStore.set(null)
  return j
}

function findText(node: PMNode, start: number, needle: string): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null
  node.descendants((child, pos) => {
    if (found) return false
    if (child.isText && child.text) {
      const i = child.text.toLowerCase().indexOf(needle)
      if (i >= 0) found = { from: start + pos + i, to: start + pos + i + needle.length }
    }
    return !found
  })
  return found
}

/** 在文档编辑器里定位到搜索命中的地方 */
export function revealInEditor(editor: Editor, target: JumpTarget) {
  if (editor.isDestroyed) return
  const doc = editor.state.doc
  const needle = target.text?.toLowerCase() ?? ''
  let range: { from: number; to: number } | null = null
  let atomPos: number | null = null
  if (target.block !== undefined && target.block < doc.childCount) {
    let offset = 0
    for (let i = 0; i < target.block; i++) offset += doc.child(i).nodeSize
    const node = doc.child(target.block)
    if (needle) range = findText(node, offset + 1, needle)
    if (!range) {
      if (node.isAtom) atomPos = offset
      else range = { from: offset + 1, to: offset + 1 }
    }
  }
  if (!range && atomPos === null && needle) range = findText(doc, 0, needle)
  if (!range && atomPos === null) return

  const chain = editor.chain()
  if (atomPos !== null)
    chain.command(({ tr }) => {
      tr.setSelection(NodeSelection.create(tr.doc, atomPos!))
      return true
    })
  else chain.setTextSelection(range!)
  chain.focus(undefined, { scrollIntoView: false }).run()

  // 滚到屏幕中间
  const pos = atomPos ?? range!.from
  const at = editor.view.domAtPos(pos)
  const el = at.node.nodeType === 3 ? at.node.parentElement : (at.node as HTMLElement)
  const block = el?.closest('.tiptap > *') ?? el
  block?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (block instanceof HTMLElement) {
    block.classList.remove('search-flash')
    void block.offsetWidth
    block.classList.add('search-flash')
    window.setTimeout(() => block.classList.remove('search-flash'), 1600)
  }
}
