import { createStore, useStore } from '../lib/store'
import { showToast } from './toast'

/**
 * 只读模式：每台设备各自设置（存在 localStorage，不同步），比如手机上开只读、电脑上照常编辑。
 * 开启后不能修改页面内容、标题和页面结构（新建、移动、重命名、删除），只能浏览。
 */

const KEY = 'note:readOnly'

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export const readOnlyMode = createStore<boolean>(load())

export function setReadOnly(value: boolean) {
  readOnlyMode.set(value)
  try {
    if (value) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    /* 忽略 */
  }
}

export function toggleReadOnly() {
  const next = !readOnlyMode.get()
  setReadOnly(next)
  showToast(next ? '已开启只读模式' : '已关闭只读模式，可以编辑了')
}

export const isReadOnly = () => readOnlyMode.get()

export function useReadOnly(): boolean {
  return useStore(readOnlyMode)
}

/** 修改操作前调用：只读模式下提示并返回 true（调用方应放弃这次操作） */
export function blockedByReadOnly(): boolean {
  if (!readOnlyMode.get()) return false
  showToast('现在是只读模式，不能修改', { action: { label: '关闭只读', run: () => setReadOnly(false) } })
  return true
}

// 其它标签页里切换了只读模式时跟着变
window.addEventListener('storage', (e) => {
  if (e.key === KEY) readOnlyMode.set(e.newValue === '1')
})
