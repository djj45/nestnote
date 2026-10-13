import type * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { HocuspocusProvider, HocuspocusProviderWebsocket, WebSocketStatus } from '@hocuspocus/provider'
import { pagesMap, setWorkspaceReadyGate, workspaceDoc } from '../store/workspace'
import { acquirePageDoc, destroyPageData, releasePageDoc, setPoolHooks } from '../store/docPool'
import { createEmitter, createStore } from '../lib/store'

/**
 * 同步引擎：本地 IndexedDB 照常保存，同时通过一条 WebSocket 和服务器同步。
 *
 * - 工作区文档一直连着；页面文档在被打开（或嵌入显示）时才连上，释放时断开
 * - 没打开的页面怎么同步？"后台补同步"：
 *   · 本地改过但还没确认传到服务器的页面，记在 dirty 里（存在 localStorage，关掉网页也不会忘）
 *   · 每个页面上次和服务器同步完成时的"最后编辑时间"记在 syncedAt 里；
 *     工作区里的编辑时间比它新（别的设备改过），或者根本没同步过（第一次连接 / 新设备），就要补
 *   · 联网后、页面列表变化时，后台逐个加载这些页面，和服务器交换完数据再释放
 * - Yjs 自动合并，两边同时改也不会互相覆盖
 */

export type SyncPhase = 'off' | 'offline' | 'syncing' | 'synced'

export interface SyncState {
  phase: SyncPhase
  /** 还没和服务器对齐的页面数 */
  pendingPages: number
  /** 还没上传完的文件数 */
  pendingUploads: number
  lastSyncedAt: number | null
}

export const syncState = createStore<SyncState>({ phase: 'off', pendingPages: 0, pendingUploads: 0, lastSyncedAt: null })
/** 连上服务器（每次重连都会触发） */
export const connectedEvents = createEmitter<void>()
/** 连接断开（用来检查是不是登录过期了） */
export const disconnectedEvents = createEmitter<void>()

// ---------------- 本地记录 ----------------

const LS_DIRTY = 'note:sync:dirty'
const LS_SYNCED_AT = 'note:sync:pages'

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

const dirty = new Set<string>(loadJson<string[]>(LS_DIRTY, []))
const syncedAt = new Map<string, number>(Object.entries(loadJson<Record<string, number>>(LS_SYNCED_AT, {})))

const saveDirty = () => localStorage.setItem(LS_DIRTY, JSON.stringify([...dirty]))
let syncedAtTimer: number | null = null
const saveSyncedAt = () => {
  if (syncedAtTimer !== null) return
  syncedAtTimer = window.setTimeout(() => {
    syncedAtTimer = null
    localStorage.setItem(LS_SYNCED_AT, JSON.stringify(Object.fromEntries(syncedAt)))
  }, 500)
}

function markDirty(id: string) {
  if (dirty.has(id)) return
  dirty.add(id)
  saveDirty()
}

function markSynced(id: string, updatedAt: number) {
  if (dirty.delete(id)) saveDirty()
  if (syncedAt.get(id) !== updatedAt) {
    syncedAt.set(id, updatedAt)
    saveSyncedAt()
  }
}

/** 页面在工作区里的最后编辑时间 */
function pageUpdatedAt(id: string): number | null {
  const m = pagesMap.get(id)
  if (!m) return null
  const v = m.get('updatedAt')
  return typeof v === 'number' ? v : 0
}

/** 页面被永久删除后清掉同步记录 */
export function forgetPage(id: string) {
  if (dirty.delete(id)) saveDirty()
  if (syncedAt.delete(id)) saveSyncedAt()
}

/** 退出登录时清掉同步记录（下次登录会全部重新对一遍） */
export function resetSyncRecords() {
  dirty.clear()
  syncedAt.clear()
  localStorage.removeItem(LS_DIRTY)
  localStorage.removeItem(LS_SYNCED_AT)
}

// ---------------- 连接 ----------------

let socket: HocuspocusProviderWebsocket | null = null
let workspaceProvider: HocuspocusProvider | null = null
const pageProviders = new Map<string, { provider: HocuspocusProvider; doc: Y.Doc; onUpdate: (u: Uint8Array, origin: unknown) => void }>()

const fullySynced = (p: HocuspocusProvider) => p.synced && !p.hasUnsyncedChanges

export function isRunning() {
  return socket !== null
}

export function isConnected() {
  return socket?.status === WebSocketStatus.Connected
}

