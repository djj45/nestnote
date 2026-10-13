/*
 * Service Worker：把网页本身（html、js、css、图标）缓存在手机或电脑上，断网也能打开。
 * 笔记数据不在这里缓存（它们在 IndexedDB 里，由同步模块管理）；/api 和 /sync 一律直接走网络。
 * 构建时由 vite.config.ts 里的插件填入版本号和文件列表，每次部署都是一个新版本。
 */
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const CACHE = `note-app-${VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('note-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

/** 打开页面：优先用网络（拿到最新版本），网络慢于 3 秒或断网时用缓存 */
async function handleNavigate(request) {
  const cache = await caches.open(CACHE)
  const fromNetwork = fetch(request).then((res) => {
    if (res.ok) cache.put('/index.html', res.clone())
    return res
  })
  const timeout = new Promise((resolve) => setTimeout(resolve, 3000))
  try {
    const res = await Promise.race([fromNetwork, timeout])
    if (res) return res
  } catch {
    /* 断网 */
  }
  const cached = await cache.match('/index.html', { ignoreVary: true })
  return cached || fromNetwork
}

/** js、css、图标：文件名带内容哈希，缓存里有就直接用 */
async function handleAsset(request) {
  const cache = await caches.open(CACHE)
  // 按网址找（脚本请求会带 Origin 头，服务器响应里如果有 Vary: Origin，严格匹配会找不到）
  const cached = await cache.match(new URL(request.url).pathname, { ignoreVary: true, ignoreSearch: true })
  if (cached) return cached
  const res = await fetch(request)
  if (res.ok) cache.put(request, res.clone())
  return res
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname === '/sync') return
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(request))
    return
  }
  if (url.pathname.startsWith('/assets/') || PRECACHE.includes(url.pathname)) {
    event.respondWith(handleAsset(request))
  }
})
