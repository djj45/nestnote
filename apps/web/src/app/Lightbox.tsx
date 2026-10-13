import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { createStore, useStore } from '../lib/store'

/** 全屏看大图 */
const lightbox = createStore<{ url: string; alt: string } | null>(null)

export function openLightbox(url: string, alt = '') {
  lightbox.set({ url, alt })
}

export function Lightbox() {
  const state = useStore(lightbox)

  useEffect(() => {
    if (!state) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        lightbox.set(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [state])

  if (!state) return null
  return createPortal(
    <div className="lightbox" role="dialog" aria-label={state.alt || '图片'} onClick={() => lightbox.set(null)}>
      <img src={state.url} alt={state.alt} onClick={(e) => e.stopPropagation()} />
      <button className="lightbox-close" aria-label="关闭" onClick={() => lightbox.set(null)}>
        <X className="icon" />
      </button>
    </div>,
    document.body,
  )
}
