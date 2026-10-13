import type { Editor } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'

const LIST_ITEMS = new Set(['listItem', 'taskItem'])

/**
 * 把光标所在的块（在列表里就是列表项）和上一个/下一个兄弟块交换位置。
 */
export function moveBlock(editor: Editor, direction: -1 | 1): boolean {
  const { state, view } = editor
  const { selection } = state
  const { $from } = selection

  let depth = Math.min(1, $from.depth)
  for (let d = $from.depth; d > 0; d--) {
    if (LIST_ITEMS.has($from.node(d).type.name)) {
      depth = d
      break
    }
  }
  if (depth < 1) return false

  const parent = $from.node(depth - 1)
  const index = $from.index(depth - 1)
  const siblingIndex = index + direction
  if (siblingIndex < 0 || siblingIndex >= parent.childCount) return true

  const node = parent.child(index)
  const sibling = parent.child(siblingIndex)
  const start = $from.before(depth)
  const end = start + node.nodeSize
  const offsetFrom = selection.from - start
  const offsetTo = selection.to - start

  const tr = state.tr
  let newStart: number
  if (direction < 0) {
    const siblingStart = start - sibling.nodeSize
    tr.replaceWith(siblingStart, end, Fragment.from([node, sibling]))
    newStart = siblingStart
  } else {
    const siblingEnd = end + sibling.nodeSize
    tr.replaceWith(start, siblingEnd, Fragment.from([sibling, node]))
    newStart = start + sibling.nodeSize
  }
  try {
    tr.setSelection(TextSelection.create(tr.doc, newStart + offsetFrom, newStart + offsetTo))
  } catch {
    /* 选区不是文本选区时保持默认映射 */
  }
  view.dispatch(tr.scrollIntoView())
  return true
}
