import http from 'node:http'
import type { Duplex } from 'node:stream'
import * as Y from 'yjs'
import { WebSocketServer, type WebSocket } from 'ws'
import { Hocuspocus } from '@hocuspocus/server'
import { config } from './config.ts'
import { getDb, closeDb } from './db.ts'
import { HttpError, originAllowed, sendJson } from './http.ts'
import { getSession, handleAuth, hasAnyUser, onSessionEnd, requireSession, sessionAlive } from './auth.ts'
import { handleAssets } from './assets.ts'
import { beforeStore, deleteHistory, handleHistory } from './history.ts'

/**
 * HTTP 接口 + Yjs 同步（WebSocket /sync）。
 * 文档名：工作区是 "workspace"，页面是 "page:<页面 id>"。
 */

const DOC_NAME_RE = /^(workspace|page:[A-Za-z0-9_-]{1,64})$/

/** 刚被永久删除的文档：一小段时间内不再保存，避免连接关闭时又被写回去 */
const recentlyDeleted = new Map<string, number>()

export function createServer() {
  const db = getDb()
  const selectDoc = db.prepare('SELECT data, updated_at FROM documents WHERE name = ?')
  const upsertDoc = db.prepare(
    `INSERT INTO documents (name, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  )

  const hocuspocus = new Hocuspocus({
    name: 'note',
    quiet: true,
    debounce: 2000,
    maxDebounce: 10000,
    timeout: 60_000,
    async onConnect({ documentName }) {
      if (!DOC_NAME_RE.test(documentName)) throw new Error('bad document name')
    },
    async onLoadDocument({ documentName, document }) {
      const row = selectDoc.get(documentName) as { data: Uint8Array } | undefined
      if (row) Y.applyUpdate(document, row.data)
    },
    async onStoreDocument({ documentName, document }) {
      const deletedAt = recentlyDeleted.get(documentName)
      if (deletedAt && Date.now() - deletedAt < 60_000) return
      const data = Y.encodeStateAsUpdate(document)
      const prev = selectDoc.get(documentName) as { data: Uint8Array; updated_at: number } | undefined
      try {
        beforeStore(documentName, prev)
      } catch (err) {
        console.error('[history] 保存快照失败', err)
      }
      upsertDoc.run(documentName, data, Date.now())
    },
  })

  /** 文档当前的完整状态（在内存里就取内存的，否则取数据库） */
  function currentState(name: string): Uint8Array | null {
    const doc = hocuspocus.documents.get(name)
    if (doc) return Y.encodeStateAsUpdate(doc)
    const row = selectDoc.get(name) as { data: Uint8Array } | undefined
    return row?.data ?? null
  }

  /** 永久删除页面在服务器上的数据（工作区里还有这个页面时拒绝） */
  function deletePage(pageId: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(pageId)) throw new HttpError(400, '页面 id 不对')
    const ws = currentState('workspace')
    if (ws) {
      const doc = new Y.Doc()
      Y.applyUpdate(doc, ws)
      const exists = doc.getMap('pages').has(pageId)
      doc.destroy()
      if (exists) throw new HttpError(409, '这个页面还在工作区里，不能删除')
    }
    const name = `page:${pageId}`
    recentlyDeleted.set(name, Date.now())
    hocuspocus.closeConnections(name)
    db.prepare('DELETE FROM documents WHERE name = ?').run(name)
    deleteHistory(name)
  }

  // ---------------- HTTP ----------------

  async function route(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (parts[0] !== 'api') throw new HttpError(404, '没有这个接口')
    const [, area, ...rest] = parts
    const method = req.method ?? 'GET'
    const writes = method !== 'GET' && method !== 'HEAD'
    // 修改类请求必须来自自己的网页（再加上 SameSite Cookie，双重防跨站）
    if (writes && !originAllowed(req)) throw new HttpError(403, '请求来源不被允许')

    if (area === 'health') return sendJson(res, 200, { ok: true, needsSetup: !hasAnyUser() })
    if (area === 'auth') return handleAuth(req, res, rest[0] ?? '')

    requireSession(req)
    if (area === 'assets') return handleAssets(req, res, rest, url)
    if (area === 'history') return handleHistory(req, res, rest, currentState)
    if (area === 'pages' && rest.length === 1 && method === 'DELETE') {
      deletePage(rest[0])
      return sendJson(res, 200, { deleted: true })
    }
    throw new HttpError(404, '没有这个接口')
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      if (!req.complete) req.resume()
      if (res.headersSent) {
        res.destroy()
        return
      }
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message, ...err.extra })
      } else {
        console.error(`[http] ${req.method} ${req.url}`, err)
        sendJson(res, 500, { error: '服务器出错了' })
      }
    })
  })
  server.requestTimeout = 10 * 60 * 1000

  // ---------------- WebSocket 同步 ----------------

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 })
  const sockets = new Map<WebSocket, string>()

  const reject = (socket: Duplex, status: number, text: string) => {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  }

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/sync') return reject(socket, 404, 'Not Found')
    if (!originAllowed(req)) return reject(socket, 403, 'Forbidden')
    const session = getSession(req)
    if (!session) return reject(socket, 401, 'Unauthorized')

    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.set(ws, session.tokenHash)
      const request = { url: req.url, headers: new Headers() } as unknown as Request
      const connection = hocuspocus.handleConnection(ws, request, { username: session.username })
      let alive = true
      ws.on('message', (data: Buffer) => {
        alive = true
        connection.handleMessage(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
      })
      ws.on('pong', () => {
        alive = true
        connection.touch()
      })
      ws.on('close', (code, reason) => {
        sockets.delete(ws)
        clearInterval(ping)
        connection.handleClose({ code, reason: reason.toString() })
      })
      ws.on('error', (err) => console.error('[sync] websocket 出错', err.message))
      const ping = setInterval(() => {
        if (!alive) return ws.terminate()
        alive = false
        ws.ping()
      }, 20_000)
    })
  })

  // 退出登录或改密码后，断开对应的同步连接
  onSessionEnd((tokenHash) => {
    for (const [ws, hash] of sockets) if (hash === tokenHash) ws.close(4401, 'logged out')
  })
  const sessionCheck = setInterval(() => {
    for (const [ws, hash] of sockets) if (!sessionAlive(hash)) ws.close(4401, 'session expired')
  }, 60_000)

  async function shutdown() {
    clearInterval(sessionCheck)
    server.close()
    for (const ws of sockets.keys()) ws.close(1012, 'restarting')
    hocuspocus.flushPendingStores()
    // 等正在进行的保存完成
    const deadline = Date.now() + 5000
    while (hocuspocus.getDocumentsCount() > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100))
    }
    closeDb()
  }

  return {
    listen: () =>
      new Promise<void>((resolve) => {
        server.listen(config.port, config.host, () => resolve())
      }),
    shutdown,
  }
}
