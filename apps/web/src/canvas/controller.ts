import * as Y from 'yjs'
import { generateJSON, getSchema, type JSONContent } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import { generateNKeysBetween } from 'fractional-indexing'
import { nanoid } from 'nanoid'
import { createStore, type Store } from '../lib/store'
import { addAsset, kindForMime, type AssetMeta } from '../assets/assetStore'
import { cardBaseExtensions } from './cardExtensions'
import { looksLikeMarkdown, markdownToHtml } from '../editor/markdown'
import { showToast } from '../app/toast'
import { requestTitleFocus, setExpanded } from '../app/ui'
import { createPage, getPage, type PageType } from '../store/workspace'
import { withPageDoc } from '../store/docPool'

/**
 * 画布的数据和操作。
 * 每个画布页面的 Yjs 文档里有一个 elements 表：元素 id -> Y.Map（坐标、尺寸、层级、内容……）。
 * 文字卡片的内容是嵌在元素里的 Y.XmlFragment，用和文档一样的编辑器编辑。
 * 卡片的高度由内容决定：界面量出来后写回 h（不进撤销记录）。
 */

export type ElementType = 'text' | 'sticky' | 'media' | 'arrow' | 'embed' | 'draw' | 'shape'

export interface CanvasElement {
  id: string
  type: ElementType
  x: number
  y: number
  w: number
  h: number
  /** 层级（分数索引，越大越靠上） */
  z: string
  /** 便签颜色 */
  color: string | null
  /** 图片、视频、文件 */
  assetId: string | null
  /** 嵌入的页面 */
  pageId: string | null
  /** 画笔：笔迹点 [x, y, 压力, …]（相对元素左上角），pw/ph 是画的时候的宽高 */
  points: number[] | null
  pw: number
  ph: number
  /** 画笔：有没有真实的压力数据（手写笔） */
  pressure: boolean
  /** 形状：rect / ellipse */
  shape: 'rect' | 'ellipse' | null
  /** 画笔和形状的线条粗细 */
  size: number
  /** 箭头：起点和终点要么连着元素，要么是自由的点 */
  fromId: string | null
  toId: string | null
  fromX: number
  fromY: number
  toX: number
  toY: number
}

export interface Camera {
  /** 屏幕坐标 = 世界坐标 × zoom + (x, y) */
  x: number
  y: number
  zoom: number
}

export type Tool = 'select' | 'hand' | 'text' | 'sticky' | 'arrow' | 'pen' | 'eraser' | 'rect' | 'ellipse'

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 不进撤销记录的修改（量出来的高度、自动清理空卡片）。会进撤销记录的修改用控制器自己作为 origin */
export const QUIET_ORIGIN = 'canvas-quiet'

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4

export const STICKY_COLORS = [
  { id: 'yellow', label: '黄色' },
  { id: 'pink', label: '粉色' },
  { id: 'green', label: '绿色' },
  { id: 'blue', label: '蓝色' },
  { id: 'purple', label: '紫色' },
] as const

const CLIPBOARD_TYPE = 'application/x-note-canvas'

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

function readElement(id: string, m: Y.Map<unknown>): CanvasElement {
  const type = m.get('type')
  return {
    id,
    type:
      type === 'sticky' || type === 'media' || type === 'arrow' || type === 'embed' || type === 'draw' || type === 'shape'
        ? type
        : 'text',
    x: num(m.get('x')),
    y: num(m.get('y')),
    w: num(m.get('w'), 280),
    h: num(m.get('h'), 60),
    z: str(m.get('z')) ?? 'a0',
    color: str(m.get('color')),
    assetId: str(m.get('assetId')),
    pageId: str(m.get('pageId')),
    points: Array.isArray(m.get('points')) ? (m.get('points') as number[]) : null,
    pw: num(m.get('pw')),
    ph: num(m.get('ph')),
    pressure: m.get('pressure') === true,
    shape: m.get('shape') === 'ellipse' ? 'ellipse' : m.get('shape') === 'rect' ? 'rect' : null,
    size: num(m.get('size'), 4),
    fromId: str(m.get('fromId')),
    toId: str(m.get('toId')),
    fromX: num(m.get('fromX')),
    fromY: num(m.get('fromY')),
    toX: num(m.get('toX')),
    toY: num(m.get('toY')),
  }
}

const byZ = (a: CanvasElement, b: CanvasElement) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : 1)

let schemaCache: Schema | null = null
function cardSchema(): Schema {
  return (schemaCache ??= getSchema(cardBaseExtensions()))
}

