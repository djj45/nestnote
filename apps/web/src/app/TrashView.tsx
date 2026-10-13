import { useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { usePages } from '../store/hooks'
import { formatTime } from '../lib/format'
import { navigate, paths } from '../lib/router'
import { deleteForever, emptyTrash, restoreFromTrash } from './actions'
import { PageIcon } from './PageIcon'

export function TrashView() {
  const snap = usePages()
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  return (
    <div className="view-scroll">
      <div className="panel-view">
        <div className="panel-head">
          <h1>回收站</h1>
          {snap.trashed.length > 0 &&
            (confirmEmpty ? (
              <span className="confirm-inline">
                永久删除全部 {snap.trashed.length} 个页面？
                <button className="btn danger" onClick={() => emptyTrash().then(() => setConfirmEmpty(false))}>
                  永久删除
                </button>
                <button className="btn" onClick={() => setConfirmEmpty(false)}>
                  取消
                </button>
              </span>
            ) : (
              <button className="btn" onClick={() => setConfirmEmpty(true)}>
                清空回收站
              </button>
            ))}
        </div>
        <p className="panel-desc">移到回收站的页面（连同它的子页面）会留在这里，直到你永久删除。</p>

        {snap.trashed.length === 0 ? (
          <p className="empty-note">回收站是空的。</p>
        ) : (
          <ul className="trash-list">
            {snap.trashed.map((page) => (
              <li key={page.id} className="trash-item">
                <button className="trash-open" onClick={() => navigate(paths.page(page.id))}>
                  <PageIcon type={page.type} />
                  <span className="recent-title">{page.title || '无标题'}</span>
                  <span className="recent-time">删除于 {formatTime(page.trashedAt ?? 0)}</span>
                </button>
                {confirmId === page.id ? (
                  <span className="confirm-inline">
                    无法撤销
                    <button className="btn danger" onClick={() => deleteForever(page.id).then(() => setConfirmId(null))}>
                      永久删除
                    </button>
                    <button className="btn" onClick={() => setConfirmId(null)}>
                      取消
                    </button>
                  </span>
                ) : (
                  <span className="trash-actions">
                    <button className="btn" onClick={() => restoreFromTrash(page.id)}>
                      <RotateCcw className="icon" />
                      恢复
                    </button>
                    <button className="btn ghost-danger" title="永久删除" onClick={() => setConfirmId(page.id)}>
                      <Trash2 className="icon" />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
