import path from 'node:path'

/**
 * 服务端配置，全部来自环境变量（生产环境写在 /etc/note/note.env 里）。
 */

const env = process.env

function list(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback
  return value
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

export const config = {
  host: env.NOTE_HOST || '127.0.0.1',
  port: Number(env.NOTE_PORT || 8790),
  /** 数据目录：数据库、文件、上传中的临时文件 */
  dataDir: path.resolve(env.NOTE_DATA_DIR || './data'),
  /** 允许访问的网页来源（防止别的网站借用登录状态）。开发时默认是 Vite 的地址 */
  origins: list(env.NOTE_ORIGINS, ['http://localhost:5173', 'http://127.0.0.1:5173']),
  /** Cookie 是否加 Secure（只在 HTTPS 下发送）。localhost 在浏览器眼里也算安全，所以默认开启 */
  cookieSecure: env.NOTE_COOKIE_SECURE !== '0',
  /** 在 nginx 后面时，从 X-Real-IP 取真实 IP */
  trustProxy: env.NOTE_TRUST_PROXY === '1',
  /** 单个文件上限 */
  maxAssetBytes: Number(env.NOTE_MAX_ASSET_MB || 2048) * 1024 * 1024,
}

export const paths = {
  db: () => path.join(config.dataDir, 'note.db'),
  assets: () => path.join(config.dataDir, 'assets'),
  uploads: () => path.join(config.dataDir, 'uploads'),
  assetTrash: () => path.join(config.dataDir, 'assets-trash'),
}
