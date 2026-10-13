/**
 * 和服务器通信的小工具。服务器和网页同域名（开发时由 Vite 转发），所以都用相对路径。
 */

export class ApiError extends Error {
  status: number
  data: Record<string, unknown>
  constructor(status: number, message: string, data: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.data = data
  }
}

/** 连不上服务器（断网、服务器没开、开发时没有配置服务器） */
export class OfflineError extends Error {}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const headers = new Headers(rest.headers)
  if (json !== undefined) headers.set('Content-Type', 'application/json')
  let res: Response
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...rest,
      headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
  } catch {
    throw new OfflineError('连不上服务器')
  }
  const isJson = res.headers.get('content-type')?.includes('application/json')
  // 开发时没有服务器，Vite 会返回网页或者 5xx 错误
  if (!isJson) {
    if (res.ok) throw new OfflineError('没有找到服务器')
    if (res.status >= 500 || res.status === 404) throw new OfflineError(`服务器暂时不可用（${res.status}）`)
    throw new ApiError(res.status, `请求失败（${res.status}）`)
  }
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new ApiError(res.status, typeof data.error === 'string' ? data.error : `请求失败（${res.status}）`, data)
  return data as T
}

export interface Me {
  app: 'note'
  authenticated: boolean
  username: string | null
}

export async function fetchMe(): Promise<Me> {
  const me = await api<Me>('/api/auth/me')
  if (me?.app !== 'note') throw new OfflineError('没有找到服务器')
  return me
}
