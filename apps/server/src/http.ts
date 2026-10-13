import type { IncomingMessage, ServerResponse } from 'node:http'
import { config } from './config.ts'

export class HttpError extends Error {
  status: number
  extra?: Record<string, unknown>
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) {
  const data = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(data)
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpError(413, '请求太大')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

export async function readJson<T>(req: IncomingMessage, limit = 1024 * 1024): Promise<T> {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, '需要 JSON')
  }
  try {
    return JSON.parse((await readBody(req, limit)).toString('utf8')) as T
  } catch (err) {
    if (err instanceof HttpError) throw err
    throw new HttpError(400, 'JSON 格式不对')
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!header) return result
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const key = part.slice(0, i).trim()
    const value = part.slice(i + 1).trim()
    if (key && !(key in result)) {
      try {
        result[key] = decodeURIComponent(value)
      } catch {
        result[key] = value
      }
    }
  }
  return result
}

export function clientIp(req: IncomingMessage): string {
  if (config.trustProxy) {
    const real = req.headers['x-real-ip']
    if (typeof real === 'string' && real) return real
  }
  return req.socket.remoteAddress ?? 'unknown'
}

/** 请求是否来自允许的网页（防跨站请求）。没有 Origin 的（比如 curl）一律不算 */
export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  return typeof origin === 'string' && config.origins.includes(origin.replace(/\/+$/, ''))
}
