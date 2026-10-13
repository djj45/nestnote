import { registerCommands, type CommandDef } from './registry'
import { navigate, paths } from '../lib/router'
import { getPage } from '../store/workspace'
import { createAndOpen, moveToTrash } from '../app/actions'
import { openPalette, setSidebarOpen, ui } from '../app/ui'
import { BACKUP_EXTENSION, exportBackup } from '../store/backup'
import { downloadBlob, fileStamp } from '../lib/format'
import { showToast } from '../app/toast'
import { toggleReadOnly } from '../app/readOnly'
import { toggleTheme } from '../app/prefs'
import { openSearch } from '../search/SearchDialog'
import { currentCanvas, exportPageImage, exportPageMarkdown, printPage } from '../export/actions'

const GROUP_PAGE = '页面'
const GROUP_APP = '通用'

const hasPage = (ctx: { pageId: string | null }) => !!ctx.pageId && !!getPage(ctx.pageId)

const builtin: CommandDef[] = [
  {
    id: 'page.newDoc',
    title: '新建文档',
    group: GROUP_PAGE,
    scope: 'global',
    keys: ['Mod+Alt+N'],
    run: () => {
      createAndOpen('doc')
    },
  },
  {
    id: 'page.newCanvas',
    title: '新建画布',
    group: GROUP_PAGE,
    scope: 'global',
    keys: ['Mod+Alt+Shift+N'],
    run: () => {
      createAndOpen('canvas')
    },
  },
  {
    id: 'page.newChildDoc',
    title: '在当前页面下新建子文档',
    group: GROUP_PAGE,
    scope: 'global',
    when: hasPage,
    run: (ctx) => {
      createAndOpen('doc', ctx.pageId)
    },
  },
  {
    id: 'page.newChildCanvas',
    title: '在当前页面下新建子画布',
    group: GROUP_PAGE,
    scope: 'global',
    when: hasPage,
    run: (ctx) => {
      createAndOpen('canvas', ctx.pageId)
    },
  },
  {
    id: 'page.trash',
    title: '将当前页面移到回收站',
    group: GROUP_PAGE,
    scope: 'global',
    when: hasPage,
    run: (ctx) => {
      moveToTrash(ctx.pageId!)
    },
  },
  {
    id: 'page.exportMarkdown',
    title: '把当前页面导出为 Markdown',
    group: GROUP_PAGE,
    scope: 'global',
    when: hasPage,
    run: (ctx) => {
      void exportPageMarkdown(ctx.pageId!)
    },
  },
  {
    id: 'page.exportImage',
    title: '把当前画布导出为图片',
    group: GROUP_PAGE,
    scope: 'global',
    when: (ctx) => !!currentCanvas(ctx.pageId),
    run: (ctx) => {
      void exportPageImage(ctx.pageId!)
    },
  },
  {
    id: 'page.print',
    title: '打印 / 存为 PDF',
    group: GROUP_PAGE,
    scope: 'global',
    when: (ctx) => !!ctx.pageId && getPage(ctx.pageId)?.type === 'doc',
    run: (ctx) => printPage(ctx.pageId!),
  },
  {
    id: 'app.quickOpen',
    title: '搜索并跳转到页面',
    group: GROUP_APP,
    scope: 'global',
    keys: ['Mod+P'],
    run: () => openPalette('pages'),
  },
  {
    id: 'app.search',
    title: '全文搜索',
    group: GROUP_APP,
    scope: 'global',
    keys: ['Mod+Shift+F'],
    run: () => openSearch(),
  },
  {
    id: 'app.commandPalette',
    title: '命令面板',
    group: GROUP_APP,
    scope: 'global',
    keys: ['Mod+Shift+P'],
    palette: false,
    run: () => openPalette('commands'),
  },
  {
    id: 'app.toggleSidebar',
    title: '显示 / 隐藏侧边栏',
    group: GROUP_APP,
    scope: 'global',
    keys: ['Mod+\\'],
    run: () => setSidebarOpen(!ui.get().sidebarOpen),
  },
  {
    id: 'app.toggleReadOnly',
    title: '开启 / 关闭只读模式',
    group: GROUP_APP,
    scope: 'global',
    run: () => toggleReadOnly(),
  },
  {
    id: 'app.toggleTheme',
    title: '切换浅色 / 深色',
    group: GROUP_APP,
    scope: 'global',
    run: () => toggleTheme(),
  },
  {
    id: 'app.home',
    title: '回到首页',
    group: GROUP_APP,
    scope: 'global',
    run: () => navigate(paths.home),
  },
  {
    id: 'app.trash',
    title: '打开回收站',
    group: GROUP_APP,
    scope: 'global',
    run: () => navigate(paths.trash),
  },
  {
    id: 'app.settings',
    title: '打开设置',
    group: GROUP_APP,
    scope: 'global',
    keys: ['Mod+,'],
    run: () => navigate(paths.settings()),
  },
  {
    id: 'app.shortcuts',
    title: '自定义快捷键',
    group: GROUP_APP,
    scope: 'global',
    run: () => navigate(paths.settings('shortcuts')),
  },
  {
    id: 'app.exportBackup',
    title: '导出备份',
    group: GROUP_APP,
    scope: 'global',
    run: () => {
      exportBackup()
        .then((blob) => {
          downloadBlob(blob, `笔记备份-${fileStamp()}${BACKUP_EXTENSION}`)
          showToast('备份已导出')
        })
        .catch((err: unknown) => showToast(`导出失败：${err instanceof Error ? err.message : String(err)}`, { tone: 'error' }))
    },
  },
]

registerCommands(builtin)
