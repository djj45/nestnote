import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { cls } from '../lib/format'
import { Kbd } from './Kbd'

export interface MenuItem {
  label: string
  icon?: ComponentType<{ className?: string }>
  shortcut?: string | null
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

export type MenuEntry = MenuItem | 'separator'

let lastOutsideDismiss = -1

/** 这次按下是不是用来关掉弹出菜单的（画布据此不把它当成写字、框选） */
export function isMenuDismissPress(e: { timeStamp: number }): boolean {
  return e.timeStamp === lastOutsideDismiss
}

/** 简单的弹出菜单：鼠标位置或按钮下方打开，点外面、按 Esc、滚动时关闭 */
export function Menu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuEntry[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  /** 打开菜单前的焦点（首次渲染时记下，之后菜单自己会获得焦点） */
  const previousFocus = useRef(document.activeElement)
  const [pos, setPos] = useState({ left: x, top: y })
  const [active, setActive] = useState(-1)
  const selectable = items.map((it, i) => (it !== 'separator' && !it.disabled ? i : -1)).filter((i) => i >= 0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))
    const top = y + rect.height > window.innerHeight - 8 ? Math.max(8, y - rect.height) : y
    setPos({ left, top })
    el.focus()
  }, [x, y])

  // 关闭后把焦点还给打开菜单前的位置（例如画布），快捷键才能继续用；选中的项目自己移走了焦点就不管
  useLayoutEffect(() => {
    const menu = ref.current
    const previous = previousFocus.current instanceof HTMLElement ? previousFocus.current : null
    return () => {
      const now = document.activeElement
      const lost = !now || now === document.body || !!menu?.contains(now)
      if (lost && previous && previous !== menu && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    // 用 pointerdown：画布在按下时会阻止浏览器默认行为，触屏和手写笔上就不会再有 mousedown 事件
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      lastOutsideDismiss = e.timeStamp
      onClose()
    }
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const select = (item: MenuItem) => {
    onClose()
    item.onSelect()
  }

  return createPortal(
    <div
      ref={ref}
      className="menu"
      role="menu"
      tabIndex={-1}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const at = selectable.indexOf(active)
          const next = e.key === 'ArrowDown' ? at + 1 : at - 1
          setActive(selectable[(next + selectable.length) % selectable.length] ?? -1)
        } else if (e.key === 'Enter' && active >= 0) {
          e.preventDefault()
          select(items[active] as MenuItem)
        }
      }}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={cls('menu-item', item.danger && 'is-danger', active === i && 'is-active')}
            disabled={item.disabled}
            onMouseEnter={() => setActive(i)}
            onClick={() => select(item)}
          >
            {item.icon ? <item.icon className="icon" /> : <span className="icon" />}
            <span className="menu-label">{item.label}</span>
            {item.shortcut && <Kbd combo={item.shortcut} />}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
