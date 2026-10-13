import { showToast } from './toast'

/**
 * 注册 Service Worker（只在正式构建里）：网页本身缓存在本机，断网也能打开。
 * 部署了新版本时，新的 Service Worker 接管后提示刷新。
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  let hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 第一次安装不用提示
    if (!hadController) {
      hadController = true
      return
    }
    showToast('笔记有新版本了', { action: { label: '刷新', run: () => location.reload() }, duration: 20000 })
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // "添加到主屏幕"后网页可能一直开着：每次切回来时检查一下有没有新版本
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {})
        })
      })
      .catch((err) => console.warn('[pwa] 注册 Service Worker 失败', err))
  })
}
