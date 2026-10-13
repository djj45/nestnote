import { useState, type ComponentType } from 'react'
import {
  Circle,
  Eraser,
  PenLine,
  Square,
  FilePlus2,
  Files,
  Hand,
  ImagePlus,
  Layers,
  Maximize,
  Minus,
  MousePointer2,
  MoveUpRight,
  Plus,
  Shapes,
  StickyNote,
  Table2,
  Type,
} from 'lucide-react'
import { Menu } from '../app/Menu'
import { eraseSelectionIfAny, pickPageForCanvas } from './canvasCommands'
import { useTitleWithShortcut } from '../app/Kbd'
import { cls } from '../lib/format'
import { pickFiles } from '../assets/assetStore'
import type { CanvasController, Tool } from './controller'
import { useStore } from '../lib/store'
import { PEN_COLORS, PEN_SIZES, penColorVar, penStyle, setPenStyle } from './ink'

/** 上次用的是矩形还是椭圆（形状按钮显示哪个） */
let lastShape: 'rect' | 'ellipse' = 'rect'

function ToolButton({
  label,
  commandId,
  icon: Icon,
  active,
  onClick,
}: {
  label: string
  commandId: string
  icon: ComponentType<{ className?: string }>
  active?: boolean
  onClick: () => void
}) {
  const title = useTitleWithShortcut(label, commandId)
  return (
    <button
      className={cls('tool-btn', active && 'is-active')}
      title={title}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon className="icon" />
    </button>
  )
}

/** 画布底部的工具条 */
export function CanvasToolbar({ controller, tool }: { controller: CanvasController; tool: Tool }) {
  const [embedMenu, setEmbedMenu] = useState<{ x: number; y: number } | null>(null)
  const [shapeMenu, setShapeMenu] = useState<{ x: number; y: number } | null>(null)
  if (tool === 'rect' || tool === 'ellipse') lastShape = tool
  const ShapeIcon = lastShape === 'ellipse' ? Circle : Square
  const inkTool = tool === 'pen' || tool === 'rect' || tool === 'ellipse'
  const hasSelection = useStore(controller.selection).size > 0
  const setTool = (t: Tool) => () => {
    controller.tool.set(t)
    controller.focusViewport()
  }
  return (
    <>
    {inkTool && <InkOptions />}
    <div className="canvas-toolbar canvas-ui" role="toolbar" aria-label="画布工具">
      <ToolButton label="选择" commandId="canvas.tool.select" icon={MousePointer2} active={tool === 'select'} onClick={setTool('select')} />
      <ToolButton label="抓手（拖动画布）" commandId="canvas.tool.hand" icon={Hand} active={tool === 'hand'} onClick={setTool('hand')} />
      <span className="tool-sep" />
      <ToolButton label="文字" commandId="canvas.tool.text" icon={Type} active={tool === 'text'} onClick={setTool('text')} />
      <ToolButton label="便签" commandId="canvas.tool.sticky" icon={StickyNote} active={tool === 'sticky'} onClick={setTool('sticky')} />
      <ToolButton
        label="表格"
        commandId="canvas.insertTable"
        icon={Table2}
        onClick={() => {
          controller.addText({ table: true })
        }}
      />
      <ToolButton label="箭头" commandId="canvas.tool.arrow" icon={MoveUpRight} active={tool === 'arrow'} onClick={setTool('arrow')} />
      <ToolButton label="画笔" commandId="canvas.tool.pen" icon={PenLine} active={tool === 'pen'} onClick={setTool('pen')} />
      <ToolButton
        label={hasSelection && tool !== 'eraser' ? '删除选中的元素' : '橡皮擦'}
        commandId="canvas.tool.eraser"
        icon={Eraser}
        active={tool === 'eraser'}
        onClick={() => {
          if (eraseSelectionIfAny(controller)) controller.focusViewport()
          else setTool('eraser')()
        }}
      />
      <button
        className={cls('tool-btn', (tool === 'rect' || tool === 'ellipse') && 'is-active')}
        title="形状：矩形、椭圆（R / O）"
        aria-label="形状"
        aria-haspopup="menu"
        onClick={(e) => {
          if (tool !== lastShape) {
            controller.tool.set(lastShape)
            controller.focusViewport()
            return
          }
          const rect = e.currentTarget.getBoundingClientRect()
          setShapeMenu({ x: rect.left, y: rect.top - 6 })
        }}
      >
        <ShapeIcon className="icon" />
      </button>
      {shapeMenu && (
        <Menu
          x={shapeMenu.x}
          y={shapeMenu.y}
          onClose={() => setShapeMenu(null)}
          items={[
            { label: '矩形', icon: Square, onSelect: () => { controller.tool.set('rect'); controller.focusViewport() } },
            { label: '椭圆', icon: Circle, onSelect: () => { controller.tool.set('ellipse'); controller.focusViewport() } },
          ]}
        />
      )}
      <ToolButton
        label="图片、视频或文件"
        commandId="canvas.insertFile"
        icon={ImagePlus}
        onClick={() => void pickFiles().then((files) => controller.addFiles(files))}
      />
      <button
        className={cls('tool-btn', embedMenu && 'is-active')}
        title="嵌入页面（也可以从侧边栏把页面拖进来）"
        aria-label="嵌入页面"
        aria-haspopup="menu"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          setEmbedMenu({ x: rect.left, y: rect.top - 6 })
        }}
      >
        <Layers className="icon" />
      </button>
      {embedMenu && (
        <Menu
          x={embedMenu.x}
          y={embedMenu.y}
          onClose={() => setEmbedMenu(null)}
          items={[
            { label: '新建文档', icon: FilePlus2, onSelect: () => controller.createEmbeddedPage('doc') },
            { label: '新建画布', icon: Shapes, onSelect: () => controller.createEmbeddedPage('canvas') },
            { label: '嵌入已有页面…', icon: Files, onSelect: () => pickPageForCanvas(controller) },
          ]}
        />
      )}
    </div>
    </>
  )
}

