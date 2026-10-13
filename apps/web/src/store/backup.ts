import * as Y from 'yjs'
import { pagesMap, workspaceDoc } from './workspace'
import { withPageDoc } from './docPool'
import { base64ToUint8, uint8ToBase64 } from '../lib/format'
import {
  assetsMap,
  deleteAssets,
  getAssetBlob,
  getAssetBlobAnywhere,
  listAssetIds,
  putAssetBlob,
} from '../assets/assetStore'
import { isConnected, isRunning, waitAllSynced } from '../sync/engine'

/**
 * 备份文件（.notebak）格式：
 *   8 字节 "NOTEBAK2" + 4 字节 JSON 长度 + JSON + 各个资源文件的原始二进制
 * JSON 里是工作区和每个页面的 Yjs 完整状态（base64），以及资源文件在文件里的位置。
 * 导入时是"合并"而不是"覆盖"：同一份备份导入多次不会重复。
 * 旧版的 .json 备份（只有文字，没有资源文件）也能导入。
 */

const MAGIC = 'NOTEBAK2'
export const BACKUP_EXTENSION = '.notebak'

interface BackupJson {
  format: 'note-backup'
  version: 1 | 2
  exportedAt: number
  workspace: string
  pages: Record<string, string>
  assets?: Record<string, { offset: number; size: number; type: string }>
}

async function collectDocs(): Promise<Pick<BackupJson, 'workspace' | 'pages'>> {
  const pages: Record<string, string> = {}
  for (const id of [...pagesMap.keys()]) {
    pages[id] = await withPageDoc(id, (doc) => uint8ToBase64(Y.encodeStateAsUpdate(doc)))
  }
  return { workspace: uint8ToBase64(Y.encodeStateAsUpdate(workspaceDoc)), pages }
}

/**
 * 同步开着时，先等本机和服务器对齐，保证导出的是完整的数据：
 * 新设备上可能还有页面没下载下来，文件也只缓存了看过的那些（缺的会从服务器下载）。
 */
async function ensureComplete(action: string) {
  if (!isRunning()) return
  if (!isConnected()) throw new Error(`现在连不上服务器，这台设备上的数据可能不完整。请联网、等顶栏显示“已同步”后再${action}`)
  if (!(await waitAllSynced(60_000))) throw new Error(`还有数据没同步完，请等顶栏显示“已同步”后再${action}`)
}

export async function exportBackup(): Promise<Blob> {
  await ensureComplete('导出')
  const docs = await collectDocs()
  const assets: NonNullable<BackupJson['assets']> = {}
  const parts: Blob[] = []
  let offset = 0
  const ids = new Set([...(await listAssetIds()), ...(isRunning() ? assetsMap.keys() : [])])
  for (const id of ids) {
    const blob = await getAssetBlobAnywhere(id)
    if (!blob) continue
    assets[id] = { offset, size: blob.size, type: blob.type }
    parts.push(blob)
    offset += blob.size
  }
  const json = new TextEncoder().encode(
    JSON.stringify({ format: 'note-backup', version: 2, exportedAt: Date.now(), ...docs, assets } satisfies BackupJson),
  )
  const header = new Uint8Array(12)
  header.set(new TextEncoder().encode(MAGIC), 0)
  new DataView(header.buffer).setUint32(8, json.length)
  return new Blob([header, json, ...parts], { type: 'application/octet-stream' })
}

function applyDocs(data: BackupJson) {
  Y.applyUpdate(workspaceDoc, base64ToUint8(data.workspace))
}

export async function importBackup(file: File): Promise<{ pages: number; assets: number }> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const isV2 = new TextDecoder().decode(head.slice(0, 8)) === MAGIC
  let data: BackupJson
  let base = 0
  try {
    if (isV2) {
      const length = new DataView(head.buffer).getUint32(8)
      data = JSON.parse(await file.slice(12, 12 + length).text())
      base = 12 + length
    } else {
      data = JSON.parse(await file.text())
    }
  } catch {
    throw new Error('这个文件不是有效的备份文件')
  }
  if (data?.format !== 'note-backup') throw new Error('这个文件不是本应用导出的备份文件')

  // 先放资源文件，再合并页面，这样页面一出现图片就能显示
  let assetCount = 0
  for (const [id, info] of Object.entries(data.assets ?? {})) {
    await putAssetBlob(id, file.slice(base + info.offset, base + info.offset + info.size, info.type))
    assetCount++
  }
  applyDocs(data)
  const ids = Object.keys(data.pages ?? {})
  for (const id of ids) {
    await withPageDoc(id, (doc) => Y.applyUpdate(doc, base64ToUint8(data.pages[id])))
  }
  return { pages: ids.length, assets: assetCount }
}

// ---------------- 清理没被任何页面用到的资源文件 ----------------

function collectAssetIds(node: Y.XmlFragment | Y.XmlElement, used: Set<string>) {
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlElement) {
      const id = child.getAttribute('assetId')
      if (typeof id === 'string' && id) used.add(id)
      collectAssetIds(child, used)
    }
  }
}

export async function findUnusedAssets(): Promise<{ ids: string[]; bytes: number }> {
  // 必须所有页面都在本机且是最新的，否则会把别的设备上正在用的文件当成没用
  await ensureComplete('检查')
  const used = new Set<string>()
  // 回收站里的页面也算在用
  for (const id of [...pagesMap.keys()]) {
    await withPageDoc(id, (doc) => {
      // 文档正文
      collectAssetIds(doc.getXmlFragment('content'), used)
      // 画布元素（图片、文件元素，以及文字卡片里的内容）
      doc.getMap('elements').forEach((el) => {
        if (!(el instanceof Y.Map)) return
        const assetId = el.get('assetId')
        if (typeof assetId === 'string' && assetId) used.add(assetId)
        const content = el.get('content')
        if (content instanceof Y.XmlFragment) collectAssetIds(content, used)
      })
    })
  }
  const stored = new Set([...(await listAssetIds()), ...assetsMap.keys()])
  const ids = [...stored].filter((id) => !used.has(id))
  let bytes = 0
  for (const id of ids) bytes += assetsMap.get(id)?.size ?? (await getAssetBlob(id))?.size ?? 0
  return { ids, bytes }
}

export async function removeUnusedAssets(ids: string[]) {
  await deleteAssets(ids)
}
