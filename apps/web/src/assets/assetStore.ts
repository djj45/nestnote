import { useEffect, useState, useSyncExternalStore } from 'react'
import { nanoid } from 'nanoid'
import { workspaceDoc } from '../store/workspace'

/**
 * 资源（图片、视频、文件）：
 * - 二进制按内容哈希存在 IndexedDB（同一个文件贴多次只存一份）
 * - 元信息（文件名、类型、大小、宽高）存在工作区的 Yjs 文档里，以后会随同步到其它设备
 */

export interface AssetMeta {
  id: string
  name: string
  mime: string
  size: number
  width?: number
  height?: number
  createdAt: number
}

export type AssetKind = 'image' | 'video' | 'audio' | 'file'

export const assetsMap = workspaceDoc.getMap<AssetMeta>('assets')

/** 浏览器能直接显示的图片格式（HEIC、TIFF 之类按普通文件处理） */
const DISPLAYABLE_IMAGES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
])

export function kindForMime(mime: string): AssetKind {
  if (DISPLAYABLE_IMAGES.has(mime)) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'file'
}

// ---------- IndexedDB ----------

const DB_NAME = 'note:assets'
const STORE = 'blobs'
let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

/** 删除本机数据前关闭数据库连接 */
export function closeAssetDb() {
  dbPromise?.then((db) => db.close()).catch(() => {})
  dbPromise = null
}

async function request<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function getAssetBlob(id: string): Promise<Blob | undefined> {
  return request<Blob | undefined>('readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>)
}

export function putAssetBlob(id: string, blob: Blob): Promise<IDBValidKey> {
  return request('readwrite', (s) => s.put(blob, id))
}

async function hasAssetBlob(id: string): Promise<boolean> {
  const count = await request<number>('readonly', (s) => s.count(id))
  return count > 0
}

export function deleteAssetBlob(id: string): Promise<undefined> {
  return request('readwrite', (s) => s.delete(id))
}

/** 删除资源（二进制和元信息） */
export async function deleteAssets(ids: string[]) {
  if (remote && ids.length) await remote.remove(ids)
  for (const id of ids) {
    await deleteAssetBlob(id)
    const url = urlCache.get(id)
    if (url) {
      urlCache.delete(id)
      url.then((u) => u && URL.revokeObjectURL(u))
    }
  }
  workspaceDoc.transact(() => {
    for (const id of ids) assetsMap.delete(id)
  })
}

export function listAssetIds(): Promise<string[]> {
  return request<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).then((keys) => keys.map(String))
}

// ---------- 写入 ----------

async function contentId(blob: Blob): Promise<string> {
  // crypto.subtle 只在 https 或 localhost 下可用；其它情况退回随机 id
  if (!globalThis.crypto?.subtle) return nanoid(24)
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function imageSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      resolve(null)
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}

function videoSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.preload = 'metadata'
    const done = (value: { width: number; height: number } | null) => {
      resolve(value)
      URL.revokeObjectURL(url)
    }
    video.onloadedmetadata = () => done({ width: video.videoWidth, height: video.videoHeight })
    video.onerror = () => done(null)
    video.src = url
  })
}

/** 保存一个文件，返回它的元信息（已存在则直接返回） */
export async function addAsset(blob: Blob, name?: string): Promise<AssetMeta> {
  const id = await contentId(blob)
  if (!(await hasAssetBlob(id))) await putAssetBlob(id, blob)
  const existing = assetsMap.get(id)
  if (existing) return existing
  const mime = blob.type || 'application/octet-stream'
  const meta: AssetMeta = {
    id,
    name: name ?? (blob instanceof File ? blob.name : '') ?? '',
    mime,
    size: blob.size,
    createdAt: Date.now(),
  }
  if (!meta.name) meta.name = kindForMime(mime) === 'image' ? '图片' : '未命名文件'
  const kind = kindForMime(mime)
  const dims = kind === 'image' ? await imageSize(blob) : kind === 'video' ? await videoSize(blob) : null
  if (dims) Object.assign(meta, dims)
  assetsMap.set(id, meta)
  return meta
}

// ---------- 服务器 ----------

