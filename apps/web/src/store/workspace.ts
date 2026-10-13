import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import { nanoid } from 'nanoid'

/**
 * 工作区索引：所有页面的元信息、快捷键配置等，存在一个 Yjs 文档里。
 * 页面的正文内容存在各自独立的 Yjs 文档里（见 docPool.ts）。
 */

export type PageType = 'doc' | 'canvas'

export interface PageMeta {
  id: string
  type: PageType
  title: string
  icon: string | null
  /** 侧边栏里挂在哪个页面下（严格的树） */
  parentId: string | null
  /** 同级排序（分数索引） */
  order: string
  createdAt: number
  updatedAt: number
  trashedAt: number | null
}

export const WORKSPACE_DB = 'note:workspace'

export const workspaceDoc = new Y.Doc({ guid: 'workspace' })
export const pagesMap = workspaceDoc.getMap<Y.Map<unknown>>('pages')
/** commandId -> 用户自定义的快捷键列表（没有记录就用默认值） */
export const keybindingsMap = workspaceDoc.getMap<string[]>('keybindings')

// ---------- 加载 ----------

const persistence = new IndexeddbPersistence(WORKSPACE_DB, workspaceDoc)
let ready = false
const readyListeners = new Set<() => void>()
/** 同步模块用：本地是空的（新设备）时，先等服务器的数据再显示界面 */
let readyGate: (() => Promise<void>) | null = null
export function setWorkspaceReadyGate(gate: () => Promise<void>) {
  readyGate = gate
}
persistence.whenSynced
  .then(() => readyGate?.())
  .catch(() => {})
  .then(() => {
    ready = true
    readyListeners.forEach((l) => l())
    readyListeners.clear()
  })

/** 删除本机数据前关闭数据库连接 */
export function closeWorkspaceStorage() {
  persistence.destroy()
}

export function isWorkspaceReady() {
  return ready
}

export function onWorkspaceReady(listener: () => void): () => void {
  if (ready) {
    listener()
    return () => {}
  }
  readyListeners.add(listener)
  return () => {
    readyListeners.delete(listener)
  }
}

// ---------- 读取 ----------

function readMeta(id: string, m: Y.Map<unknown>): PageMeta {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)
  const parent = m.get('parentId')
  const trashed = m.get('trashedAt')
  const icon = m.get('icon')
  return {
    id,
    type: m.get('type') === 'canvas' ? 'canvas' : 'doc',
    title: str(m.get('title')),
    icon: typeof icon === 'string' ? icon : null,
    parentId: typeof parent === 'string' ? parent : null,
    order: str(m.get('order')) || 'a0',
    createdAt: num(m.get('createdAt')),
    updatedAt: num(m.get('updatedAt')),
    trashedAt: typeof trashed === 'number' ? trashed : null,
  }
}

