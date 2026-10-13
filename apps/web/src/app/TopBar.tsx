import { useState } from 'react'
import {
  ChevronRight,
  CornerDownRight,
  FileDown,
  FilePlus2,
  History,
  ImageDown,
  MoreHorizontal,
  PanelLeftOpen,
  Printer,
  Shapes,
  Trash2,
} from 'lucide-react'
import { exportPageImage, exportPageMarkdown, printPage } from '../export/actions'
import { useRoute, navigate, paths } from '../lib/router'
import { useStore } from '../lib/store'
import { usePage, usePages } from '../store/hooks'
import { getAncestors } from '../store/workspace'
import { setSidebarOpen, ui } from './ui'
import { useTitleWithShortcut } from './Kbd'
import { PageIcon } from './PageIcon'
import { Menu, type MenuEntry } from './Menu'
import { createAndOpen, moveToTrash, pageTypeLabel } from './actions'
import { cls, formatTime } from '../lib/format'
import { SyncIndicator } from './SyncIndicator'
import { openHistory } from './HistoryDialog'
import { session } from '../sync/session'
import { useReadOnly } from './readOnly'

export function TopBar() {
  const route = useRoute()
  const { sidebarOpen } = useStore(ui)
  const openTitle = useTitleWithShortcut('展开侧边栏', 'app.toggleSidebar')

  return (
    <header className="topbar">
      {!sidebarOpen && (
        <button className="icon-btn" title={openTitle} aria-label="展开侧边栏" onClick={() => setSidebarOpen(true)}>
          <PanelLeftOpen className="icon" />
        </button>
      )}
      {route.name === 'page' ? (
        <PageCrumbs pageId={route.id} trail={route.trail} />
      ) : (
        <div className="crumbs">
          <span className="crumb is-current">
            {route.name === 'trash' ? '回收站' : route.name === 'settings' ? '设置' : '首页'}
          </span>
        </div>
      )}
      {route.name !== 'page' && <SyncIndicator />}
    </header>
  )
}

function PageCrumbs({ pageId, trail }: { pageId: string; trail: string[] | null }) {
  const snap = usePages()
  const page = usePage(pageId)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const syncing = useStore(session).status === 'ready'
  const readOnly = useReadOnly()
  if (!page)
    return (
      <>
        <div className="crumbs" />
        <SyncIndicator />
      </>
    )
  // 从嵌入处打开的：面包屑显示来时经过的页面；否则显示目录层级
  const validTrail =
    trail && trail.every((id) => snap.byId.has(id)) && !trail.includes(pageId) ? trail : null
  const ancestors = validTrail ? validTrail.map((id) => snap.byId.get(id)!) : getAncestors(pageId)
  const openCrumb = (index: number) => {
    const target = ancestors[index]
    if (validTrail && index > 0) navigate(paths.page(target.id), { state: { trail: validTrail.slice(0, index) } })
    else navigate(paths.page(target.id))
  }

  const historyItem: MenuEntry[] = syncing ? [{ label: '历史版本', icon: History, onSelect: () => openHistory(pageId) }] : []
  const exportItems: MenuEntry[] = [
    { label: '导出为 Markdown', icon: FileDown, onSelect: () => void exportPageMarkdown(pageId) },
    page.type === 'canvas'
      ? { label: '导出为图片（PNG）', icon: ImageDown, onSelect: () => void exportPageImage(pageId) }
      : { label: '打印 / 存为 PDF', icon: Printer, onSelect: () => printPage(pageId) },
  ]
  const items: MenuEntry[] = readOnly
    ? [...historyItem, ...exportItems]
    : [
        { label: '新建子文档', icon: FilePlus2, onSelect: () => createAndOpen('doc', pageId) },
        { label: '新建子画布', icon: Shapes, onSelect: () => createAndOpen('canvas', pageId) },
        ...historyItem,
        'separator',
        ...exportItems,
        'separator',
        { label: '移到回收站', icon: Trash2, danger: true, disabled: !!page.trashedAt, onSelect: () => moveToTrash(pageId) },
      ]

  return (
    <>
      <nav
        className={cls('crumbs', validTrail && 'is-embed-trail')}
        aria-label={validTrail ? '页面路径（从嵌入处打开）' : '页面路径'}
      >
        {ancestors.map((a, i) => (
          <span key={a.id} className="crumb-wrap">
            <button className="crumb" onClick={() => openCrumb(i)}>
              <PageIcon type={a.type} />
              <span>{a.title || '无标题'}</span>
            </button>
            {validTrail ? (
              <CornerDownRight className="icon crumb-sep" aria-label="嵌入" />
            ) : (
              <ChevronRight className="icon crumb-sep" aria-hidden />
            )}
          </span>
        ))}
        <span className="crumb is-current">
          <PageIcon type={page.type} />
          <span>{page.title || '无标题'}</span>
        </span>
      </nav>
      <SyncIndicator />
      <span className="topbar-meta" title={`${pageTypeLabel(page.type)}，创建于 ${formatTime(page.createdAt)}`}>
        {page.updatedAt ? `编辑于 ${formatTime(page.updatedAt)}` : ''}
      </span>
      {items.length > 0 && (
        <button
          className="icon-btn"
          title="页面操作"
          aria-label="页面操作"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            setMenu({ x: rect.right - 180, y: rect.bottom + 4 })
          }}
        >
          <MoreHorizontal className="icon" />
        </button>
      )}
      {menu && <Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </>
  )
}
