import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 开发时把 /api 和 /sync 转发给同步服务：
 * - 默认是本机的 apps/server（npm run dev:server，端口 8790）
 * - NOTE_SERVER=https://你的域名 npm run dev 可以让开发版直接连正式服务器
 *   （用来把只存在 localhost 里的笔记传上去）。这时把 Origin 改成服务器自己的域名，
 *   否则服务器会拒绝。
 */
const target = process.env.NOTE_SERVER || 'http://127.0.0.1:8790'
const remote = !!process.env.NOTE_SERVER
const headers = remote ? { origin: new URL(target).origin } : undefined

/**
 * 去掉登录 Cookie 的 Secure 标记：Safari 不把 http://localhost 当作安全地址，
 * 带 Secure 的 Cookie 会被直接丢掉，导致登录后马上又变成未登录。
 * 这个 Cookie 只在本机浏览器和开发服务器之间使用，开发服务器再用 HTTPS 转给正式服务器。
 */
const configure: ProxyOptions['configure'] = (proxy) => {
  proxy.on('proxyRes', (res) => {
    const cookies = res.headers['set-cookie']
    if (cookies) res.headers['set-cookie'] = cookies.map((c) => c.replace(/;\s*Secure/gi, ''))
  })
}

/**
 * 构建时生成 sw.js：把这次构建出来的所有文件列进"预缓存"清单。
 * 文件列表变了（也就是有新版本），sw.js 的内容就变，浏览器会自动更新。
 */
function serviceWorker(): Plugin {
  const here = (file: string) => fileURLToPath(new URL(file, import.meta.url))
  return {
    name: 'note-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'))
      const publicFiles = fs.readdirSync(here('./public')).filter((f) => !f.startsWith('.'))
      const precache = ['/index.html', ...files.filter((f) => f !== 'index.html').map((f) => `/${f}`), ...publicFiles.map((f) => `/${f}`)]
      const version = crypto.createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12)
      const source = fs
        .readFileSync(here('./sw.js'), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__PRECACHE__', JSON.stringify(precache))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true, headers, configure },
      '/sync': { target, changeOrigin: true, ws: true, headers, configure },
    },
  },
})
