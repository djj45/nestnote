import { getStroke } from 'perfect-freehand'
import { createStore } from '../lib/store'

/**
 * 画笔和形状的公共部分：颜色、粗细、把笔迹点变成平滑的轮廓（perfect-freehand）。
 *
 * 一笔存成：points = [x, y, 压力, x, y, 压力, …]（相对元素左上角），pw/ph = 当时的宽高。
 * 元素被拉伸时，画面按 w/pw、h/ph 缩放。
 */

export const PEN_COLORS = [
  { id: 'ink', label: '墨色' },
  { id: 'red', label: '红色' },
  { id: 'orange', label: '橙色' },
  { id: 'green', label: '绿色' },
  { id: 'blue', label: '蓝色' },
  { id: 'purple', label: '紫色' },
] as const

export type PenColor = (typeof PEN_COLORS)[number]['id']

export const PEN_SIZES = [
  { id: 2, label: '细' },
  { id: 4, label: '中' },
  { id: 8, label: '粗' },
] as const

export const isPenColor = (v: unknown): v is PenColor => PEN_COLORS.some((c) => c.id === v)

/** CSS 里的颜色变量（深色模式下自动换成亮一些的颜色） */
export const penColorVar = (color: string | null) => `var(--pen-${isPenColor(color) ? color : 'ink'})`

export interface StrokeStyle {
  size: number
  /** 是不是真的有压力数据（手写笔）；鼠标和手指按速度模拟粗细 */
  pressure: boolean
}

function strokeOptions(style: StrokeStyle, last: boolean) {
  return {
    size: style.size * 2,
    thinning: 0.6,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: !style.pressure,
    start: { taper: style.pressure ? 0 : style.size * 2, cap: true },
    end: { taper: style.pressure ? 0 : style.size * 3, cap: true },
    last,
  }
}

/** 轮廓点 -> SVG 路径（二次曲线连接，比折线平滑） */
export function outlineToPath(outline: number[][]): string {
  if (outline.length < 2) return ''
  const avg = (a: number, b: number) => (a + b) / 2
  let d = `M${outline[0][0].toFixed(2)},${outline[0][1].toFixed(2)} Q`
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i]
    const [x1, y1] = outline[(i + 1) % outline.length]
    d += `${x0.toFixed(2)},${y0.toFixed(2)} ${avg(x0, x1).toFixed(2)},${avg(y0, y1).toFixed(2)} `
  }
  return d + 'Z'
}

/** flat 数组 -> [x, y, 压力][] */
export function unflatten(points: readonly number[]): number[][] {
  const out: number[][] = []
  for (let i = 0; i + 1 < points.length; i += 3) out.push([points[i], points[i + 1], points[i + 2] ?? 0.5])
  return out
}

/** 一笔的 SVG 路径（坐标和 points 相同） */
export function strokePath(points: readonly number[], style: StrokeStyle, last = true): string {
  const pts = unflatten(points)
  if (!pts.length) return ''
  // 只有一个点（点一下）：画一个圆点
  if (pts.length === 1) pts.push([pts[0][0] + 0.1, pts[0][1] + 0.1, pts[0][2]])
  return outlineToPath(getStroke(pts, strokeOptions(style, last)))
}

const pathCache = new WeakMap<readonly number[], Map<string, string>>()

/** 带缓存：同一笔（points 数组没变）只算一次 */
export function cachedStrokePath(points: readonly number[], style: StrokeStyle): string {
  let byStyle = pathCache.get(points)
  if (!byStyle) {
    byStyle = new Map()
    pathCache.set(points, byStyle)
  }
  const key = `${style.size}:${style.pressure}`
  let d = byStyle.get(key)
  if (d === undefined) {
    d = strokePath(points, style)
    byStyle.set(key, d)
  }
  return d
}

/** 点到线段的距离 */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** 世界坐标里的一点离这一笔（已按元素大小缩放）有多远 */
export function distanceToStroke(
  el: { x: number; y: number; w: number; h: number; pw: number; ph: number; points: readonly number[] | null },
  px: number,
  py: number,
): number {
  const pts = el.points ?? []
  const sx = el.pw ? el.w / el.pw : 1
  const sy = el.ph ? el.h / el.ph : 1
  let best = Infinity
  for (let i = 0; i < pts.length; i += 3) {
    const ax = el.x + pts[i] * sx
    const ay = el.y + pts[i + 1] * sy
    const j = i + 3 < pts.length ? i + 3 : i
    const bx = el.x + pts[j] * sx
    const by = el.y + pts[j + 1] * sy
    best = Math.min(best, distToSegment(px, py, ax, ay, bx, by))
  }
  return best
}

/** 世界坐标里的一点离矩形 / 椭圆的边有多远 */
export function distanceToShape(el: { x: number; y: number; w: number; h: number; shape: string | null }, px: number, py: number): number {
  const cx = el.x + el.w / 2
  const cy = el.y + el.h / 2
  if (el.shape === 'ellipse') {
    const rx = Math.max(el.w / 2, 1)
    const ry = Math.max(el.h / 2, 1)
    const nx = (px - cx) / rx
    const ny = (py - cy) / ry
    const r = Math.hypot(nx, ny)
    // 近似：按归一化半径差换算回像素
    return Math.abs(r - 1) * Math.min(rx, ry)
  }
  const dx = Math.max(el.x - px, 0, px - (el.x + el.w))
  const dy = Math.max(el.y - py, 0, py - (el.y + el.h))
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy)
  return Math.min(px - el.x, el.x + el.w - px, py - el.y, el.y + el.h - py)
}

// ---------------- 当前的笔：颜色和粗细（每台设备各自记住） ----------------

export interface PenStyle {
  color: PenColor
  size: number
}

function loadPenStyle(): PenStyle {
  try {
    const raw = JSON.parse(localStorage.getItem('note:pen') ?? 'null')
    if (raw && isPenColor(raw.color) && PEN_SIZES.some((s) => s.id === raw.size)) return raw
  } catch {
    /* 忽略 */
  }
  return { color: 'ink', size: 4 }
}

export const penStyle = createStore<PenStyle>(loadPenStyle())

export function setPenStyle(patch: Partial<PenStyle>) {
  penStyle.set((s) => ({ ...s, ...patch }))
  try {
    localStorage.setItem('note:pen', JSON.stringify(penStyle.get()))
  } catch {
    /* 忽略 */
  }
}
