import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { CellSelection } from '@tiptap/pm/tables'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  ChevronDown,
  Columns2,
  Rows2,
  Table2,
  TableCellsMerge,
  Trash2,
} from 'lucide-react'
import { getBindings, runCommand } from '../commands/registry'
import { Menu, type MenuEntry } from '../app/Menu'

/** 光标所在表格节点的起始位置 */
function findTablePos(editor: Editor): number | null {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') return $from.before(d)
  }
  return null
}

function tableElementAt(editor: Editor, pos: number): HTMLElement | null {
  const dom = editor.view.nodeDOM(pos)
  if (!(dom instanceof HTMLElement)) return null
  return dom.classList.contains('tableWrapper') ? dom : ((dom.closest('.tableWrapper') as HTMLElement | null) ?? dom)
}

const ITEMS: Array<{ id: string; icon: ComponentType<{ className?: string }> } | 'separator'> = [
  { id: 'addRowBefore', icon: ArrowUpToLine },
  { id: 'addRowAfter', icon: ArrowDownToLine },
  { id: 'addColumnBefore', icon: ArrowLeftToLine },
  { id: 'addColumnAfter', icon: ArrowRightToLine },
  'separator',
  { id: 'deleteRow', icon: Rows2 },
  { id: 'deleteColumn', icon: Columns2 },
  { id: 'mergeOrSplit', icon: TableCellsMerge },
  { id: 'toggleHeaderRow', icon: Table2 },
  'separator',
  { id: 'delete', icon: Trash2 },
]

const TITLES: Record<string, string> = {
  addRowBefore: '上方插入行',
  addRowAfter: '下方插入行',
  addColumnBefore: '左侧插入列',
  addColumnAfter: '右侧插入列',
  deleteRow: '删除所在行',
  deleteColumn: '删除所在列',
  toggleHeaderRow: '切换表头行',
  delete: '删除整个表格',
}

/**
 * 表格操作：光标在表格里时，表格右侧出现一个小按钮（窄屏时在表格上方右侧），
 * 点开是操作菜单；在单元格里点右键也能打开同一个菜单。
 */
export function TableToolbar({ editor }: { editor: Editor }) {
  const pillRef = useRef<HTMLButtonElement>(null)
  const [focused, setFocused] = useState(editor.isFocused)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      inTable: e.isEditable && e.isActive('table'),
      tablePos: findTablePos(e),
      canMerge: e.can().mergeCells(),
      canSplit: e.can().splitCell(),
    }),
  })

  useEffect(() => {
    const onFocus = () => setFocused(true)
    const onBlur = () => window.setTimeout(() => setFocused(editor.isFocused), 0)
    editor.on('focus', onFocus)
    editor.on('blur', onBlur)

    const dom = editor.view.dom
    const onContextMenu = (e: MouseEvent) => {
      if (!editor.isEditable) return
      const cell = (e.target as HTMLElement | null)?.closest('td, th')
      if (!cell || !dom.contains(cell)) return
      e.preventDefault()
      // 右键点在已选中的多个单元格里时保留选区（方便合并），否则把光标移到点击处
      if (!(editor.state.selection instanceof CellSelection)) {
        const hit = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
        if (hit) editor.chain().focus().setTextSelection(hit.pos).run()
      }
      setMenu({ x: e.clientX, y: e.clientY })
    }
    dom.addEventListener('contextmenu', onContextMenu)
    return () => {
      editor.off('focus', onFocus)
      editor.off('blur', onBlur)
      dom.removeEventListener('contextmenu', onContextMenu)
    }
  }, [editor])

  const visible = state.inTable && focused && state.tablePos !== null

  useLayoutEffect(() => {
    const el = pillRef.current
    const table = visible && state.tablePos !== null ? tableElementAt(editor, state.tablePos) : null
    if (!el || !table) return
    const update = () =>
      computePosition(table, el, {
        placement: 'right-start',
        strategy: 'fixed',
        middleware: [offset(8), flip({ fallbackPlacements: ['top-end', 'bottom-end'], padding: 8 }), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        el.style.left = `${x}px`
        el.style.top = `${y}px`
        el.style.visibility = 'visible'
      })
    return autoUpdate(table, el, update)
  }, [visible, state.tablePos, editor])

  const items: MenuEntry[] = ITEMS.map((item) => {
    if (item === 'separator') return 'separator'
    const id = `editor.table.${item.id}`
    const label =
      item.id === 'mergeOrSplit' ? (state.canMerge ? '合并单元格' : '拆分单元格') : (TITLES[item.id] ?? item.id)
    return {
      label,
      icon: item.icon,
      shortcut: getBindings(id)[0] ?? null,
      danger: item.id === 'delete',
      disabled: item.id === 'mergeOrSplit' && !state.canMerge && !state.canSplit,
      onSelect: () => runCommand(id, { editor }),
    }
  })

  return (
    <>
      {visible &&
        createPortal(
          <button
            ref={pillRef}
            className="table-pill"
            style={{ visibility: 'hidden' }}
            title="表格操作（也可以在单元格里点右键）"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const rect = pillRef.current!.getBoundingClientRect()
              setMenu({ x: rect.left, y: rect.bottom + 4 })
            }}
          >
            <Table2 className="icon" />
            <span>表格</span>
            <ChevronDown className="icon" />
          </button>,
          document.body,
        )}
      {menu && <Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </>
  )
}
