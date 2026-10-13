import { showToast } from '../app/toast'
import { registerCommands, type CommandContext, type CommandDef } from '../commands/registry'
import { pickFiles } from '../assets/assetStore'
import { openPagePicker } from '../app/ui'
import { openPage } from '../embed/status'
import type { CanvasController, Point, Tool } from './controller'

/** 弹出页面选择框，把选中的页面嵌到画布上（at 不传就放在视口中间） */
export function pickPageForCanvas(c: CanvasController, at?: Point) {
  openPagePicker({
    title: '嵌入页面',
    exclude: c.path,
    onPick: (id) => c.addEmbed(id, { at }),
    onCreate: (type, title) => c.createEmbeddedPage(type, at, title),
  })
}

/** 画布上的命令（只在画布获得焦点、且没有在编辑卡片文字时生效），快捷键都可以在设置里改 */

let nudgeShift = false
/** 方向键微调：按住 Shift 一次移动 10 像素 */
export function setNudgeShift(value: boolean) {
  nudgeShift = value
}

const GROUP = '画布'

function def(
  id: string,
  title: string,
  keys: string[],
  run: (canvas: CanvasController) => boolean | void,
  options: { needsEdit?: boolean; needsSelection?: boolean; palette?: boolean } = {},
): CommandDef {
  return {
    id: `canvas.${id}`,
    title,
    group: GROUP,
    scope: 'canvas',
    keys,
    palette: options.palette,
    when: (ctx: CommandContext) =>
      !!ctx.canvas &&
      (!options.needsEdit || !ctx.canvas.readOnly) &&
      (!options.needsSelection || ctx.canvas.selection.get().size > 0),
    run: (ctx) => run(ctx.canvas!),
  }
}

const setTool = (tool: Tool) => (c: CanvasController) => {
  c.tool.set(tool)
}

/**
 * 点橡皮擦（或按 E）时已经选中了元素（例如刚框选完）：直接删掉选中的，不切换工具；
 * 没选中东西才切到橡皮擦。返回 true 表示删了。
 */
export function eraseSelectionIfAny(c: CanvasController): boolean {
  if (c.readOnly || c.editing.get()) return false
  const n = c.selection.get().size
  if (!n) return false
  c.deleteSelection()
  c.clearSelection()
  showToast(`已删除 ${n} 个元素`, { action: { label: '撤销', run: () => c.undo() } })
  return true
}

