import crypto from 'node:crypto'
import { promisify } from 'node:util'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getDb } from './db.ts'
import { config } from './config.ts'
import { HttpError, clientIp, parseCookies, readJson, sendJson } from './http.ts'

/**
 * 登录：账号密码 + 长期有效的 Cookie。
 * - 密码用 scrypt 加盐哈希保存，不存原文
 * - Cookie 里是随机令牌，数据库只存它的 SHA-256；HttpOnly + SameSite=Lax + Secure
 * - 登录失败限流：同一 IP 连续失败 5 次锁 15 分钟（再失败时间翻倍，最多 24 小时）；
 *   所有 IP 合计一小时失败 30 次，暂停登录一小时
 */

export const COOKIE_NAME = 'note_session'
const SESSION_DAYS = 365
const DAY = 24 * 60 * 60 * 1000

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(password.normalize('NFKC'), salt, 32, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$')
  if (kind !== 'scrypt') return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  })
  return crypto.timingSafeEqual(expected, actual)
}

// 用户不存在时也算一遍哈希，避免通过响应时间判断用户名是否存在
let dummyHash: Promise<string> | null = null

export async function setPassword(username: string, password: string) {
  const hash = await hashPassword(password)
  const db = getDb()
  db.prepare(
    `INSERT INTO users (username, password_hash, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at`,
  ).run(username, hash, Date.now())
  // 改密码后，所有设备都要重新登录
  db.prepare('DELETE FROM sessions WHERE username = ?').run(username)
}

export function hasAnyUser(): boolean {
  return !!getDb().prepare('SELECT 1 FROM users LIMIT 1').get()
}

// ---------------- 会话 ----------------

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

export interface Session {
  tokenHash: string
  username: string
}

function sessionCookie(token: string, maxAgeSeconds: number): string {
  return [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(config.cookieSecure ? ['Secure'] : []),
  ].join('; ')
}

function createSession(username: string, userAgent: string | undefined): string {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  getDb()
    .prepare(
      'INSERT INTO sessions (token_hash, username, created_at, last_seen, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(sha256(token), username, now, now, now + SESSION_DAYS * DAY, (userAgent ?? '').slice(0, 300))
  return token
}

/** 从请求的 Cookie 里找出有效的会话；顺便延长有效期（每天最多更新一次） */
export function getSession(req: IncomingMessage): Session | null {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME]
  if (!token || token.length > 100) return null
  const tokenHash = sha256(token)
  const db = getDb()
  const row = db
    .prepare('SELECT username, last_seen, expires_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash) as { username: string; last_seen: number; expires_at: number } | undefined
  if (!row) return null
  const now = Date.now()
  if (row.expires_at < now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
    return null
  }
  if (now - row.last_seen > DAY) {
    db.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?').run(
      now,
      now + SESSION_DAYS * DAY,
      tokenHash,
    )
  }
  return { tokenHash, username: row.username }
}

/** 会话是否还有效（同步连接定期检查，改密码后旧连接会被断开） */
export function sessionAlive(tokenHash: string): boolean {
  const row = getDb().prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(tokenHash) as
    | { expires_at: number }
    | undefined
  return !!row && row.expires_at > Date.now()
}

export function requireSession(req: IncomingMessage): Session {
  const session = getSession(req)
  if (!session) throw new HttpError(401, '请先登录')
  return session
}

/** 会话被删除时（退出登录、改密码）通知同步连接断开 */
const sessionEndListeners = new Set<(tokenHash: string) => void>()
export function onSessionEnd(listener: (tokenHash: string) => void) {
  sessionEndListeners.add(listener)
}

// ---------------- 登录限流 ----------------

const IP_MAX_FAILS = 5
const IP_LOCK_MS = 15 * 60 * 1000
const GLOBAL_MAX_FAILS = 30
const GLOBAL_WINDOW_MS = 60 * 60 * 1000

const ipState = new Map<string, { fails: number; lockedUntil: number; lockCount: number }>()
let globalFails: number[] = []

function lockedFor(ip: string, now: number): number {
  const s = ipState.get(ip)
  if (s && s.lockedUntil > now) return s.lockedUntil - now
  globalFails = globalFails.filter((t) => now - t < GLOBAL_WINDOW_MS)
  if (globalFails.length >= GLOBAL_MAX_FAILS) return globalFails[0] + GLOBAL_WINDOW_MS - now
  return 0
}

function recordFailure(ip: string, now: number) {
  globalFails.push(now)
  const s = ipState.get(ip) ?? { fails: 0, lockedUntil: 0, lockCount: 0 }
  s.fails++
  if (s.fails >= IP_MAX_FAILS) {
    s.lockedUntil = now + Math.min(IP_LOCK_MS * 2 ** s.lockCount, DAY)
    s.lockCount++
    s.fails = 0
  }
  ipState.set(ip, s)
  if (ipState.size > 10_000) {
    for (const [key, value] of ipState) if (value.lockedUntil < now) ipState.delete(key)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------- 接口 ----------------

export async function handleAuth(req: IncomingMessage, res: ServerResponse, action: string) {
  if (action === 'me' && req.method === 'GET') {
    const session = getSession(req)
    sendJson(res, 200, { app: 'note', authenticated: !!session, username: session?.username ?? null })
    return
  }

  if (action === 'login' && req.method === 'POST') {
    const ip = clientIp(req)
    const now = Date.now()
    const wait = lockedFor(ip, now)
    if (wait > 0) {
      const minutes = Math.ceil(wait / 60000)
      throw new HttpError(429, `尝试次数太多，请 ${minutes} 分钟后再试`, { retryAfter: Math.ceil(wait / 1000) })
    }
    const body = await readJson<{ username?: unknown; password?: unknown }>(req, 4096)
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const row = getDb().prepare('SELECT password_hash FROM users WHERE username = ?').get(username) as
      | { password_hash: string }
      | undefined
    let ok = false
    if (row) ok = await verifyPassword(password, row.password_hash)
    else await verifyPassword(password, await (dummyHash ??= hashPassword('dummy-password')))
    if (!ok || !username || !password) {
      recordFailure(ip, now)
      console.warn(`[auth] 登录失败 ip=${ip} user=${JSON.stringify(username.slice(0, 40))}`)
      await sleep(400 + Math.random() * 400)
      throw new HttpError(401, '用户名或密码不对')
    }
    ipState.delete(ip)
    const token = createSession(username, req.headers['user-agent'])
    console.log(`[auth] 登录成功 ip=${ip} user=${username}`)
    sendJson(res, 200, { authenticated: true, username }, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) })
    return
  }

  if (action === 'logout' && req.method === 'POST') {
    const session = getSession(req)
    if (session) {
      getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.tokenHash)
      sessionEndListeners.forEach((l) => l(session.tokenHash))
    }
    sendJson(res, 200, { authenticated: false }, { 'Set-Cookie': sessionCookie('', 0) })
    return
  }

  throw new HttpError(404, '没有这个接口')
}
