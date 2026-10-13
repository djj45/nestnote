import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Download, Plus, RotateCcw, Upload, X } from 'lucide-react'
import { leaveSettings, navigate, paths } from '../lib/router'
import { cls, downloadBlob, fileStamp, formatBytes } from '../lib/format'
import {
  bindingsClash,
  conflictsFor,
  defaultBindings,
  exportBindings,
  getBindings,
  importBindings,
  listBindingProblems,
  isCustomized,
  listCommands,
  resetAllBindings,
  scopeLabel,
  setBindings,
  setRecordingShortcut,
  useCommandsVersion,
  type BindingProblem,
  type CommandDef,
} from '../commands/registry'
import { canStartSequence, comboFromEvent, formatCombo, isReservedCombo, splitSequence } from '../commands/keys'
import { pickFiles } from '../assets/assetStore'
import { Kbd } from './Kbd'
import { BACKUP_EXTENSION, exportBackup, findUnusedAssets, importBackup, removeUnusedAssets } from '../store/backup'
import { showToast } from './toast'
import { SyncSettings } from './SyncSettings'
import { blockedByReadOnly, setReadOnly, useReadOnly } from './readOnly'
import { DOC_WIDTHS, THEMES, resetSidebarWidth, setDocWidth, setPenDraws, setTheme, usePrefs } from './prefs'
import { useStore } from '../lib/store'
import { session } from '../sync/session'

const TABS = [
  { id: 'general', label: '通用' },
  { id: 'shortcuts', label: '快捷键' },
  { id: 'sync', label: '同步' },
  { id: 'data', label: '数据与备份' },
]

export function SettingsView({ tab }: { tab: string }) {
  const current = TABS.some((t) => t.id === tab) ? tab : 'general'
  return (
    <div className="view-scroll">
      <div className="panel-view">
        <div className="panel-head settings-head">
          <button className="icon-btn settings-back" title="返回" aria-label="返回" onClick={leaveSettings}>
            <ArrowLeft className="icon" />
          </button>
          <h1>设置</h1>
        </div>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={current === t.id}
              className={cls('tab', current === t.id && 'is-active')}
              onClick={() => navigate(paths.settings(t.id), { replace: true })}
            >
              {t.label}
            </button>
          ))}
        </div>
        {current === 'general' ? (
          <GeneralSettings />
        ) : current === 'shortcuts' ? (
          <ShortcutSettings />
        ) : current === 'sync' ? (
          <SyncSettings />
        ) : (
          <DataSettings />
        )}
      </div>
    </div>
  )
}

// ---------------- 通用 ----------------

