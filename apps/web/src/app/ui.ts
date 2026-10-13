import { createStore } from '../lib/store'
import type { PageType } from '../store/workspace'

/** 窄屏（手机）时侧边栏浮在内容上方，和 app.css 里的断点保持一致 */
export const isNarrowScreen = () => window.matchMedia('(max-width: 720px)').matches

function readSidebarPref(): boolean {
  if (isNarrowScreen()) return false
  try {
    const value = localStorage.getItem('note:sidebar')
    if (value !== null) return value === '1'
  } catch {
    /* 浏览器存储不可用时用默认值 */
  }
  return true
}

export interface UiState {
  sidebarOpen: boolean
  /** pick：选一个页面（嵌入、链接时用） */
  palette: null | 'pages' | 'commands' | 'pick'
}

export const ui = createStore<UiState>({
  sidebarOpen: readSidebarPref(),
  palette: null,
})

export function setSidebarOpen(open: boolean) {
  ui.set((s) => ({ ...s, sidebarOpen: open }))
  if (isNarrowScreen()) return
  try {
    localStorage.setItem('note:sidebar', open ? '1' : '0')
  } catch {
    /* 忽略 */
  }
}

/** 打开命令面板前的焦点位置，关闭时还回去（例如回到编辑器里原来的光标处） */
let paletteReturnFocus: HTMLElement | null = null

export function openPalette(mode: 'pages' | 'commands') {
  const current = ui.get().palette
  if (current === mode) {
    closePalette()
    return
  }
  if (!current) paletteReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  ui.set((s) => ({ ...s, palette: mode }))
}

export interface PagePickRequest {
  /** 对话框标题，例如"嵌入页面" */
  title: string
  /** 不能选的页面（例如自己和上层页面，避免循环嵌入） */
  exclude?: readonly string[]
  onPick: (pageId: string) => void
  /** 提供时，搜索框里有字就可以直接新建同名页面 */
  onCreate?: (type: PageType, title: string) => void
}

let pickRequest: PagePickRequest | null = null

export function getPickRequest(): PagePickRequest | null {
  return pickRequest
}

/** 弹出页面选择框（和"跳转到页面"同一个界面），选好后焦点回到原来的位置再回调 */
export function openPagePicker(request: PagePickRequest) {
  if (!ui.get().palette) paletteReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  pickRequest = request
  ui.set((s) => ({ ...s, palette: 'pick' }))
}

/** restoreFocus 为 false 时不还焦点（比如要跳转到别的页面） */
export function closePalette(restoreFocus = true) {
  ui.set((s) => ({ ...s, palette: null }))
  const el = paletteReturnFocus
  paletteReturnFocus = null
  if (restoreFocus && el && document.contains(el)) el.focus({ preventScroll: true })
}

// ---------- 侧边栏展开状态（每个浏览器各自记住） ----------

function readExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem('note:expanded') ?? '[]'))
  } catch {
    return new Set()
  }
}

export const expanded = createStore<Set<string>>(readExpanded())

export function setExpanded(id: string, open: boolean) {
  expanded.set((prev) => {
    if (prev.has(id) === open) return prev
    const next = new Set(prev)
    if (open) next.add(id)
    else next.delete(id)
    try {
      localStorage.setItem('note:expanded', JSON.stringify([...next]))
    } catch {
      /* 忽略 */
    }
    return next
  })
}

// ---------- 新建页面后让标题自动获得焦点 ----------

let pendingTitleFocus: string | null = null
export function requestTitleFocus(pageId: string) {
  pendingTitleFocus = pageId
}
export function consumeTitleFocus(pageId: string): boolean {
  if (pendingTitleFocus !== pageId) return false
  pendingTitleFocus = null
  return true
}
/** 只看不取（开发模式下 effect 会跑两次，真正聚焦后再 consume） */
export function wantsTitleFocus(pageId: string): boolean {
  return pendingTitleFocus === pageId
}