registerCommands([
  def('tool.select', '选择工具', ['V'], setTool('select')),
  def('tool.hand', '抓手工具（拖动画布）', ['H'], setTool('hand')),
  def('tool.text', '文字工具', ['T'], setTool('text'), { needsEdit: true }),
  def('tool.sticky', '便签工具', ['N'], setTool('sticky'), { needsEdit: true }),
  def('tool.arrow', '箭头工具', ['A'], setTool('arrow'), { needsEdit: true }),
  def('tool.pen', '画笔', ['P'], setTool('pen'), { needsEdit: true }),
  def('tool.eraser', '橡皮擦（选中了元素时直接删除它们）', ['E'], (c) => {
    if (!eraseSelectionIfAny(c)) c.tool.set('eraser')
  }, { needsEdit: true }),
  def('tool.rect', '矩形', ['R'], setTool('rect'), { needsEdit: true }),
  def('tool.ellipse', '椭圆', ['O'], setTool('ellipse'), { needsEdit: true }),
  def('insertTable', '插入表格', ['Shift+T'], (c) => {
    c.addText({ table: true })
  }, { needsEdit: true }),
  def('insertFile', '插入图片、视频或文件', [], (c) => {
    void pickFiles().then((files) => c.addFiles(files))
  }, { needsEdit: true }),
  def(
    'edit',
    '编辑选中卡片的文字',
    ['Enter'],
    (c) => {
      const [id] = [...c.selection.get()]
      const el = id ? c.get(id) : undefined
      if (c.selection.get().size !== 1 || !el) return false
      if (el.type === 'embed') return c.startEditing(el.id)
      if (c.readOnly || (el.type !== 'text' && el.type !== 'sticky')) return false
      c.startEditing(el.id)
    },
    { needsSelection: true },
  ),
  def(
    'openEmbed',
    '打开嵌入的页面',
    ['Mod+Enter'],
    (c) => {
      const [id] = [...c.selection.get()]
      const el = id ? c.get(id) : undefined
      if (c.selection.get().size !== 1 || el?.type !== 'embed' || !el.pageId) return false
      openPage(el.pageId, c.path)
    },
    { needsSelection: true },
  ),
  def('newDocEmbed', '新建文档并嵌在画布上', [], (c) => c.createEmbeddedPage('doc'), { needsEdit: true }),
  def('newCanvasEmbed', '新建画布并嵌在画布上', [], (c) => c.createEmbeddedPage('canvas'), { needsEdit: true }),
  def('embedPage', '嵌入已有页面…', [], (c) => pickPageForCanvas(c), { needsEdit: true }),
  def(
    'promote',
    '把卡片转为文档页面',
    [],
    (c) => {
      const [id] = [...c.selection.get()]
      const el = id ? c.get(id) : undefined
      if (c.selection.get().size !== 1 || (el?.type !== 'text' && el?.type !== 'sticky')) return false
      void c.promoteToPage(el.id)
    },
    { needsEdit: true, needsSelection: true },
  ),
  def('delete', '删除选中的元素', ['Backspace', 'Delete'], (c) => c.deleteSelection(), { needsEdit: true, needsSelection: true }),
  def('selectAll', '全选', ['Mod+A'], (c) => c.selectAll()),
  def('escape', '取消选择 / 退回选择工具', ['Escape'], (c) => {
    if (c.tool.get() !== 'select') c.tool.set('select')
    else if (c.selection.get().size) c.clearSelection()
    else return false
  }, { palette: false }),
  def('duplicate', '复制一份', ['Mod+D'], (c) => c.duplicateSelection(), { needsEdit: true, needsSelection: true }),
  def('undo', '撤销', ['Mod+Z'], (c) => c.undo(), { needsEdit: true }),
  def('redo', '重做', ['Mod+Shift+Z', 'win:Mod+Y'], (c) => c.redo(), { needsEdit: true }),
  def('front', '置于顶层', ['Shift+]'], (c) => c.reorder('front'), { needsEdit: true, needsSelection: true }),
  def('back', '置于底层', ['Shift+['], (c) => c.reorder('back'), { needsEdit: true, needsSelection: true }),
  def('forward', '上移一层', [']'], (c) => c.reorder('forward'), { needsEdit: true, needsSelection: true }),
  def('backward', '下移一层', ['['], (c) => c.reorder('backward'), { needsEdit: true, needsSelection: true }),
  def('zoomIn', '放大', ['Mod+='], (c) => c.zoomAt(1.25)),
  def('zoomOut', '缩小', ['Mod+-'], (c) => c.zoomAt(1 / 1.25)),
  def('zoomReset', '缩放到 100%', ['Mod+0'], (c) => c.resetZoom()),
  def('fitAll', '适应全部', ['Shift+1'], (c) => c.fitAll()),
  def('fitSelection', '适应选中', ['Shift+2'], (c) => c.fitSelection()),
  def('nudgeLeft', '向左移动', ['ArrowLeft', 'Shift+ArrowLeft'], (c) => c.nudge(nudgeShift ? -10 : -1, 0), {
    needsEdit: true,
    needsSelection: true,
    palette: false,
  }),
  def('nudgeRight', '向右移动', ['ArrowRight', 'Shift+ArrowRight'], (c) => c.nudge(nudgeShift ? 10 : 1, 0), {
    needsEdit: true,
    needsSelection: true,
    palette: false,
  }),
  def('nudgeUp', '向上移动', ['ArrowUp', 'Shift+ArrowUp'], (c) => c.nudge(0, nudgeShift ? -10 : -1), {
    needsEdit: true,
    needsSelection: true,
    palette: false,
  }),
  def('nudgeDown', '向下移动', ['ArrowDown', 'Shift+ArrowDown'], (c) => c.nudge(0, nudgeShift ? 10 : 1), {
    needsEdit: true,
    needsSelection: true,
    palette: false,
  }),
])
