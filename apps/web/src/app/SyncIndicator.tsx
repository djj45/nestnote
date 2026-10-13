import { Cloud, CloudOff, LoaderCircle, Lock, LockOpen } from 'lucide-react'
import { useStore } from '../lib/store'
import { cls } from '../lib/format'
import { navigate, paths } from '../lib/router'
import { syncState } from '../sync/engine'
import { session } from '../sync/session'
import { setReadOnly, useReadOnly } from './readOnly'
import { showToast } from './toast'

/** 顶栏右侧：只读开关 + 同步状态 */
export function SyncIndicator() {
  return (
    <>
      <ReadOnlyBadge />
      <SyncStatus />
    </>
  )
}

/** 只读开关：一直显示。关闭时是淡色的开锁图标，开启时是蓝色的"只读" */
function ReadOnlyBadge() {
  const readOnly = useReadOnly()
  const toggle = () => {
    setReadOnly(!readOnly)
    showToast(readOnly ? '已关闭只读模式，可以编辑了' : '已开启只读模式')
  }
  if (!readOnly) {
    return (
      <button className="icon-btn readonly-toggle" title="开启只读模式（防止误改）" aria-label="开启只读模式" onClick={toggle}>
        <LockOpen className="icon" aria-hidden />
      </button>
    )
  }
  return (
    <button className="readonly-badge" title="只读模式：不能修改内容。点击关闭只读" aria-pressed="true" onClick={toggle}>
      <Lock className="icon" aria-hidden />
      <span>只读</span>
    </button>
  )
}

/** 同步状态：已同步 / 同步中 / 离线 */
function SyncStatus() {
  const { status } = useStore(session)
  const { phase, pendingPages, pendingUploads } = useStore(syncState)
  if (status !== 'ready') return null

  let label: string
  let detail: string
  let Icon = Cloud
  if (phase === 'offline' || phase === 'off') {
    label = '离线'
    detail = '连不上服务器。可以照常编辑，联网后会自动同步。'
    Icon = CloudOff
  } else if (phase === 'syncing') {
    label = '同步中'
    const parts = []
    if (pendingPages) parts.push(`${pendingPages} 个页面`)
    if (pendingUploads) parts.push(`${pendingUploads} 个文件`)
    detail = parts.length ? `正在同步 ${parts.join('、')}` : '正在同步'
    Icon = LoaderCircle
  } else {
    label = '已同步'
    detail = '所有改动都已保存到服务器'
  }

  return (
    <button
      className={cls('sync-indicator', `is-${phase}`)}
      title={`${detail}（点击查看同步设置）`}
      onClick={() => navigate(paths.settings('sync'))}
    >
      <Icon className="icon" aria-hidden />
      <span>{label}</span>
    </button>
  )
}