export function compareOrder(a: PageMeta, b: PageMeta): number {
  if (a.order < b.order) return -1
  if (a.order > b.order) return 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export interface PagesSnapshot {
  /** 所有页面（包括回收站里的） */
  byId: Map<string, PageMeta>
  /** 有效父页面（父页面不存在或成环时视为根） */
  parentOf: Map<string, string | null>
  /** 可见页面的子页面列表（已排序），根用 null 作 key */
  children: Map<string | null, PageMeta[]>
  /** 可见页面：本身和所有祖先都不在回收站 */
  visible: Set<string>
  /** 回收站里的页面（直接被删除的那些），按删除时间倒序 */
  trashed: PageMeta[]
}

function buildSnapshot(): PagesSnapshot {
  const byId = new Map<string, PageMeta>()
  pagesMap.forEach((m, id) => {
    if (m instanceof Y.Map) byId.set(id, readMeta(id, m))
  })

  const parentOf = new Map<string, string | null>()
  for (const page of byId.values()) {
    let parent = page.parentId && byId.has(page.parentId) ? page.parentId : null
    // 防止父子关系成环（多设备同时移动页面时可能出现）
    if (parent) {
      const seen = new Set<string>([page.id])
      let cursor: string | null = parent
      while (cursor) {
        if (seen.has(cursor)) {
          parent = null
          break
        }
        seen.add(cursor)
        const p = byId.get(cursor)
        cursor = p?.parentId && byId.has(p.parentId) ? p.parentId : null
      }
    }
    parentOf.set(page.id, parent)
  }

  const visible = new Set<string>()
  const isVisible = (id: string): boolean => {
    let cursor: string | null = id
    while (cursor) {
      const p = byId.get(cursor)
      if (!p || p.trashedAt) return false
      cursor = parentOf.get(cursor) ?? null
    }
    return true
  }
  for (const id of byId.keys()) if (isVisible(id)) visible.add(id)

  const children = new Map<string | null, PageMeta[]>()
  for (const id of visible) {
    const page = byId.get(id)!
    const parent = parentOf.get(id) ?? null
    const list = children.get(parent)
    if (list) list.push(page)
    else children.set(parent, [page])
  }
  for (const list of children.values()) list.sort(compareOrder)

  const trashed = [...byId.values()]
    .filter((p) => p.trashedAt)
    .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))

  return { byId, parentOf, children, visible, trashed }
}

let snapshot = buildSnapshot()
const snapshotListeners = new Set<() => void>()
pagesMap.observeDeep(() => {
  snapshot = buildSnapshot()
  snapshotListeners.forEach((l) => l())
})

export function getPagesSnapshot(): PagesSnapshot {
  return snapshot
}

export function subscribePages(listener: () => void): () => void {
  snapshotListeners.add(listener)
  return () => {
    snapshotListeners.delete(listener)
  }
}

export function getPage(id: string): PageMeta | undefined {
  return snapshot.byId.get(id)
}

/** 从根到该页面的路径（不含自己） */
export function getAncestors(id: string): PageMeta[] {
  const result: PageMeta[] = []
  let cursor = snapshot.parentOf.get(id) ?? null
  while (cursor) {
    const page = snapshot.byId.get(cursor)
    if (!page) break
    result.unshift(page)
    cursor = snapshot.parentOf.get(cursor) ?? null
  }
  return result
}

/** 页面（或它的某个祖先）在回收站里时，返回直接被删除的那个页面；不在回收站返回 null */
export function trashedRootOf(id: string): string | null {
  let cursor: string | null = id
  while (cursor) {
    const page = snapshot.byId.get(cursor)
    if (!page) return null
    if (page.trashedAt) return cursor
    cursor = snapshot.parentOf.get(cursor) ?? null
  }
  return null
}

/** id 是否是 ancestorId 本身或其后代 */
export function isSelfOrDescendant(id: string, ancestorId: string): boolean {
  let cursor: string | null = id
  while (cursor) {
    if (cursor === ancestorId) return true
    cursor = snapshot.parentOf.get(cursor) ?? null
  }
  return false
}

/** 所有后代（包括回收站里的），用于永久删除 */
function collectDescendants(id: string): string[] {
  const result: string[] = []
  const stack = [id]
  while (stack.length) {
    const current = stack.pop()!
    for (const page of snapshot.byId.values()) {
      if (snapshot.parentOf.get(page.id) === current && !result.includes(page.id)) {
        result.push(page.id)
        stack.push(page.id)
      }
    }
  }
  return result
}

// ---------- 修改 ----------

/** 计算插入到 parent 的第 index 个位置所需的排序键。必须在 transact 里调用。 */
function orderKeyAt(parentId: string | null, index: number, excludeId?: string): string {
  const siblings = (snapshot.children.get(parentId) ?? []).filter((p) => p.id !== excludeId)
  const before = siblings[index - 1]?.order ?? null
  const after = siblings[index]?.order ?? null
  try {
    return generateKeyBetween(before, after)
  } catch {
    // 排序键冲突（例如两台设备同时插入），整组重新编号
    const keys = generateNKeysBetween(null, null, siblings.length + 1)
    siblings.forEach((p, i) => pagesMap.get(p.id)?.set('order', keys[i >= index ? i + 1 : i]))
    return keys[index]
  }
}

