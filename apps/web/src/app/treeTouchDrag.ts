import { createStore } from '../lib/store'
import { canMove, getPage, movePage, type DropPosition } from '../store/workspace'
import { setExpanded } from './ui'

/**
 * 手机、平板上拖动侧边栏里的页面（浏览器自带的拖放在触屏上不好用）：
 * 按住页面约半秒，它浮起来后跟着手指走；松手时放到手指下面那一行的前面、后面或里面（变成子页面），
 * 放到列表下方的空白处就移到最外层。靠近列表上下边缘时自动滚动。
 */

export interface TouchDragState {
  dragId: string
  title: string
  x: number
  y: number
  /** 放到哪个页面；null + root=true 表示最外层 */
  targetId: string | null
  position: DropPosition | null
  root: boolean
}

export const touchDrag = createStore<TouchDragState | null>(null)

const LONG_PRESS = 420
const MOVE_TOLERANCE = 8

let pressing = false
/** 刚拖完：吞掉松手后紧跟着的那次点击（不要打开页面） */
let suppressClickUntil = 0

export const isTouchPressing = () => pressing || touchDrag.get() !== null
export const shouldSuppressClick = () => Date.now() < suppressClickUntil

function findTarget(x: number, y: number, dragId: string): Pick<TouchDragState, 'targetId' | 'position' | 'root'> {
  const el = document.elementFromPoint(x, y)
  const row = el?.closest<HTMLElement>('[data-page-id]')
  if (row) {
    const id = row.dataset.pageId!
    if (id === dragId) return { targetId: null, position: null, root: false }
    const rect = row.getBoundingClientRect()
    const ratio = (y - rect.top) / rect.height
    const position: DropPosition = ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'inside'
    return canMove(dragId, id, position) ? { targetId: id, position, root: false } : { targetId: null, position: null, root: false }
  }
  if (el?.closest('.tree-tail') && canMove(dragId, null, 'after')) return { targetId: null, position: null, root: true }
  return { targetId: null, position: null, root: false }
}

/**
 * 拖动时不让列表跟着手指滚动。要一直挂在列表上（非 passive）：
 * 按下之后才加的监听，安卓 Chrome 可能不让它拦滚动。
 */
export function installTreeTouchGuard(tree: HTMLElement): () => void {
  const onTouchMove = (ev: TouchEvent) => {
    if (touchDrag.get() && ev.cancelable) ev.preventDefault()
  }
  tree.addEventListener('touchmove', onTouchMove, { passive: false })
  return () => tree.removeEventListener('touchmove', onTouchMove)
}

/** 在页面树上按下（只处理手指和笔） */
export function startTreePress(e: PointerEvent, tree: HTMLElement) {
  if (e.pointerType === 'mouse' || !e.isPrimary) return
  const target = e.target as Element
  if (target.closest('button, input')) return
  const row = target.closest<HTMLElement>('[data-page-id]')
  if (!row) return
  const id = row.dataset.pageId!
  const startX = e.clientX
  const startY = e.clientY
  const pointerId = e.pointerId
  let dragging = false
  let lastX = startX
  let lastY = startY
  let scrollTimer = 0
  pressing = true

  const update = () => {
    touchDrag.set((s) => (s ? { ...s, x: lastX, y: lastY, ...findTarget(lastX, lastY, id) } : s))
  }

  // 靠近列表上下边缘：自动滚动
  const autoScroll = () => {
    const rect = tree.getBoundingClientRect()
    const edge = 40
    let dy = 0
    if (lastY < rect.top + edge) dy = -Math.ceil((rect.top + edge - lastY) / 4)
    else if (lastY > rect.bottom - edge) dy = Math.ceil((lastY - (rect.bottom - edge)) / 4)
    if (dy) {
      tree.scrollTop += dy
      update()
    }
    scrollTimer = window.setTimeout(autoScroll, 16)
  }

  const begin = () => {
    dragging = true
    navigator.vibrate?.(10)
    const page = getPage(id)
    touchDrag.set({ dragId: id, title: page?.title || '无标题', x: lastX, y: lastY, targetId: null, position: null, root: false })
    update()
    autoScroll()
  }
  const timer = window.setTimeout(begin, LONG_PRESS)

  const cleanup = () => {
    window.clearTimeout(timer)
    window.clearTimeout(scrollTimer)
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    pressing = false
    touchDrag.set(null)
  }

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    lastX = ev.clientX
    lastY = ev.clientY
    if (!dragging) {
      // 还没到长按时间就动了：是在滚动列表，不拖
      if (Math.hypot(lastX - startX, lastY - startY) > MOVE_TOLERANCE) cleanup()
      return
    }
    ev.preventDefault()
    update()
  }

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    if (dragging) {
      suppressClickUntil = Date.now() + 500
      const s = touchDrag.get()
      if (s?.root) movePage(id, null, 'after')
      else if (s?.targetId && s.position) {
        if (movePage(id, s.targetId, s.position) && s.position === 'inside') setExpanded(s.targetId, true)
      }
    }
    cleanup()
  }

  const onCancel = (ev: PointerEvent) => {
    if (ev.pointerId === pointerId) cleanup()
  }

  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
}
