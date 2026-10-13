import type * as Y from 'yjs'
import type { Extensions } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { Collaboration } from '@tiptap/extension-collaboration'
import { Placeholder } from '@tiptap/extensions'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import { Callout } from '../editor/callout'
import { SlashCommand } from '../editor/slash'
import { CommandKeymap, LinkOpener, TabTrap } from '../editor/commandKeymap'
import { MarkdownPaste } from '../editor/markdownPaste'
import { PageContext } from '../embed/pageContext'
import { PageLink } from '../embed/pageLink'

const lowlight = createLowlight(common)

/**
 * 画布上文字卡片的编辑器扩展：和文档编辑器基本一样，
 * 只是不放图片、视频、文件块和页面嵌入（画布上它们是单独的元素），表格列宽不可拖动（画布缩放时坐标不准）。
 * 可以插入页面链接（[[）。path 是画布所在的嵌入路径。
 */
export function cardBaseExtensions(path: string[] = []): Extensions {
  return [
    StarterKit.configure({
      undoRedo: false,
      codeBlock: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      dropcursor: false,
      // 卡片里不需要在列表、表格后面自动补一个空段落（会让卡片底部多出一行空白）
      trailingNode: false,
    }),
    Placeholder.configure({ placeholder: '输入文字…' }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    CodeBlockLowlight.configure({ lowlight }),
    Callout,
    SlashCommand.configure({ allowMedia: false }),
    CommandKeymap,
    TabTrap,
    LinkOpener,
    MarkdownPaste,
    PageContext.configure({ path }),
    PageLink,
  ]
}

export function buildCardExtensions(fragment: Y.XmlFragment, path: string[]): Extensions {
  return [...cardBaseExtensions(path), Collaboration.configure({ fragment })]
}
