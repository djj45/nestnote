import { isMac } from '../lib/platform'

/**
 * 快捷键字符串的统一格式："Mod+Ctrl+Meta+Alt+Shift+键"，修饰键顺序固定。
 * - Mod：Mac 上是 ⌘，Windows 上是 Ctrl。配置用 Mod 写，两边通用。
 * - Ctrl：只在 Mac 上有意义（⌃）；Windows 上会被归并为 Mod。
 * - Meta：只在 Windows 上有意义（Win 键）；Mac 上会被归并为 Mod。
 * - 键名：字母大写（"N"），数字（"1"），符号（"[" "\\" "="），
 *   以及 Enter Escape Tab Space Backspace Delete ArrowUp … F1–F12。
 * 默认快捷键可以加平台前缀："mac:Mod+Y" 只在 Mac 上生效，"win:Mod+Y" 只在非 Mac 上生效。
 *
 * 按键序列：两个组合键用空格隔开，例如 "Mod+K S"（先按 ⌘K，松开后再按 S）。
 * 第一个键必须带 Mod/Ctrl/Alt/Meta 之一（或是 F1–F12），否则打字时会误触发。
 */

export interface Combo {
  mod: boolean
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  key: string
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  space: 'Space',
  spacebar: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
  insert: 'Insert',
}

function normalizeKeyName(key: string): string {
  if (key.length === 1) return key.toUpperCase()
  const alias = KEY_ALIASES[key.toLowerCase()]
  if (alias) return alias
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase()
  return key
}

export function parseCombo(input: string): Combo | null {
  let text = input.trim()
  if (!text) return null
  if (text.startsWith('mac:') || text.startsWith('win:')) text = text.slice(4)
  // 最后一段是键名；键名本身可能是 "+"（写作 "Plus"）
  const parts = text.split('+')
  let keyPart = parts.pop() ?? ''
  if (keyPart === '' && parts.length && parts[parts.length - 1] === '') {
    parts.pop()
    keyPart = '+'
  }
  if (!keyPart) return null
  const combo: Combo = { mod: false, ctrl: false, meta: false, alt: false, shift: false, key: normalizeKeyName(keyPart) }
  for (const raw of parts) {
    switch (raw.trim().toLowerCase()) {
      case 'mod':
      case 'cmdorctrl':
        combo.mod = true
        break
      case 'cmd':
      case 'command':
      case '⌘':
        if (isMac) combo.mod = true
        else combo.meta = true
        break
      case 'meta':
      case 'win':
      case 'super':
        if (isMac) combo.mod = true
        else combo.meta = true
        break
      case 'ctrl':
      case 'control':
      case '⌃':
        if (isMac) combo.ctrl = true
        else combo.mod = true
        break
      case 'alt':
      case 'option':
      case 'opt':
      case '⌥':
        combo.alt = true
        break
      case 'shift':
      case '⇧':
        combo.shift = true
        break
      default:
        return null
    }
  }
  return combo
}

export function stringifyCombo(c: Combo): string {
  const parts: string[] = []
  if (c.mod) parts.push('Mod')
  if (c.ctrl) parts.push('Ctrl')
  if (c.meta) parts.push('Meta')
  if (c.alt) parts.push('Alt')
  if (c.shift) parts.push('Shift')
  parts.push(c.key)
  return parts.join('+')
}

/** 规范化单个组合键；无法解析时返回 null */
export function canonical(input: string): string | null {
  const combo = parseCombo(input)
  return combo ? stringifyCombo(combo) : null
}

/** 按键序列里的各个组合键 */
export function splitSequence(binding: string): string[] {
  let text = binding.trim()
  if (text.startsWith('mac:') || text.startsWith('win:')) text = text.slice(4)
  return text.split(/\s+/).filter(Boolean)
}

export const isSequence = (binding: string) => splitSequence(binding).length > 1

/** 规范化一个快捷键（单个组合键，或者最多两个组合键组成的序列）；无法解析时返回 null */
export function canonicalBinding(input: string): string | null {
  const parts = splitSequence(input)
  if (!parts.length || parts.length > 2) return null
  const out: string[] = []
  for (const part of parts) {
    const c = canonical(part)
    if (!c) return null
    out.push(c)
  }
  if (out.length > 1 && !canStartSequence(out[0])) return null
  return out.join(' ')
}

/** 能不能作为按键序列的第一个键：要带修饰键，或者是功能键 */
export function canStartSequence(combo: string): boolean {
  const c = parseCombo(combo)
  if (!c) return false
  return c.mod || c.ctrl || c.alt || c.meta || /^F\d{1,2}$/.test(c.key)
}