function socketUrl() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sync`
}

function newProvider(name: string, doc: Y.Doc, withAwareness: boolean) {
  const provider = new HocuspocusProvider({
    websocketProvider: socket!,
    name,
    document: doc,
    // 工作区保留 awareness：它会定期收发小消息，让连接保持"活着"的判断
    ...(withAwareness ? {} : { awareness: null }),
  })
  provider.on('synced', updateStatus)
  provider.on('unsyncedChanges', updateStatus)
  provider.attach()
  return provider
}

function waitFullySynced(provider: HocuspocusProvider, timeout: number): Promise<boolean> {
  if (fullySynced(provider)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer)
      provider.off('synced', check)
      provider.off('unsyncedChanges', check)
      resolve(ok)
    }
    const check = () => {
      if (fullySynced(provider)) done(true)
    }
    const timer = window.setTimeout(() => done(false), timeout)
    provider.on('synced', check)
    provider.on('unsyncedChanges', check)
  })
}

function waitFirstSync(provider: HocuspocusProvider, timeout: number): Promise<void> {
  if (provider.synced) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      provider.off('synced', done)
      resolve()
    }
    const timer = window.setTimeout(done, timeout)
    provider.on('synced', done)
  })
}

const poolHooks = {
  attach(id: string, doc: Y.Doc) {
    if (!socket || pageProviders.has(id)) return
    const provider = newProvider(`page:${id}`, doc, false)
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin === provider || origin instanceof IndexeddbPersistence) return
      markDirty(id)
    }
    doc.on('update', onUpdate)
    const settle = () => {
      if (!fullySynced(provider)) return
      const updatedAt = pageUpdatedAt(id)
      if (updatedAt !== null && !sweepActive.has(id)) markSynced(id, updatedAt)
    }
    provider.on('synced', settle)
    provider.on('unsyncedChanges', settle)
    pageProviders.set(id, { provider, doc, onUpdate })
    updateStatus()
  },
  async afterLocalLoad(_id: string, doc: Y.Doc) {
    // 本地没有这个页面（新设备、别的设备新建的）：等一下服务器的数据，避免先显示空白页
    const entry = pageProviders.get(_id)
    if (!entry || doc.store.clients.size > 0 || !socket) return
    if (socket.status === WebSocketStatus.Disconnected) return
    await waitFirstSync(entry.provider, socket.status === WebSocketStatus.Connected ? 8000 : 4000)
  },
  detach(id: string) {
    const entry = pageProviders.get(id)
    if (!entry) return
    pageProviders.delete(id)
    entry.doc.off('update', entry.onUpdate)
    if (!fullySynced(entry.provider) && entry.doc.store.clients.size > 0) markDirty(id)
    entry.provider.destroy()
    updateStatus()
    if (dirty.has(id)) kickSweep()
  },
  isRemoteOrigin(origin: unknown) {
    return origin instanceof HocuspocusProvider
  },
}

/** 开始同步（已登录，或者以前登录过、现在离线） */
export function startSync() {
  if (socket) return
  socket = new HocuspocusProviderWebsocket({
    url: socketUrl(),
    // 断线重连：1 秒起，每次翻倍，最长 30 秒一次
    delay: 1000,
    factor: 2,
    maxDelay: 30000,
    messageReconnectTimeout: 45000,
  })
  socket.on('status', ({ status }: { status: WebSocketStatus }) => {
    if (status === WebSocketStatus.Connected) {
      connectedEvents.emit()
      kickSweep()
    } else if (status === WebSocketStatus.Disconnected) {
      disconnectedEvents.emit()
    }
    updateStatus()
  })
  workspaceProvider = newProvider('workspace', workspaceDoc, true)
  workspaceProvider.on('synced', () => kickSweep())
  setPoolHooks(poolHooks)
  pagesMap.observeDeep(onPagesChanged)
  window.addEventListener('online', reconnectNow)
  updateStatus()
}

export function stopSync() {
  if (!socket) return
  setPoolHooks(null)
  pagesMap.unobserveDeep(onPagesChanged)
  window.removeEventListener('online', reconnectNow)
  workspaceProvider?.destroy()
  workspaceProvider = null
  socket.destroy()
  socket = null
  sweepQueue.clear()
  updateStatus()
}

/** 联网了（或刚登录）：不等退避计时，立刻重连 */
export function reconnectNow() {
  if (socket && socket.status === WebSocketStatus.Disconnected) void socket.connect()
}

/** 第一次加载工作区时：本地是空的（新设备），先等服务器的数据 */
export async function waitWorkspaceIfEmpty(timeout = 10000) {
  if (!workspaceProvider || pagesMap.size > 0 || workspaceDoc.store.clients.size > 0) return
  await waitFirstSync(workspaceProvider, timeout)
}

setWorkspaceReadyGate(() => waitWorkspaceIfEmpty())

// ---------------- 后台补同步 ----------------

const sweepQueue = new Set<string>()
const sweepActive = new Set<string>()
let sweepTimer: number | null = null
let sweeping = false
const SWEEP_CONCURRENCY = 3

function onPagesChanged() {
  kickSweep(2000)
}

/** 稍后检查一遍哪些页面需要补同步 */
export function kickSweep(delay = 300) {
  if (!socket) return
  if (sweepTimer !== null) clearTimeout(sweepTimer)
  sweepTimer = window.setTimeout(() => {
    sweepTimer = null
    void runSweep()
  }, delay)
}

function collectQueue() {
  sweepQueue.clear()
  for (const id of pagesMap.keys()) {
    const updatedAt = pageUpdatedAt(id) ?? 0
    const last = syncedAt.get(id)
    if (sweepActive.has(id)) continue
    if (dirty.has(id) || last === undefined || last < updatedAt) sweepQueue.add(id)
  }
  // 工作区里已经没有的页面（被永久删除了）不用再管
  for (const id of [...dirty]) if (!pagesMap.has(id)) forgetPage(id)
}

/** 别的设备永久删除了页面：删掉本机残留的副本（只删和服务器同步过的，工作区已和服务器对齐时才做） */
function removeDeletedPages() {
  if (!workspaceProvider || !fullySynced(workspaceProvider)) return
  for (const id of [...syncedAt.keys()]) {
    if (pagesMap.has(id)) continue
    forgetPage(id)
    void destroyPageData(id).catch(() => {})
  }
}

async function syncOnePage(id: string) {
  const updatedAt = pageUpdatedAt(id)
  if (updatedAt === null) return
  sweepActive.add(id)
  const entry = acquirePageDoc(id)
  try {
    await entry.whenSynced
    const p = pageProviders.get(id)?.provider
    if (p && (await waitFullySynced(p, 60000))) markSynced(id, updatedAt)
  } finally {
    sweepActive.delete(id)
    releasePageDoc(id)
  }
}

async function runSweep() {
  if (sweeping || !socket || !isConnected() || !workspaceProvider?.synced) return
  sweeping = true
  try {
    removeDeletedPages()
    collectQueue()
    updateStatus()
    const workers = Array.from({ length: SWEEP_CONCURRENCY }, async () => {
      while (socket && isConnected()) {
        const next = sweepQueue.values().next()
        if (next.done) return
        sweepQueue.delete(next.value)
        await syncOnePage(next.value).catch((err) => console.warn('[sync] 页面同步失败', next.value, err))
        updateStatus()
      }
    })
    await Promise.all(workers)
  } finally {
    sweeping = false
    // 期间如果又有新的变化，再检查一遍
    collectQueue()
    updateStatus()
    if (sweepQueue.size && isConnected()) kickSweep(5000)
  }
}

// ---------------- 状态 ----------------

let pendingUploads = 0
export function setPendingUploads(n: number) {
  pendingUploads = n
  updateStatus()
}

let statusTimer: number | null = null
function updateStatus() {
  if (statusTimer !== null) return
  statusTimer = window.setTimeout(() => {
    statusTimer = null
    computeStatus()
  }, 50)
}

function computeStatus() {
  const prev = syncState.get()
  if (!socket) {
    syncState.set({ ...prev, phase: 'off', pendingPages: 0, pendingUploads: 0 })
    return
  }
  let unsynced = 0
  for (const { provider } of pageProviders.values()) if (!fullySynced(provider)) unsynced++
  const pendingPages = Math.max(sweepQueue.size + sweepActive.size, dirty.size, unsynced)
  let phase: SyncPhase
  if (!isConnected()) phase = 'offline'
  else if (!workspaceProvider || !fullySynced(workspaceProvider) || pendingPages > 0 || unsynced > 0 || pendingUploads > 0)
    phase = 'syncing'
  else phase = 'synced'
  const next: SyncState = {
    phase,
    pendingPages,
    pendingUploads,
    lastSyncedAt: phase === 'synced' ? Date.now() : prev.lastSyncedAt,
  }
  if (
    next.phase !== prev.phase ||
    next.pendingPages !== prev.pendingPages ||
    next.pendingUploads !== prev.pendingUploads ||
    (phase === 'synced' && prev.phase !== 'synced')
  ) {
    syncState.set(next)
  }
}

/** 所有页面都已经和服务器对齐（清理文件之类的操作前要检查） */
export function isFullySynced(): boolean {
  if (!socket) return true
  collectQueue()
  computeStatus()
  return syncState.get().phase === 'synced'
}

/** 等到全部同步完成（或超时），返回是否完成 */
export function waitAllSynced(timeout: number): Promise<boolean> {
  if (isFullySynced()) return Promise.resolve(true)
  kickSweep(0)
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      off()
      resolve(false)
    }, timeout)
    const off = syncState.subscribe(() => {
      if (syncState.get().phase === 'synced') {
        clearTimeout(timer)
        off()
        resolve(true)
      }
    })
  })
}
