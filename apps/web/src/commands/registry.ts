import { useSyncExternalStore } from 'react'
import type { Editor } from '@tiptap/core'
import { keybindingsMap, workspaceDoc } from '../store/workspace'
import { appliesToPlatform, canonicalBinding, comboFromEvent, formatCombo, isReservedCombo, splitSequence } from './keys'
import { createStore } from '../lib/store'
import { showToast } from '../app/toast'
import { currentPageId } from '../lib/router'
import type { CanvasController } from '../canvas/controller'

/**
 * 命令系统：所有功能都注册成命令，快捷键只是命令的绑定。
 * 用户自定义的快捷键存在工作区（keybindingsMap）里，以后会随同步到所有设备。
 */

export type Scope = 'global' | 'editor' | 'canvas'

export interface CommandContext {
  /** 当前（或最近一次）获得焦点的文档编辑器 */
  editor: Editor | null
  /** 当前打开的页面 */
  pageId: string | null
  /** 当前画布（打开的是画布页面时） */
  canvas: CanvasController | null
}

export interface CommandDef {
  id: string
  title: string
  /** 设置页和命令面板里的分组名 */
  group: string
  scope: Scope
  /** 默认快捷键，可带 "mac:" / "win:" 前缀 */
  keys?: string[]
  /** 返回 false 表示这次没有处理（按键会继续交给其它逻辑） */
  run: (ctx: CommandContext) => boolean | void
  when?: (ctx: CommandContext) => boolean
  /** 是否出现在命令面板里，默认 true */
  palette?: boolean
}

const SCOPE_LABELS: Record<Scope, string> = { global: '全局', editor: '文字编辑', canvas: '画布' }
export const scopeLabel = (scope: Scope) => SCOPE_LABELS[scope]

const commands = new Map<string, CommandDef>()
let version = 0
const listeners = new Set<() => void>()
/** 快捷键（单个组合键或按键序列） -> 命令列表 */
let index: Map<string, CommandDef[]> | null = null
/** 按键序列的第一个键 -> 命令列表 */
let prefixIndex: Map<string, CommandDef[]> | null = null

function changed() {
  version++
  index = null
  prefixIndex = null
  listeners.forEach((l) => l())
}

keybindingsMap.observe(() => changed())

export function registerCommands(defs: CommandDef[]): () => void {
  for (const def of defs) commands.set(def.id, def)
  changed()
  return () => {
    for (const def of defs) if (commands.get(def.id) === def) commands.delete(def.id)
    changed()
  }
}

export function getCommand(id: string): CommandDef | undefined {
  return commands.get(id)
}

export function listCommands(): CommandDef[] {
  return [...commands.values()]
}

export function defaultBindings(cmd: CommandDef): string[] {
  return (cmd.keys ?? [])
    .filter(appliesToPlatform)
    .map((k) => canonicalBinding(k))
    .filter((k): k is string => !!k)
}

export function getBindings(id: string): string[] {
  const cmd = commands.get(id)
  const custom = keybindingsMap.get(id)
  if (Array.isArray(custom))
    return custom.map((k) => (typeof k === 'string' ? canonicalBinding(k) : null)).filter((k): k is string => !!k)
  return cmd ? defaultBindings(cmd) : []
}

export function isCustomized(id: string): boolean {
  return keybindingsMap.has(id)
}

/** keys 为 null 表示恢复默认 */
export function setBindings(id: string, keys: string[] | null) {
  if (keys === null) keybindingsMap.delete(id)
  else keybindingsMap.set(id, keys)
}

export function resetAllBindings() {
  keybindingsMap.clear()
}

function getIndex(): Map<string, CommandDef[]> {
  if (index) return index
  const next = new Map<string, CommandDef[]>()
  const prefixes = new Map<string, CommandDef[]>()
  const add = (map: Map<string, CommandDef[]>, key: string, cmd: CommandDef) => {
    const list = map.get(key)
    if (list) list.push(cmd)
    else map.set(key, [cmd])
  }
  for (const cmd of commands.values()) {
    for (const binding of getBindings(cmd.id)) {
      add(next, binding, cmd)
      const parts = splitSequence(binding)
      if (parts.length > 1) add(prefixes, parts[0], cmd)
    }
  }
  index = next
  prefixIndex = prefixes
  return next
}

export function commandsForCombo(combo: string): CommandDef[] {
  return getIndex().get(combo) ?? []
}

