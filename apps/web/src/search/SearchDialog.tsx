import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { TextSearch } from 'lucide-react'
import { createStore, useStore } from '../lib/store'
import { cls } from '../lib/format'
import { navigate, paths } from '../lib/router'
import { PageIcon } from '../app/PageIcon'
import { refreshIndex, search, type SearchResult, type Snippet } from './searchIndex'
import { jumpTo } from './jump'

/** 全文搜索对话框：搜标题、正文、画布卡片和表格里的文字，选中结果直接跳到那个位置 */

const searchUi = createStore<{ open: boolean; query: string }>({ open: false, query: '' })
let returnFocus: HTMLElement | null = null

export function openSearch(query = '') {
  if (!searchUi.get().open) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  searchUi.set({ open: true, query })
}

function closeSearch(restoreFocus: boolean) {
  searchUi.set({ open: false, query: '' })
  const el = returnFocus
  returnFocus = null
  if (restoreFocus && el && document.contains(el)) el.focus({ preventScroll: true })
}

export function SearchDialog() {
  const state = useStore(searchUi)
  if (!state.open) return null
  return <SearchPanel initial={state.query} />
}

type Item = { result: SearchResult; snippet: Snippet | null }

function Highlight({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p ? <span key={i}>{p}</span> : null))}
    </>
  )
}

function SearchPanel({ initial }: { initial: string }) {
  const [query, setQuery] = useState(initial)
  const deferred = useDeferredValue(query)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>({ done: 0, total: 0 })
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // 打开时把有改动的页面读进索引（第一次会慢一点）
  useEffect(() => {
    let alive = true
    refreshIndex((done, total) => alive && setProgress({ done, total })).finally(() => alive && setProgress(null))
    return () => {
      alive = false
    }
  }, [])

  const results = useMemo(() => search(deferred), [deferred, progress?.done])
  const items = useMemo<Item[]>(
    () => results.flatMap((r) => [{ result: r, snippet: null }, ...r.snippets.map((s) => ({ result: r, snippet: s }))]),
    [results],
  )

  useEffect(() => setActive(0), [deferred])
  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (item: Item) => {
    closeSearch(false)
    const { result, snippet } = item
    if (!snippet) navigate(paths.page(result.page.id))
    else jumpTo({ pageId: result.page.id, block: snippet.block, elementId: snippet.elementId, text: snippet.term })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeSearch(true)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!items.length) return
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[active]
      if (item) choose(item)
    }
  }

  let index = -1
  const indexing = progress && progress.total > 0 && progress.done < progress.total

  return (
    <div className="palette-backdrop" onMouseDown={() => closeSearch(true)}>
      <div className="palette search-panel" role="dialog" aria-label="全文搜索" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <TextSearch className="icon" />
          <input
            autoFocus
            value={query}
            placeholder="搜索所有页面的文字（空格隔开多个词）"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded
            aria-controls="search-results"
          />
          {indexing && (
            <span className="search-progress">
              正在读取页面 {progress.done}/{progress.total}
            </span>
          )}
        </div>
        <div className="search-results" id="search-results" role="listbox" ref={listRef}>
          {!deferred.trim() && <div className="search-empty">输入要找的文字，会在所有页面的标题、正文、画布卡片和表格里找</div>}
          {deferred.trim() && !results.length && !indexing && <div className="search-empty">没有找到“{deferred.trim()}”</div>}
          {results.map((r) => (
            <div key={r.page.id} className="search-group">
              {(() => {
                index++
                const i = index
                return (
                  <button
                    className={cls('search-item search-page', active === i && 'is-active')}
                    role="option"
                    aria-selected={active === i}
                    onMouseMove={() => active !== i && setActive(i)}
                    onClick={() => choose({ result: r, snippet: null })}
                  >
                    <PageIcon type={r.page.type} />
                    <span className="search-title">
                      <Highlight parts={r.titleParts} />
                    </span>
                    {r.path && <span className="palette-item-meta">{r.path}</span>}
                    {r.hits > 0 && <span className="search-count">{r.hits} 处</span>}
                  </button>
                )
              })()}
              {r.snippets.map((s, k) => {
                index++
                const i = index
                return (
                  <button
                    key={k}
                    className={cls('search-item search-snippet', active === i && 'is-active')}
                    role="option"
                    aria-selected={active === i}
                    onMouseMove={() => active !== i && setActive(i)}
                    onClick={() => choose({ result: r, snippet: s })}
                  >
                    <Highlight parts={s.parts} />
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
