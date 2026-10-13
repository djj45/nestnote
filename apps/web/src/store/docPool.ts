import * as Y from 'yjs'
import { IndexeddbPersistence, clearDocument } from 'y-indexeddb'

/**
 * 页面正文的 Yjs 文档池：按需加载，引用计数，没人用 30 秒后释放。
 * 同一个页面被多处同时显示（以后的嵌套）时共用同一个 Y.Doc。
 */

export const pageDbName = (id: string) => `note:page:${id}`

interface Entry {
  id: string
  doc: Y.Doc
  persistence: IndexeddbPersistence
  refs: number
  synced: boolean
  whenSynced: Promise<void>
  releaseTimer: number | null
}

const pool = new Map<string, Entry>()
let changeListener: ((pageId: string) => void) | null = null

/**
 * 同步模块的挂钩（见 sync/engine.ts）：
 * - attach：页面文档创建时连上服务器
 * - afterLocalLoad：本地数据读完后调用；本地没有这个页面时可以等服务器的数据
 * - detach：页面文档释放或删除前断开
 * - isRemoteOrigin：判断一次修改是不是从服务器来的（不算本地编辑）
 */
export interface PoolHooks {
  attach(id: string, doc: Y.Doc): void
  afterLocalLoad(id: string, doc: Y.Doc): Promise<void>
  detach(id: string): void
  isRemoteOrigin(origin: unknown): boolean
}
let hooks: PoolHooks | null = null

export function setPoolHooks(next: PoolHooks | null) {
  if (hooks) for (const id of pool.keys()) hooks.detach(id)
  hooks = next
  if (hooks) for (const [id, entry] of pool) hooks.attach(id, entry.doc)
}

/** 页面内容被本地修改时回调（用于更新"最后编辑时间"） */
export function setPageChangeListener(listener: (pageId: string) => void) {
  changeListener = listener
}

export function acquirePageDoc(id: string): Entry {
  let entry = pool.get(id)
  if (!entry) {
    const doc = new Y.Doc({ guid: id })
    const persistence = new IndexeddbPersistence(pageDbName(id), doc)
    const created: Entry = {
      id,
      doc,
      persistence,
      refs: 0,
      synced: false,
      whenSynced: Promise.resolve(),
      releaseTimer: null,
    }
    created.whenSynced = persistence.whenSynced
      .then(() => hooks?.afterLocalLoad(id, doc))
      .then(() => {
        created.synced = true
      })
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin !== persistence && !hooks?.isRemoteOrigin(origin)) changeListener?.(id)
    })
    pool.set(id, created)
    hooks?.attach(id, doc)
    entry = created
  }
  if (entry.releaseTimer !== null) {
    clearTimeout(entry.releaseTimer)
    entry.releaseTimer = null
  }
  entry.refs++
  return entry
}

export function releasePageDoc(id: string) {
  const entry = pool.get(id)
  if (!entry) return
  entry.refs = Math.max(0, entry.refs - 1)
  if (entry.refs === 0 && entry.releaseTimer === null) {
    entry.releaseTimer = window.setTimeout(() => {
      if (entry.refs > 0) return
      pool.delete(id)
      hooks?.detach(id)
      entry.persistence.destroy()
      entry.doc.destroy()
    }, 30_000)
  }
}

/** 删除本机数据前关闭所有页面的数据库连接 */
export function closeAllPageDocs() {
  for (const [id, entry] of pool) {
    if (entry.releaseTimer !== null) clearTimeout(entry.releaseTimer)
    hooks?.detach(id)
    entry.persistence.destroy()
  }
  pool.clear()
}

/** 临时加载一个页面文档做点事（导出、导入时用） */
export async function withPageDoc<T>(id: string, fn: (doc: Y.Doc) => T | Promise<T>): Promise<T> {
  const entry = acquirePageDoc(id)
  try {
    await entry.whenSynced
    return await fn(entry.doc)
  } finally {
    releasePageDoc(id)
  }
}

/**
 * 只读地看一眼页面内容（搜索、导出用）：已经打开的页面直接用内存里的文档；
 * 没打开的从本机数据库临时读一份，用完就关，不连服务器、不占文档池。
 */
export async function readPageDoc<T>(id: string, fn: (doc: Y.Doc) => T | Promise<T>): Promise<T> {
  const entry = pool.get(id)
  if (entry && entry.synced) return await fn(entry.doc)
  const doc = new Y.Doc({ guid: id })
  const persistence = new IndexeddbPersistence(pageDbName(id), doc)
  try {
    await persistence.whenSynced
    return await fn(doc)
  } finally {
    await persistence.destroy()
    doc.destroy()
  }
}

/** 删除页面正文在本地的全部数据 */
export async function destroyPageData(id: string) {
  const entry = pool.get(id)
  if (entry) {
    if (entry.releaseTimer !== null) clearTimeout(entry.releaseTimer)
    pool.delete(id)
    hooks?.detach(id)
    await entry.persistence.clearData()
    entry.doc.destroy()
  } else {
    await clearDocument(pageDbName(id))
  }
}