function sequencesStartingWith(combo: string): CommandDef[] {
  getIndex()
  return prefixIndex?.get(combo) ?? []
}

/** 作用范围是否会互相冲突：全局与任何范围都冲突，编辑器和画布互不冲突 */
export function scopesOverlap(a: Scope, b: Scope): boolean {
  return a === b || a === 'global' || b === 'global'
}

/**
 * 给命令 commandId 用 binding 时，会和哪些命令冲突：
 * - 作用范围重叠、用了同一个快捷键；
 * - 一个是单键、另一个是以这个键开头的按键序列（单键会先触发，序列就永远按不出来）。
 */
export function conflictsFor(commandId: string, binding: string): CommandDef[] {
  const cmd = commands.get(commandId)
  if (!cmd) return []
  return listCommands().filter(
    (other) =>
      other.id !== commandId &&
      scopesOverlap(other.scope, cmd.scope) &&
      getBindings(other.id).some((b) => bindingsClash(b, binding)),
  )
}

/** 两个快捷键是否冲突：完全相同，或者一个是单键、另一个是以它开头的按键序列 */
export function bindingsClash(a: string, b: string): boolean {
  if (a === b) return true
  const pa = splitSequence(a)
  const pb = splitSequence(b)
  return pa.length !== pb.length && pa[0] === pb[0]
}

export interface BindingProblem {
  commandId: string
  binding: string
  /** 冲突的命令；为空表示问题是"会被浏览器拦截" */
  others: CommandDef[]
  reserved: boolean
}

/** 当前所有快捷键里有问题的（冲突或会被浏览器拦截），设置页用来提醒 */
export function listBindingProblems(): BindingProblem[] {
  const result: BindingProblem[] = []
  for (const cmd of commands.values()) {
    for (const binding of getBindings(cmd.id)) {
      const others = conflictsFor(cmd.id, binding)
      const reserved = isReservedCombo(binding)
      if (others.length || reserved) result.push({ commandId: cmd.id, binding, others, reserved })
    }
  }
  return result
}

// ---------- 导入导出 ----------

const EXPORT_FORMAT = 'note-keybindings'

/** 导出自己改过的快捷键（没改过的用默认值，不写进文件） */
export function exportBindings(): string {
  const bindings: Record<string, string[]> = {}
  keybindingsMap.forEach((value, id) => {
    if (Array.isArray(value)) bindings[id] = value.filter((k): k is string => typeof k === 'string')
  })
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), bindings }, null, 2)
}

export interface ImportResult {
  applied: number
  /** 文件里有、但这个版本没有的命令（照样保存，以后有了就生效） */
  unknown: number
  /** 写错、无法识别的快捷键（跳过） */
  invalid: number
}

/**
 * 导入快捷键配置。mode 为 merge 时只改文件里提到的命令；replace 时先把所有命令恢复默认再导入。
 * 格式不对时抛出错误。
 */
export function importBindings(text: string, mode: 'merge' | 'replace' = 'merge'): ImportResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  const obj = data as { format?: unknown; bindings?: unknown }
  if (!obj || typeof obj !== 'object' || obj.format !== EXPORT_FORMAT || !obj.bindings || typeof obj.bindings !== 'object') {
    throw new Error('这不是快捷键配置文件')
  }
  const result: ImportResult = { applied: 0, unknown: 0, invalid: 0 }
  const entries: Array<[string, string[]]> = []
  for (const [id, value] of Object.entries(obj.bindings as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      result.invalid++
      continue
    }
    const keys: string[] = []
    for (const k of value) {
      const c = typeof k === 'string' ? canonicalBinding(k) : null
      if (c) keys.push(c)
      else result.invalid++
    }
    entries.push([id, [...new Set(keys)]])
    if (commands.has(id)) result.applied++
    else result.unknown++
  }
  workspaceDoc.transact(() => {
    if (mode === 'replace') keybindingsMap.clear()
    for (const [id, keys] of entries) keybindingsMap.set(id, keys)
  })
  return result
}

// ---------- 执行 ----------

/*
 * "主"编辑器/画布是当前页面本身的；"活动"的是最近获得焦点的（可能是嵌在页面里的另一个页面）。
 * 活动的那个被卸载或退出后，自动回到主的那个。
 */
