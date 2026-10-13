import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'home' }
  /** trail：从嵌入处打开时，经过的页面路径（面包屑显示它而不是目录层级） */
  | { name: 'page'; id: string; trail: string[] | null }
  | { name: 'trash' }
  | { name: 'settings'; tab: string }

export interface RouteState {
  trail?: string[]
}

function readTrail(state: unknown): string[] | null {
  const trail = (state as RouteState | null)?.trail
  return Array.isArray(trail) && trail.length && trail.every((x) => typeof x === 'string') ? trail : null
}

function parse(pathname: string, state: unknown): Route {
  const page = pathname.match(/^\/p\/([^/]+)\/?$/)
  if (page) return { name: 'page', id: decodeURIComponent(page[1]), trail: readTrail(state) }
  if (/^\/trash\/?$/.test(pathname)) return { name: 'trash' }
  const settings = pathname.match(/^\/settings(?:\/([^/]+))?\/?$/)
  if (settings) return { name: 'settings', tab: settings[1] ?? 'general' }
  return { name: 'home' }
}

let current: Route = parse(window.location.pathname, window.history.state)
const listeners = new Set<() => void>()

/** 最近一个不是设置页的地址（设置页的"返回"按钮回到这里） */
let lastNonSettings: { path: string; state: RouteState | null } | null =
  current.name === 'settings' ? null : { path: window.location.pathname, state: window.history.state as RouteState | null }

function emit() {
  if (current.name !== 'settings') {
    lastNonSettings = { path: window.location.pathname, state: window.history.state as RouteState | null }
  }
  listeners.forEach((l) => l())
}

window.addEventListener('popstate', () => {
  current = parse(window.location.pathname, window.history.state)
  emit()
})

export const paths = {
  home: '/',
  trash: '/trash',
  page: (id: string) => `/p/${encodeURIComponent(id)}`,
  settings: (tab?: string) => (tab ? `/settings/${tab}` : '/settings'),
}

export function navigate(path: string, options: { replace?: boolean; state?: RouteState } = {}) {
  if (path === window.location.pathname) return
  const state = options.state ?? null
  if (options.replace) window.history.replaceState(state, '', path)
  else window.history.pushState(state, '', path)
  current = parse(path, state)
  emit()
}

/** 离开设置页：回到打开设置前的页面（没有的话回首页） */
export function leaveSettings() {
  const target = lastNonSettings ?? { path: paths.home, state: null }
  navigate(target.path, { state: target.state ?? undefined })
}

export function getRoute(): Route {
  return current
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    () => current,
  )
}

export function currentPageId(): string | null {
  return current.name === 'page' ? current.id : null
}
