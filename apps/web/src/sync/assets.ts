import { assetsMap, getAssetBlob, listAssetIds, type RemoteAssetSource } from '../assets/assetStore'
import { ApiError, OfflineError, api } from './api'
import { isConnected, setPendingUploads } from './engine'

/**
 * 文件的上传和下载。
 * - 上传：问服务器本地哪些文件它还没有，逐个分片（8MB 一片）上传；传断了下次从断点继续
 * - 下载：本地没有的文件按需从服务器取（见 assetStore.getAssetUrl）
 */

const CHUNK = 8 * 1024 * 1024
/** 内容和 id 对不上之类、重试也没用的文件，本次打开网页期间不再重试 */
const failed = new Set<string>()

interface UploadState {
  done: boolean
  received: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function uploadOne(id: string) {
  const blob = await getAssetBlob(id)
  if (!blob) return
  const type = blob.type || assetsMap.get(id)?.mime || 'application/octet-stream'
  let state = await api<UploadState>(`/api/assets/${encodeURIComponent(id)}/upload`)
  let conflicts = 0
  while (!state.done) {
    const offset = Math.min(state.received, blob.size)
    const chunk = blob.slice(offset, offset + CHUNK)
    try {
      state = await api<UploadState>(`/api/assets/${encodeURIComponent(id)}?offset=${offset}&total=${blob.size}`, {
        method: 'PUT',
        body: chunk,
        headers: { 'Content-Type': 'application/octet-stream', 'X-Asset-Type': type },
      })
    } catch (err) {
      // 断点位置不一致（比如另一个标签页也在传）：按服务器说的位置继续
      if (err instanceof ApiError && err.status === 409 && conflicts++ < 20) {
        await sleep(1500)
        state = { done: false, received: typeof err.data.received === 'number' ? err.data.received : 0 }
        continue
      }
      throw err
    }
  }
}

let running = false
let again = false

/** 把服务器上还没有的本地文件传上去 */
export async function uploadMissing(): Promise<void> {
  if (!isConnected()) return
  if (running) {
    again = true
    return
  }
  running = true
  try {
    do {
      again = false
      await uploadPass()
    } while (again && isConnected())
  } catch (err) {
    if (!(err instanceof OfflineError)) console.warn('[sync] 上传文件失败', err)
    // 稍后再试
    window.setTimeout(() => void uploadMissing(), 60_000)
  } finally {
    running = false
  }
}

async function uploadPass() {
  const ids = (await listAssetIds()).filter((id) => !failed.has(id))
  const missing: string[] = []
  for (let i = 0; i < ids.length; i += 2000) {
    const res = await api<{ missing: string[] }>('/api/assets/missing', { method: 'POST', json: { ids: ids.slice(i, i + 2000) } })
    missing.push(...res.missing)
  }
  let remaining = missing.length
  setPendingUploads(remaining)
  for (const id of missing) {
    if (!isConnected()) break
    try {
      await uploadOne(id)
    } catch (err) {
      if (err instanceof ApiError && (err.status === 422 || err.status === 413 || err.status === 400)) {
        console.warn('[sync] 文件无法上传，跳过', id, err.message)
        failed.add(id)
      } else {
        throw err
      }
    }
    setPendingUploads(--remaining)
  }
}

let observeTimer: number | null = null
/** 新加了文件：稍后上传 */
export function watchLocalAssets(): () => void {
  const onChange = () => {
    if (observeTimer !== null) clearTimeout(observeTimer)
    observeTimer = window.setTimeout(() => {
      observeTimer = null
      void uploadMissing()
    }, 1500)
  }
  assetsMap.observe(onChange)
  return () => assetsMap.unobserve(onChange)
}

export const remoteAssetSource: RemoteAssetSource = {
  async download(id) {
    const res = await fetch(`/api/assets/${encodeURIComponent(id)}`, { credentials: 'same-origin' })
    if (!res.ok || res.headers.get('content-type')?.startsWith('text/html')) return null
    return res.blob()
  },
  streamUrl(id) {
    return `/api/assets/${encodeURIComponent(id)}`
  },
  async remove(ids) {
    for (const id of ids) await api(`/api/assets/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
}
