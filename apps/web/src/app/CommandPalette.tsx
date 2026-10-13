import { useMemo, useState } from 'react'
import { Command } from 'cmdk'
import { CornerDownLeft, FilePlus2, Shapes, TextSearch } from 'lucide-react'
import { openSearch } from '../search/SearchDialog'
import { closePalette, getPickRequest, ui } from './ui'
import { useStore } from '../lib/store'
import { usePages } from '../store/hooks'
import { getAncestors, type PageMeta } from '../store/workspace'
import { navigate, paths } from '../lib/router'
import {
  getBindings,
  getCommandContext,
  listCommands,
  runCommand,
  scopeLabel,
  useCommandsVersion,
} from '../commands/registry'
import { CommandKbd, Kbd } from './Kbd'
import { PageIcon } from './PageIcon'
import { createAndOpen } from './actions'

function matches(haystack: string, query: string): boolean {
  const text = haystack.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => text.includes(term))
}

export function CommandPalette() {
  const { palette } = useStore(ui)
  if (!palette) return null
  return <PaletteDialog key={palette} mode={palette} />
}

function PaletteDialog({ mode }: { mode: 'pages' | 'commands' | 'pick' }) {
  const [query, setQuery] = useState(mode === 'commands' ? '>' : '')
  const snap = usePages()
  useCommandsVersion()
  const pick = mode === 'pick' ? getPickRequest() : null

  const commandMode = !pick && query.startsWith('>')
  const search = commandMode ? query.slice(1).trim() : query.trim()

  const close = () => closePalette()

  const pages = useMemo(() => {
    const excluded = new Set(pick?.exclude ?? [])
    const list = [...snap.visible]
      .filter((id) => !excluded.has(id))
      .map((id) => snap.byId.get(id)!)
      .filter(Boolean)
    list.sort((a, b) => b.updatedAt - a.updatedAt)
    return list
      .map((page) => ({ page, path: getAncestors(page.id).map((p) => p.title || '无标题').join(' / ') }))
      .filter(({ page, path }) => !search || matches(`${page.title || '无标题'} ${path}`, search))
      .slice(0, 50)
  }, [snap, search, pick])

  const ctx = getCommandContext()
  const commands = listCommands()
    .filter((c) => c.palette !== false)
    .filter((c) => c.scope === 'global' || (c.scope === 'editor' && ctx.editor) || (c.scope === 'canvas' && ctx.canvas))
    .filter((c) => !c.when || c.when(ctx))
    .filter((c) => !search || matches(`${c.title} ${c.group}`, search))

  const openPage = (page: PageMeta) => {
    if (pick) {
      // 先把焦点还给原来的编辑器/画布，再插入
      closePalette(true)
      pick.onPick(page.id)
      return
    }
    closePalette(false)
    navigate(paths.page(page.id))
  }

  const createPage = (type: 'doc' | 'canvas') => {
    if (pick) {
      closePalette(true)
      pick.onCreate?.(type, search)
      return
    }
    closePalette(false)
    createAndOpen(type, null, search)
  }

  const label = pick ? pick.title : commandMode ? '命令面板' : '跳转到页面'

  const runCmd = (id: string) => {
    // 先关闭面板、把焦点还给编辑器，再执行命令
    closePalette(true)
    runCommand(id)
  }

  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={label}>
        {pick && <div className="palette-heading">{pick.title}</div>}
        <Command shouldFilter={false} loop label={label}>
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={
              pick ? '输入页面标题搜索' : commandMode ? '输入命令名称…' : '输入页面标题搜索，输入 > 切换到命令'
            }
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                close()
              }
            }}
          />
          <Command.List>
            <Command.Empty>没有找到匹配的{commandMode ? '命令' : '页面'}</Command.Empty>
            {commandMode ? (
              <Command.Group heading="命令">
                {commands.map((c) => {
                  const combo = getBindings(c.id)[0]
                  return (
                    <Command.Item key={c.id} value={c.id} onSelect={() => runCmd(c.id)}>
                      <span className="palette-item-title">{c.title}</span>
                      <span className="palette-item-meta">{c.scope === 'global' ? c.group : scopeLabel(c.scope)}</span>
                      {combo && <Kbd combo={combo} />}
                    </Command.Item>
                  )
                })}
              </Command.Group>
            ) : (
              <>
                {pages.length > 0 && (
                  <Command.Group heading={search ? '页面' : '最近编辑'}>
                    {pages.map(({ page, path }) => (
                      <Command.Item key={page.id} value={page.id} onSelect={() => openPage(page)}>
                        <PageIcon type={page.type} />
                        <span className="palette-item-title">{page.title || '无标题'}</span>
                        {path && <span className="palette-item-meta">{path}</span>}
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                {search && !pick && (
                  <Command.Group heading="全文">
                    <Command.Item
                      value="__fulltext"
                      onSelect={() => {
                        closePalette(false)
                        openSearch(search)
                      }}
                    >
                      <TextSearch className="icon" />
                      <span className="palette-item-title">在所有页面的正文里搜索“{search}”</span>
                      <CommandKbd commandId="app.search" />
                    </Command.Item>
                  </Command.Group>
                )}
                {search && (!pick || pick.onCreate) && (
                  <Command.Group heading="新建">
                    <Command.Item value="__new_doc" onSelect={() => createPage('doc')}>
                      <FilePlus2 className="icon" />
                      <span className="palette-item-title">新建文档“{search}”</span>
                      <CornerDownLeft className="icon palette-enter" />
                    </Command.Item>
                    <Command.Item value="__new_canvas" onSelect={() => createPage('canvas')}>
                      <Shapes className="icon" />
                      <span className="palette-item-title">新建画布“{search}”</span>
                    </Command.Item>
                  </Command.Group>
                )}
              </>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  )
}