export function createPage(options: {
  type: PageType
  parentId?: string | null
  title?: string
  index?: number
}): string {
  const id = nanoid(12)
  const parentId = options.parentId ?? null
  const now = Date.now()
  workspaceDoc.transact(() => {
    const count = (snapshot.children.get(parentId) ?? []).length
    const order = orderKeyAt(parentId, options.index ?? count)
    const m = new Y.Map<unknown>()
    pagesMap.set(id, m)
    m.set('type', options.type)
    m.set('title', options.title ?? '')
    m.set('parentId', parentId)
    m.set('order', order)
    m.set('createdAt', now)
    m.set('updatedAt', now)
  })
  return id
}

export function renamePage(id: string, title: string) {
  const m = pagesMap.get(id)
  if (!m || m.get('title') === title) return
  workspaceDoc.transact(() => {
    m.set('title', title)
    m.set('updatedAt', Date.now())
  })
}

const touchTimers = new Map<string, number>()
/** 页面内容变化时更新"最后编辑时间"（节流） */
export function touchPage(id: string) {
  if (touchTimers.has(id)) return
  touchTimers.set(
    id,
    window.setTimeout(() => {
      touchTimers.delete(id)
      pagesMap.get(id)?.set('updatedAt', Date.now())
    }, 1500),
  )
}

export type DropPosition = 'before' | 'after' | 'inside'

export function canMove(id: string, targetId: string | null, position: DropPosition): boolean {
  if (targetId === null) return true
  const newParent = position === 'inside' ? targetId : (snapshot.parentOf.get(targetId) ?? null)
  if (id === targetId) return false
  if (newParent && isSelfOrDescendant(newParent, id)) return false
  return true
}

/** 把页面移到 target 的前面/后面/里面；targetId 为 null 表示移到根的末尾 */
export function movePage(id: string, targetId: string | null, position: DropPosition): boolean {
  if (!canMove(id, targetId, position)) return false
  const m = pagesMap.get(id)
  if (!m) return false
  let parentId: string | null
  let index: number
  if (targetId === null) {
    parentId = null
    index = (snapshot.children.get(null) ?? []).filter((p) => p.id !== id).length
  } else if (position === 'inside') {
    parentId = targetId
    index = (snapshot.children.get(targetId) ?? []).filter((p) => p.id !== id).length
  } else {
    parentId = snapshot.parentOf.get(targetId) ?? null
    const siblings = (snapshot.children.get(parentId) ?? []).filter((p) => p.id !== id)
    const targetIndex = siblings.findIndex((p) => p.id === targetId)
    index = position === 'before' ? targetIndex : targetIndex + 1
  }
  workspaceDoc.transact(() => {
    const order = orderKeyAt(parentId, index, id)
    m.set('parentId', parentId)
    m.set('order', order)
  })
  return true
}

export function trashPage(id: string) {
  pagesMap.get(id)?.set('trashedAt', Date.now())
}

export function restorePage(id: string) {
  const m = pagesMap.get(id)
  if (!m) return
  workspaceDoc.transact(() => {
    m.delete('trashedAt')
    const parent = snapshot.parentOf.get(id) ?? null
    // 父页面也在回收站里（或已删除）的话，恢复到根目录
    if (parent && !snapshot.visible.has(parent)) m.set('parentId', null)
  })
}

/** 永久删除页面及其所有子页面，返回被删除的页面 id（调用方负责清理正文数据） */
export function deletePagesForever(id: string): string[] {
  const ids = [id, ...collectDescendants(id)]
  workspaceDoc.transact(() => {
    for (const pid of ids) pagesMap.delete(pid)
  })
  return ids
}
