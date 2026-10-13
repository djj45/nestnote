import { useEffect, useRef } from 'react'
import { useRoute } from '../lib/router'
import { useStore } from '../lib/store'
import { cls } from '../lib/format'
import { isNarrowScreen, ui, setSidebarOpen } from './ui'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { HomeView } from './HomeView'
import { TrashView } from './TrashView'
import { SettingsView } from './SettingsView'
import { CommandPalette } from './CommandPalette'
import { Toasts } from './toast'
import { PageView } from '../pages/PageView'
import { SlashMenu } from '../editor/SlashMenu'
import { Lightbox } from './Lightbox'
import { HistoryDialog } from './HistoryDialog'
import { ChordHint } from './ChordHint'
import { SearchDialog } from '../search/SearchDialog'

export function Layout() {
  const route = useRoute()
  const { sidebarOpen } = useStore(ui)

  // 手机上点了侧边栏里的页面后，自动收起侧边栏
  const routeKey = route.name === 'page' ? `page:${route.id}` : route.name
  const lastRoute = useRef(routeKey)
  useEffect(() => {
    if (lastRoute.current === routeKey) return
    lastRoute.current = routeKey
    if (isNarrowScreen() && ui.get().sidebarOpen) setSidebarOpen(false)
  }, [routeKey])

  return (
    <div className={cls('app', sidebarOpen ? 'sidebar-open' : 'sidebar-closed')}>
      {sidebarOpen && (
        <>
          <Sidebar />
          {/* 窄屏时侧边栏浮在内容上，点遮罩关闭 */}
          <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />
        </>
      )}
      <main className="main">
        <TopBar />
        {route.name === 'page' ? (
          <PageView key={route.id} pageId={route.id} />
        ) : route.name === 'trash' ? (
          <TrashView />
        ) : route.name === 'settings' ? (
          <SettingsView tab={route.tab} />
        ) : (
          <HomeView />
        )}
      </main>
      <CommandPalette />
      <SearchDialog />
      <SlashMenu />
      <Lightbox />
      <HistoryDialog />
      <Toasts />
      <ChordHint />
    </div>
  )
}
