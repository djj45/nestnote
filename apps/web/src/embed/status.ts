import { getPagesSnapshot, trashedRootOf } from '../store/workspace'
import { usePages } from '../store/hooks'
import { navigate, paths } from '../lib/router'

/**
 * 嵌套规则：
 * - hostPath 是从最外层页面到"宿主"页面的 id 列表（宿主 = 正在显示这个嵌入的页面）。
 * - 宿主路径里已经出现过的页面不再展开（循环引用）。
 * - 最多实时展开 3 层，更深的显示成一张标题卡片，点开看。
 */
export const MAX_EMBED_DEPTH = 3

export type EmbedStatus = 'live' | 'missing' | 'trashed' | 'cycle' | 'deep'

export function embedStatus(pageId: string | null, hostPath: readonly string[]): EmbedStatus {
  const snap = getPagesSnapshot()
  if (!pageId || !snap.byId.has(pageId)) return 'missing'
  if (!snap.visible.has(pageId)) {
    // 被嵌入的页面在回收站里。宿主也在回收站同一处时（在回收站里查看），照常显示
    const root = trashedRootOf(pageId)
    if (!root || !hostPath.length || root !== trashedRootOf(hostPath[0])) return 'trashed'
  }
  if (hostPath.includes(pageId)) return 'cycle'
  if (hostPath.length > MAX_EMBED_DEPTH) return 'deep'
  return 'live'
}

export function useEmbedStatus(pageId: string | null, hostPath: readonly string[]): EmbedStatus {
  usePages()
  return embedStatus(pageId, hostPath)
}

/** 打开整页。trail 是来时的路径，顶栏的面包屑会显示它 */
export function openPage(pageId: string, trail?: readonly string[]) {
  navigate(paths.page(pageId), trail?.length ? { state: { trail: [...trail] } } : {})
}
