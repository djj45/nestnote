import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { renamePage, type PageMeta } from '../store/workspace'

/**
 * 页面标题：自动换行的 textarea。
 * - 中文输入法组字期间不写入数据，组字结束后再写，避免打断输入法。
 * - 粘贴多行文字时，第一行作为标题，其余内容放进正文开头。
 */
export const PageTitle = forwardRef<
  HTMLTextAreaElement,
  {
    page: PageMeta
    readOnly: boolean
    onExitDown: () => void
    /** 粘贴多行时，标题以外的部分交给正文 */
    onPasteBody?: (text: string) => void
  }
>(function PageTitle({ page, readOnly, onExitDown, onPasteBody }, ref) {
  const [value, setValueState] = useState(page.title)
  const valueRef = useRef(page.title)
  const inner = useRef<HTMLTextAreaElement | null>(null)
  const composing = useRef(false)
  const focused = useRef(false)

  const setValue = (next: string) => {
    valueRef.current = next
    setValueState(next)
  }

  // 其它地方（侧边栏重命名、以后的同步）改了标题时更新显示
  useEffect(() => {
    if (!focused.current) setValue(page.title)
  }, [page.title])

  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  const setRefs = (el: HTMLTextAreaElement | null) => {
    inner.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }

  return (
    <textarea
      ref={setRefs}
      className="page-title"
      rows={1}
      value={value}
      placeholder="无标题"
      readOnly={readOnly}
      aria-label="页面标题"
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        focused.current = false
        renamePage(page.id, valueRef.current.trim())
      }}
      onCompositionStart={() => {
        composing.current = true
      }}
      onCompositionEnd={(e) => {
        composing.current = false
        renamePage(page.id, e.currentTarget.value)
      }}
      onChange={(e) => {
        const next = e.target.value.replace(/[\r\n]+/g, '')
        setValue(next)
        if (!composing.current) renamePage(page.id, next)
      }}
      onPaste={(e) => {
        const text = e.clipboardData.getData('text/plain')
        if (!/[\r\n]/.test(text.trim())) return
        e.preventDefault()
        const lines = text.replace(/\r\n?/g, '\n').split('\n')
        while (lines.length && !lines[0].trim()) lines.shift()
        const first = (lines.shift() ?? '').replace(/^#{1,6}\s+/, '').trim()
        const el = e.currentTarget
        const next = el.value.slice(0, el.selectionStart) + first + el.value.slice(el.selectionEnd)
        setValue(next)
        renamePage(page.id, next)
        const rest = lines.join('\n').trim()
        if (rest && onPasteBody) requestAnimationFrame(() => onPasteBody(rest))
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        const el = e.currentTarget
        const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length
        if (e.key === 'Enter' || (e.key === 'ArrowDown' && atEnd)) {
          e.preventDefault()
          onExitDown()
        }
      }}
    />
  )
})
