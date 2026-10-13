import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { useStore } from '../lib/store'
import { cls } from '../lib/format'
import { slashStore } from './slash'
import { CommandKbd } from '../app/Kbd'

export function SlashMenu() {
  const state = useStore(slashStore)
  const ref = useRef<HTMLDivElement>(null)
  const visible = state.open && !state.dismissed && state.items.length > 0 && !!state.rect

  useLayoutEffect(() => {
    const el = ref.current
    const rect = state.rect
    if (!visible || !el || !rect) return
    computePosition({ getBoundingClientRect: () => rect }, el, {
      placement: 'bottom-start',
      strategy: 'fixed',
      middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      el.style.left = `${x}px`
      el.style.top = `${y}px`
      el.style.visibility = 'visible'
    })
  }, [visible, state.rect, state.items])

  useEffect(() => {
    ref.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [state.index])

  if (!visible) return null
  return createPortal(
    <div ref={ref} className="slash-menu" role="listbox" aria-label="插入内容" style={{ visibility: 'hidden' }}>
      {state.items.map((item, i) => (
        <button
          key={item.id}
          role="option"
          aria-selected={i === state.index}
          className={cls('slash-item', i === state.index && 'is-active')}
          onMouseDown={(e) => e.preventDefault()}
          onMouseMove={() => {
            if (slashStore.get().index !== i) slashStore.set((s) => ({ ...s, index: i }))
          }}
          onClick={() => state.select?.(item)}
        >
          <span className="slash-icon">
            <item.icon className="icon" />
          </span>
          <span className="slash-text">
            <span className="slash-title">{item.title}</span>
            <span className="slash-desc">{item.description}</span>
          </span>
          {item.commandId && <CommandKbd commandId={item.commandId} />}
        </button>
      ))}
    </div>,
    document.body,
  )
}
