import {
  createPage,
  deletePagesForever,
  getPage,
  getPagesSnapshot,
  isSelfOrDescendant,
  restorePage,
  trashPage,
  type PageType,
} from '../store/workspace'
import { destroyPageData } from '../store/docPool'
import { currentPageId, navigate, paths } from '../lib/router'
import { requestTitleFocus, setExpanded } from './ui'
import { showToast } from './toast'
import { deletePagesOnServer } from '../sync/session'
import { blockedByReadOnly } from './readOnly'

export const pageTypeLabel = (type: PageType) => (type === 'canvas' ? '画布' : '文档')

let persistRequested = false
/** 第一次新建页面时，请浏览器把本站数据标记为"持久存储"，避免空间紧张时被自动清理 */
function requestPersistentStorage() {
  if (persistRequested) return
  persistRequested = true
  navigator.storage?.persist?.().catch(() => {})
}

export function createAndOpen(type: PageType, parentId: string | null = null, title = ''): string | null {
  if (blockedByReadOnly()) return null
  const id = createPage({ type, parentId, title })
  if (parentId) setExpanded(parentId, true)
  requestTitleFocus(id)
  navigate(paths.page(id))
  requestPersistentStorage()
  return id
}

export function moveToTrash(id: string) {
  if (blockedByReadOnly()) return
  const page = getPage(id)
  if (!page) return
  const current = currentPageId()
  const leaving = current !== null && isSelfOrDescendant(current, id)
  const parent = getPagesSnapshot().parentOf.get(id) ?? null
  trashPage(id)
  if (leaving) navigate(parent ? paths.page(parent) : paths.home, { replace: true })
  showToast(`已将“${page.title || '无标题'}”移到回收站`, {
    action: { label: '撤销', run: () => restorePage(id) },
  })
}

export function restoreFromTrash(id: string) {
  if (blockedByReadOnly()) return
  restorePage(id)
  const page = getPage(id)
  showToast(`已恢复“${page?.title || '无标题'}”`)
}

export async function deleteForever(id: string) {
  if (blockedByReadOnly()) return
  const ids = deletePagesForever(id)
  if (currentPageId() && ids.includes(currentPageId()!)) navigate(paths.trash, { replace: true })
  await Promise.all(ids.map((pid) => destroyPageData(pid).catch(() => {})))
  deletePagesOnServer(ids)
}

export async function emptyTrash() {
  if (blockedByReadOnly()) return
  const trashed = getPagesSnapshot().trashed.map((p) => p.id)
  for (const id of trashed) await deleteForever(id)
  showToast('回收站已清空')
}
