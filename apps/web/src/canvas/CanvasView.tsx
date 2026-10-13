import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  ArrowDownToLine,
  ArrowUpRight,
  ArrowUpToLine,
  Copy,
  FileOutput,
  FilePlus2,
  Files,
  LogIn,
  Maximize,
  Pencil,
  Shapes,
  StickyNote,
  Table2,
  Trash2,
  Type,
} from 'lucide-react'
import { useStore } from '../lib/store'
import { cls } from '../lib/format'
import {
  arrowEnds,
  boxOf,
  intersects,
  STICKY_COLORS,
  type CanvasController,
  type CanvasElement,
  type Point,
} from './controller'
import { TextCardBody } from './TextCard'
import { MediaCardBody } from './MediaCard'
import { ArrowLayer } from './ArrowLayer'
import { EmbedCardBody } from './EmbedCard'
import { CanvasToolbar, ZoomControls } from './CanvasToolbar'
import { isTouchDevice } from '../lib/platform'
import { setNudgeShift } from './canvasCommands'
import { Menu, isMenuDismissPress, type MenuEntry } from '../app/Menu'
import {
  clearActiveCanvas,
  dispatchKeyEvent,
  getBindings,
  getCommandContext,
  setActiveCanvas,
  setPrimaryCanvas,
} from '../commands/registry'
import { draggedPageId, isPageDrag } from '../lib/dnd'
import { openPage } from '../embed/status'
import { jumpStore, takeJump } from '../search/jump'
import { pickPageForCanvas } from './canvasCommands'
import { openLightbox } from '../app/Lightbox'
import { assetsMap, getAssetUrl, kindForMime, pickFiles } from '../assets/assetStore'
import { prefs } from '../app/prefs'
import {
  PEN_COLORS,
  PEN_SIZES,
  cachedStrokePath,
  distanceToShape,
  distanceToStroke,
  penColorVar,
  penStyle,
  strokePath,
} from './ink'

/** 这次打开网页以后用过手写笔：之后画笔、橡皮、形状工具下手指只用来拖动和缩放 */
let penSeen = false

type Gesture =
  | { kind: 'pan'; startX: number; startY: number; camX: number; camY: number }
  | { kind: 'pinch'; world: Point; startDist: number; startZoom: number }
  | {
      kind: 'move'
      startWorld: Point
      origins: CanvasElement[]
      moved: boolean
      clickedId: string
      wasSelected: boolean
    }
  | { kind: 'resize'; id: string; startX: number; startW: number; startY: number; startH: number; both: boolean }
  | { kind: 'marquee'; start: Point; base: Set<string> }
  | { kind: 'arrow'; from: { id?: string; point: Point } }
  | { kind: 'draw'; pointerId: number; points: number[]; pressure: boolean; color: string; size: number }
  | { kind: 'erase'; pointerId: number; ids: Set<string> }
  | { kind: 'shape'; shape: 'rect' | 'ellipse'; start: Point; color: string; size: number }

/** 点到的是这个画布里的哪个元素（嵌套画布外层的元素不算） */
const hitIdIn = (viewport: HTMLElement | null, target: EventTarget | null): string | null => {
  const hit = target instanceof Element ? target.closest('[data-el-id]') : null
  return hit && viewport?.contains(hit) ? hit.getAttribute('data-el-id') : null
}

const shortcut = (id: string) => getBindings(id)[0] ?? null

export interface EmbeddedMode {
  /** 激活后才响应鼠标和键盘 */
  active: boolean
  /** 按 Esc（没有别的可以取消时）退出 */
  onExit: () => void
}

/** 最近的画布视口是否就是 viewport（嵌套的画布里发生的事件不归外层管） */
function belongsTo(target: EventTarget | null, viewport: HTMLElement | null): boolean {
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  return !!el && !!viewport && el.closest('.canvas-viewport') === viewport
}