/** 这条默认快捷键是否适用于当前平台 */
export function appliesToPlatform(input: string): boolean {
  if (input.startsWith('mac:')) return isMac
  if (input.startsWith('win:')) return !isMac
  return true
}

const CODE_KEYS: Record<string, string> = {
  Backslash: '\\',
  IntlBackslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Equal: '=',
  NumpadAdd: '=',
  Minus: '-',
  NumpadSubtract: '-',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Home: 'Home',
  End: 'End',
  Insert: 'Insert',
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'OS'])

/**
 * 从键盘事件取键名。优先用 event.code（物理按键位置），
 * 因为 Mac 上按住 Option 时 event.key 会变成特殊字符（例如 ⌥N 得到 "Dead"）。
 */
export function keyFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  const code = e.code
  if (code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3)
    if (/^Digit\d$/.test(code)) return code.slice(5)
    if (/^Numpad\d$/.test(code)) return code.slice(6)
    if (/^F\d{1,2}$/.test(code)) return code
    if (CODE_KEYS[code]) return CODE_KEYS[code]
  }
  if (!e.key || e.key === 'Unidentified' || e.key === 'Dead' || e.key === 'Process') return null
  return normalizeKeyName(e.key)
}

export function comboFromEvent(e: KeyboardEvent): string | null {
  const key = keyFromEvent(e)
  if (!key) return null
  return stringifyCombo({
    mod: isMac ? e.metaKey : e.ctrlKey,
    ctrl: isMac ? e.ctrlKey : false,
    meta: isMac ? false : e.metaKey,
    alt: e.altKey,
    shift: e.shiftKey,
    key,
  })
}

const TYPING_KEYS = new Set([
  'Space',
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
])

/** 在输入框里会被当作"打字"的组合（没有 Mod/Ctrl/Alt/Meta 的普通键） */
export function isTypingCombo(combo: string): boolean {
  const c = parseCombo(combo)
  if (!c) return true
  if (c.mod || c.ctrl || c.alt || c.meta) return false
  return c.key.length === 1 || TYPING_KEYS.has(c.key)
}

const MAC_SYMBOLS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '↩',
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: '⌦',
  Tab: '⇥',
  Space: '空格',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
}

const WIN_NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Delete: 'Del',
  Space: '空格',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
}

/** 显示用的按键，例如 Mac 上 ["⌥", "⇧", "⌘", "N"]，Windows 上 ["Ctrl", "Alt", "Shift", "N"]（单个组合键） */
export function comboParts(input: string): string[] {
  const c = parseCombo(input)
  if (!c) return [input]
  if (isMac) {
    const parts: string[] = []
    if (c.ctrl) parts.push('⌃')
    if (c.alt) parts.push('⌥')
    if (c.shift) parts.push('⇧')
    if (c.mod) parts.push('⌘')
    parts.push(MAC_SYMBOLS[c.key] ?? c.key)
    return parts
  }
  const parts: string[] = []
  if (c.mod) parts.push('Ctrl')
  if (c.meta) parts.push('Win')
  if (c.alt) parts.push('Alt')
  if (c.shift) parts.push('Shift')
  parts.push(WIN_NAMES[c.key] ?? c.key)
  return parts
}

/** 显示用的文字；按键序列的两个组合键之间用空格隔开，例如 "⌘K S" */
export function formatCombo(input: string): string {
  return splitSequence(input)
    .map((part) => (isMac ? comboParts(part).join('') : comboParts(part).join('+')))
    .join(' ')
}

/** 浏览器会先拦截、网页收不到的组合键 */
const RESERVED_RAW = [
  'Mod+N',
  'Mod+Shift+N',
  'Mod+T',
  'Mod+Shift+T',
  'Mod+W',
  'Mod+Shift+W',
  'Ctrl+Tab',
  'Ctrl+Shift+Tab',
  'Ctrl+PageUp',
  'Ctrl+PageDown',
  'Mod+L',
  'Mod+1',
  'Mod+2',
  'Mod+3',
  'Mod+4',
  'Mod+5',
  'Mod+6',
  'Mod+7',
  'Mod+8',
  'Mod+9',
  ...(isMac ? ['Mod+Q', 'Mod+H', 'Mod+M', 'Mod+Alt+I', 'Mod+Alt+J', 'Mod+Alt+C'] : ['Alt+F4', 'Mod+Shift+I', 'Mod+Shift+J', 'F11', 'F12']),
]
const RESERVED = new Set(RESERVED_RAW.map((k) => canonical(k)).filter((k): k is string => !!k))

/** 是否会被浏览器拦截（按键序列看第一个键） */
export function isReservedCombo(binding: string): boolean {
  return RESERVED.has(splitSequence(binding)[0] ?? '')
}