export function boxOf(el: CanvasElement): Rect {
  return { x: el.x, y: el.y, w: el.w, h: el.h }
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/** 箭头两端的实际坐标（连着元素时取元素边框上朝向另一端的点） */
export function arrowEnds(arrow: CanvasElement, lookup: (id: string) => CanvasElement | undefined): [Point, Point] | null {
  const from = arrow.fromId ? lookup(arrow.fromId) : null
  const to = arrow.toId ? lookup(arrow.toId) : null
  if ((arrow.fromId && !from) || (arrow.toId && !to)) return null
  const center = (el: CanvasElement) => ({ x: el.x + el.w / 2, y: el.y + el.h / 2 })
  const p1 = from ? center(from) : { x: arrow.fromX, y: arrow.fromY }
  const p2 = to ? center(to) : { x: arrow.toX, y: arrow.toY }
  const clip = (el: CanvasElement, c: Point, toward: Point): Point => {
    const dx = toward.x - c.x
    const dy = toward.y - c.y
    if (dx === 0 && dy === 0) return c
    const hw = el.w / 2 + 6
    const hh = el.h / 2 + 6
    const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity)
    return t >= 1 ? c : { x: c.x + dx * t, y: c.y + dy * t }
  }
  return [from ? clip(from, p1, p2) : p1, to ? clip(to, p2, p1) : p2]
}

function tableContent(rows = 3, cols = 3): JSONContent {
  const cell = (type: string) => ({ type, content: [{ type: 'paragraph' }] })
  return {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: Array.from({ length: rows }, (_r, r) => ({
          type: 'tableRow',
          content: Array.from({ length: cols }, () => cell(r === 0 ? 'tableHeader' : 'tableCell')),
        })),
      },
    ],
  }
}

function loadCamera(pageId: string): Camera | null {
  try {
    const raw = localStorage.getItem(`note:camera:${pageId}`)
    if (!raw) return null
    const c = JSON.parse(raw)
    if (typeof c?.x === 'number' && typeof c?.y === 'number' && typeof c?.zoom === 'number') return c
  } catch {
    /* 忽略 */
  }
  return null
}

function saveCamera(pageId: string, camera: Camera) {
  try {
    localStorage.setItem(`note:camera:${pageId}`, JSON.stringify(camera))
  } catch {
    /* 忽略 */
  }
}

interface ClipboardPayload {
  kind: 'note-canvas'
  items: Array<{ el: CanvasElement; content?: JSONContent }>
}

/** 同一个浏览器里复制的元素（剪贴板里的自定义格式读不到时用它） */
let internalClipboard: { text: string; payload: ClipboardPayload } | null = null

export class CanvasController {
  readonly map: Y.Map<Y.Map<unknown>>
  readonly undoManager: Y.UndoManager
  readonly tool = createStore<Tool>('select')
  readonly selection = createStore<ReadonlySet<string>>(new Set())
  readonly editing = createStore<string | null>(null)
  readonly elements = createStore<CanvasElement[]>([])
  readonly camera: Store<Camera>
  /** 是否有保存过的视角（没有的话第一次打开时自动"适应全部"） */
  readonly hadSavedCamera: boolean
  /** 从最外层页面到这个画布的路径（包括自己），用来判断嵌入的循环和深度 */
  readonly path: string[]
  /** 视角存在哪（嵌在别处时每个嵌入位置各自一份） */
  readonly cameraKey: string
  viewport: HTMLDivElement | null = null

  private cache = new Map<string, CanvasElement>()
  /** 新建后开始编辑时光标放在开头（表格卡片：放进第一个单元格） */
  private focusStartIds = new Set<string>()
  /** 双击进入编辑时点的位置（屏幕坐标），用来放光标 */
  private editPoint: (Point & { id: string }) | null = null
  private disposers: Array<() => void> = []

  /** 只读（回收站里、或者开了只读模式）。可以随时切换，不用重建画布 */
  readonly readOnlyStore: Store<boolean>

  get readOnly(): boolean {
    return this.readOnlyStore.get()
  }

  setReadOnly(value: boolean) {
    if (value === this.readOnly) return
    if (value) {
      this.editing.set(null)
      this.tool.set('select')
    }
    this.readOnlyStore.set(value)
  }

  constructor(
    readonly pageId: string,
    readonly doc: Y.Doc,
    readOnly: boolean,
    options: { path?: string[]; cameraKey?: string } = {},
  ) {
    this.readOnlyStore = createStore(readOnly)
    this.path = options.path ?? [pageId]
    this.cameraKey = options.cameraKey ?? pageId
    this.map = doc.getMap<Y.Map<unknown>>('elements')
    // 同一个画布可能同时显示在几个地方，各自的撤销只记自己的修改
    this.undoManager = new Y.UndoManager(this.map, { trackedOrigins: new Set([this]), captureTimeout: 400 })
    const saved = loadCamera(this.cameraKey)
    this.hadSavedCamera = !!saved
    this.camera = createStore<Camera>(saved ?? { x: 80, y: 80, zoom: 1 })
    this.rebuild(null)

    const onDeep = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>) => {
      const changed = new Set<string>()
      for (const e of events) {
        if (e.target === this.map) (e as Y.YMapEvent<unknown>).keysChanged.forEach((k) => changed.add(k))
        else if (e.target instanceof Y.Map && e.target.parent === this.map) {
          const id = e.target.get('id')
          if (typeof id === 'string') changed.add(id)
        }
      }
      if (changed.size) this.rebuild(changed)
    }
    this.map.observeDeep(onDeep)
    this.disposers.push(() => this.map.unobserveDeep(onDeep))

