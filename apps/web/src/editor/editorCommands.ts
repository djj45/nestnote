import type { Editor } from '@tiptap/core'
import { registerCommands, type CommandContext, type CommandDef } from '../commands/registry'
import { editorEvents } from './events'
import { moveBlock } from './moveBlock'
import { isSlashMenuOpen } from './slash'
import { pickFiles } from '../assets/assetStore'
import { insertFiles } from './insertFiles'
import { NodeSelection, Selection } from '@tiptap/pm/state'
import { editorPath } from '../embed/pageContext'
import { openPage } from '../embed/status'
import { embedNewPage, pickPageToEmbed } from '../embed/actions'

/** 文字编辑相关的命令，快捷键都可以在设置里改 */

const GROUP = '文字编辑'
const canEdit = (ctx: CommandContext) => !!ctx.editor && ctx.editor.isEditable

function def(
  id: string,
  title: string,
  keys: string[],
  run: (editor: Editor) => boolean | void,
  extra: Partial<CommandDef> = {},
): CommandDef {
  return {
    id: `editor.${id}`,
    title,
    group: GROUP,
    scope: 'editor',
    keys,
    when: canEdit,
    run: (ctx) => run(ctx.editor!),
    ...extra,
  }
}

/** 格式类命令无论成功与否都算"处理过"，避免按键漏给浏览器 */
const always = (fn: (editor: Editor) => unknown) => (editor: Editor) => {
  fn(editor)
  return true
}

