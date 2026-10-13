import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getDb } from './db.ts'
import { config, paths } from './config.ts'
import { HttpError, readJson, sendJson } from './http.ts'

/**
 * 文件（图片、视频等）：
 * - id 是内容的 SHA-256（64 位十六进制），服务器收完后会重新计算核对；同一个文件只存一份
 * - 分片上传：每片最多 16MB，传断了可以从断点继续（GET .../upload 查已收到多少）
 * - 下载支持 Range，视频可以拖动进度条
 * - 删除只是挪到 assets-trash 目录，30 天后才真正删掉（见 backup.ts）
 */

const ID_RE = /^[A-Za-z0-9_-]{16,64}$/
const SHA256_RE = /^[0-9a-f]{64}$/
export const MAX_CHUNK = 16 * 1024 * 1024

export function assetFile(id: string) {
  return path.join(paths.assets(), id.slice(0, 2), id)
}
const partFile = (id: string) => path.join(paths.uploads(), `${id}.part`)

function checkId(id: string) {
  if (!ID_RE.test(id)) throw new HttpError(400, '文件 id 不对')
}

interface AssetRow {
  id: string
  size: number
  mime: string
}

function getRow(id: string): AssetRow | undefined {
  return getDb().prepare('SELECT id, size, mime FROM assets WHERE id = ?').get(id) as AssetRow | undefined
}

async function fileSize(file: string): Promise<number> {
  try {
    return (await fsp.stat(file)).size
  } catch {
    return 0
  }
}

async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  await pipeline(fs.createReadStream(file), hash)
  return hash.digest('hex')
}

function cleanMime(value: unknown): string {
  const mime = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) && mime.length < 100 ? mime : 'application/octet-stream'
}

/** 同一个文件同时只处理一个上传请求 */
const busy = new Set<string>()

async function handleUpload(req: IncomingMessage, res: ServerResponse, id: string, url: URL) {
  const offset = Number(url.searchParams.get('offset'))
  const total = Number(url.searchParams.get('total'))
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(total) || offset < 0 || total < 0 || offset > total) {
    throw new HttpError(400, 'offset/total 不对')
  }
  if (total > config.maxAssetBytes) throw new HttpError(413, '文件太大')
  if (getRow(id)) {
    req.resume()
    sendJson(res, 200, { done: true, received: total })
    return
  }
  if (busy.has(id)) {
    req.resume()
    throw new HttpError(409, '这个文件正在上传', { received: await fileSize(partFile(id)) })
  }
  busy.add(id)
  try {
    const part = partFile(id)
    const received = await fileSize(part)
    if (received !== offset) {
      req.resume()
      throw new HttpError(409, '断点位置不一致', { received })
    }
    if (offset === 0) {
      const { bavail, bsize } = fs.statfsSync(config.dataDir)
      if (bavail * bsize < total + 1024 * 1024 * 1024) throw new HttpError(507, '服务器磁盘空间不足')
    }
    const length = Number(req.headers['content-length'])
    if (!Number.isSafeInteger(length) || length > MAX_CHUNK || offset + length > total) {
      req.resume()
      throw new HttpError(400, '分片大小不对')
    }
    await fsp.mkdir(paths.uploads(), { recursive: true })
    await pipeline(req, fs.createWriteStream(part, { flags: 'a' }))
    const now = await fileSize(part)
    if (now !== offset + length) {
      // 连接中途断了：截掉不完整的部分，下次从 offset 重新传
      await fsp.truncate(part, offset)
      throw new HttpError(400, '分片没有传完整', { received: offset })
    }
    if (now < total) {
      sendJson(res, 200, { done: false, received: now })
      return
    }
    // 收齐了：核对内容哈希
    if (SHA256_RE.test(id)) {
      const actual = await sha256File(part)
      if (actual !== id) {
        await fsp.rm(part, { force: true })
        throw new HttpError(422, '文件内容和 id 对不上，已丢弃，请重新上传')
      }
    }
    const target = assetFile(id)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.rename(part, target)
    getDb()
      .prepare('INSERT OR IGNORE INTO assets (id, size, mime, created_at) VALUES (?, ?, ?, ?)')
      .run(id, total, cleanMime(req.headers['x-asset-type']), Date.now())
    sendJson(res, 200, { done: true, received: total })
  } finally {
    busy.delete(id)
  }
}

async function handleDownload(req: IncomingMessage, res: ServerResponse, id: string) {
  const row = getRow(id)
  if (!row) throw new HttpError(404, '服务器上没有这个文件')
  const file = assetFile(id)
  let stat: fs.Stats
  try {
    stat = await fsp.stat(file)
  } catch {
    throw new HttpError(404, '服务器上没有这个文件')
  }
  const headers: Record<string, string | number> = {
    'Content-Type': row.mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
    ETag: `"${id}"`,
    // 防止上传的 HTML/SVG 被直接打开时执行脚本
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
  }
  if (req.headers['if-none-match'] === `"${id}"`) {
    res.writeHead(304, headers)
    res.end()
    return
  }
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/)
  if (range && (range[1] || range[2])) {
    let start: number
    let end: number
    if (range[1]) {
      start = Number(range[1])
      end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1
    } else {
      start = Math.max(0, stat.size - Number(range[2]))
      end = stat.size - 1
    }
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` })
      res.end()
      return
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 })
    if (req.method === 'HEAD') return void res.end()
    await pipeline(fs.createReadStream(file, { start, end }), res).catch(() => {})
    return
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size })
  if (req.method === 'HEAD') return void res.end()
  await pipeline(fs.createReadStream(file), res).catch(() => {})
}

async function handleDelete(res: ServerResponse, id: string) {
  const file = assetFile(id)
  if (getRow(id)) {
    await fsp.mkdir(paths.assetTrash(), { recursive: true })
    await fsp.rename(file, path.join(paths.assetTrash(), id)).catch(() => {})
    getDb().prepare('DELETE FROM assets WHERE id = ?').run(id)
  }
  sendJson(res, 200, { deleted: true })
}

/** /api/assets/... */
export async function handleAssets(req: IncomingMessage, res: ServerResponse, rest: string[], url: URL) {
  const method = req.method ?? 'GET'

  // 批量查询哪些文件服务器上还没有
  if (rest.length === 1 && rest[0] === 'missing' && method === 'POST') {
    const body = await readJson<{ ids?: unknown }>(req)
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && ID_RE.test(x)) : []
    if (ids.length > 5000) throw new HttpError(400, '一次最多查 5000 个')
    const stmt = getDb().prepare('SELECT 1 FROM assets WHERE id = ?')
    sendJson(res, 200, { missing: ids.filter((id) => !stmt.get(id)) })
    return
  }

  const id = rest[0] ?? ''
  checkId(id)

  if (rest.length === 2 && rest[1] === 'upload' && method === 'GET') {
    const done = !!getRow(id)
    sendJson(res, 200, { done, received: done ? getRow(id)!.size : await fileSize(partFile(id)) })
    return
  }
  if (rest.length !== 1) throw new HttpError(404, '没有这个接口')
  if (method === 'PUT') return handleUpload(req, res, id, url)
  if (method === 'GET' || method === 'HEAD') return handleDownload(req, res, id)
  if (method === 'DELETE') return handleDelete(res, id)
  throw new HttpError(405, '不支持的请求')
}