/**
 * 登录服务器后由同步模块提供：本地没有的文件从服务器下载（下载后缓存在本地）。
 */
export interface RemoteAssetSource {
  download(id: string): Promise<Blob | null>
  /** 大视频直接边下边播，不缓存 */
  streamUrl(id: string): string
  remove(ids: string[]): Promise<void>
}

let remote: RemoteAssetSource | null = null
const STREAM_THRESHOLD = 50 * 1024 * 1024

export function setRemoteAssetSource(source: RemoteAssetSource | null) {
  remote = source
}

export function hasRemoteAssets() {
  return remote !== null
}

/** 文件不在本机时的说明 */
export function missingAssetHint(): string {
  return remote ? '还没下载到这台设备，联网后会自动显示' : '不在这个浏览器里'
}

/** 本地没有就从服务器下载并缓存 */
export async function getAssetBlobAnywhere(id: string): Promise<Blob | undefined> {
  const local = await getAssetBlob(id)
  if (local || !remote) return local
  const fetched = await remote.download(id).catch(() => null)
  if (!fetched) return undefined
  const mime = assetsMap.get(id)?.mime
  const blob = mime && fetched.type !== mime ? new Blob([fetched], { type: mime }) : fetched
  await putAssetBlob(id, blob).catch(() => {})
  return blob
}

// ---------- 读取 ----------

const urlCache = new Map<string, Promise<string | null>>()

async function resolveAssetUrl(id: string): Promise<string | null> {
  const local = await getAssetBlob(id)
  if (local) return URL.createObjectURL(local)
  if (!remote) return null
  const meta = assetsMap.get(id)
  const kind = meta ? kindForMime(meta.mime) : 'file'
  if (meta && (kind === 'video' || kind === 'audio') && meta.size > STREAM_THRESHOLD) return remote.streamUrl(id)
  const blob = await getAssetBlobAnywhere(id)
  return blob ? URL.createObjectURL(blob) : null
}

export function getAssetUrl(id: string): Promise<string | null> {
  let cached = urlCache.get(id)
  if (!cached) {
    cached = resolveAssetUrl(id).catch(() => null)
    urlCache.set(id, cached)
    // 没找到的不缓存，以后同步下来了还能再取
    cached.then((url) => {
      if (!url) urlCache.delete(id)
    })
  }
  return cached
}

function subscribeAssets(listener: () => void) {
  assetsMap.observe(listener)
  return () => assetsMap.unobserve(listener)
}

export function useAssetMeta(id: string | null): AssetMeta | undefined {
  return useSyncExternalStore(subscribeAssets, () => (id ? assetsMap.get(id) : undefined))
}

export type AssetStatus = 'loading' | 'ready' | 'missing'

const RETRY_DELAYS = [3000, 10000, 30000, 60000, 120000, 300000]

export function useAssetUrl(id: string | null): { url: string | null; status: AssetStatus } {
  const [state, setState] = useState<{ id: string | null; url: string | null; status: AssetStatus }>({
    id: null,
    url: null,
    status: 'loading',
  })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!id) {
      setState({ id, url: null, status: 'missing' })
      return
    }
    let alive = true
    let timer: number | null = null
    getAssetUrl(id).then((url) => {
      if (!alive) return
      setState({ id, url, status: url ? 'ready' : 'missing' })
      // 服务器上暂时还没有（别的设备还没传完）：过一会儿再试
      if (!url && hasRemoteAssets()) {
        timer = window.setTimeout(() => setAttempt((n) => n + 1), RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)])
      }
    })
    return () => {
      alive = false
      if (timer !== null) clearTimeout(timer)
    }
  }, [id, attempt])
  return state.id === id ? { url: state.url, status: state.status } : { url: null, status: 'loading' }
}

/** 打开系统的文件选择框 */
export function pickFiles(accept?: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    if (accept) input.accept = accept
    input.style.display = 'none'
    input.addEventListener('change', () => {
      resolve([...(input.files ?? [])])
      input.remove()
    })
    input.addEventListener('cancel', () => {
      resolve([])
      input.remove()
    })
    document.body.appendChild(input)
    input.click()
  })
}