let primaryEditor: Editor | null = null
let activeEditor: Editor | null = null
export function setPrimaryEditor(editor: Editor | null) {
  primaryEditor = editor
}
export function setActiveEditor(editor: Editor | null) {
  activeEditor = editor
}
export function clearActiveEditor(editor: Editor) {
  if (activeEditor === editor) activeEditor = null
  if (primaryEditor === editor) primaryEditor = null
}

let primaryCanvas: CanvasController | null = null
let activeCanvas: CanvasController | null = null
export function setPrimaryCanvas(canvas: CanvasController | null) {
  primaryCanvas = canvas
}
export function setActiveCanvas(canvas: CanvasController | null) {
  activeCanvas = canvas
}
export function clearActiveCanvas(canvas: CanvasController) {
  if (activeCanvas === canvas) activeCanvas = null
  if (primaryCanvas === canvas) primaryCanvas = null
}

const liveEditor = (e: Editor | null) => (e && !e.isDestroyed ? e : null)

export function getCommandContext(overrides?: Partial<CommandContext>): CommandContext {
  const editor = liveEditor(activeEditor) ?? liveEditor(primaryEditor)
  return { editor, pageId: currentPageId(), canvas: activeCanvas ?? primaryCanvas, ...overrides }
}

export function runCommand(id: string, overrides?: Partial<CommandContext>): boolean {
  const cmd = commands.get(id)
  if (!cmd) return false
  const ctx = getCommandContext(overrides)
  if (cmd.when && !cmd.when(ctx)) return false
  return cmd.run(ctx) !== false
}

let recording = false
/** 设置页录制快捷键时暂停所有快捷键 */
export function setRecordingShortcut(value: boolean) {
  recording = value
}
export function isRecordingShortcut() {
  return recording
}

// ---------- 按键序列 ----------

interface PendingChord {
  prefix: string
  scopes: Scope[]
  overrides?: Partial<CommandContext>
}

let pendingChord: PendingChord | null = null
let chordTimer = 0
/** 按键序列按了第一个键、正在等第二个键时的第一个键（界面上显示提示） */
export const chordStore = createStore<string | null>(null)

const CHORD_TIMEOUT = 2500

export function isChordPending(): boolean {
  return pendingChord !== null
}

export function cancelChord() {
  window.clearTimeout(chordTimer)
  pendingChord = null
  if (chordStore.get() !== null) chordStore.set(null)
}

function runFirst(candidates: CommandDef[], scopes: Scope[], ctx: CommandContext): boolean {
  for (const scope of scopes) {
    for (const cmd of candidates) {
      if (cmd.scope !== scope) continue
      if (cmd.when && !cmd.when(ctx)) continue
      if (cmd.run(ctx) !== false) return true
    }
  }
  return false
}

/**
 * 按作用范围顺序查找并执行命令。
 * 返回 true 表示已处理（同时会阻止浏览器默认行为）。
 * 按下按键序列的第一个键时先记下来、等第二个键（这时也返回 true，按键不会打进文字里）。
 */
export function dispatchKeyEvent(
  e: KeyboardEvent,
  scopes: Scope[],
  overrides?: Partial<CommandContext>,
): boolean {
  if (recording || e.isComposing || e.keyCode === 229) return false
  const combo = comboFromEvent(e)
  if (!combo) return false

  // 正在等按键序列的第二个键：不管按的是什么都不再往下传
  if (pendingChord) {
    const chord = pendingChord
    cancelChord()
    e.preventDefault()
    if (combo === 'Escape') return true
    const full = `${chord.prefix} ${combo}`
    const ctx = getCommandContext(chord.overrides ?? overrides)
    if (!runFirst(commandsForCombo(full), chord.scopes, ctx)) {
      showToast(`${formatCombo(full)} 没有对应的命令`)
    }
    return true
  }

  const ctx = getCommandContext(overrides)
  if (runFirst(commandsForCombo(combo), scopes, ctx)) {
    e.preventDefault()
    return true
  }

  const starts = sequencesStartingWith(combo).filter((cmd) => scopes.includes(cmd.scope) && (!cmd.when || cmd.when(ctx)))
  if (starts.length) {
    e.preventDefault()
    pendingChord = { prefix: combo, scopes, overrides }
    chordStore.set(combo)
    window.clearTimeout(chordTimer)
    chordTimer = window.setTimeout(cancelChord, CHORD_TIMEOUT)
    return true
  }
  return false
}

export function useCommandsVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    () => version,
  )
}
