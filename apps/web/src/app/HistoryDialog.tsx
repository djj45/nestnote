import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Y from 'yjs'
import { X } from 'lucide-react'
import { createStore, useStore } from '../lib/store'
import { cls, formatTime } from '../lib/format'
import { usePage } from '../store/hooks'
import { withPageDoc } from '../store/docPool'
import { api, OfflineError } from '../sync/api'
import { DocPreview } from '../editor/DocEditor'
import { CanvasController } from '../canvas/controller'
import { CanvasView } from '../canvas/CanvasView'
import { showToast } from './toast'
import { useReadOnly } from './readOnly'

/**
 * 页面历史版本：服务器定期保存的快照，可以查看和恢复。
 * 恢复 = 把页面内容换成那个版本的内容（作为一次新的修改同步到各设备）；
 * 恢复前服务器会先把当前内容存一个版本，所以恢复错了还能再恢复回来。
 */

const historyFor = createStore<string | null>(null)

export function openHistory(pageId: string) {
  historyFor.set(pageId)
}

interface Snapshot {
  id: number
  createdAt: number
  size: number
}

async function loadSnapshot(pageId: string, id: number): Promise<Uint8Array> {
  const res = await fetch(`/api/history/${encodeURIComponent(pageId)}/${id}`, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(res.status === 401 ? '请先登录' : `读取失败（${res.status}）`)
  return new Uint8Array(await res.arrayBuffer())
}

/** 把页面内容整体换成快照里的内容 */
async function restoreSnapshot(pageId: string, data: Uint8Array) {
  const source = new Y.Doc()
  Y.applyUpdate(source, data)
  await withPageDoc(pageId, (doc) => {
    doc.transact(() => {
      const content = doc.getXmlFragment('content')
      content.delete(0, content.length)
      const from = source.getXmlFragment('content')
      content.insert(
        0,
        from.toArray().map((node) => node.clone() as Y.XmlElement | Y.XmlText),
      )
      const elements = doc.getMap('elements')
      for (const key of [...elements.keys()]) elements.delete(key)
      source.getMap('elements').forEach((value, key) => {
        elements.set(key, value instanceof Y.AbstractType ? value.clone() : value)
      })
    })
  })
  source.destroy()
}

function fullTime(ts: number) {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function HistoryDialog() {
  const pageId = useStore(historyFor)
  if (!pageId) return null
  return createPortal(<HistoryPanel key={pageId} pageId={pageId} onClose={() => historyFor.set(null)} />, document.body)
}

function HistoryPanel({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const page = usePage(pageId)
  const [list, setList] = useState<Snapshot[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [preview, setPreview] = useState<{ id: number; data: Uint8Array } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const readOnly = useReadOnly()

  useEffect(() => {
    api<{ snapshots: Snapshot[] }>(`/api/history/${encodeURIComponent(pageId)}`)
      .then((res) => {
        setList(res.snapshots)
        if (res.snapshots.length) setSelected(res.snapshots[0].id)
      })
      .catch((err) => setError(err instanceof OfflineError ? '连不上服务器，联网后才能查看历史版本' : String(err.message ?? err)))
  }, [pageId])

  useEffect(() => {
    if (selected === null) return
    let alive = true
    setPreview(null)
    setConfirming(false)
    loadSnapshot(pageId, selected)
      .then((data) => alive && setPreview({ id: selected, data }))
      .catch((err) => alive && setError(String(err.message ?? err)))
    return () => {
      alive = false
    }
  }, [pageId, selected])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const restore = async () => {
    if (!preview) return
    setBusy(true)
    try {
      // 先让服务器把当前内容存一个版本
      await api(`/api/history/${encodeURIComponent(pageId)}/checkpoint`, { method: 'POST', json: {} })
      await restoreSnapshot(pageId, preview.data)
      const snap = list?.find((s) => s.id === preview.id)
      showToast(`已恢复到 ${snap ? fullTime(snap.createdAt) : ''} 的版本，恢复前的内容也保存了一个版本`)
      onClose()
    } catch (err) {
      showToast(err instanceof OfflineError ? '连不上服务器，联网后再恢复' : `恢复失败：${(err as Error).message}`, {
        tone: 'error',
      })
      setBusy(false)
    }
  }

  return (
    <div className="history-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="history" role="dialog" aria-label="历史版本">
        <header className="history-head">
          <h2>历史版本：{page?.title || '无标题'}</h2>
          <button className="icon-btn" aria-label="关闭" onClick={onClose}>
            <X className="icon" />
          </button>
        </header>
        <div className="history-body">
          <aside className="history-list">
            {error && <p className="history-empty">{error}</p>}
            {!error && list === null && <p className="history-empty">正在读取…</p>}
            {!error && list?.length === 0 && (
              <p className="history-empty">还没有历史版本。页面改动后，服务器会定期（最多 10 分钟一次）保存一个版本。</p>
            )}
            {list?.map((s) => (
              <button
                key={s.id}
                className={cls('history-item', selected === s.id && 'is-active')}
                onClick={() => setSelected(s.id)}
              >
                <span>{fullTime(s.createdAt)}</span>
                <small>{formatTime(s.createdAt)}</small>
              </button>
            ))}
          </aside>
          <section className="history-preview">
            {preview && page ? (
              <SnapshotPreview key={preview.id} pageId={pageId} type={page.type} data={preview.data} />
            ) : (
              selected !== null && !error && <p className="history-empty">正在读取…</p>
            )}
          </section>
        </div>
        <footer className="history-foot">
          <span className="history-hint">{readOnly ? '只读模式下只能查看，不能恢复。' : '这里只是预览，不能编辑。'}</span>
          {confirming ? (
            <span className="confirm-inline">
              页面内容会换成这个版本（当前内容也会先存一个版本）。
              <button className="btn primary" disabled={busy} onClick={restore}>
                确定恢复
              </button>
              <button className="btn" onClick={() => setConfirming(false)}>
                取消
              </button>
            </span>
          ) : (
            <button className="btn primary" disabled={!preview || busy || readOnly} onClick={() => setConfirming(true)}>
              恢复到这个版本
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

function SnapshotPreview({ pageId, type, data }: { pageId: string; type: 'doc' | 'canvas'; data: Uint8Array }) {
  const doc = useMemo(() => {
    const d = new Y.Doc()
    Y.applyUpdate(d, data)
    return d
  }, [data])
  useEffect(() => () => doc.destroy(), [doc])
  if (type === 'canvas') return <CanvasSnapshot pageId={pageId} doc={doc} />
  return (
    <div className="history-doc">
      <DocPreview doc={doc} pageId={pageId} />
    </div>
  )
}

function CanvasSnapshot({ pageId, doc }: { pageId: string; doc: Y.Doc }) {
  const [controller, setController] = useState<CanvasController | null>(null)
  useEffect(() => {
    const c = new CanvasController(pageId, doc, true, { cameraKey: `history:${pageId}` })
    setController(c)
    return () => c.dispose()
  }, [pageId, doc])
  if (!controller) return null
  return (
    <div className="history-canvas">
      <CanvasView controller={controller} />
    </div>
  )
}
