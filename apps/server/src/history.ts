import crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getDb } from './db.ts'
import { HttpError, sendJson } from './http.ts'

/**
 * 页面历史版本。
 * 每次保存页面时，如果离上一个快照已经超过 10 分钟，就把"上一次保存的状态"存成快照
 * （也就是这段编辑开始之前的样子），时间记成它当时的保存时间。
 * 越旧的快照保留得越稀：1 天内全留，7 天内每小时留一个，90 天内每天一个，再早每周一个。
 */

const INTERVAL = 10 * 60 * 1000
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const hashOf = (data: Uint8Array) => crypto.createHash('sha256').update(data).digest('hex')

export function isPageDoc(name: string) {
  return name.startsWith('page:')
}

function lastSnapshot(name: string) {
  return getDb()
    .prepare('SELECT created_at, hash FROM snapshots WHERE name = ? ORDER BY created_at DESC, id DESC LIMIT 1')
    .get(name) as { created_at: number; hash: string } | undefined
}

function insert(name: string, data: Uint8Array, createdAt: number): boolean {
  const hash = hashOf(data)
  const last = lastSnapshot(name)
  if (last?.hash === hash) return false
  getDb()
    .prepare('INSERT INTO snapshots (name, created_at, data, size, hash) VALUES (?, ?, ?, ?, ?)')
    .run(name, createdAt, data, data.length, hash)
  prune(name)
  return true
}

/** 保存文档前调用：prev 是数据库里旧的状态 */
export function beforeStore(name: string, prev: { data: Uint8Array; updated_at: number } | undefined) {
  if (!isPageDoc(name) || !prev) return
  const last = lastSnapshot(name)
  if (last && Date.now() - last.created_at < INTERVAL) return
  insert(name, prev.data, prev.updated_at)
}

/** 立即存一个快照（恢复旧版本之前调用，保证"恢复前"的样子也能找回来） */
export function checkpoint(name: string, data: Uint8Array): boolean {
  return insert(name, data, Date.now())
}

function prune(name: string) {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, created_at FROM snapshots WHERE name = ? ORDER BY created_at DESC, id DESC')
    .all(name) as { id: number; created_at: number }[]
  const now = Date.now()
  const seen = new Set<string>()
  const remove: number[] = []
  for (const row of rows) {
    const age = now - row.created_at
    if (age < DAY) continue
    const bucket =
      age < 7 * DAY
        ? `h${Math.floor(row.created_at / HOUR)}`
        : age < 90 * DAY
          ? `d${Math.floor(row.created_at / DAY)}`
          : `w${Math.floor(row.created_at / (7 * DAY))}`
    if (seen.has(bucket)) remove.push(row.id)
    else seen.add(bucket)
  }
  const del = db.prepare('DELETE FROM snapshots WHERE id = ?')
  for (const id of remove) del.run(id)
}

export function deleteHistory(name: string) {
  getDb().prepare('DELETE FROM snapshots WHERE name = ?').run(name)
}

/** /api/history/<pageId>[/<snapshotId>] */
export function handleHistory(
  req: IncomingMessage,
  res: ServerResponse,
  rest: string[],
  currentState: (name: string) => Uint8Array | null,
) {
  const [pageId, snapshotId] = rest
  if (!pageId || !/^[A-Za-z0-9_-]{1,64}$/.test(pageId)) throw new HttpError(400, '页面 id 不对')
  const name = `page:${pageId}`
  const db = getDb()

  if (req.method === 'GET' && rest.length === 1) {
    const rows = db
      .prepare('SELECT id, created_at, size FROM snapshots WHERE name = ? ORDER BY created_at DESC, id DESC')
      .all(name) as { id: number; created_at: number; size: number }[]
    sendJson(res, 200, { snapshots: rows.map((r) => ({ id: r.id, createdAt: r.created_at, size: r.size })) })
    return
  }

  if (req.method === 'GET' && rest.length === 2) {
    const row = db.prepare('SELECT data FROM snapshots WHERE id = ? AND name = ?').get(Number(snapshotId), name) as
      | { data: Uint8Array }
      | undefined
    if (!row) throw new HttpError(404, '没有这个版本')
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': row.data.length,
      'Cache-Control': 'private, max-age=31536000, immutable',
    })
    res.end(Buffer.from(row.data))
    return
  }

  if (req.method === 'POST' && rest.length === 2 && snapshotId === 'checkpoint') {
    const data = currentState(name)
    const created = data ? checkpoint(name, data) : false
    sendJson(res, 200, { created })
    return
  }

  throw new HttpError(404, '没有这个接口')
}
