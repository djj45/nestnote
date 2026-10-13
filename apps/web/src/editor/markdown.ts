/**
 * 极简 Markdown → HTML 转换，只用于"粘贴纯文本 Markdown"：
 * 标题、无序/有序/待办列表（支持缩进嵌套）、引用、代码块、分割线、表格，
 * 以及行内的加粗、斜体、删除线、行内代码、链接。
 * 普通的多行文字每行变成一个段落（比 Markdown 标准的"合并成一段"更符合记笔记的习惯）。
 */

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const HEADING_RE = /^(#{1,6})\s+(.*)$/
const FENCE_RE = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/
const QUOTE_RE = /^\s*>\s?(.*)$/
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const TASK_RE = /^\[([ xX]?)\]\s*(.*)$/

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inline(text: string): string {
  const codes: string[] = []
  let s = text.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(code)
    return `\u0000${codes.length - 1}\u0000`
  })
  s = escapeHtml(s)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, href: string) =>
    /^(https?:|mailto:|\/|#)/i.test(href) ? `<a href="${href}">${label}</a>` : m,
  )
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code>${escapeHtml(codes[Number(i)])}</code>`)
  return s
}

const indentOf = (s: string) => s.replace(/\t/g, '    ').length

interface ListItem {
  text: string
  checked: boolean | null
  children: string
}

function parseList(lines: string[], start: number, indent: number): [string, number] {
  const first = lines[start].match(LIST_RE)!
  const ordered = /\d/.test(first[2])
  const items: ListItem[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      // 空行：如果后面还是同一个列表就跳过
      const next = lines.slice(i + 1).find((l) => l.trim())
      const m = next?.match(LIST_RE)
      if (m && indentOf(m[1]) >= indent) {
        i++
        continue
      }
      break
    }
    const m = line.match(LIST_RE)
    if (!m) {
      // 列表项的续行
      if (items.length && indentOf(line.match(/^\s*/)![0]) > indent) {
        items[items.length - 1].text += ` ${line.trim()}`
        i++
        continue
      }
      break
    }
    const ind = indentOf(m[1])
    if (ind < indent) break
    if (ind > indent) {
      if (!items.length) break
      const [sub, next] = parseList(lines, i, ind)
      items[items.length - 1].children += sub
      i = next
      continue
    }
    if (/\d/.test(m[2]) !== ordered) break
    const task = m[3].match(TASK_RE)
    // 普通项和待办项混在一起时拆成两个列表
    if (items.length && (items[0].checked !== null) !== !!task) break
    items.push(
      task
        ? { text: task[2], checked: task[1].toLowerCase() === 'x', children: '' }
        : { text: m[3], checked: null, children: '' },
    )
    i++
  }

  if (items.length && items.every((it) => it.checked !== null)) {
    const lis = items
      .map((it) => `<li data-type="taskItem" data-checked="${it.checked}"><p>${inline(it.text)}</p>${it.children}</li>`)
      .join('')
    return [`<ul data-type="taskList">${lis}</ul>`, i]
  }
  const tag = ordered ? 'ol' : 'ul'
  const lis = items.map((it) => `<li><p>${inline(it.text)}</p>${it.children}</li>`).join('')
  return [`<${tag}>${lis}</${tag}>`, i]
}

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

function isBlockStart(line: string, next: string | undefined): boolean {
  return (
    HEADING_RE.test(line) ||
    FENCE_RE.test(line) ||
    HR_RE.test(line) ||
    QUOTE_RE.test(line) ||
    LIST_RE.test(line) ||
    TASK_RE.test(line.trim()) ||
    (line.includes('|') && !!next && TABLE_SEP_RE.test(next))
  )
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    const fence = line.match(FENCE_RE)
    if (fence) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) buf.push(lines[i++])
      i++
      const lang = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : ''
      out.push(`<pre><code${lang}>${escapeHtml(buf.join('\n'))}</code></pre>`)
      continue
    }

    const heading = line.match(HEADING_RE)
    if (heading) {
      const level = Math.min(3, heading[1].length)
      out.push(`<h${level}>${inline(heading[2].replace(/\s+#+\s*$/, ''))}</h${level}>`)
      i++
      continue
    }

    if (HR_RE.test(line)) {
      out.push('<hr>')
      i++
      continue
    }

    if (QUOTE_RE.test(line)) {
      const buf: string[] = []
      while (i < lines.length && QUOTE_RE.test(lines[i])) buf.push(lines[i++].match(QUOTE_RE)![1])
      out.push(`<blockquote>${markdownToHtml(buf.join('\n')) || '<p></p>'}</blockquote>`)
      continue
    }

    if (line.includes('|') && TABLE_SEP_RE.test(lines[i + 1] ?? '')) {
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]))
      const cell = (tag: string, text: string) => `<${tag}><p>${inline(text)}</p></${tag}>`
      const head = `<tr>${header.map((h) => cell('th', h)).join('')}</tr>`
      const body = rows
        .map((r) => `<tr>${header.map((_h, c) => cell('td', r[c] ?? '')).join('')}</tr>`)
        .join('')
      out.push(`<table><tbody>${head}${body}</tbody></table>`)
      continue
    }

    const list = line.match(LIST_RE)
    if (list) {
      const [html, next] = parseList(lines, i, indentOf(list[1]))
      out.push(html)
      i = next
      continue
    }

    // 没有列表符号、单独一行的 "[ ] 待办"
    if (TASK_RE.test(line.trim())) {
      const items: string[] = []
      while (i < lines.length && TASK_RE.test(lines[i].trim())) {
        const m = lines[i++].trim().match(TASK_RE)!
        items.push(`<li data-type="taskItem" data-checked="${m[1].toLowerCase() === 'x'}"><p>${inline(m[2])}</p></li>`)
      }
      out.push(`<ul data-type="taskList">${items.join('')}</ul>`)
      continue
    }

    // 普通文字：每行一个段落
    out.push(`<p>${inline(line.trim())}</p>`)
    i++
  }
  return out.join('')
}

/** 这段纯文本看起来像 Markdown 吗（有块级标记或行内标记） */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split(/\r?\n/)
  const blockHits = lines.filter((l, idx) => isBlockStart(l, lines[idx + 1])).length
  if (blockHits > 0) return true
  return /\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|~~[^~]+~~/.test(text)
}
