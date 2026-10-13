import { createStore, useStore } from '../lib/store'

/**
 * 每台设备各自的显示偏好（存在 localStorage，不同步）：侧边栏宽度、文档宽度、浅色/深色。
 * 通过 CSS 变量（--sidebar-width、--doc-width）和 <html data-theme> 生效。
 */

export type DocWidth = 'narrow' | 'standard' | 'wide' | 'full'

export const DOC_WIDTHS: { id: DocWidth; label: string; css: string }[] = [
  { id: 'narrow', label: '窄', css: '640px' },
  { id: 'standard', label: '标准', css: '780px' },
  { id: 'wide', label: '宽', css: '1040px' },
  { id: 'full', label: '铺满', css: 'none' },
]

/** 外观：跟随系统、浅色、深色 */
export type Theme = 'system' | 'light' | 'dark'

export const THEMES: { id: Theme; label: string }[] = [
  { id: 'system', label: '跟随系统' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
]

export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 252

interface Prefs {
  sidebarWidth: number
  docWidth: DocWidth
  theme: Theme
  /** 选择工具下用手写笔在空白处画，直接是写字（不用先切到画笔） */
  penDraws: boolean
}

function load(): Prefs {
  let sidebarWidth = SIDEBAR_DEFAULT
  let docWidth: DocWidth = 'standard'
  let theme: Theme = 'system'
  let penDraws = true
  try {
    penDraws = localStorage.getItem('note:penDraws') !== '0'
    const t = localStorage.getItem('note:theme')
    if (THEMES.some((x) => x.id === t)) theme = t as Theme
    const w = Number(localStorage.getItem('note:sidebarWidth'))
    if (w >= SIDEBAR_MIN && w <= SIDEBAR_MAX) sidebarWidth = w
    const d = localStorage.getItem('note:docWidth')
    if (DOC_WIDTHS.some((x) => x.id === d)) docWidth = d as DocWidth
  } catch {
    /* 浏览器存储不可用时用默认值 */
  }
  return { sidebarWidth, docWidth, theme, penDraws }
}

export const prefs = createStore<Prefs>(load())

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

/** 实际生效的是浅色还是深色 */
export function effectiveTheme(theme: Theme = prefs.get().theme): 'light' | 'dark' {
  return theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : theme
}

function apply({ sidebarWidth, docWidth, theme }: Prefs) {
  const el = document.documentElement
  el.style.setProperty('--sidebar-width', `${sidebarWidth}px`)
  el.style.setProperty('--doc-width', DOC_WIDTHS.find((x) => x.id === docWidth)!.css)
  if (theme === 'system') delete el.dataset.theme
  else el.dataset.theme = theme
  // 手机浏览器顶部状态栏的颜色
  const bar = effectiveTheme(theme) === 'dark' ? '#15181d' : '#f6f7f9'
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    if (theme === 'system') m.content = m.media.includes('dark') ? '#15181d' : '#f6f7f9'
    else m.content = bar
  })
}
apply(prefs.get())
prefs.subscribe(() => apply(prefs.get()))
darkQuery.addEventListener?.('change', () => apply(prefs.get()))

export function setPenDraws(penDraws: boolean) {
  try {
    localStorage.setItem('note:penDraws', penDraws ? '1' : '0')
  } catch {
    /* 忽略 */
  }
  prefs.set((p) => ({ ...p, penDraws }))
}

export function setTheme(theme: Theme) {
  try {
    if (theme === 'system') localStorage.removeItem('note:theme')
    else localStorage.setItem('note:theme', theme)
  } catch {
    /* 忽略 */
  }
  prefs.set((p) => ({ ...p, theme }))
}

/** 在浅色和深色之间切换（跟随系统时切到和系统相反的那个） */
export function toggleTheme() {
  setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark')
}

export function setSidebarWidth(width: number, save: boolean) {
  const w = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)))
  prefs.set((p) => ({ ...p, sidebarWidth: w }))
  if (save) localStorage.setItem('note:sidebarWidth', String(w))
}

export function resetSidebarWidth() {
  localStorage.removeItem('note:sidebarWidth')
  prefs.set((p) => ({ ...p, sidebarWidth: SIDEBAR_DEFAULT }))
}

export function setDocWidth(docWidth: DocWidth) {
  localStorage.setItem('note:docWidth', docWidth)
  prefs.set((p) => ({ ...p, docWidth }))
}

export function usePrefs(): Prefs {
  return useStore(prefs)
}
