import { useEffect } from 'react'
import { createStore, useStore } from '../lib/store'

/**
 * 提示框：同时最多一个（新的替换旧的）；过几秒自动消失，
 * 或者点屏幕任何地方、按键、滚动时立即消失（点提示框自己的按钮除外）。
 */

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'error'
  action?: { label: string; run: () => void }
}

const current = createStore<Toast | null>(null)
let nextId = 1

export function showToast(message: string, options: { tone?: Toast['tone']; action?: Toast['action']; duration?: number } = {}) {
  const toast: Toast = { id: nextId++, message, tone: options.tone ?? 'info', action: options.action }
  current.set(toast)
  window.setTimeout(() => dismissToast(toast.id), options.duration ?? (options.action ? 6000 : 3000))
}

export function dismissToast(id: number) {
  if (current.get()?.id === id) current.set(null)
}

export function Toasts() {
  const toast = useStore(current)

  useEffect(() => {
    if (!toast) return
    const dismiss = (e: Event) => {
      // 点的是提示框本身（比如上面的按钮）：交给按钮处理
      if (e.target instanceof Element && e.target.closest('.toast')) return
      dismissToast(toast.id)
    }
    const opts = { capture: true, passive: true }
    window.addEventListener('pointerdown', dismiss, opts)
    window.addEventListener('keydown', dismiss, opts)
    window.addEventListener('wheel', dismiss, opts)
    return () => {
      window.removeEventListener('pointerdown', dismiss, opts)
      window.removeEventListener('keydown', dismiss, opts)
      window.removeEventListener('wheel', dismiss, opts)
    }
  }, [toast])

  if (!toast) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      <div key={toast.id} className={`toast toast-${toast.tone}`}>
        <span>{toast.message}</span>
        {toast.action && (
          <button
            className="toast-action"
            onClick={() => {
              toast.action!.run()
              dismissToast(toast.id)
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  )
}