registerCommands([
  def('bold', '加粗', ['Mod+B'], always((e) => e.chain().focus().toggleBold().run())),
  def('italic', '斜体', ['Mod+I'], always((e) => e.chain().focus().toggleItalic().run())),
  def('underline', '下划线', ['Mod+U'], always((e) => e.chain().focus().toggleUnderline().run())),
  def('strike', '删除线', ['Mod+Shift+X'], always((e) => e.chain().focus().toggleStrike().run())),
  def('code', '行内代码', ['Mod+E'], always((e) => e.chain().focus().toggleCode().run())),
  def('link', '插入 / 编辑链接', ['Mod+K'], (e) => {
    editorEvents.emit({ type: 'link', editor: e })
    return true
  }),
  def('paragraph', '转为正文', ['Mod+Alt+0'], always((e) => e.chain().focus().setParagraph().run())),
  def('h1', '转为标题 1', ['Mod+Alt+1'], always((e) => e.chain().focus().toggleHeading({ level: 1 }).run())),
  def('h2', '转为标题 2', ['Mod+Alt+2'], always((e) => e.chain().focus().toggleHeading({ level: 2 }).run())),
  def('h3', '转为标题 3', ['Mod+Alt+3'], always((e) => e.chain().focus().toggleHeading({ level: 3 }).run())),
  def('bulletList', '无序列表', ['Mod+Shift+8'], always((e) => e.chain().focus().toggleBulletList().run())),
  def('orderedList', '有序列表', ['Mod+Shift+7'], always((e) => e.chain().focus().toggleOrderedList().run())),
  def('taskList', '待办列表', ['Mod+Shift+9'], always((e) => e.chain().focus().toggleTaskList().run())),
  def('blockquote', '引用', ['Mod+Shift+B'], always((e) => e.chain().focus().toggleBlockquote().run())),
  def('codeBlock', '代码块', [], always((e) => e.chain().focus().toggleCodeBlock().run())),
  def('callout', '标注框', [], always((e) => e.chain().focus().toggleCallout().run())),
  def('table', '插入表格', [], always((e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())),
  def('hr', '插入分割线', [], always((e) => e.chain().focus().setHorizontalRule().run())),
  def('insertImage', '插入图片', [], always((e) => pickFiles('image/*').then((f) => insertFiles(e, f)))),
  def('insertVideo', '插入视频', [], always((e) => pickFiles('video/*').then((f) => insertFiles(e, f)))),
  def('insertAudio', '插入音频', [], always((e) => pickFiles('audio/*').then((f) => insertFiles(e, f)))),
  def('insertFile', '插入文件', [], always((e) => pickFiles().then((f) => insertFiles(e, f)))),
  def(
    'indent',
    '增加缩进（列表）',
    ['Tab'],
    (e) => e.commands.sinkListItem('listItem') || e.commands.sinkListItem('taskItem'),
    { palette: false, when: (ctx) => canEdit(ctx) && !isSlashMenuOpen() },
  ),
  def(
    'outdent',
    '减少缩进（列表）',
    ['Shift+Tab'],
    (e) => e.commands.liftListItem('listItem') || e.commands.liftListItem('taskItem'),
    { palette: false, when: (ctx) => canEdit(ctx) && !isSlashMenuOpen() },
  ),
  def('undo', '撤销', ['Mod+Z'], always((e) => e.commands.undo())),
  def('redo', '重做', ['Mod+Shift+Z', 'win:Mod+Y'], always((e) => e.commands.redo())),
  def('moveUp', '当前块上移', ['Mod+Shift+ArrowUp'], (e) => moveBlock(e, -1)),
  def('moveDown', '当前块下移', ['Mod+Shift+ArrowDown'], (e) => moveBlock(e, 1)),
  def('openEmbed', '打开选中的嵌入页面或页面链接', ['Mod+Enter'], openFromEditor, {
    when: (ctx) => !!ctx.editor,
  }),
  def('embedNewDoc', '嵌入新文档', [], always((e) => embedNewPage(e, 'doc')), { when: canEmbed }),
  def('embedNewCanvas', '嵌入新画布', [], always((e) => embedNewPage(e, 'canvas')), { when: canEmbed }),
  def('embedPage', '嵌入已有页面…', [], always((e) => pickPageToEmbed(e)), { when: canEmbed }),
])

/** 文档编辑器里才能嵌入页面（画布卡片里不行） */
function canEmbed(ctx: CommandContext): boolean {
  return canEdit(ctx) && !!ctx.editor!.schema.nodes.pageEmbed
}

/**
 * ⌘/Ctrl+Enter：选中的是嵌入块或页面链接（或光标紧挨着链接）就打开那个页面；
 * 光标在嵌入的文档里，就把这个文档整页打开。
 */
function openFromEditor(editor: Editor): boolean {
  const { selection } = editor.state
  const path = editorPath(editor)
  const isTarget = (n: { type: { name: string }; attrs: Record<string, unknown> } | null | undefined) =>
    !!n && (n.type.name === 'pageEmbed' || n.type.name === 'pageLink') && typeof n.attrs.pageId === 'string'
  const candidates =
    selection instanceof NodeSelection
      ? [selection.node]
      : selection.empty
        ? [selection.$from.nodeAfter, selection.$from.nodeBefore]
        : []
  const target = candidates.find(isTarget)
  if (target) {
    openPage(target.attrs.pageId as string, path)
    return true
  }
  if (path.length > 1) {
    openPage(path[path.length - 1], path.slice(0, -1))
    return true
  }
  return false
}

// ---------- 表格（光标在表格里时可用；默认没有快捷键，可以在设置里绑定） ----------

const inTable = (ctx: CommandContext) => canEdit(ctx) && ctx.editor!.isActive('table')

function tableDef(id: string, title: string, run: (editor: Editor) => unknown): CommandDef {
  return {
    id: `editor.table.${id}`,
    title,
    group: '表格',
    scope: 'editor',
    keys: [],
    when: inTable,
    run: (ctx) => {
      run(ctx.editor!)
      return true
    },
  }
}

export const TABLE_COMMANDS = [
  tableDef('addRowBefore', '上方插入行', (e) => e.chain().focus().addRowBefore().run()),
  tableDef('addRowAfter', '下方插入行', (e) => e.chain().focus().addRowAfter().run()),
  tableDef('addColumnBefore', '左侧插入列', (e) => e.chain().focus().addColumnBefore().run()),
  tableDef('addColumnAfter', '右侧插入列', (e) => e.chain().focus().addColumnAfter().run()),
  tableDef('deleteRow', '删除所在行', (e) => e.chain().focus().deleteRow().run()),
  tableDef('deleteColumn', '删除所在列', (e) => e.chain().focus().deleteColumn().run()),
  tableDef('mergeOrSplit', '合并 / 拆分单元格', (e) => e.chain().focus().mergeOrSplit().run()),
  tableDef('toggleHeaderRow', '切换表头行', (e) => e.chain().focus().toggleHeaderRow().run()),
  tableDef('delete', '删除整个表格', deleteWholeTable),
]

registerCommands(TABLE_COMMANDS)

/**
 * 删除整个表格。自带的命令删完把光标放到表格后面那一块（通常是表格下方的空行，会冒出“输入文字…”提示），
 * 这里改成放回表格上方那段文字的末尾；上面没有文字才往下找。
 */
export function deleteWholeTable(editor: Editor): boolean {
  const { state } = editor
  const $anchor = state.selection.$anchor
  for (let d = $anchor.depth; d > 0; d--) {
    if ($anchor.node(d).type.spec.tableRole !== 'table') continue
    const from = $anchor.before(d)
    const tr = state.tr.delete(from, $anchor.after(d))
    const $pos = tr.doc.resolve(Math.min(from, tr.doc.content.size))
    const selection =
      Selection.findFrom($pos, -1, true) ?? Selection.findFrom($pos, 1, true) ?? Selection.near($pos)
    tr.setSelection(selection).scrollIntoView()
    editor.view.dispatch(tr)
    editor.commands.focus()
    editorEvents.emit({ type: 'tableDeleted', editor })
    return true
  }
  return false
}