export function CanvasView({ controller, embedded }: { controller: CanvasController; embedded?: EmbeddedMode }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const elements = useStore(controller.elements)
  const selection = useStore(controller.selection)
  const editing = useStore(controller.editing)
  const camera = useStore(controller.camera)
  const tool = useStore(controller.tool)
  const readOnly = useStore(controller.readOnlyStore)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [arrowPreview, setArrowPreview] = useState<[Point, Point] | null>(null)
  /** 正在画的这一笔、正在拖出来的形状、橡皮擦正要擦掉的元素 */
  const [inkPreview, setInkPreview] = useState<{ d: string; color: string } | null>(null)
  const [shapePreview, setShapePreview] = useState<{ shape: 'rect' | 'ellipse'; x: number; y: number; w: number; h: number; color: string; size: number } | null>(null)
  const [erasing, setErasing] = useState<ReadonlySet<string>>(new Set())
  const inkFrame = useRef(0)
  /** 手写笔正按在屏幕上（这时手掌碰到屏幕不算） */
  const penDown = useRef<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [panning, setPanning] = useState(false)
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const lastPointer = useRef<Point | null>(null)
  /** 触屏：识别"轻点两下"（iPhone 上不一定有 dblclick 事件） */
  const touchDown = useRef<{ x: number; y: number; t: number } | null>(null)
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null)
  const suppressDblClickUntil = useRef(0)

  const isEmbedded = !!embedded
  const active = !embedded || embedded.active
  const activeRef = useRef(active)
  activeRef.current = active
  const exitRef = useRef(embedded?.onExit)
  exitRef.current = embedded?.onExit

  useLayoutEffect(() => {
    controller.viewport = viewportRef.current
    return () => {
      if (controller.viewport === viewportRef.current) controller.viewport = null
    }
  }, [controller])

  // 页面本身的画布是"主"画布；嵌入的画布激活时成为活动画布，退出后交还
  useLayoutEffect(() => {
    if (!active) return
    if (isEmbedded) {
      setActiveCanvas(controller)
      controller.focusViewport()
    } else setPrimaryCanvas(controller)
    return () => {
      clearActiveCanvas(controller)
      if (isEmbedded) {
        controller.editing.set(null)
        controller.clearSelection()
        controller.tool.set('select')
      }
    }
  }, [controller, active, isEmbedded])

  useLayoutEffect(() => {
    const el = viewportRef.current!
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 第一次打开、没有保存过视角时，自动"适应全部"
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || !size.w) return
    fitted.current = true
    if (!controller.hadSavedCamera && controller.elements.get().length) controller.fitAll()
  }, [size.w, controller])

  // 从搜索结果跳过来：移到对应元素，选中并闪一下
  useEffect(() => {
    if (isEmbedded) return
    let timer = 0
    const check = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const target = takeJump(controller.pageId, 'canvas')
        const id = target?.elementId
        if (!id || !controller.get(id)) return
        controller.select([id])
        controller.fitTo(controller.boundsOf([id]), 120)
        controller.focusViewport()
        window.setTimeout(() => {
          const node = viewportRef.current?.querySelector(`[data-el-id="${id}"]`)
          if (!node) return
          node.classList.remove('search-flash')
          void (node as HTMLElement).offsetWidth
          node.classList.add('search-flash')
          window.setTimeout(() => node.classList.remove('search-flash'), 1600)
        }, 60)
      }, 120)
    }
    check()
    const off = jumpStore.subscribe(check)
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [controller, isEmbedded])

  // 滚轮：平移；按住 ⌘/Ctrl（触控板捏合也是这样）：缩放。Safari 的捏合手势单独处理。
  useEffect(() => {
    const el = viewportRef.current!
    const onWheel = (e: WheelEvent) => {
      // 已经被里面嵌套的画布处理过；或者没激活（交给外面滚动）
      if (e.defaultPrevented || !activeRef.current) return
      // 正在编辑的嵌入文档：滚动它自己
      if (!(e.ctrlKey || e.metaKey) && e.target instanceof Element && e.target.closest('.card-editing .embed-scroll')) return
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      if (e.ctrlKey || e.metaKey) {
        const delta = Math.max(-25, Math.min(25, e.deltaY * unit))
        controller.zoomAt(Math.exp(-delta * 0.01), e.clientX, e.clientY)
      } else {
        controller.panBy(-e.deltaX * unit, -e.deltaY * unit)
      }
    }
    let lastScale = 1
    const onGestureStart = (e: Event) => {
      if (e.defaultPrevented || !activeRef.current) return
      e.preventDefault()
      lastScale = 1
    }
    const onGestureChange = (e: Event) => {
      if (e.defaultPrevented || !activeRef.current) return
      e.preventDefault()
      const g = e as Event & { scale: number; clientX: number; clientY: number }
      controller.zoomAt(g.scale / lastScale, g.clientX, g.clientY)
      lastScale = g.scale
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
    }
  }, [controller])

  // ---------------- 指针 ----------------

  /**
   * 弹出的菜单、格式工具栏、斜杠菜单是渲染到 body 上的，但 React 会把它们的事件沿组件树冒泡到画布上。
   * 只处理真正发生在画布 DOM 里面的事件。
   */
  const fromInside = (target: EventTarget | null) => activeRef.current && belongsTo(target, viewportRef.current)
  /** 只在这个画布内部找祖先（嵌在别的画布的卡片里时，外层的 .card-editing 等不算） */
  const here = (target: Element, selector: string) => {
    const m = target.closest(selector)
    return m && viewportRef.current?.contains(m) ? m : null
  }
  const hitId = (target: EventTarget | null) => hitIdIn(viewportRef.current, target)

  const startPan = (e: ReactPointerEvent) => {
    const c = controller.camera.get()
    const p = controller.toLocal(e.clientX, e.clientY)
    gesture.current = { kind: 'pan', startX: p.x, startY: p.y, camX: c.x, camY: c.y }
    setPanning(true)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!fromInside(e.target)) return
    const target = e.target as HTMLElement
    if (here(target, '.canvas-ui')) return
    // 点空白处只是为了关掉弹出的菜单：不画、不框选
    if (isMenuDismissPress(e.nativeEvent)) return
    // 手写笔在写的时候，手掌、手指碰到屏幕都不算
    if (e.pointerType === 'touch' && penDown.current !== null) return
    if (e.pointerType === 'pen') penSeen = true
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // 正在编辑的卡片里面、视频播放器、卡片上的按钮：交给它们自己
    if (here(target, '.card-editing') || here(target, '[data-interactive]')) return
    if (e.button === 2) return
    touchDown.current = e.pointerType === 'touch' && pointers.current.size === 1 ? { x: e.clientX, y: e.clientY, t: Date.now() } : null
    e.preventDefault()
    controller.focusViewport()
    if (controller.editing.get()) controller.stopEditing()
    try {
      viewportRef.current?.setPointerCapture(e.pointerId)
    } catch {
      /* 指针已经不存在（例如触摸被系统取消）时忽略 */
    }

    // 两根手指：捏合缩放 + 平移
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      gesture.current = {
        kind: 'pinch',
        world: controller.screenToWorld(mid.x, mid.y),
        startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        startZoom: controller.camera.get().zoom,
      }
      setMarquee(null)
      return
    }
    if (pointers.current.size > 2) return

    const world = controller.screenToWorld(e.clientX, e.clientY)
    const id = hitId(target)
    const el = id ? controller.get(id) : undefined
    const isTouch = e.pointerType === 'touch'

    if (e.button === 1 || tool === 'hand' || spaceDown || readOnly) {
      startPan(e)
      return
    }

    // ---- 画笔、橡皮擦、形状 ----
    const isPen = e.pointerType === 'pen'
    // 用过手写笔以后，手指只负责拖动和缩放；没有笔的设备（手机）上手指也能画
    const fingerNavigates = isTouch && penSeen
    const penEraserEnd = isPen && (e.buttons & 32) !== 0
    const penWritesHere =
      isPen && tool === 'select' && prefs.get().penDraws && (!el || el.type === 'draw' || el.type === 'shape')
    if (penEraserEnd || (tool === 'eraser' && !fingerNavigates)) {
      if (isPen) penDown.current = e.pointerId
      gesture.current = { kind: 'erase', pointerId: e.pointerId, ids: new Set() }
      eraseAt([{ x: e.clientX, y: e.clientY }])
      return
    }
    if ((tool === 'pen' && !fingerNavigates) || penWritesHere) {
      if (isPen) penDown.current = e.pointerId
      const style = penStyle.get()
      gesture.current = {
        kind: 'draw',
        pointerId: e.pointerId,
        points: [world.x, world.y, isPen ? e.pressure || 0.5 : 0.5],
        pressure: isPen,
        color: style.color,
        size: style.size,
      }
      controller.clearSelection()
      scheduleInkPreview()
      return
    }
    if ((tool === 'rect' || tool === 'ellipse') && !fingerNavigates) {
      const style = penStyle.get()
      gesture.current = { kind: 'shape', shape: tool, start: world, color: style.color, size: Math.min(style.size, 4) }
      return
    }
    if (isTouch && (!el || tool !== 'select')) {
      startPan(e)
      return
    }

    if (tool === 'arrow') {
      gesture.current = { kind: 'arrow', from: { id: el && el.type !== 'arrow' ? el.id : undefined, point: world } }
      return
    }

    if (tool === 'text' || tool === 'sticky') {
      if (el && (el.type === 'text' || el.type === 'sticky')) controller.startEditing(el.id)
      else controller.addText({ at: world, sticky: tool === 'sticky' })
      controller.tool.set('select')
      return
    }

    // 选择工具
    if (el && here(target, '[data-resize]')) {
      gesture.current = {
        kind: 'resize',
        id: el.id,
        startX: e.clientX,
        startW: el.w,
        startY: e.clientY,
        startH: el.h,
        both: here(target, '[data-resize]')?.getAttribute('data-resize') === 'both',
      }
      return
    }
    if (el) {
      const wasSelected = controller.selection.get().has(el.id)
      if (e.shiftKey) {
        controller.toggle(el.id)
        if (wasSelected) return
      } else if (!wasSelected) controller.select([el.id])
      const origins = [...controller.selection.get()]
        .map((sid) => controller.get(sid))
        .filter((x): x is CanvasElement => !!x)
      gesture.current = { kind: 'move', startWorld: world, origins, moved: false, clickedId: el.id, wasSelected }
      return
    }

    // 空白处：框选
    gesture.current = {
      kind: 'marquee',
      start: controller.toLocal(e.clientX, e.clientY),
      base: e.shiftKey ? new Set(controller.selection.get()) : new Set(),
    }
    if (!e.shiftKey) controller.clearSelection()
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    lastPointer.current = { x: e.clientX, y: e.clientY }
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return
    const zoom = controller.camera.get().zoom

    switch (g.kind) {
      case 'pan': {
        const p = controller.toLocal(e.clientX, e.clientY)
        controller.setCamera({ ...controller.camera.get(), x: g.camX + p.x - g.startX, y: g.camY + p.y - g.startY })
        break
      }
      case 'pinch': {
        if (pointers.current.size < 2) return
        const [a, b] = [...pointers.current.values()]
        const mid = controller.toLocal((a.x + b.x) / 2, (a.y + b.y) / 2)
        const nextZoom = g.startZoom * (Math.hypot(a.x - b.x, a.y - b.y) / g.startDist)
        controller.setCamera({ zoom: nextZoom, x: mid.x - g.world.x * nextZoom, y: mid.y - g.world.y * nextZoom })
        // setCamera 会把缩放限制在范围内，重新按实际缩放算一次位置
        const z = controller.camera.get().zoom
        controller.setCamera({ zoom: z, x: mid.x - g.world.x * z, y: mid.y - g.world.y * z })
        break
      }
      case 'move': {
        const world = controller.screenToWorld(e.clientX, e.clientY)
        const dx = world.x - g.startWorld.x
        const dy = world.y - g.startWorld.y
        if (!g.moved && Math.hypot(dx * zoom, dy * zoom) < 3) return
        g.moved = true
        const patches: Parameters<CanvasController['update']>[0] = {}
        for (const o of g.origins) {
          if (o.type === 'arrow') {
            patches[o.id] = {
              ...(o.fromId ? {} : { fromX: o.fromX + dx, fromY: o.fromY + dy }),
              ...(o.toId ? {} : { toX: o.toX + dx, toY: o.toY + dy }),
            }
          } else patches[o.id] = { x: o.x + dx, y: o.y + dy }
        }
        controller.update(patches)
        break
      }
      case 'resize': {
        const el = controller.get(g.id)
        if (!el) return
        const min = el.type === 'media' ? 80 : el.type === 'embed' ? 200 : el.type === 'draw' || el.type === 'shape' ? 10 : 120
        const k = zoom * controller.screenScale()
        const w = Math.max(min, g.startW + (e.clientX - g.startX) / k)
        const minH = el.type === 'embed' ? 120 : 10
        if (g.both) controller.update({ [g.id]: { w, h: Math.max(minH, g.startH + (e.clientY - g.startY) / k) } })
        else controller.update({ [g.id]: { w } })
        break
      }
      case 'marquee': {
        const cur = controller.toLocal(e.clientX, e.clientY)
        const box = {
          x: Math.min(g.start.x, cur.x),
          y: Math.min(g.start.y, cur.y),
          w: Math.abs(cur.x - g.start.x),
          h: Math.abs(cur.y - g.start.y),
        }
        setMarquee(box)
        const c = controller.camera.get()
        const worldBox = { x: (box.x - c.x) / c.zoom, y: (box.y - c.y) / c.zoom, w: box.w / c.zoom, h: box.h / c.zoom }
        const hits = controller.elements.get().filter((el) => {
          if (el.type !== 'arrow') return intersects(boxOf(el), worldBox)
          const ends = arrowEnds(el, (id) => controller.get(id))
          if (!ends) return false
          const mid = { x: (ends[0].x + ends[1].x) / 2, y: (ends[0].y + ends[1].y) / 2 }
          return intersects({ ...mid, w: 0.1, h: 0.1 }, worldBox)
        })
        controller.selection.set(new Set([...g.base, ...hits.map((el) => el.id)]))
        break
      }
      case 'draw': {
        if (e.pointerId !== g.pointerId) return
        // 手写笔一帧里会有好几个点，都要（笔迹才圆滑）
        const events = e.nativeEvent.getCoalescedEvents?.() ?? []
        for (const ev of events.length ? events : [e.nativeEvent]) {
          const p = controller.screenToWorld(ev.clientX, ev.clientY)
          g.points.push(p.x, p.y, g.pressure ? ev.pressure || 0.5 : 0.5)
        }
        scheduleInkPreview()
        break
      }
      case 'erase': {
        if (e.pointerId !== g.pointerId) return
        const events = e.nativeEvent.getCoalescedEvents?.() ?? []
        eraseAt((events.length ? events : [e.nativeEvent]).map((ev) => ({ x: ev.clientX, y: ev.clientY })))
        break
      }
      case 'shape': {
        const world = controller.screenToWorld(e.clientX, e.clientY)
        let w = world.x - g.start.x
        let h = world.y - g.start.y
        // 按住 Shift：正方形 / 正圆
        if (e.shiftKey) {
          const m = Math.max(Math.abs(w), Math.abs(h))
          w = Math.sign(w || 1) * m
          h = Math.sign(h || 1) * m
        }
        setShapePreview({
          shape: g.shape,
          x: Math.min(g.start.x, g.start.x + w),
          y: Math.min(g.start.y, g.start.y + h),
          w: Math.abs(w),
          h: Math.abs(h),
          color: g.color,
          size: g.size,
        })
        break
      }
      case 'arrow': {
        const world = controller.screenToWorld(e.clientX, e.clientY)
        const fake: CanvasElement = {
          id: '_preview',
          type: 'arrow',
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          z: '',
          color: null,
          assetId: null,
          pageId: null,
          points: null,
          pw: 0,
          ph: 0,
          pressure: false,
          shape: null,
          size: 0,
          fromId: g.from.id ?? null,
          toId: null,
          fromX: g.from.point.x,
          fromY: g.from.point.y,
          toX: world.x,
          toY: world.y,
        }
        setArrowPreview(arrowEnds(fake, (id) => controller.get(id)))
        break
      }
    }
  }

  /** 触屏轻点：两次轻点离得近、间隔短，就当作双击 */
  const detectDoubleTap = (e: ReactPointerEvent<HTMLDivElement>) => {
    const down = touchDown.current
    touchDown.current = null
    if (e.pointerType !== 'touch' || !down) return
    const now = Date.now()
    const isTap = now - down.t < 350 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10
    if (!isTap) {
      lastTap.current = null
      return
    }
    const prev = lastTap.current
    if (prev && now - prev.t < 400 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30) {
      lastTap.current = null
      suppressDblClickUntil.current = now + 600
      doubleAt(e.clientX, e.clientY)
    } else {
      lastTap.current = { x: e.clientX, y: e.clientY, t: now }
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (penDown.current === e.pointerId) penDown.current = null
    detectDoubleTap(e)
    const g = gesture.current
    if (!g) return
    if ((g.kind === 'draw' || g.kind === 'erase') && e.pointerId !== g.pointerId) return
    if (g.kind === 'pinch') {
      if (pointers.current.size === 0) gesture.current = null
      return
    }
    gesture.current = null
    if (viewportRef.current?.hasPointerCapture(e.pointerId)) viewportRef.current.releasePointerCapture(e.pointerId)

    if (g.kind === 'pan') setPanning(false)
    if (g.kind === 'marquee') setMarquee(null)
    if (g.kind === 'draw') {
      cancelAnimationFrame(inkFrame.current)
      setInkPreview(null)
      controller.addDrawing(g.points, { color: g.color, size: g.size, pressure: g.pressure })
    }
    if (g.kind === 'erase') {
      setErasing(new Set())
      controller.eraseElements([...g.ids])
    }
    if (g.kind === 'shape') {
      setShapePreview(null)
      const world = controller.screenToWorld(e.clientX, e.clientY)
      const zoom = controller.camera.get().zoom
      let w = world.x - g.start.x
      let h = world.y - g.start.y
      if (e.shiftKey) {
        const m = Math.max(Math.abs(w), Math.abs(h))
        w = Math.sign(w || 1) * m
        h = Math.sign(h || 1) * m
      }
      // 只点了一下：放一个默认大小的
      const tiny = Math.abs(w) * zoom < 6 && Math.abs(h) * zoom < 6
      const rect = tiny
        ? { x: g.start.x - 80, y: g.start.y - 50, w: 160, h: 100 }
        : { x: Math.min(g.start.x, g.start.x + w), y: Math.min(g.start.y, g.start.y + h), w: Math.abs(w), h: Math.abs(h) }
      controller.addShape(g.shape, rect, { color: g.color, size: g.size })
      controller.tool.set('select')
    }
    if (g.kind === 'move' && !g.moved && g.wasSelected && !e.shiftKey && controller.selection.get().size > 1) {
      // 在多选里点其中一个（没拖动）= 只选它
      controller.select([g.clickedId])
    }
    if (g.kind === 'arrow') {
      setArrowPreview(null)
      const world = controller.screenToWorld(e.clientX, e.clientY)
      const under = hitId(document.elementFromPoint(e.clientX, e.clientY))
      const toEl = under ? controller.get(under) : undefined
      const toId = toEl && toEl.type !== 'arrow' && toEl.id !== g.from.id ? toEl.id : undefined
      const dist = Math.hypot(world.x - g.from.point.x, world.y - g.from.point.y) * controller.camera.get().zoom
      if (toId || (dist > 12 && !(toEl && toEl.id === g.from.id))) {
        controller.addArrow(g.from, { id: toId, point: world })
      }
      controller.tool.set('select')
    }
  }

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (penDown.current === e.pointerId) penDown.current = null
    const g = gesture.current
    // 手写笔偶尔会被系统取消（例如手掌误触）：已经画了的部分照样保存
    if (g?.kind === 'draw' && g.pointerId === e.pointerId && g.points.length >= 6)
      controller.addDrawing(g.points, { color: g.color, size: g.size, pressure: g.pressure })
    gesture.current = null
    cancelAnimationFrame(inkFrame.current)
    setInkPreview(null)
    setShapePreview(null)
    setErasing(new Set())
    setMarquee(null)
    setArrowPreview(null)
    setPanning(false)
  }

  /** 画笔：每帧最多重算一次预览 */
  const scheduleInkPreview = () => {
    cancelAnimationFrame(inkFrame.current)
    inkFrame.current = requestAnimationFrame(() => {
      const g = gesture.current
      if (g?.kind !== 'draw') return
      setInkPreview({ d: strokePath(g.points, { size: g.size, pressure: g.pressure }, false), color: g.color })
    })
  }

  /** 橡皮擦：碰到的笔迹和形状先变淡，松手时一起删掉 */
  const eraseAt = (points: Point[]) => {
    const g = gesture.current
    if (g?.kind !== 'erase') return
    const zoom = controller.camera.get().zoom
    const radius = 10 / zoom
    let changed = false
    for (const sp of points) {
      const p = controller.screenToWorld(sp.x, sp.y)
      for (const el of controller.elements.get()) {
        if ((el.type !== 'draw' && el.type !== 'shape') || g.ids.has(el.id)) continue
        const reach = radius + el.size
        if (p.x < el.x - reach || p.x > el.x + el.w + reach || p.y < el.y - reach || p.y > el.y + el.h + reach) continue
        const d = el.type === 'draw' ? distanceToStroke(el, p.x, p.y) : distanceToShape(el, p.x, p.y)
        if (d <= reach) {
          g.ids.add(el.id)
          changed = true
        }
      }
    }
    if (changed) setErasing(new Set(g.ids))
  }

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!fromInside(e.target)) return
    // 触屏上已经按"轻点两下"处理过了
    if (Date.now() < suppressDblClickUntil.current) return
    doubleAt(e.clientX, e.clientY)
  }

  const doubleAt = (clientX: number, clientY: number) => {
    // 按下时画布捕获了指针，dblclick 的 target 会是画布本身，所以按坐标找实际点到的元素
    const under = document.elementFromPoint(clientX, clientY)
    if (!fromInside(under)) return
    const target = under as HTMLElement
    if (here(target, '.card-editing') || here(target, '.canvas-ui') || here(target, '[data-interactive]')) return
    const id = hitId(target)
    const el = id ? controller.get(id) : undefined
    if (el && (el.type === 'text' || el.type === 'sticky' || el.type === 'embed')) {
      controller.startEditing(el.id, { x: clientX, y: clientY })
      return
    }
    if (el?.type === 'media' && el.assetId) {
      const meta = assetsMap.get(el.assetId)
      if (meta && kindForMime(meta.mime) === 'image') {
        void getAssetUrl(el.assetId).then((url) => url && openLightbox(url, meta.name))
      }
      return
    }
    if (!el && tool === 'select' && !readOnly) controller.addText({ at: controller.screenToWorld(clientX, clientY) })
  }

  // ---------------- 右键菜单 ----------------

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!fromInside(e.target)) return
    const target = e.target as HTMLElement
    if (here(target, '.card-editing') || here(target, '.canvas-ui')) return
    e.preventDefault()
    if (readOnly) return
    // 写字、擦除、画形状时笔停住不动（长按）不弹菜单
    const g = gesture.current
    if (penDown.current !== null || g?.kind === 'draw' || g?.kind === 'erase' || g?.kind === 'shape') return
    const id = hitId(target)
    if (id && !controller.selection.get().has(id)) controller.select([id])
    const at = controller.screenToWorld(e.clientX, e.clientY)
    let items: MenuEntry[]
    if (id) {
      const sel = [...controller.selection.get()].map((sid) => controller.get(sid)).filter((x): x is CanvasElement => !!x)
      const single = sel.length === 1 ? sel[0] : null
      const isCard = single && (single.type === 'text' || single.type === 'sticky')
      const embedEl = single?.type === 'embed' && single.pageId ? single : null
      items = [
        ...(isCard
          ? [
              { label: '编辑文字', icon: Pencil, shortcut: shortcut('canvas.edit'), onSelect: () => controller.startEditing(single.id) },
              { label: '转为文档页面', icon: FileOutput, onSelect: () => void controller.promoteToPage(single.id) },
            ]
          : []),
        ...(embedEl
          ? [
              { label: '打开页面', icon: ArrowUpRight, shortcut: shortcut('canvas.openEmbed'), onSelect: () => openPage(embedEl.pageId!, controller.path) },
              { label: '进入编辑', icon: LogIn, shortcut: shortcut('canvas.edit'), onSelect: () => controller.startEditing(embedEl.id) },
            ]
          : []),
        { label: '复制一份', icon: Copy, shortcut: shortcut('canvas.duplicate'), onSelect: () => controller.duplicateSelection() },
        { label: '置于顶层', icon: ArrowUpToLine, shortcut: shortcut('canvas.front'), onSelect: () => controller.reorder('front') },
        { label: '置于底层', icon: ArrowDownToLine, shortcut: shortcut('canvas.back'), onSelect: () => controller.reorder('back') },
        ...(sel.some((el) => el.type === 'draw' || el.type === 'shape')
          ? ([
              'separator',
              ...PEN_COLORS.map((c) => ({
                label: `颜色：${c.label}`,
                icon: () => <span className="color-dot" style={{ background: penColorVar(c.id) }} />,
                onSelect: () => controller.setColor(c.id),
              })),
              ...PEN_SIZES.map((sz) => ({
                label: `线条：${sz.label}`,
                icon: () => <span className="size-dot" style={{ width: sz.id + 4, height: sz.id + 4 }} />,
                onSelect: () => controller.setStrokeSize(sz.id),
              })),
            ] as MenuEntry[])
          : []),
        ...(sel.some((el) => el.type === 'sticky')
          ? (['separator', ...STICKY_COLORS.map((c) => ({
              label: `便签颜色：${c.label}`,
              icon: () => <span className={`color-dot sticky-${c.id}`} />,
              onSelect: () => controller.setColor(c.id),
            }))] as MenuEntry[])
          : []),
        'separator',
        {
          label: sel.length === 1 && sel[0].type === 'embed' ? '移除嵌入（页面还在）' : '删除',
          icon: Trash2,
          danger: true,
          shortcut: shortcut('canvas.delete'),
          onSelect: () => controller.deleteSelection(),
        },
      ]
    } else {
      items = [
        { label: '在这里添加文字', icon: Type, onSelect: () => controller.addText({ at }) },
        { label: '在这里添加便签', icon: StickyNote, onSelect: () => controller.addText({ at, sticky: true }) },
        { label: '在这里插入表格', icon: Table2, onSelect: () => controller.addText({ at, table: true }) },
        {
          label: '插入图片或文件…',
          icon: FilePlus2,
          onSelect: () => void pickFiles().then((files) => controller.addFiles(files, at)),
        },
        'separator',
        { label: '在这里新建文档', icon: FilePlus2, onSelect: () => controller.createEmbeddedPage('doc', at) },
        { label: '在这里新建画布', icon: Shapes, onSelect: () => controller.createEmbeddedPage('canvas', at) },
        { label: '嵌入已有页面…', icon: Files, onSelect: () => pickPageForCanvas(controller, at) },
        'separator',
        { label: '适应窗口', icon: Maximize, shortcut: shortcut('canvas.fitAll'), onSelect: () => controller.fitAll() },
      ]
    }
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  // ---------------- 键盘、剪贴板、拖放 ----------------

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // 卡片里的编辑器已经处理过的按键（例如 Esc 退出编辑）不再当作画布快捷键
    if (e.defaultPrevented || !fromInside(e.target)) return
    const target = e.target as HTMLElement
    if (here(target, '.card-editing') || here(target, '.canvas-ui')) return
    // 标记着"正在编辑"但焦点不在卡片里（比如点了别处）：先结束编辑，按键照常处理
    if (controller.editing.get()) {
      controller.stopEditing()
      if (e.key === 'Escape') {
        e.preventDefault()
        return
      }
    }
    if (e.key === ' ' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      if (!e.repeat) setSpaceDown(true)
      return
    }
    setNudgeShift(e.shiftKey)
    const handled = dispatchKeyEvent(e.nativeEvent, ['canvas', 'global'], { canvas: controller })
    if (!handled && e.key === 'Escape' && exitRef.current) {
      e.preventDefault()
      exitRef.current()
    }
  }

  const onFocus = (e: ReactFocusEvent<HTMLDivElement>) => {
    // 嵌入的画布获得焦点时成为活动画布
    if (isEmbedded && active && e.target === viewportRef.current) setActiveCanvas(controller)
  }

  const onKeyUp = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ') setSpaceDown(false)
  }

  const pointerWorld = (): Point | undefined => {
    const p = lastPointer.current
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!p || !rect || p.x < rect.left || p.x > rect.right || p.y < rect.top || p.y > rect.bottom) return undefined
    return controller.screenToWorld(p.x, p.y)
  }

  // 复制、剪切、粘贴：没有选中文字时浏览器可能把事件发给 body 而不是画布，所以在 document 上监听，
  // 只要焦点在画布里（且不是在编辑卡片文字）就处理
  useEffect(() => {
    const ownsFocus = () => {
      const vp = viewportRef.current
      const focused = document.activeElement
      if (!vp || !activeRef.current || controller.editing.get()) return false
      if (focused instanceof Element && here(focused, '.card-editing')) return false
      if (!focused || focused === document.body) return getCommandContext().canvas === controller
      return belongsTo(focused, vp)
    }
    const onCopy = (e: ClipboardEvent) => {
      if (!e.clipboardData || !ownsFocus()) return
      if (controller.copySelection(e.clipboardData)) e.preventDefault()
    }
    const onCut = (e: ClipboardEvent) => {
      if (!e.clipboardData || readOnly || !ownsFocus()) return
      if (controller.cutSelection(e.clipboardData)) e.preventDefault()
    }
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData || readOnly || !ownsFocus()) return
      if (controller.paste(e.clipboardData, pointerWorld())) e.preventDefault()
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
    // pointerWorld 只读 ref，不需要作为依赖
  }, [controller, readOnly])

  const onDragOver = (e: ReactDragEvent) => {
    if (e.defaultPrevented || !fromInside(e.target) || readOnly) return
    if (![...e.dataTransfer.types].includes('Files') && !isPageDrag(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (e: ReactDragEvent) => {
    if (e.defaultPrevented || !fromInside(e.target) || readOnly) return
    const at = controller.screenToWorld(e.clientX, e.clientY)
    // 从侧边栏拖来的页面：嵌入
    const pageId = draggedPageId(e.dataTransfer)
    if (pageId) {
      e.preventDefault()
      controller.addEmbed(pageId, { at })
      controller.focusViewport()
      return
    }
    if (!e.dataTransfer.files.length) return
    e.preventDefault()
    void controller.addFiles([...e.dataTransfer.files], at)
  }

  // ---------------- 渲染 ----------------

  const { x, y, zoom } = camera
  // 只渲染视口附近的元素
  const margin = Math.max(size.w, size.h) / zoom / 2
  const view = { x: -x / zoom - margin, y: -y / zoom - margin, w: size.w / zoom + margin * 2, h: size.h / zoom + margin * 2 }
  const cards = elements.filter(
    (el) => el.type !== 'arrow' && (intersects(boxOf(el), view) || el.id === editing || selection.has(el.id)),
  )
  let grid = 24 * zoom
  while (grid < 12) grid *= 4

  return (
    <div
      ref={viewportRef}
      className={cls(
        'canvas-viewport',
        `tool-${tool}`,
        (spaceDown || panning) && 'is-panning',
        readOnly && 'is-readonly',
        isEmbedded && 'is-embedded',
        isEmbedded && (active ? 'is-active' : 'is-inactive'),
      )}
      tabIndex={active ? 0 : -1}
      aria-label={isEmbedded ? '嵌入的画布' : '画布'}
      style={{ backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${x}px ${y}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onFocus={onFocus}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="canvas-world" style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }}>
        <ArrowLayer elements={elements} selection={selection} preview={arrowPreview} />
        {(inkPreview || shapePreview) && (
          <svg className="ink-preview" aria-hidden>
            {inkPreview && <path d={inkPreview.d} fill={penColorVar(inkPreview.color)} />}
            {shapePreview &&
              (shapePreview.shape === 'ellipse' ? (
                <ellipse
                  cx={shapePreview.x + shapePreview.w / 2}
                  cy={shapePreview.y + shapePreview.h / 2}
                  rx={shapePreview.w / 2}
                  ry={shapePreview.h / 2}
                  fill="none"
                  stroke={penColorVar(shapePreview.color)}
                  strokeWidth={shapePreview.size}
                />
              ) : (
                <rect
                  x={shapePreview.x}
                  y={shapePreview.y}
                  width={shapePreview.w}
                  height={shapePreview.h}
                  rx={6}
                  fill="none"
                  stroke={penColorVar(shapePreview.color)}
                  strokeWidth={shapePreview.size}
                />
              ))}
          </svg>
        )}
        {cards.map((el) => (
          <ElementView
            key={el.id}
            el={el}
            controller={controller}
            selected={selection.has(el.id)}
            single={selection.size === 1}
            editing={editing === el.id}
            compact={el.type === 'embed' && (el.w * zoom < 200 || el.h * zoom < 120)}
            erasing={erasing.has(el.id)}
            readOnly={readOnly}
          />
        ))}
      </div>
      {marquee && (
        <div className="canvas-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
      )}
      {elements.length === 0 && (active || !isEmbedded) && !readOnly && (
        <div className="canvas-empty">
          {isTouchDevice() ? '轻点两下空白处写字，或者用下面的工具条添加' : '双击空白处写字，或者把图片、文件、页面拖进来'}
        </div>
      )}
      {elements.length === 0 && isEmbedded && !active && <div className="canvas-empty">空画布</div>}
      {active && !readOnly && <CanvasToolbar controller={controller} tool={tool} />}
      {active && <ZoomControls controller={controller} zoom={zoom} />}
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}

const ElementView = memo(function ElementView({
  el,
  controller,
  selected,
  single,
  editing,
  compact,
  erasing,
  readOnly,
}: {
  el: CanvasElement
  controller: CanvasController
  selected: boolean
  single: boolean
  editing: boolean
  /** 嵌入的页面在屏幕上太小时只显示标题 */
  compact: boolean
  /** 橡皮擦正要擦掉它 */
  erasing: boolean
  readOnly: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const fixedHeight = el.type === 'embed' || el.type === 'draw' || el.type === 'shape'

  // 卡片高度由内容决定：量出来写回数据（用于框选、箭头、"适应全部"）。嵌入的页面高度是固定的
  useLayoutEffect(() => {
    const node = ref.current
    if (!node || readOnly || fixedHeight) return
    const ro = new ResizeObserver(() => controller.setMeasuredHeight(el.id, node.offsetHeight))
    ro.observe(node)
    return () => ro.disconnect()
  }, [controller, el.id, fixedHeight, readOnly])

  const fragment = el.type === 'text' || el.type === 'sticky' ? controller.fragment(el.id) : null

  return (
    <div
      ref={ref}
      data-el-id={el.id}
      className={cls(
        'canvas-el',
        `el-${el.type}`,
        el.type === 'sticky' && `sticky-${el.color ?? 'yellow'}`,
        selected && 'is-selected',
        editing && 'card-editing',
        erasing && 'is-erasing',
      )}
      style={{ left: el.x, top: el.y, width: el.w, height: fixedHeight ? el.h : undefined }}
    >
      {el.type === 'media' ? (
        <MediaCardBody assetId={el.assetId} selected={selected} />
      ) : el.type === 'embed' ? (
        <EmbedCardBody controller={controller} el={el} editing={editing} compact={compact} />
      ) : el.type === 'draw' ? (
        <DrawBody el={el} />
      ) : el.type === 'shape' ? (
        <ShapeBody el={el} />
      ) : fragment ? (
        <TextCardBody controller={controller} id={el.id} fragment={fragment} editing={editing} />
      ) : null}
      {selected && single && !editing && !readOnly &&
        (fixedHeight ? (
          <span className="el-resize-corner" data-resize="both" title="拖动调整大小" />
        ) : (
          <span className="el-resize" data-resize="" title="拖动调整宽度" />
        ))}
    </div>
  )
})

/** 手写的一笔：按画的时候的外框画，元素被拉伸时整体缩放 */
function DrawBody({ el }: { el: CanvasElement }) {
  if (!el.points) return null
  const d = cachedStrokePath(el.points, { size: el.size, pressure: el.pressure })
  return (
    <svg className="ink-svg" viewBox={`0 0 ${el.pw || el.w} ${el.ph || el.h}`} preserveAspectRatio="none" aria-hidden>
      <path className="ink-hit" d={d} />
      <path className="ink-fill" d={d} fill={penColorVar(el.color)} />
    </svg>
  )
}

/** 矩形、椭圆：只有边框，点边框才选得中（框里面的卡片照样能点） */
function ShapeBody({ el }: { el: CanvasElement }) {
  const sw = el.size
  const w = Math.max(0, el.w - sw)
  const h = Math.max(0, el.h - sw)
  const color = penColorVar(el.color)
  const shape =
    el.shape === 'ellipse' ? (
      <ellipse cx={el.w / 2} cy={el.h / 2} rx={w / 2} ry={h / 2} />
    ) : (
      <rect x={sw / 2} y={sw / 2} width={w} height={h} rx={Math.min(8, w / 4, h / 4)} />
    )
  return (
    <svg className="shape-svg" width={el.w} height={el.h} aria-hidden>
      <g className="ink-hit">{shape}</g>
      <g fill="none" stroke={color} strokeWidth={sw}>
        {shape}
      </g>
    </svg>
  )
}