/** 画笔、形状的颜色和粗细（用画笔或形状工具时显示在工具条上方） */
function InkOptions() {
  const style = useStore(penStyle)
  return (
    <div className="ink-options canvas-ui" role="toolbar" aria-label="笔的颜色和粗细">
      {PEN_COLORS.map((c) => (
        <button
          key={c.id}
          className={cls('ink-color', style.color === c.id && 'is-active')}
          title={c.label}
          aria-label={c.label}
          aria-pressed={style.color === c.id}
          onClick={() => setPenStyle({ color: c.id })}
        >
          <span style={{ background: penColorVar(c.id) }} />
        </button>
      ))}
      <span className="tool-sep" />
      {PEN_SIZES.map((sz) => (
        <button
          key={sz.id}
          className={cls('ink-size', style.size === sz.id && 'is-active')}
          title={`${sz.label}`}
          aria-label={`线条${sz.label}`}
          aria-pressed={style.size === sz.id}
          onClick={() => setPenStyle({ size: sz.id })}
        >
          <span style={{ width: sz.id + 3, height: sz.id + 3, background: penColorVar(style.color) }} />
        </button>
      ))}
    </div>
  )
}

/** 右下角的缩放按钮 */
export function ZoomControls({ controller, zoom }: { controller: CanvasController; zoom: number }) {
  const resetTitle = useTitleWithShortcut('缩放到 100%', 'canvas.zoomReset')
  return (
    <div className="canvas-zoom canvas-ui" role="toolbar" aria-label="缩放">
      <ToolButton label="缩小" commandId="canvas.zoomOut" icon={Minus} onClick={() => controller.zoomAt(1 / 1.25)} />
      <button className="zoom-value" title={resetTitle} onClick={() => controller.resetZoom()}>
        {Math.round(zoom * 100)}%
      </button>
      <ToolButton label="放大" commandId="canvas.zoomIn" icon={Plus} onClick={() => controller.zoomAt(1.25)} />
      <ToolButton label="适应全部" commandId="canvas.fitAll" icon={Maximize} onClick={() => controller.fitAll()} />
    </div>
  )
}
