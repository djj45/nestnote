import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { posToDOMRect, type Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { AllSelection, TextSelection } from '@tiptap/pm/state'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import { Bold, Code, Heading1, Heading2, Heading3, Italic, Link, Strikethrough, Underline, Unlink } from 'lucide-react'
import { runCommand } from '../commands/registry'
import { useTitleWithShortcut } from '../app/Kbd'
import { cls } from '../lib/format'
import { editorEvents } from './events'

function normalizeUrl(input: string): string {
  const value = input.trim()
  if (!value) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/') || value.startsWith('#')) return value
  return `https://${value}`
}

/** 选中文字时出现的格式工具栏，也负责链接输入 */
export function BubbleToolbar({ editor }: { editor: Editor }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [anchor, setAnchor] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const linkRef = useRef<string | null>(null)
  linkRef.current = link
  const pointerDown = useRef(false)

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
    }),
  })

  const evaluate = useCallback(() => {
    if (editor.isDestroyed) return
    const { selection } = editor.state
    // ⌘A 全选得到的是 AllSelection，也算选中了文字
    const hasText = !selection.empty && (selection instanceof TextSelection || selection instanceof AllSelection)
    const focusInside = editor.isFocused || !!ref.current?.contains(document.activeElement)
    const show =
      editor.isEditable &&
      !pointerDown.current &&
      (linkRef.current !== null || (hasText && focusInside && !editor.isActive('codeBlock')))
    setVisible(show)
    setAnchor(`${selection.from}:${selection.to}`)
  }, [editor])

  useEffect(() => {
    const onBlur = () => window.setTimeout(evaluate, 0)
    editor.on('selectionUpdate', evaluate)
    editor.on('focus', evaluate)
    editor.on('blur', onBlur)
    const dom = editor.view.dom
    const onDown = () => {
      pointerDown.current = true
      setVisible(false)
    }
    const onUp = () => {
      if (!pointerDown.current) return
      pointerDown.current = false
      window.setTimeout(evaluate, 0)
    }
    dom.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    const offLink = editorEvents.on((event) => {
      if (event.type !== 'link' || event.editor !== editor) return
      if (editor.isActive('link')) editor.chain().extendMarkRange('link').run()
      setLink((editor.getAttributes('link').href as string | undefined) ?? '')
    })
    return () => {
      editor.off('selectionUpdate', evaluate)
      editor.off('focus', evaluate)
      editor.off('blur', onBlur)
      dom.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      offLink()
    }
  }, [editor, evaluate])

  useEffect(() => {
    evaluate()
  }, [link, evaluate])

  useLayoutEffect(() => {
    const el = ref.current
    if (!visible || !el) return
    const reference = {
      getBoundingClientRect: () => {
        const { from, to } = editor.state.selection
        return posToDOMRect(editor.view, from, to)
      },
      contextElement: editor.view.dom,
    }
    const update = () =>
      computePosition(reference, el, {
        placement: 'top',
        strategy: 'fixed',
        middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        el.style.left = `${x}px`
        el.style.top = `${y}px`
        el.style.visibility = 'visible'
      })
    return autoUpdate(reference, el, update)
  }, [visible, anchor, link, editor])

  const closeLink = (refocus: boolean) => {
    setLink(null)
    if (refocus) editor.commands.focus()
  }

  const applyLink = () => {
    const url = normalizeUrl(link ?? '')
    const chain = editor.chain().focus()
    if (!url) chain.extendMarkRange('link').unsetLink().run()
    else if (editor.state.selection.empty)
      chain.insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run()
    else chain.extendMarkRange('link').setLink({ href: url }).run()
    setLink(null)
  }

  if (!visible) return null
  return createPortal(
    <div
      ref={ref}
      className="bubble"
      role="toolbar"
      aria-label="文字格式"
      style={{ visibility: 'hidden' }}
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
      }}
    >
      {link !== null ? (
        <form
          className="bubble-link"
          onSubmit={(e) => {
            e.preventDefault()
            applyLink()
          }}
        >
          <input
            autoFocus
            className="bubble-input"
            value={link}
            placeholder="粘贴或输入链接，按回车确认"
            onChange={(e) => setLink(e.target.value)}
            onBlur={() => closeLink(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                closeLink(true)
              }
            }}
          />
          {active.link && (
            <button
              type="button"
              className="tool-btn"
              title="移除链接"
              aria-label="移除链接"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run()
                setLink(null)
              }}
            >
              <Unlink className="icon" />
            </button>
          )}
        </form>
      ) : (
        <>
          <ToolButton editor={editor} commandId="editor.bold" label="加粗" icon={Bold} active={active.bold} />
          <ToolButton editor={editor} commandId="editor.italic" label="斜体" icon={Italic} active={active.italic} />
          <ToolButton editor={editor} commandId="editor.underline" label="下划线" icon={Underline} active={active.underline} />
          <ToolButton editor={editor} commandId="editor.strike" label="删除线" icon={Strikethrough} active={active.strike} />
          <ToolButton editor={editor} commandId="editor.code" label="行内代码" icon={Code} active={active.code} />
          <ToolButton editor={editor} commandId="editor.link" label="链接" icon={Link} active={active.link} />
          <span className="tool-sep" />
          <ToolButton editor={editor} commandId="editor.h1" label="标题 1" icon={Heading1} active={active.h1} />
          <ToolButton editor={editor} commandId="editor.h2" label="标题 2" icon={Heading2} active={active.h2} />
          <ToolButton editor={editor} commandId="editor.h3" label="标题 3" icon={Heading3} active={active.h3} />
        </>
      )}
    </div>,
    document.body,
  )
}

function ToolButton({
  editor,
  commandId,
  label,
  icon: Icon,
  active,
}: {
  editor: Editor
  commandId: string
  label: string
  icon: ComponentType<{ className?: string }>
  active: boolean
}) {
  const title = useTitleWithShortcut(label, commandId)
  return (
    <button
      type="button"
      className={cls('tool-btn', active && 'is-active')}
      title={title}
      aria-label={label}
      aria-pressed={active}
      onClick={() => runCommand(commandId, { editor })}
    >
      <Icon className="icon" />
    </button>
  )
}
