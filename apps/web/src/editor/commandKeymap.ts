import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { dispatchKeyEvent, type Scope } from '../commands/registry'
import { canonical, comboFromEvent, isTypingCombo } from '../commands/keys'

/**
 * Tiptap 自带的格式快捷键。这些按键统一交给命令系统处理：
 * 用户把"加粗"改成别的键以后，原来的 ⌘B 就不再加粗。
 */
const TIPTAP_DEFAULTS = [
  'Mod+B',
  'Mod+I',
  'Mod+U',
  'Mod+E',
  'Mod+Shift+S',
  'Mod+Shift+X',
  'Mod+Shift+B',
  'Mod+Shift+H',
  'Mod+Shift+7',
  'Mod+Shift+8',
  'Mod+Shift+9',
  'Mod+Alt+0',
  'Mod+Alt+1',
  'Mod+Alt+2',
  'Mod+Alt+3',
  'Mod+Alt+4',
  'Mod+Alt+5',
  'Mod+Alt+6',
  'Mod+Alt+C',
  'Mod+Z',
  'Mod+Shift+Z',
  'Mod+Y',
  'Mod+Enter',
]
const MANAGED = new Set(TIPTAP_DEFAULTS.map((k) => canonical(k)).filter((k): k is string => !!k))

/** 编辑器里的按键先经过命令系统（编辑器范围 + 全局范围），优先级高于 Tiptap 自带的快捷键 */
export const CommandKeymap = Extension.create({
  name: 'commandKeymap',
  priority: 1000,

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('commandKeymap'),
        props: {
          handleKeyDown: (_view, event) => {
            const combo = comboFromEvent(event)
            if (!combo) return false
            const scopes: Scope[] = isTypingCombo(combo) ? ['editor'] : ['editor', 'global']
            if (dispatchKeyEvent(event, scopes, { editor })) return true
            if (MANAGED.has(combo)) {
              event.preventDefault()
              return true
            }
            return false
          },
        },
      }),
    ]
  },
})

/** 没有其它逻辑处理 Tab 时吞掉它，避免焦点跳出编辑器 */
export const TabTrap = Extension.create({
  name: 'tabTrap',
  priority: 1,
  addKeyboardShortcuts() {
    return {
      Tab: () => true,
      'Shift-Tab': () => true,
    }
  },
})

/** 按住 ⌘/Ctrl 点击链接时在新标签页打开 */
export const LinkOpener = Extension.create({
  name: 'linkOpener',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('linkOpener'),
        props: {
          handleClick: (_view, _pos, event) => {
            if (!(event.metaKey || event.ctrlKey)) return false
            const anchor = (event.target as HTMLElement | null)?.closest('a')
            if (!anchor?.href) return false
            window.open(anchor.href, '_blank', 'noopener,noreferrer')
            return true
          },
        },
      }),
    ]
  },
})
