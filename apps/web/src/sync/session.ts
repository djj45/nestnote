import { createStore } from '../lib/store'
import { closeAssetDb, setRemoteAssetSource } from '../assets/assetStore'
import { closeWorkspaceStorage } from '../store/workspace'
import { closeAllPageDocs } from '../store/docPool'
import { ApiError, OfflineError, api, fetchMe } from './api'
import {
  connectedEvents,
  disconnectedEvents,
  forgetPage,
  isConnected,
  reconnectNow,
  resetSyncRecords,
  startSync,
  stopSync,
  waitWorkspaceIfEmpty,
} from './engine'
import { remoteAssetSource, uploadMissing, watchLocalAssets } from './assets'

/**
 * 登录状态：
 * - checking：正在问服务器（只在从没登录过时出现）
 * - login：需要登录（没登录过，或者登录过期了）
 * - local：只在本机使用（没有服务器，或者在 localhost 上选择了"暂不登录"）
 * - ready：已登录，正在同步（离线时也是这个状态，联网后自动继续）
 */
export type AuthStatus = 'checking' | 'login' | 'local' | 'ready'

export interface SessionState {
  status: AuthStatus
  username: string | null
  /** 以前登录过，但登录已失效 */
  expired: boolean
  /** 找到服务器了（local 状态下用来决定显示"连接服务器"按钮） */
  serverFound: boolean
}

export const session = createStore<SessionState>({ status: 'checking', username: null, expired: false, serverFound: false })

const LS_ACCOUNT = 'note:sync:account'
const LS_SKIP = 'note:sync:skip'
const LS_PENDING_DELETES = 'note:sync:pendingDeletes'

export const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)

// ---------------- 同步的开关 ----------------

let stopWatchingAssets: (() => void) | null = null
let offConnected: (() => void) | null = null
let offDisconnected: (() => void) | null = null

function startEngine() {
  startSync()
  setRemoteAssetSource(remoteAssetSource)
  stopWatchingAssets ??= watchLocalAssets()
  offConnected ??= connectedEvents.on(() => {
    window.setTimeout(() => {
      void uploadMissing()
      void flushPageDeletes()
    }, 1000)
  })
  offDisconnected ??= disconnectedEvents.on(checkStillLoggedIn)
}

function stopEngine() {
  stopSync()
  setRemoteAssetSource(null)
  stopWatchingAssets?.()
  offConnected?.()
  offDisconnected?.()
  stopWatchingAssets = offConnected = offDisconnected = null
}

// ---------------- 启动时 ----------------

function init() {
  const account = localStorage.getItem(LS_ACCOUNT)
  if (account) {
    // 以前登录过：直接用本地数据开始，后台确认登录是否还有效（离线也能用）
    startEngine()
    session.set({ status: 'ready', username: account, expired: false, serverFound: true })
    void checkStillLoggedIn()
    return
  }
  void probe()
}

async function probe() {
  try {
    const me = await fetchMe()
    if (me.authenticated && me.username) {
      setAccount(me.username)
      startEngine()
      await waitWorkspaceIfEmpty()
      session.set({ status: 'ready', username: me.username, expired: false, serverFound: true })
    } else {
      const skip = isLocalhost && localStorage.getItem(LS_SKIP) === '1'
      session.set({ status: skip ? 'local' : 'login', username: null, expired: false, serverFound: true })
    }
  } catch {
    // 找不到服务器：只在本机使用
    session.set({ status: 'local', username: null, expired: false, serverFound: false })
  }
}

let lastCheck = 0
/** 同步连接断开时检查一下：如果是登录失效了，提示重新登录 */
async function checkStillLoggedIn() {
  const now = Date.now()
  if (now - lastCheck < 15_000) return
  lastCheck = now
  try {
    const me = await fetchMe()
    if (!me.authenticated && localStorage.getItem(LS_ACCOUNT)) {
      session.set((s) => ({ ...s, status: 'login', expired: true }))
    }
  } catch {
    // 离线：什么都不做，联网后会自动重连
  }
}

function setAccount(username: string) {
  localStorage.setItem(LS_ACCOUNT, username)
  localStorage.removeItem(LS_SKIP)
}

// ---------------- 操作 ----------------

export async function login(username: string, password: string) {
  const res = await api<{ username: string }>('/api/auth/login', { method: 'POST', json: { username, password } })
  const previous = localStorage.getItem(LS_ACCOUNT)
  if (previous && previous !== res.username) resetSyncRecords()
  setAccount(res.username)
  startEngine()
  reconnectNow()
  await waitWorkspaceIfEmpty()
  session.set({ status: 'ready', username: res.username, expired: false, serverFound: true })
}

/** 只在本机使用（仅 localhost 可选） */
export function skipLogin() {
  localStorage.setItem(LS_SKIP, '1')
  session.set((s) => ({ ...s, status: 'local' }))
}

/** 从"只在本机使用"切换到登录 */
export async function connectServer() {
  localStorage.removeItem(LS_SKIP)
  session.set((s) => ({ ...s, status: 'checking' }))
  await probe()
  if (session.get().status === 'local' && !session.get().serverFound) throw new OfflineError('连不上服务器')
}

/** 退出登录。clearLocal：同时删除这台设备上的所有笔记数据（服务器上的不受影响） */
export async function logout(clearLocal: boolean) {
  try {
    await api('/api/auth/logout', { method: 'POST', json: {} })
  } catch (err) {
    if (!(err instanceof OfflineError) && !(err instanceof ApiError)) throw err
  }
  stopEngine()
  resetSyncRecords()
  localStorage.removeItem(LS_ACCOUNT)
  localStorage.removeItem(LS_PENDING_DELETES)
  if (clearLocal) {
    await wipeLocalData()
    location.replace('/')
    return
  }
  session.set({ status: 'login', username: null, expired: false, serverFound: true })
}

async function wipeLocalData() {
  closeWorkspaceStorage()
  closeAllPageDocs()
  closeAssetDb()
  const dbs = (await indexedDB.databases?.()) ?? []
  await Promise.all(
    dbs
      .map((d) => d.name)
      .filter((name): name is string => !!name && name.startsWith('note:'))
      .map(
        (name) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name)
            req.onsuccess = req.onerror = req.onblocked = () => resolve()
          }),
      ),
  )
  for (const key of Object.keys(localStorage)) if (key.startsWith('note:')) localStorage.removeItem(key)
}

// ---------------- 永久删除页面：服务器上的副本也删掉 ----------------

function pendingDeletes(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LS_PENDING_DELETES) ?? '[]') as string[]
  } catch {
    return []
  }
}

export function deletePagesOnServer(ids: string[]) {
  ids.forEach(forgetPage)
  if (!localStorage.getItem(LS_ACCOUNT)) return
  localStorage.setItem(LS_PENDING_DELETES, JSON.stringify([...new Set([...pendingDeletes(), ...ids])]))
  // 先让工作区的删除传到服务器（服务器会确认工作区里已经没有这些页面）
  window.setTimeout(() => void flushPageDeletes(), 3000)
}

async function flushPageDeletes() {
  if (!isConnected()) return
  const left: string[] = []
  for (const id of pendingDeletes()) {
    try {
      await api(`/api/pages/${encodeURIComponent(id)}`, { method: 'DELETE' })
    } catch (err) {
      // 409：服务器上的工作区还没更新，下次再删；其它错误也留着下次
      if (!(err instanceof ApiError && err.status === 400)) left.push(id)
    }
  }
  localStorage.setItem(LS_PENDING_DELETES, JSON.stringify(left))
}

init()