function GeneralSettings() {
  const readOnly = useReadOnly()
  const { docWidth, theme, penDraws } = usePrefs()
  return (
    <div className="data-settings">
      <section className="setting-block">
        <h2>外观</h2>
        <p>浅色还是深色。“跟随系统”时会随电脑、手机的深色模式自动切换。只对这台设备有效。</p>
        <div className="width-choices" role="radiogroup" aria-label="外观">
          {THEMES.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={theme === t.id}
              className={cls('btn', theme === t.id && 'is-active')}
              onClick={() => setTheme(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <section className="setting-block">
        <h2>文档宽度</h2>
        <p>文档正文的最大宽度。屏幕宽的时候选“宽”或“铺满”，两边的空白会少一些。只对这台设备有效。</p>
        <div className="width-choices" role="radiogroup" aria-label="文档宽度">
          {DOC_WIDTHS.map((w) => (
            <button
              key={w.id}
              role="radio"
              aria-checked={docWidth === w.id}
              className={cls('btn', docWidth === w.id && 'is-active')}
              onClick={() => setDocWidth(w.id)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </section>

      <section className="setting-block">
        <h2>侧边栏宽度</h2>
        <p>在电脑上拖动侧边栏的右边缘可以调宽窄，双击右边缘恢复默认。</p>
        <div className="row-actions">
          <button className="btn" onClick={resetSidebarWidth}>
            恢复默认宽度
          </button>
        </div>
      </section>

      <section className="setting-block">
        <h2>手写笔</h2>
        <p>
          在平板上用手写笔（Apple Pencil 等）时，画布上不用先选画笔工具，笔在空白处一落下就是写字、画画；笔点到卡片上还是选中和拖动。用过笔以后，手指只负责拖动和缩放，手掌碰到屏幕也不会乱画。笔尾带橡皮的笔，翻过来就是橡皮擦。
        </p>
        <label className="switch-row">
          <input type="checkbox" checked={penDraws} onChange={(e) => setPenDraws(e.target.checked)} />
          <span>用手写笔直接写字</span>
        </label>
      </section>

      <section className="setting-block">
        <h2>只读模式</h2>
        <p>
          开启后只能浏览，不能修改页面内容和标题，也不能新建、移动、重命名或删除页面，适合在手机上看笔记时防止误触。只对这台设备上的这个浏览器有效，其它设备不受影响。顶栏右上角有一个锁形按钮，点它也能直接开关只读模式。
        </p>
        <label className="switch-row">
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
          <span>在这台设备上开启只读模式</span>
        </label>
      </section>
    </div>
  )
}

// ---------------- 快捷键 ----------------

interface Pending {
  commandId: string
  /** 已经按下的键（按键序列最多两个） */
  keys: string[]
  /** 录好的快捷键（有问题、等用户决定时才有） */
  binding: string | null
  problem: null | { kind: 'reserved' } | { kind: 'conflict'; others: CommandDef[] }
}

/** 按完第一个键后等多久，看是不是要组成按键序列 */
const SEQUENCE_WAIT = 1200

function ShortcutSettings() {
  const version = useCommandsVersion()
  const [filter, setFilter] = useState('')
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const groups = useMemo(() => {
    const map = new Map<string, CommandDef[]>()
    for (const cmd of listCommands()) {
      const name = cmd.scope === 'global' ? cmd.group : scopeLabel(cmd.scope)
      const list = map.get(name)
      if (list) list.push(cmd)
      else map.set(name, [cmd])
    }
    return [...map.entries()]
  }, [version])

  // 有冲突、或者会被浏览器拦截的快捷键：commandId -> binding -> 问题
  const problems = useMemo(() => {
    const map = new Map<string, Map<string, BindingProblem>>()
    for (const p of listBindingProblems()) {
      const inner = map.get(p.commandId) ?? new Map<string, BindingProblem>()
      inner.set(p.binding, p)
      map.set(p.commandId, inner)
    }
    return map
  }, [version])
  const problemCount = [...problems.values()].reduce((n, m) => n + m.size, 0)

  const addBinding = (id: string, binding: string) => {
    const current = getBindings(id)
    if (!current.includes(binding)) setBindings(id, [...current, binding])
  }

  const removeBinding = (id: string, binding: string) => {
    setBindings(
      id,
      getBindings(id).filter((k) => k !== binding),
    )
  }

  /** 录完一个快捷键：没问题就直接加上，有问题先让用户决定 */
  const commit = (commandId: string, binding: string) => {
    if (isReservedCombo(binding)) {
      setPending({ commandId, keys: splitSequence(binding), binding, problem: { kind: 'reserved' } })
      return
    }
    const others = conflictsFor(commandId, binding)
    if (others.length) {
      setPending({ commandId, keys: splitSequence(binding), binding, problem: { kind: 'conflict', others } })
      return
    }
    addBinding(commandId, binding)
    setPending(null)
  }

  // 录制状态下拦截所有按键。带修饰键的第一个键按下后再等一会儿，期间再按一个键就组成按键序列
  const recordingFor = pending && !pending.binding ? pending.commandId : null
  useEffect(() => {
    if (!recordingFor) return
    setRecordingShortcut(true)
    const keys: string[] = []
    let timer = 0
    const finish = () => commit(recordingFor, keys.join(' '))
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setPending(null)
        return
      }
      const combo = comboFromEvent(e)
      if (!combo) return
      keys.push(combo)
      if (keys.length === 1 && canStartSequence(combo)) {
        setPending((p) => (p && p.commandId === recordingFor ? { ...p, keys: [combo] } : p))
        timer = window.setTimeout(finish, SEQUENCE_WAIT)
        return
      }
      window.clearTimeout(timer)
      finish()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey, true)
      setRecordingShortcut(false)
    }
    // commit 只用到稳定的函数
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingFor])

  const startRecording = (commandId: string) => setPending({ commandId, keys: [], binding: null, problem: null })

  const doExport = () => {
    const blob = new Blob([exportBindings()], { type: 'application/json' })
    downloadBlob(blob, `笔记快捷键-${fileStamp()}.json`)
  }

  const doImport = async () => {
    const [file] = await pickFiles('.json,application/json', false)
    if (!file) return
    try {
      const result = importBindings(await file.text())
      const extra = [
        result.unknown ? `${result.unknown} 个命令这个版本还没有（先保存着）` : '',
        result.invalid ? `${result.invalid} 个快捷键无法识别，已跳过` : '',
      ]
        .filter(Boolean)
        .join('；')
      showToast(`已导入 ${result.applied} 个命令的快捷键${extra ? `。${extra}` : ''}`)
    } catch (err) {
      showToast(`导入失败：${err instanceof Error ? err.message : String(err)}`, { tone: 'error' })
    }
  }

  const q = filter.trim().toLowerCase()

  return (
    <div className="shortcuts">
      <div className="shortcuts-toolbar">
        <input
          className="input"
          placeholder="搜索命令或快捷键"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className="btn" onClick={doExport} title="把改过的快捷键存成一个文件，可以在别的浏览器里导入">
          <Download className="icon" />
          导出
        </button>
        <button className="btn" onClick={() => void doImport()} title="导入之前导出的快捷键文件">
          <Upload className="icon" />
          导入…
        </button>
        {confirmReset ? (
          <span className="confirm-inline">
            所有快捷键都恢复成默认值？
            <button
              className="btn danger"
              onClick={() => {
                resetAllBindings()
                setConfirmReset(false)
              }}
            >
              全部恢复
            </button>
            <button className="btn" onClick={() => setConfirmReset(false)}>
              取消
            </button>
          </span>
        ) : (
          <button className="btn" onClick={() => setConfirmReset(true)}>
            <RotateCcw className="icon" />
            全部恢复默认
          </button>
        )}
      </div>
      <p className="panel-desc">
        点“添加”后直接按下想要的组合键，按 Esc 取消。想用按键序列（比如先按 {formatCombo('Mod+K')} 再按 S），按完第一个键后一秒内接着按第二个键。
        {['Mod+N', 'Mod+T', 'Mod+W'].map(formatCombo).join('、')} 这类组合会被浏览器拦截，网页收不到，所以不能使用。快捷键随同步保存，所有设备通用；导入导出可以在没登录的浏览器之间搬配置。
      </p>

      {problemCount > 0 && (
        <div className="shortcut-warning" role="status">
          <AlertTriangle className="icon" />
          <span>有 {problemCount} 个快捷键冲突或会被浏览器拦截，对应的命令可能按不出来。</span>
          <button className="btn sm" onClick={() => setOnlyProblems((v) => !v)}>
            {onlyProblems ? '显示全部' : '只看这些'}
          </button>
        </div>
      )}

      {groups.map(([group, cmds]) => {
        const visible = cmds.filter(
          (c) =>
            (!onlyProblems || problems.has(c.id)) &&
            (!q ||
              c.title.toLowerCase().includes(q) ||
              getBindings(c.id).some((k) => formatCombo(k).toLowerCase().includes(q))),
        )
        if (!visible.length) return null
        return (
          <section key={group} className="shortcut-group">
            <h2>{group}</h2>
            <ul>
              {visible.map((cmd) => {
                const bindings = getBindings(cmd.id)
                const isPending = pending?.commandId === cmd.id
                const rowProblems = problems.get(cmd.id)
                return (
                  <li key={cmd.id} className={cls('shortcut-row', isPending && 'is-recording')}>
                    <span className="shortcut-title">{cmd.title}</span>
                    <span className="shortcut-keys">
                      {bindings.map((binding) => {
                        const problem = rowProblems?.get(binding)
                        return (
                          <span
                            key={binding}
                            className={cls('shortcut-chip', problem && 'has-problem')}
                            title={
                              problem
                                ? problem.reserved
                                  ? '会被浏览器拦截，按了没反应'
                                  : `和“${problem.others.map((o) => o.title).join('”“')}”冲突`
                                : undefined
                            }
                          >
                            <Kbd combo={binding} />
                            <button
                              className="chip-remove"
                              title="删除这个快捷键"
                              aria-label={`删除 ${formatCombo(binding)}`}
                              onClick={() => removeBinding(cmd.id, binding)}
                            >
                              <X className="icon" />
                            </button>
                          </span>
                        )
                      })}
                      {isPending && !pending.binding && (
                        <span className="recording-hint">
                          {pending.keys.length ? (
                            <>
                              <Kbd combo={pending.keys[0]} />
                              可以再按一个键组成按键序列…
                            </>
                          ) : (
                            '请按下组合键…'
                          )}
                        </span>
                      )}
                      {isPending && pending.binding && pending.problem?.kind === 'reserved' && (
                        <span className="shortcut-problem">
                          <Kbd combo={pending.binding} /> 会被浏览器拦截，换一个吧。
                          <button className="btn sm" onClick={() => startRecording(cmd.id)}>
                            重新录制
                          </button>
                          <button className="btn sm" onClick={() => setPending(null)}>
                            取消
                          </button>
                        </span>
                      )}
                      {isPending && pending.binding && pending.problem?.kind === 'conflict' && (
                        <span className="shortcut-problem">
                          <Kbd combo={pending.binding} /> 和“{pending.problem.others.map((o) => o.title).join('”“')}”冲突
                          {pending.problem.others.some((o) => !getBindings(o.id).includes(pending.binding!))
                            ? '（单键会先触发，按键序列就按不出来了）'
                            : ''}
                          。
                          <button
                            className="btn sm danger"
                            onClick={() => {
                              const binding = pending.binding!
                              if (pending.problem?.kind === 'conflict')
                                for (const other of pending.problem.others)
                                  setBindings(
                                    other.id,
                                    getBindings(other.id).filter((b) => !bindingsClash(b, binding)),
                                  )
                              addBinding(cmd.id, binding)
                              setPending(null)
                            }}
                          >
                            改用到这里
                          </button>
                          <button className="btn sm" onClick={() => startRecording(cmd.id)}>
                            重新录制
                          </button>
                          <button className="btn sm" onClick={() => setPending(null)}>
                            取消
                          </button>
                        </span>
                      )}
                    </span>
                    <span className="shortcut-actions">
                      {!isPending && (
                        <button className="btn sm" onClick={() => startRecording(cmd.id)}>
                          <Plus className="icon" />
                          添加
                        </button>
                      )}
                      {isCustomized(cmd.id) && !isPending && (
                        <button
                          className="btn sm"
                          title={`默认：${defaultBindings(cmd).map(formatCombo).join('、') || '无'}`}
                          onClick={() => setBindings(cmd.id, null)}
                        >
                          恢复默认
                        </button>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {onlyProblems && problemCount === 0 && <p className="panel-desc">现在没有冲突了。</p>}
    </div>
  )
}

// ---------------- 数据与备份 ----------------

function DataSettings() {
  const syncing = useStore(session).status === 'ready'
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () => {
    navigator.storage
      ?.estimate?.()
      .then((e) => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 }))
      .catch(() => {})
    navigator.storage
      ?.persisted?.()
      .then(setPersisted)
      .catch(() => {})
  }
  useEffect(refresh, [])

  return (
    <div className="data-settings">
      <section className="setting-block">
        <h2>数据保存在哪里</h2>
        {syncing ? (
          <p>
            笔记保存在服务器上，这个浏览器里有一份副本，离线时也能看和编辑。服务器每天自动备份；也可以在下面导出一份自己保存。
          </p>
        ) : (
          <p>
            现在没有连接服务器，笔记只保存在当前这个浏览器里。清除这个网站的浏览器数据会把笔记一起删掉，换浏览器或换电脑也看不到。请定期导出备份，或者在“同步”里连接服务器。
          </p>
        )}
        <dl className="facts">
          <dt>已用空间</dt>
          <dd>{usage ? `${formatBytes(usage.used)}（浏览器允许最多约 ${formatBytes(usage.quota)}）` : '无法获取'}</dd>
          <dt>持久存储</dt>
          <dd>
            {persisted === null ? '无法获取' : persisted ? '已开启：浏览器不会自动清理这里的数据' : '未开启：磁盘空间紧张时浏览器可能清理数据'}
            {persisted === false && (
              <button
                className="btn sm"
                onClick={() =>
                  navigator.storage
                    .persist()
                    .then((ok) => {
                      setPersisted(ok)
                      showToast(ok ? '已开启持久存储' : '浏览器没有同意，可以先把这个网站加入书签或安装为应用后再试')
                    })
                    .catch(() => {})
                }
              >
                开启
              </button>
            )}
          </dd>
        </dl>
      </section>

      <section className="setting-block">
        <h2>备份</h2>
        <p>备份文件包含所有页面（包括回收站里的）、图片视频等文件，以及快捷键设置。导入时会和现有内容合并，同一份备份导入多次不会产生重复。</p>
        <div className="row-actions">
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                downloadBlob(await exportBackup(), `笔记备份-${fileStamp()}${BACKUP_EXTENSION}`)
                showToast('备份已导出')
              } catch (err) {
                showToast(`导出失败：${err instanceof Error ? err.message : String(err)}`, { tone: 'error' })
              } finally {
                setBusy(false)
                refresh()
              }
            }}
          >
            <Download className="icon" />
            导出备份
          </button>
          <button className="btn" disabled={busy} onClick={() => !blockedByReadOnly() && fileRef.current?.click()}>
            <Upload className="icon" />
            导入备份
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={`${BACKUP_EXTENSION},.json,application/json,application/octet-stream`}
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              setBusy(true)
              try {
                const result = await importBackup(file)
                showToast(`已导入 ${result.pages} 个页面、${result.assets} 个文件`)
              } catch (err) {
                showToast(err instanceof Error ? err.message : String(err), { tone: 'error' })
              } finally {
                setBusy(false)
                refresh()
              }
            }}
          />
        </div>
      </section>

      <UnusedFiles onDone={refresh} />
    </div>
  )
}

function UnusedFiles({ onDone }: { onDone: () => void }) {
  const [scan, setScan] = useState<null | 'scanning' | { ids: string[]; bytes: number }>(null)
  const [busy, setBusy] = useState(false)
  return (
    <section className="setting-block">
      <h2>清理没用到的文件</h2>
      <p>从文档里删掉图片或文件后，文件本身还留着（方便撤销）。这里可以把已经没有任何页面用到的文件清掉，连接了服务器时服务器上的也一起清掉（服务器会再保留 30 天）。回收站里的页面用到的文件会保留。</p>
      <div className="row-actions">
        <button
          className="btn"
          disabled={scan === 'scanning' || busy}
          onClick={async () => {
            setScan('scanning')
            try {
              setScan(await findUnusedAssets())
            } catch (err) {
              setScan(null)
              showToast(`检查失败：${err instanceof Error ? err.message : String(err)}`, { tone: 'error' })
            }
          }}
        >
          {scan === 'scanning' ? '正在检查…' : '检查'}
        </button>
        {scan && scan !== 'scanning' && (
          <span className="confirm-inline">
            {scan.ids.length === 0 ? (
              '没有可以清理的文件。'
            ) : (
              <>
                有 {scan.ids.length} 个文件没用到，共 {formatBytes(scan.bytes)}。
                <button
                  className="btn danger"
                  disabled={busy}
                  onClick={async () => {
                    if (blockedByReadOnly()) return
                    setBusy(true)
                    try {
                      await removeUnusedAssets(scan.ids)
                      showToast(`已清理 ${scan.ids.length} 个文件`)
                      setScan(null)
                      onDone()
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  清理
                </button>
              </>
            )}
          </span>
        )}
      </div>
    </section>
  )
}
