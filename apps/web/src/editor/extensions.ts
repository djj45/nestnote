import type * as Y from 'yjs'
import type { Extensions } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { Collaboration } from '@tiptap/extension-collaboration'
import { Placeholder } from '@tiptap/extensions'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import { Callout } from './callout'
import { SlashCommand } from './slash'
import { CommandKeymap, LinkOpener, TabTrap } from './commandKeymap'
import { MarkdownPaste } from './markdownPaste'
import { MEDIA_NODES } from './media'
import { FileDropPaste } from './insertFiles'
import { PageContext } from '../embed/pageContext'
import { PageEmbed } from '../embed/pageEmbed'
import { PageLink } from '../embed/pageLink'

const lowlight = createLowlight(common)

export interface DocExtensionOptions {
  /** 从最外层页面到这个文档的路径（包括它自己），嵌套显示时用来判断循环和深度 */
  path?: string[]
}

export function buildDocExtensions(doc: Y.Doc, options: DocExtensionOptions = {}): Extensions {
  return [
    StarterKit.configure({
      // 撤销重做由 Yjs 协同扩展提供（只撤销自己的修改）
      undoRedo: false,
      codeBlock: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      dropcursor: { color: 'var(--accent)', width: 2 },
    }),
    Collaboration.configure({ document: doc, field: 'content' }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return `标题 ${node.attrs.level}`
        return '输入文字，或输入 / 插入标题、列表、表格…'
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    CodeBlockLowlight.configure({ lowlight }),
    Callout,
    SlashCommand,
    CommandKeymap,
    TabTrap,
    LinkOpener,
    MarkdownPaste,
    ...MEDIA_NODES,
    FileDropPaste,
    PageContext.configure({ path: options.path ?? [] }),
    PageEmbed,
    PageLink,
  ]
}