    let timer = 0
    this.disposers.push(
      this.camera.subscribe(() => {
        clearTimeout(timer)
        timer = window.setTimeout(() => saveCamera(this.cameraKey, this.camera.get()), 300)
      }),
    )
  }

  dispose() {
    this.disposers.forEach((d) => d())
    this.undoManager.destroy()
  }

  private rebuild(changed: Set<string> | null) {
    if (!changed) {
      this.cache.clear()
      this.map.forEach((m, id) => {
        if (m instanceof Y.Map) this.cache.set(id, readElement(id, m))
      })
    } else {
      for (const id of changed) {
        const m = this.map.get(id)
        if (m instanceof Y.Map) this.cache.set(id, readElement(id, m))
        else this.cache.delete(id)
      }
    }
    this.elements.set([...this.cache.values()].sort(byZ))
    const sel = this.selection.get()
    if ([...sel].some((id) => !this.cache.has(id))) this.selection.set(new Set([...sel].filter((id) => this.cache.has(id))))
    const editing = this.editing.get()
    if (editing && !this.cache.has(editing)) this.editing.set(null)
  }

  get(id: string): CanvasElement | undefined {
    return this.cache.get(id)
  }

  fragment(id: string): Y.XmlFragment | null {
    const content = this.map.get(id)?.get('content')
    return content instanceof Y.XmlFragment ? content : null
  }

  private transact(fn: () => void, origin: unknown = this) {
    this.doc.transact(fn, origin)
  }

  // ---------------- 坐标 ----------------

  viewportRect(): DOMRect | null {
    return this.viewport?.getBoundingClientRect() ?? null
  }

  /** 视口在屏幕上被外层缩放的倍数（嵌在缩放过的画布里时不是 1） */
  screenScale(): number {
    const vp = this.viewport
    if (!vp || !vp.offsetWidth) return 1
    return vp.getBoundingClientRect().width / vp.offsetWidth || 1
  }

  /** 屏幕坐标 → 视口内的坐标（未缩放的像素） */
  toLocal(clientX: number, clientY: number): Point {
    const rect = this.viewportRect()
    const s = this.screenScale()
    return { x: (clientX - (rect?.left ?? 0)) / s, y: (clientY - (rect?.top ?? 0)) / s }
  }

  /** 视口大小（未缩放的像素） */
  viewportSize(): { w: number; h: number } | null {
    const vp = this.viewport
    return vp ? { w: vp.clientWidth, h: vp.clientHeight } : null
  }

  screenToWorld(clientX: number, clientY: number): Point {
    const p = this.toLocal(clientX, clientY)
    const { x, y, zoom } = this.camera.get()
    return { x: (p.x - x) / zoom, y: (p.y - y) / zoom }
  }

  viewportCenter(): Point {
    const size = this.viewportSize()
    if (!size) return { x: 0, y: 0 }
    const { x, y, zoom } = this.camera.get()
    return { x: (size.w / 2 - x) / zoom, y: (size.h / 2 - y) / zoom }
  }

  // ---------------- 视角 ----------------

  setCamera(camera: Camera) {
    this.camera.set({ ...camera, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom)) })
  }

  panBy(dx: number, dy: number) {
    const c = this.camera.get()
    this.camera.set({ ...c, x: c.x + dx, y: c.y + dy })
  }

  /** 以屏幕上某一点为中心缩放（不传就以视口中心） */
  zoomAt(factor: number, clientX?: number, clientY?: number) {
    const size = this.viewportSize()
    if (!size) return
    const local = clientX !== undefined && clientY !== undefined ? this.toLocal(clientX, clientY) : null
    const px = local ? local.x : size.w / 2
    const py = local ? local.y : size.h / 2
    const c = this.camera.get()
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * factor))
    const k = zoom / c.zoom
    this.camera.set({ zoom, x: px - (px - c.x) * k, y: py - (py - c.y) * k })
  }

  resetZoom() {
    this.zoomAt(1 / this.camera.get().zoom)
  }

  boundsOf(ids?: Iterable<string>): Rect | null {
    const list = ids ? [...ids].map((id) => this.cache.get(id)).filter((e): e is CanvasElement => !!e) : [...this.cache.values()]
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const el of list) {
      if (el.type === 'arrow') {
        const ends = arrowEnds(el, (id) => this.cache.get(id))
        if (!ends) continue
        for (const p of ends) {
          minX = Math.min(minX, p.x)
          minY = Math.min(minY, p.y)
          maxX = Math.max(maxX, p.x)
          maxY = Math.max(maxY, p.y)
        }
        continue
      }
      minX = Math.min(minX, el.x)
      minY = Math.min(minY, el.y)
      maxX = Math.max(maxX, el.x + el.w)
      maxY = Math.max(maxY, el.y + el.h)
    }
    if (!Number.isFinite(minX)) return null
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }

  fitTo(bounds: Rect | null, padding = 80) {
    const rect = this.viewportSize()
    if (!rect || !bounds) return
    padding = Math.min(padding, rect.w / 8, rect.h / 8)
    const zoom = Math.min(
      1,
      Math.max(MIN_ZOOM, Math.min((rect.w - padding * 2) / Math.max(bounds.w, 1), (rect.h - padding * 2) / Math.max(bounds.h, 1))),
    )
    this.camera.set({
      zoom,
      x: rect.w / 2 - (bounds.x + bounds.w / 2) * zoom,
      y: rect.h / 2 - (bounds.y + bounds.h / 2) * zoom,
    })
  }

  fitAll() {
    this.fitTo(this.boundsOf())
  }

  fitSelection() {
    const sel = this.selection.get()
    this.fitTo(this.boundsOf(sel.size ? sel : undefined))
  }

  // ---------------- 选择和编辑 ----------------

  select(ids: Iterable<string>, additive = false) {
    const next = new Set(additive ? this.selection.get() : [])
    for (const id of ids) next.add(id)
    this.selection.set(next)
  }

  toggle(id: string) {
    const next = new Set(this.selection.get())
    if (next.has(id)) next.delete(id)
    else next.add(id)
    this.selection.set(next)
  }

  clearSelection() {
    if (this.selection.get().size) this.selection.set(new Set())
  }

  selectAll() {
    this.selection.set(new Set(this.cache.keys()))
  }

  /**
   * 进入编辑：文字卡片、便签是编辑文字；嵌入的页面是进入里面（只读画布里也可以进去看）。
   * clientPoint 是双击的位置，用来放光标。
   */
  startEditing(id: string, clientPoint?: Point) {
    const el = this.cache.get(id)
    if (!el) return
    if (el.type === 'embed' ? !el.pageId : this.readOnly || (el.type !== 'text' && el.type !== 'sticky')) return
    this.editPoint = clientPoint ? { id, ...clientPoint } : null
    this.selection.set(new Set([id]))
    this.editing.set(id)
  }

  /** 这次进入编辑时双击的位置（只取一次） */
  takeEditPoint(id: string): Point | null {
    const p = this.editPoint
    this.editPoint = null
    return p && p.id === id ? { x: p.x, y: p.y } : null
  }

  /** 这张卡片开始编辑时，光标是否应该放在开头（只生效一次） */
  takeFocusStart(id: string): boolean {
    return this.focusStartIds.delete(id)
  }

  stopEditing() {
    if (this.editing.get() === null) return
    this.editing.set(null)
    this.focusViewport()
  }

  focusViewport() {
    this.viewport?.focus({ preventScroll: true })
  }

  /** 编辑结束时内容是空的文字卡片、便签自动删掉（不进撤销记录） */
  removeIfEmpty(id: string) {
    const el = this.cache.get(id)
    if (!el || (el.type !== 'text' && el.type !== 'sticky')) return
    this.transact(() => this.deleteNow([id]), QUIET_ORIGIN)
  }

  // ---------------- 新建 ----------------

  private allocZ(count: number): string[] {
    const list = this.elements.get()
    const top = list.length ? list[list.length - 1].z : null
    try {
      return generateNKeysBetween(top, null, count)
    } catch {
      return generateNKeysBetween(null, null, count)
    }
  }

  private writeElement(id: string, props: Partial<CanvasElement> & { type: ElementType }, z: string, content?: JSONContent) {
    const m = new Y.Map<unknown>()
    this.map.set(id, m)
    m.set('id', id)
    m.set('type', props.type)
    m.set('z', z)
    for (const key of ['x', 'y', 'w', 'h', 'fromX', 'fromY', 'toX', 'toY', 'pw', 'ph', 'size'] as const) {
      if (props[key] !== undefined) m.set(key, Math.round(props[key]! * 100) / 100)
    }
    for (const key of ['color', 'assetId', 'pageId', 'fromId', 'toId', 'shape'] as const) {
      if (props[key]) m.set(key, props[key])
    }
    if (props.points) m.set('points', props.points)
    if (props.pressure) m.set('pressure', true)
    if (props.type === 'text' || props.type === 'sticky') {
      const fragment = new Y.XmlFragment()
      m.set('content', fragment)
      if (content) {
        try {
          prosemirrorJSONToYXmlFragment(cardSchema(), content, fragment)
        } catch {
          /* 内容格式不对时留空 */
        }
      }
    }
  }

  /** 新建文字卡片（或便签、表格），返回 id；不传位置就放在视口中间 */
  addText(options: { at?: Point; sticky?: boolean; table?: boolean; content?: JSONContent; edit?: boolean } = {}): string | null {
    if (this.readOnly) return null
    const id = nanoid(10)
    const at = options.at ?? this.viewportCenter()
    const w = options.table ? 440 : options.sticky ? 220 : 280
    const [z] = this.allocZ(1)
    const content = options.table ? tableContent() : options.content
    this.transact(() =>
      this.writeElement(
        id,
        {
          type: options.sticky ? 'sticky' : 'text',
          x: at.x - (options.at ? 12 : w / 2),
          y: at.y - (options.at ? 20 : 30),
          w,
          h: options.sticky ? 180 : 48,
          color: options.sticky ? 'yellow' : null,
        },
        z,
        content,
      ),
    )
    if (options.table) this.focusStartIds.add(id)
    if (options.edit !== false) this.startEditing(id)
    else this.select([id])
    return id
  }

  /** 把文件存进资源库，作为图片/视频/文件元素放到画布上 */
  async addFiles(files: File[], at?: Point) {
    if (this.readOnly || !files.length) return
    const metas: AssetMeta[] = []
    for (const file of files) {
      if (file.size > 1024 ** 3) {
        showToast(`“${file.name}”超过 1 GB，暂时不支持`, { tone: 'error' })
        continue
      }
      try {
        metas.push(await addAsset(file))
      } catch (err) {
        showToast(`保存“${file.name}”失败：${err instanceof Error ? err.message : String(err)}`, { tone: 'error' })
      }
    }
    if (!metas.length) return
    const origin = at ?? this.viewportCenter()
    const zs = this.allocZ(metas.length)
    const ids: string[] = []
    let cursorX = origin.x
    this.transact(() => {
      metas.forEach((meta, i) => {
        const kind = kindForMime(meta.mime)
        let w = 300
        let h = 72
        if (kind === 'image') {
          w = Math.min(meta.width ?? 360, 480)
          h = meta.width && meta.height ? (w * meta.height) / meta.width : w * 0.66
        } else if (kind === 'video') {
          w = 480
          h = 32 + (meta.width && meta.height ? (w * meta.height) / meta.width : 270)
        } else if (kind === 'audio') {
          w = 320
          h = 96
        }
        const id = nanoid(10)
        this.writeElement(id, { type: 'media', assetId: meta.id, x: cursorX - (at ? 0 : w / 2), y: origin.y - (at ? 0 : h / 2), w, h }, zs[i])
        cursorX += w + 24
        ids.push(id)
      })
    })
    this.select(ids)
  }

  /** 把一个页面嵌到画布上，返回元素 id */
  addEmbed(pageId: string, options: { at?: Point; edit?: boolean } = {}): string | null {
    if (this.readOnly) return null
    if (this.path.includes(pageId)) {
      showToast('不能把页面嵌入到它自己里面', { tone: 'error' })
      return null
    }
    const isCanvas = getPage(pageId)?.type === 'canvas'
    const w = isCanvas ? 520 : 440
    const h = isCanvas ? 360 : 320
    const at = options.at ?? this.viewportCenter()
    const id = nanoid(10)
    const [z] = this.allocZ(1)
    this.transact(() =>
      this.writeElement(
        id,
        { type: 'embed', pageId, x: at.x - (options.at ? 0 : w / 2), y: at.y - (options.at ? 0 : h / 2), w, h },
        z,
      ),
    )
    if (options.edit) this.startEditing(id)
    else this.select([id])
    return id
  }

  /** 新建子文档/子画布（侧边栏里挂在这个画布下面）并嵌在画布上，标题输入框自动获得焦点 */
  createEmbeddedPage(type: PageType, at?: Point, title = '') {
    if (this.readOnly) return
    const pageId = createPage({ type, parentId: this.pageId, title })
    setExpanded(this.pageId, true)
    if (!title) requestTitleFocus(pageId)
    this.addEmbed(pageId, { at, edit: true })
  }

  /**
   * 把文字卡片/便签变成一个子文档：内容搬进新文档（第一行做标题），
   * 卡片原地变成这个文档的嵌入（连着的箭头保留）。
   */
  async promoteToPage(id: string) {
    const el = this.cache.get(id)
    const fragment = this.fragment(id)
    if (this.readOnly || !el || !fragment || (el.type !== 'text' && el.type !== 'sticky')) return
    const json = yXmlFragmentToProsemirrorJSON(fragment) as JSONContent
    const blocks = json.content ?? []
    const first = blocks[0] ? plainText(blocks[0]).trim() : ''
    let title: string
    let body = blocks
    if (first && first.length <= 60 && (blocks[0].type === 'heading' || blocks[0].type === 'paragraph')) {
      title = first.replace(/\s+/g, ' ')
      body = blocks.slice(1)
    } else {
      title = first.length > 30 ? `${first.slice(0, 30)}…` : first
    }
    const pageId = createPage({ type: 'doc', parentId: this.pageId, title })
    setExpanded(this.pageId, true)
    if (body.length) {
      await withPageDoc(pageId, (doc) => {
        prosemirrorJSONToYXmlFragment(cardSchema(), { type: 'doc', content: body }, doc.getXmlFragment('content'))
      })
    }
    const m = this.map.get(id)
    if (!m) return
    this.editing.set(null)
    this.transact(() => {
      m.set('type', 'embed')
      m.set('pageId', pageId)
      m.delete('content')
      m.delete('color')
      m.set('w', Math.max(el.w, 360))
      m.set('h', Math.max(el.h + 48, 220))
    })
    this.select([id])
    showToast(`已转为文档“${title || '无标题'}”`)
  }

  /**
   * 画完一笔：points 是世界坐标 [x, y, 压力, …]。
   * 存成相对外框左上角的坐标（外框留出笔的粗细），保留一位小数省空间。
   */
  addDrawing(points: number[], style: { color: string; size: number; pressure: boolean }): string | null {
    if (this.readOnly || points.length < 3) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < points.length; i += 3) {
      minX = Math.min(minX, points[i])
      minY = Math.min(minY, points[i + 1])
      maxX = Math.max(maxX, points[i])
      maxY = Math.max(maxY, points[i + 1])
    }
    const pad = style.size * 1.5 + 2
    const x = minX - pad
    const y = minY - pad
    const w = maxX - minX + pad * 2
    const h = maxY - minY + pad * 2
    const rel: number[] = []
    for (let i = 0; i < points.length; i += 3) {
      rel.push(
        Math.round((points[i] - x) * 10) / 10,
        Math.round((points[i + 1] - y) * 10) / 10,
        Math.round((points[i + 2] ?? 0.5) * 100) / 100,
      )
    }
    const id = nanoid(10)
    const [z] = this.allocZ(1)
    this.transact(() =>
      this.writeElement(
        id,
        { type: 'draw', x, y, w, h, pw: w, ph: h, points: rel, color: style.color, size: style.size, pressure: style.pressure },
        z,
      ),
    )
    // 每一笔单独一步撤销（写得快时也不和上一笔合在一起）
    this.undoManager.stopCapturing()
    return id
  }

  /** 画一个矩形或椭圆 */
  addShape(shape: 'rect' | 'ellipse', rect: Rect, style: { color: string; size: number }): string | null {
    if (this.readOnly) return null
    const id = nanoid(10)
    const [z] = this.allocZ(1)
    this.transact(() =>
      this.writeElement(
        id,
        { type: 'shape', shape, x: rect.x, y: rect.y, w: Math.max(rect.w, 8), h: Math.max(rect.h, 8), color: style.color, size: style.size },
        z,
      ),
    )
    this.undoManager.stopCapturing()
    this.select([id])
    return id
  }

  /** 橡皮擦：一次擦掉的几笔合成一步撤销 */
  eraseElements(ids: string[]) {
    if (this.readOnly || !ids.length) return
    this.transact(() => this.deleteNow(ids))
    this.undoManager.stopCapturing()
  }

  addArrow(from: { id?: string; point: Point }, to: { id?: string; point: Point }) {
    if (this.readOnly) return
    const id = nanoid(10)
    const [z] = this.allocZ(1)
    this.transact(() =>
      this.writeElement(
        id,
        {
          type: 'arrow',
          fromId: from.id ?? null,
          toId: to.id ?? null,
          fromX: from.point.x,
          fromY: from.point.y,
          toX: to.point.x,
          toY: to.point.y,
          x: 0,
          y: 0,
          w: 0,
          h: 0,
        },
        z,
      ),
    )
    this.select([id])
  }

  // ---------------- 修改 ----------------

  /** 批量改坐标、尺寸等（拖动时每帧调用；一次连续拖动会合成一步撤销） */
  update(patches: Record<string, Partial<Pick<CanvasElement, 'x' | 'y' | 'w' | 'h' | 'fromX' | 'fromY' | 'toX' | 'toY' | 'color'>>>, origin: unknown = this) {
    if (this.readOnly) return
    this.transact(() => {
      for (const [id, patch] of Object.entries(patches)) {
        const m = this.map.get(id)
        if (!m) continue
        for (const [key, value] of Object.entries(patch)) {
          if (typeof value === 'number') m.set(key, Math.round(value * 100) / 100)
          else if (value !== undefined) m.set(key, value)
        }
      }
    }, origin)
  }

  /** 界面量出来的卡片高度 */
  setMeasuredHeight(id: string, h: number) {
    const el = this.cache.get(id)
    if (this.readOnly || !el || Math.abs(el.h - h) < 0.5) return
    this.update({ [id]: { h } }, QUIET_ORIGIN)
  }

  /** 按方向键微调选中元素的位置 */
  nudge(dx: number, dy: number) {
    const patches: Parameters<CanvasController['update']>[0] = {}
    for (const id of this.selection.get()) {
      const el = this.cache.get(id)
      if (!el) continue
      if (el.type === 'arrow') {
        patches[id] = {
          ...(el.fromId ? {} : { fromX: el.fromX + dx, fromY: el.fromY + dy }),
          ...(el.toId ? {} : { toX: el.toX + dx, toY: el.toY + dy }),
        }
      } else patches[id] = { x: el.x + dx, y: el.y + dy }
    }
    this.update(patches)
  }

  private deleteNow(ids: string[]) {
    const gone = new Set(ids)
    // 连着被删元素的箭头一起删掉
    for (const el of this.cache.values()) {
      if (el.type === 'arrow' && ((el.fromId && gone.has(el.fromId)) || (el.toId && gone.has(el.toId)))) gone.add(el.id)
    }
    for (const id of gone) this.map.delete(id)
  }

  deleteSelection() {
    if (this.readOnly) return
    const ids = [...this.selection.get()]
    if (!ids.length) return
    this.editing.set(null)
    this.transact(() => this.deleteNow(ids))
  }

  /** 改颜色：便签用便签颜色，画笔和形状用笔的颜色 */
  setColor(color: string) {
    const patches: Parameters<CanvasController['update']>[0] = {}
    const forSticky = STICKY_COLORS.some((c) => c.id === color)
    for (const id of this.selection.get()) {
      const type = this.cache.get(id)?.type
      if (forSticky ? type === 'sticky' : type === 'draw' || type === 'shape') patches[id] = { color }
    }
    this.update(patches)
  }

  /** 改画笔和形状的粗细 */
  setStrokeSize(size: number) {
    if (this.readOnly) return
    this.transact(() => {
      for (const id of this.selection.get()) {
        const el = this.cache.get(id)
        if (el && (el.type === 'draw' || el.type === 'shape')) this.map.get(id)?.set('size', size)
      }
    })
  }

  /** 层级：置顶、置底、上移一层、下移一层 */
  reorder(mode: 'front' | 'back' | 'forward' | 'backward') {
    if (this.readOnly) return
    const sel = this.selection.get()
    if (!sel.size) return
    const list = this.elements.get()
    const chosen = list.filter((el) => sel.has(el.id))
    const rest = list.filter((el) => !sel.has(el.id))
    let before: string | null
    let after: string | null
    if (mode === 'front') {
      before = rest.length ? rest[rest.length - 1].z : null
      after = null
    } else if (mode === 'back') {
      before = null
      after = rest.length ? rest[0].z : null
    } else {
      // 上移/下移：越过最近的一个没被选中的元素
      const firstIndex = list.findIndex((el) => sel.has(el.id))
      const lastIndex = list.length - 1 - [...list].reverse().findIndex((el) => sel.has(el.id))
      if (mode === 'forward') {
        const next = list.slice(lastIndex + 1).find((el) => !sel.has(el.id))
        if (!next) return
        const idx = rest.indexOf(next)
        before = next.z
        after = rest[idx + 1]?.z ?? null
      } else {
        const prev = list
          .slice(0, firstIndex)
          .reverse()
          .find((el) => !sel.has(el.id))
        if (!prev) return
        const idx = rest.indexOf(prev)
        before = rest[idx - 1]?.z ?? null
        after = prev.z
      }
    }
    let keys: string[]
    try {
      keys = generateNKeysBetween(before, after, chosen.length)
    } catch {
      return
    }
    this.transact(() => chosen.forEach((el, i) => this.map.get(el.id)?.set('z', keys[i])))
  }

  undo() {
    this.editing.set(null)
    this.undoManager.undo()
  }

  redo() {
    this.editing.set(null)
    this.undoManager.redo()
  }

  // ---------------- 复制、粘贴、复制一份 ----------------

  private serialize(ids: Iterable<string>): ClipboardPayload {
    const set = new Set(ids)
    const items: ClipboardPayload['items'] = []
    for (const el of this.elements.get()) {
      if (!set.has(el.id)) continue
      if (el.type === 'arrow' && ((el.fromId && !set.has(el.fromId)) || (el.toId && !set.has(el.toId)))) {
        // 只复制了箭头一端的元素时，箭头变成自由端点
        const ends = arrowEnds(el, (id) => this.cache.get(id))
        if (!ends) continue
        items.push({
          el: {
            ...el,
            fromId: el.fromId && set.has(el.fromId) ? el.fromId : null,
            toId: el.toId && set.has(el.toId) ? el.toId : null,
            fromX: ends[0].x,
            fromY: ends[0].y,
            toX: ends[1].x,
            toY: ends[1].y,
          },
        })
        continue
      }
      const fragment = this.fragment(el.id)
      items.push({ el, content: fragment ? (yXmlFragmentToProsemirrorJSON(fragment) as JSONContent) : undefined })
    }
    return { kind: 'note-canvas', items }
  }

  /** 把一组元素放到画布上（offset 为相对原位置的偏移），返回新 id */
  private insertPayload(payload: ClipboardPayload, offset: Point): string[] {
    const idMap = new Map<string, string>()
    for (const { el } of payload.items) idMap.set(el.id, nanoid(10))
    const zs = this.allocZ(payload.items.length)
    this.transact(() => {
      payload.items.forEach(({ el, content }, i) => {
        const id = idMap.get(el.id)!
        if (el.type === 'arrow') {
          this.writeElement(
            id,
            {
              ...el,
              fromId: el.fromId ? (idMap.get(el.fromId) ?? null) : null,
              toId: el.toId ? (idMap.get(el.toId) ?? null) : null,
              fromX: el.fromX + offset.x,
              fromY: el.fromY + offset.y,
              toX: el.toX + offset.x,
              toY: el.toY + offset.y,
            },
            zs[i],
          )
        } else {
          this.writeElement(id, { ...el, x: el.x + offset.x, y: el.y + offset.y }, zs[i], content)
        }
      })
    })
    const ids = [...idMap.values()]
    this.select(ids)
    return ids
  }

  duplicateSelection() {
    if (this.readOnly || !this.selection.get().size) return
    this.insertPayload(this.serialize(this.selection.get()), { x: 24, y: 24 })
  }

  /** 复制到系统剪贴板（同时带纯文本，方便粘到别的软件里） */
  copySelection(data: DataTransfer): boolean {
    const sel = this.selection.get()
    if (!sel.size) return false
    const payload = this.serialize(sel)
    const text = payload.items
      .map(({ content }) => (content ? plainText(content) : ''))
      .filter(Boolean)
      .join('\n\n')
    const json = JSON.stringify(payload)
    data.setData('text/plain', text || ' ')
    data.setData(CLIPBOARD_TYPE, json)
    internalClipboard = { text: text || ' ', payload }
    return true
  }

  cutSelection(data: DataTransfer): boolean {
    if (!this.copySelection(data)) return false
    this.deleteSelection()
    return true
  }

  /** 粘贴：画布元素、文件、或者文字（变成新的文字卡片） */
  paste(data: DataTransfer, at?: Point): boolean {
    if (this.readOnly) return false
    let payload: ClipboardPayload | null = null
    const custom = data.getData(CLIPBOARD_TYPE)
    if (custom) {
      try {
        payload = JSON.parse(custom)
      } catch {
        payload = null
      }
    } else if (internalClipboard && data.getData('text/plain') === internalClipboard.text) {
      payload = internalClipboard.payload
    }
    if (payload?.kind === 'note-canvas' && payload.items.length) {
      const bounds = this.boundsOfPayload(payload)
      const target = at ?? this.viewportCenter()
      this.insertPayload(payload, { x: target.x - (bounds.x + bounds.w / 2), y: target.y - (bounds.y + bounds.h / 2) })
      return true
    }
    const files = [...data.files]
    if (files.length) {
      void this.addFiles(files, at)
      return true
    }
    const html = data.getData('text/html')
    const text = data.getData('text/plain')
    if (!html && !text.trim()) return false
    const source = html && /<(p|h[1-6]|li|table|pre|blockquote|div|br)[\s>]/i.test(html)
      ? html
      : looksLikeMarkdown(text)
        ? markdownToHtml(text)
        : text
            .split(/\r?\n/)
            .map((line) => `<p>${escapeHtml(line)}</p>`)
            .join('')
    const content = generateJSON(source, cardBaseExtensions()) as JSONContent
    this.addText({ at, content, edit: false })
    return true
  }

  private boundsOfPayload(payload: ClipboardPayload): Rect {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const { el } of payload.items) {
      const pts =
        el.type === 'arrow'
          ? [
              { x: el.fromX, y: el.fromY },
              { x: el.toX, y: el.toY },
            ]
          : [
              { x: el.x, y: el.y },
              { x: el.x + el.w, y: el.y + el.h },
            ]
      for (const p of pts) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
    }
    return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : { x: 0, y: 0, w: 0, h: 0 }
  }

}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function plainText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  const inner = (node.content ?? []).map(plainText)
  const block = ['paragraph', 'heading', 'listItem', 'taskItem', 'tableRow', 'codeBlock', 'blockquote'].includes(node.type ?? '')
  return inner.join(block ? '' : '\n') + (block ? '\n' : '')
}
