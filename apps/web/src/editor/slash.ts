import { Extension, type Editor } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { Suggestion, type SuggestionOptions } from '@tiptap/suggestion'
import { createStore } from '../lib/store'
import { filterSlashItems, type SlashItem } from './slashItems'

/**
 * 斜杠菜单：输入 "/" 弹出插入菜单。
 * 中文输入法下按 "/" 键会打出 "、"，所以 "、" 也能触发。
 * 页面链接菜单（[[）也用同一个弹出菜单显示。
 */

export interface SlashState {
  open: boolean
  /** 按 Esc 关掉后，在这次输入结束前不再弹出 */
  dismissed: boolean
  items: SlashItem[]
  index: number
  rect: DOMRect | null
  select: ((item: SlashItem) => void) | null
}

const CLOSED: SlashState = { open: false, dismissed: false, items: [], index: 0, rect: null, select: null }

export const slashStore = createStore<SlashState>(CLOSED)

/** 画布卡片里不能插入的项目（图片等是画布上单独的元素；卡片里也不能嵌入页面） */
const BLOCK_ONLY_ITEMS = new Set(['image', 'video', 'audio', 'file', 'embedPage', 'embedNewDoc', 'embedNewCanvas'])

/** 弹出菜单的渲染：把建议插件的状态同步到 slashStore，由 SlashMenu 组件显示 */
export function menuRender(): SuggestionOptions<SlashItem, SlashItem>['render'] {
  return () => ({
    onStart: (props) => {
      slashStore.set({
        open: true,
        dismissed: false,
        items: props.items,
        index: 0,
        rect: props.clientRect?.() ?? null,
        select: (item) => props.command(item),
      })
    },
    onUpdate: (props) => {
      slashStore.set((s) => ({
        ...s,
        items: props.items,
        index: 0,
        rect: props.clientRect?.() ?? s.rect,
        select: (item) => props.command(item),
      }))
    },
    onKeyDown: ({ event }) => {
      const s = slashStore.get()
      if (!s.open || s.dismissed || s.items.length === 0) return false
      if (event.key === 'ArrowDown') {
        slashStore.set({ ...s, index: (s.index + 1) % s.items.length })
        return true
      }
      if (event.key === 'ArrowUp') {
        slashStore.set({ ...s, index: (s.index - 1 + s.items.length) % s.items.length })
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = s.items[s.index]
        if (item) s.select?.(item)
        return true
      }
      if (event.key === 'Escape') {
        slashStore.set({ ...s, dismissed: true })
        return true
      }
      return false
    },
    onExit: () => {
      slashStore.set(CLOSED)
    },
  })
}

function createSlashPlugin(editor: Editor, char: string, key: string, allowMedia: boolean) {
  return Suggestion<SlashItem, SlashItem>({
    editor,
    char,
    pluginKey: new PluginKey(key),
    startOfLine: false,
    allowedPrefixes: null,
    allow: ({ state, range }) => {
      const $from = state.doc.resolve(range.from)
      return $from.parent.type.name !== 'codeBlock'
    },
    items: ({ query }) => filterSlashItems(query).filter((item) => allowMedia || !BLOCK_ONLY_ITEMS.has(item.id)),
    command: ({ editor, range, props }) => props.run(editor, range),
    render: menuRender(),
  })
}

export const SlashCommand = Extension.create<{ allowMedia: boolean }>({
  name: 'slashCommand',
  addOptions() {
    return { allowMedia: true }
  },
  addProseMirrorPlugins() {
    const { allowMedia } = this.options
    return [
      createSlashPlugin(this.editor, '/', 'slashMenu', allowMedia),
      createSlashPlugin(this.editor, '、', 'slashMenuCn', allowMedia),
    ]
  },
})

export function isSlashMenuOpen(): boolean {
  const s = slashStore.get()
  return s.open && !s.dismissed && s.items.length > 0
}
