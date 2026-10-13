import { useEffect, useRef, useState, type ComponentType, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import {
  ChevronRight,
  FilePlus2,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Settings,
  Shapes,
  TextSearch,
  Trash2,
} from 'lucide-react'
import { usePages } from '../store/hooks'
import { canMove, getAncestors, movePage, renamePage, type DropPosition, type PageMeta } from '../store/workspace'
import { navigate, paths, useRoute } from '../lib/router'
import { useStore } from '../lib/store'
import { cls } from '../lib/format'
import { expanded, setExpanded, setSidebarOpen } from './ui'
import { createAndOpen, moveToTrash } from './actions'
import { CommandKbd, useShortcut, useTitleWithShortcut } from './Kbd'
import { PageIcon } from './PageIcon'
import { Menu, type MenuEntry } from './Menu'
import { runCommand } from '../commands/registry'
import { PAGE_DRAG_TYPE } from '../lib/dnd'
import { useReadOnly } from './readOnly'
import { resetSidebarWidth, setSidebarWidth } from './prefs'
import { createPortal } from 'react-dom'
import { isTouchDevice } from '../lib/platform'
import { installTreeTouchGuard, isTouchPressing, shouldSuppressClick, startTreePress, touchDrag } from './treeTouchDrag'

/** 正在拖动的页面（dragover 事件里拿不到 dataTransfer 的数据，只能放这里） */
let draggingId: string | null = null

export function Sidebar() {
  const snap = usePages()
  const route = useRoute()
  const activeId = route.name === 'page' ? route.id : null
  const roots = snap.children.get(null) ?? []
  const [rootDrop, setRootDrop] = useState(false)
  const treeRef = useRef<HTMLDivElement>(null)
  const drag = useStore(touchDrag)
  const toggleTitle = useTitleWithShortcut('收起侧边栏', 'app.toggleSidebar')
  const readOnly = useReadOnly()

  useEffect(() => (treeRef.current ? installTreeTouchGuard(treeRef.current) : undefined), [])

  // 打开某个页面时，自动展开它的所有上级
  useEffect(() => {
    if (activeId) for (const p of getAncestors(activeId)) setExpanded(p.id, true)
  }, [activeId])

  const onRootDragOver = (e: DragEvent) => {
    if (!draggingId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setRootDrop(true)
  }
  const onRootDrop = (e: DragEvent) => {
    e.preventDefault()
    setRootDrop(false)
    if (draggingId) movePage(draggingId, null, 'after')
  }

  return (
    <aside className="sidebar" aria-label="侧边栏">
      <div className="sidebar-head">
        <button className="brand" onClick={() => navigate(paths.home)}>
          笔记
        </button>
        <button className="icon-btn" title={toggleTitle} aria-label="收起侧边栏" onClick={() => setSidebarOpen(false)}>
          <PanelLeftClose className="icon" />
        </button>
      </div>

      <div className="sidebar-actions">
        <SidebarButton icon={Search} label="跳转到页面" commandId="app.quickOpen" />
        <SidebarButton icon={TextSearch} label="全文搜索" commandId="app.search" />
        {!readOnly && <SidebarButton icon={FilePlus2} label="新建文档" commandId="page.newDoc" />}
        {!readOnly && <SidebarButton icon={Shapes} label="新建画布" commandId="page.newCanvas" />}
      </div>

      <div className="sidebar-label">页面</div>
      <div
        ref={treeRef}
        className={cls('tree', drag && 'is-touch-dragging')}
        role="tree"
        aria-label="页面"
        onPointerDown={(e) => {
          // 手机、平板：按住页面拖动排序
          if (!readOnly && treeRef.current) startTreePress(e.nativeEvent, treeRef.current)
        }}
      >
        {roots.map((page) => (
          <TreeItem key={page.id} page={page} depth={0} activeId={activeId} />
        ))}
        {roots.length === 0 && <p className="tree-empty">还没有页面，用上面的按钮新建一个。</p>}
        <div
          className={cls('tree-tail', (rootDrop || drag?.root) && 'is-drop')}
          onDragOver={onRootDragOver}
          onDragLeave={() => setRootDrop(false)}
          onDrop={onRootDrop}
        />
      </div>

      <div className="sidebar-foot">
        <button
          className={cls('sidebar-btn', route.name === 'trash' && 'is-active')}
          onClick={() => navigate(paths.trash)}
        >
          <Trash2 className="icon" />
          <span>回收站</span>
          {snap.trashed.length > 0 && <span className="badge">{snap.trashed.length}</span>}
        </button>
        <button
          className={cls('sidebar-btn', route.name === 'settings' && 'is-active')}
          onClick={() => navigate(paths.settings())}
        >
          <Settings className="icon" />
          <span>设置</span>
          <CommandKbd commandId="app.settings" />
        </button>
      </div>
      <SidebarResizer />
      {drag &&
        createPortal(
          <div className="tree-drag-ghost" style={{ left: drag.x, top: drag.y }}>
            {drag.title}
          </div>,
          document.body,
        )}
    </aside>
  )
}

/** 侧边栏右边缘：拖动调宽度，双击恢复默认（窄屏上不显示） */
function SidebarResizer() {
  const [dragging, setDragging] = useState(false)
  return (
    <div
      className={cls('sidebar-resizer', dragging && 'is-dragging')}
      role="separator"
      aria-orientation="vertical"
      aria-label="拖动调整侧边栏宽度"
      title="拖动调整宽度，双击恢复默认"
      onDoubleClick={resetSidebarWidth}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        const el = e.currentTarget
        try {
          el.setPointerCapture(e.pointerId)
        } catch {
          /* 捕获失败也能拖，只是拖出窗口时可能中断 */
        }
        const left = el.parentElement!.getBoundingClientRect().left
        setDragging(true)
        const move = (ev: PointerEvent) => setSidebarWidth(ev.clientX - left, false)
        const up = (ev: PointerEvent) => {
          setSidebarWidth(ev.clientX - left, true)
          setDragging(false)
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
          el.removeEventListener('pointercancel', up)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
        el.addEventListener('pointercancel', up)
      }}
    />
  )
}

function SidebarButton({
  icon: Icon,
  label,
  commandId,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  commandId: string
}) {
  return (
    <button className="sidebar-btn" onClick={() => runCommand(commandId)}>
      <Icon className="icon" />
      <span>{label}</span>
      <CommandKbd commandId={commandId} />
    </button>
  )
}

function TreeItem({ page, depth, activeId }: { page: PageMeta; depth: number; activeId: string | null }) {
  const snap = usePages()
  const open = useStore(expanded).has(page.id)
  const kids = snap.children.get(page.id) ?? []
  const [renaming, setRenaming] = useState(false)
  const [drop, setDrop] = useState<DropPosition | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; kind: 'more' | 'add' } | null>(null)
  const newDocKey = useShortcut('page.newChildDoc')
  const touch = useStore(touchDrag)
  const touchDropHere = touch && touch.targetId === page.id ? touch.position : null
  const readOnly = useReadOnly()
  const active = page.id === activeId

  const menuItems: MenuEntry[] =
    menu?.kind === 'add'
      ? [
          { label: '新建子文档', icon: FilePlus2, shortcut: newDocKey, onSelect: () => createAndOpen('doc', page.id) },
          { label: '新建子画布', icon: Shapes, onSelect: () => createAndOpen('canvas', page.id) },
        ]
      : [
          { label: '重命名', icon: Pencil, onSelect: () => setRenaming(true) },
          { label: '新建子文档', icon: FilePlus2, onSelect: () => createAndOpen('doc', page.id) },
          { label: '新建子画布', icon: Shapes, onSelect: () => createAndOpen('canvas', page.id) },
          'separator',
          { label: '移到回收站', icon: Trash2, danger: true, onSelect: () => moveToTrash(page.id) },
        ]

  const openMenuAt = (e: ReactMouseEvent, kind: 'more' | 'add') => {
    e.stopPropagation()
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({ x: kind === 'more' && e.type === 'contextmenu' ? e.clientX : rect.left, y: e.type === 'contextmenu' ? e.clientY : rect.bottom + 4, kind })
  }

  const onDragStart = (e: DragEvent) => {
    draggingId = page.id
    // 侧边栏里是移动；拖进文档、画布里是嵌入（copy）
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData(PAGE_DRAG_TYPE, page.id)
    e.dataTransfer.setData('text/plain', page.title || '无标题')
  }

  const onDragOver = (e: DragEvent) => {
    if (!draggingId || draggingId === page.id) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const ratio = (e.clientY - rect.top) / rect.height
    const position: DropPosition = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside'
    if (!canMove(draggingId, page.id, position)) {
      setDrop(null)
      return
    }
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDrop(position)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const position = drop
    setDrop(null)
    if (!draggingId || !position) return
    if (movePage(draggingId, page.id, position) && position === 'inside') setExpanded(page.id, true)
  }

  return (
    <>
      <div
        data-page-id={page.id}
        className={cls(
          'tree-row',
          active && 'is-active',
          (drop ?? touchDropHere) && `drop-${drop ?? touchDropHere}`,
          touch?.dragId === page.id && 'is-dragging',
        )}
        style={{ paddingLeft: 6 + depth * 16 }}
        role="treeitem"
        aria-selected={active}
        aria-expanded={kids.length ? open : undefined}
        draggable={!renaming && !readOnly && !isTouchDevice()}
        onClick={() => {
          if (shouldSuppressClick()) return
          navigate(paths.page(page.id))
        }}
        onDoubleClick={() => !readOnly && setRenaming(true)}
        onContextMenu={(e) => {
          // 触屏长按是拖动，不弹菜单（菜单用右边的"…"按钮）
          if (readOnly || isTouchPressing()) e.preventDefault()
          else openMenuAt(e, 'more')
        }}
        onDragStart={onDragStart}
        onDragEnd={() => {
          draggingId = null
        }}
        onDragOver={onDragOver}
        onDragLeave={() => setDrop(null)}
        onDrop={onDrop}
      >
        <button
          className={cls('tree-twisty', kids.length === 0 && 'is-leaf')}
          aria-label={open ? '折叠' : '展开'}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation()
            setExpanded(page.id, !open)
          }}
        >
          <ChevronRight className={cls('icon', open && 'is-open')} />
        </button>
        <PageIcon type={page.type} />
        {renaming ? (
          <RenameInput page={page} onDone={() => setRenaming(false)} />
        ) : (
          <span className={cls('tree-title', !page.title && 'is-untitled')}>{page.title || '无标题'}</span>
        )}
        {!renaming && !readOnly && (
          <span className="tree-actions">
            <button className="icon-btn sm" title="新建子页面" aria-label="新建子页面" onClick={(e) => openMenuAt(e, 'add')}>
              <Plus className="icon" />
            </button>
            <button className="icon-btn sm" title="更多操作" aria-label="更多操作" onClick={(e) => openMenuAt(e, 'more')}>
              <MoreHorizontal className="icon" />
            </button>
          </span>
        )}
      </div>
      {open && kids.map((kid) => <TreeItem key={kid.id} page={kid} depth={depth + 1} activeId={activeId} />)}
      {menu && <Menu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </>
  )
}

function RenameInput({ page, onDone }: { page: PageMeta; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(page.title)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const commit = () => {
    renamePage(page.id, value.trim())
    onDone()
  }
  return (
    <input
      ref={ref}
      className="tree-rename"
      value={value}
      placeholder="无标题"
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') onDone()
      }}
    />
  )
}
