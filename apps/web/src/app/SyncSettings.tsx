import { useState } from 'react'
import { useStore } from '../lib/store'
import { formatTime } from '../lib/format'
import { kickSweep, reconnectNow, syncState } from '../sync/engine'
import { uploadMissing } from '../sync/assets'
import { connectServer, logout, session } from '../sync/session'
import { showToast } from './toast'

export function SyncSettings() {
  const s = useStore(session)
  const sync = useStore(syncState)
  const [confirm, setConfirm] = useState<null | 'logout' | 'wipe'>(null)
  const [busy, setBusy] = useState(false)

  if (s.status !== 'ready') {
    return (
      <div className="data-settings">
        <section className="setting-block">
          <h2>服务器</h2>
          <p>
            现在没有连接服务器，笔记只保存在这个浏览器里。
            {s.serverFound ? '登录后，这里已有的笔记会全部传到服务器，并在各台设备之间同步。' : '没有找到服务器。'}
          </p>
          <div className="row-actions">
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await connectServer()
                } catch (err) {
                  showToast(err instanceof Error ? err.message : String(err), { tone: 'error' })
                } finally {
                  setBusy(false)
                }
              }}
            >
              连接服务器
            </button>
          </div>
        </section>
      </div>
    )
  }

  const phaseText =
    sync.phase === 'synced'
      ? '已同步：所有改动都已保存到服务器'
      : sync.phase === 'syncing'
        ? '同步中'
        : '离线：连不上服务器。可以照常编辑，联网后会自动同步'

  return (
    <div className="data-settings">
      <section className="setting-block">
        <h2>同步状态</h2>
        <dl className="facts">
          <dt>服务器</dt>
          <dd>{location.host}</dd>
          <dt>账号</dt>
          <dd>{s.username}</dd>
          <dt>状态</dt>
          <dd>{phaseText}</dd>
          {sync.pendingPages > 0 && (
            <>
              <dt>待同步页面</dt>
              <dd>{sync.pendingPages} 个</dd>
            </>
          )}
          {sync.pendingUploads > 0 && (
            <>
              <dt>待上传文件</dt>
              <dd>{sync.pendingUploads} 个</dd>
            </>
          )}
          <dt>上次全部同步</dt>
          <dd>{sync.lastSyncedAt ? formatTime(sync.lastSyncedAt) : '还没有'}</dd>
        </dl>
        <div className="row-actions">
          <button
            className="btn"
            onClick={() => {
              reconnectNow()
              kickSweep(0)
              void uploadMissing()
            }}
          >
            立即同步
          </button>
        </div>
      </section>

      <section className="setting-block">
        <h2>退出登录</h2>
        <p>退出后这台设备不再同步。选“退出并清除本机数据”会删掉这个浏览器里的笔记副本（服务器上的不受影响），适合在别人的电脑上用完时。</p>
        <div className="row-actions">
          {confirm ? (
            <span className="confirm-inline">
              {confirm === 'wipe'
                ? sync.phase === 'synced'
                  ? '确定退出并删除这台设备上的笔记副本？'
                  : '还有改动没同步到服务器，现在清除会丢失这些改动。仍然清除？'
                : '确定退出登录？'}
              <button
                className="btn danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await logout(confirm === 'wipe')
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : String(err), { tone: 'error' })
                    setBusy(false)
                  }
                }}
              >
                {confirm === 'wipe' ? '退出并清除' : '退出'}
              </button>
              <button className="btn" onClick={() => setConfirm(null)}>
                取消
              </button>
            </span>
          ) : (
            <>
              <button className="btn" onClick={() => setConfirm('logout')}>
                退出登录
              </button>
              <button className="btn ghost-danger" onClick={() => setConfirm('wipe')}>
                退出并清除本机数据
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
