import type { ComponentType } from 'react'
import type { Editor, Range } from '@tiptap/core'
import { pickFiles } from '../assets/assetStore'
import { insertFiles } from './insertFiles'
import { embedNewPage, pickPageToEmbed } from '../embed/actions'
import {
  Code,
  FilePlus2,
  Files,
  FileUp,
  Link2,
  Shapes,
  Image,
  Music,
  Video,
  Heading1,
  Heading2,
  Heading3,
  Lightbulb,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pilcrow,
  Quote,
  Table,
} from 'lucide-react'

export interface SlashItem {
  id: string
  title: string
  description: string
  /** 英文、拼音全拼和首字母，方便不切输入法也能搜到 */
  keywords: string[]
  icon: ComponentType<{ className?: string }>
  /** 对应的命令 id，用来显示快捷键 */
  commandId?: string
  run: (editor: Editor, range: Range) => void
}

const start = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range)

/** 删掉 "/xxx"，打开系统文件选择框，选好后插入 */
const pick = (accept: string | undefined, multiple: boolean) => (editor: Editor, range: Range) => {
  start(editor, range).run()
  void pickFiles(accept, multiple).then((files) => insertFiles(editor, files))
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'paragraph',
    title: '正文',
    description: '普通的文字段落',
    keywords: ['text', 'paragraph', 'p', 'zhengwen', 'zw'],
    icon: Pilcrow,
    commandId: 'editor.paragraph',
    run: (e, r) => start(e, r).setParagraph().run(),
  },
  {
    id: 'h1',
    title: '标题 1',
    description: '最大的标题',
    keywords: ['h1', 'heading', 'title', 'biaoti', 'bt', '#'],
    icon: Heading1,
    commandId: 'editor.h1',
    run: (e, r) => start(e, r).setHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    title: '标题 2',
    description: '中等标题',
    keywords: ['h2', 'heading', 'title', 'biaoti', 'bt', '##'],
    icon: Heading2,
    commandId: 'editor.h2',
    run: (e, r) => start(e, r).setHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    title: '标题 3',
    description: '小标题',
    keywords: ['h3', 'heading', 'title', 'biaoti', 'bt', '###'],
    icon: Heading3,
    commandId: 'editor.h3',
    run: (e, r) => start(e, r).setHeading({ level: 3 }).run(),
  },
  {
    id: 'bulletList',
    title: '无序列表',
    description: '圆点开头的列表',
    keywords: ['ul', 'bullet', 'list', 'liebiao', 'lb', 'wuxu', 'wx', '-'],
    icon: List,
    commandId: 'editor.bulletList',
    run: (e, r) => start(e, r).toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    title: '有序列表',
    description: '带编号的列表',
    keywords: ['ol', 'ordered', 'number', 'list', 'liebiao', 'youxu', 'yx', '1.'],
    icon: ListOrdered,
    commandId: 'editor.orderedList',
    run: (e, r) => start(e, r).toggleOrderedList().run(),
  },
  {
    id: 'taskList',
    title: '待办列表',
    description: '可以打勾的清单',
    keywords: ['todo', 'task', 'check', 'daiban', 'db', 'qingdan', '[]'],
    icon: ListTodo,
    commandId: 'editor.taskList',
    run: (e, r) => start(e, r).toggleTaskList().run(),
  },
  {
    id: 'blockquote',
    title: '引用',
    description: '引用一段话',
    keywords: ['quote', 'blockquote', 'yinyong', 'yy', '>'],
    icon: Quote,
    commandId: 'editor.blockquote',
    run: (e, r) => start(e, r).toggleBlockquote().run(),
  },
  {
    id: 'codeBlock',
    title: '代码块',
    description: '带语法高亮的代码',
    keywords: ['code', 'pre', 'daima', 'dm', '```'],
    icon: Code,
    commandId: 'editor.codeBlock',
    run: (e, r) => start(e, r).toggleCodeBlock().run(),
  },
  {
    id: 'callout',
    title: '标注框',
    description: '带底色的提示',
    keywords: ['callout', 'note', 'tip', 'biaozhu', 'bz', 'tishi', 'ts'],
    icon: Lightbulb,
    commandId: 'editor.callout',
    run: (e, r) => start(e, r).toggleCallout().run(),
  },
  {
    id: 'table',
    title: '表格',
    description: '3 × 3 表格，带表头',
    keywords: ['table', 'grid', 'biaoge', 'bg'],
    icon: Table,
    commandId: 'editor.table',
    run: (e, r) => start(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'image',
    title: '图片',
    description: '从电脑里选择图片',
    keywords: ['image', 'img', 'picture', 'photo', 'tupian', 'tp', 'zhaopian'],
    icon: Image,
    commandId: 'editor.insertImage',
    run: pick('image/*', true),
  },
  {
    id: 'video',
    title: '视频',
    description: '在文档里直接播放',
    keywords: ['video', 'movie', 'shipin', 'sp'],
    icon: Video,
    commandId: 'editor.insertVideo',
    run: pick('video/*', true),
  },
  {
    id: 'audio',
    title: '音频',
    description: '录音、音乐',
    keywords: ['audio', 'music', 'sound', 'yinpin', 'yp', 'luyin'],
    icon: Music,
    commandId: 'editor.insertAudio',
    run: pick('audio/*', true),
  },
  {
    id: 'file',
    title: '文件',
    description: 'PDF、Word、压缩包等任意文件',
    keywords: ['file', 'pdf', 'attachment', 'wenjian', 'wj', 'fujian', 'fj'],
    icon: FileUp,
    commandId: 'editor.insertFile',
    run: pick(undefined, true),
  },
  {
    id: 'hr',
    title: '分割线',
    description: '一条横线',
    keywords: ['hr', 'divider', 'line', 'fengexian', 'fgx', '---'],
    icon: Minus,
    commandId: 'editor.hr',
    run: (e, r) => start(e, r).setHorizontalRule().run(),
  },
  {
    id: 'embedNewDoc',
    title: '嵌入新文档',
    description: '新建一个子文档，直接在这里编辑',
    keywords: ['embed', 'doc', 'page', 'subpage', 'qianru', 'qr', 'wendang', 'wd', 'ziwendang', 'zwd', 'xinjian'],
    icon: FilePlus2,
    commandId: 'editor.embedNewDoc',
    run: (e, r) => {
      start(e, r).run()
      embedNewPage(e, 'doc')
    },
  },
  {
    id: 'embedNewCanvas',
    title: '嵌入新画布',
    description: '新建一个子画布，嵌在文档里',
    keywords: ['embed', 'canvas', 'board', 'qianru', 'qr', 'huabu', 'hb', 'zihuabu', 'zhb', 'xinjian'],
    icon: Shapes,
    commandId: 'editor.embedNewCanvas',
    run: (e, r) => {
      start(e, r).run()
      embedNewPage(e, 'canvas')
    },
  },
  {
    id: 'embedPage',
    title: '嵌入已有页面',
    description: '把别的文档或画布嵌进来',
    keywords: ['embed', 'page', 'qianru', 'qr', 'yemian', 'ym', 'yiyou'],
    icon: Files,
    commandId: 'editor.embedPage',
    run: (e, r) => {
      start(e, r).run()
      pickPageToEmbed(e)
    },
  },
  {
    id: 'pageLink',
    title: '链接到页面',
    description: '插入页面链接，也可以直接输入 [[',
    keywords: ['link', 'page', 'mention', 'lianjie', 'lj', 'yemian', 'ym', '[['],
    icon: Link2,
    run: (e, r) => start(e, r).insertContent('[[').run(),
  },
]

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_ITEMS
  return SLASH_ITEMS.filter(
    (item) => item.title.toLowerCase().includes(q) || item.keywords.some((k) => k.startsWith(q)),
  )
}
