import { getCommandContext } from '../commands/registry'
import { getPage } from '../store/workspace'
import { showToast } from '../app/toast'

/** 导出当前页面为 Markdown（嵌入的页面和图片一起打包） */
export async function exportPageMarkdown(pageId: string) {
  showToast('正在导出…')
  try {
    const { exportMarkdown } = await import('./markdown')
    const { files, assets } = await exportMarkdown(pageId)
    showToast(
      files > 1 || assets > 0
        ? `已导出 ${files} 个页面${assets ? `、${assets} 个文件` : ''}（zip 压缩包）`
        : '已导出 Markdown 文件',
    )
  } catch (err) {
    showToast(`导出失败：${err instanceof Error ? err.message : String(err)}`, { tone: 'error' })
  }
}

/** 当前打开的画布页面的控制器 */
export function currentCanvas(pageId: string | null) {
  const canvas = getCommandContext().canvas
  return canvas && canvas.pageId === pageId ? canvas : null
}

/** 导出当前画布为 PNG（有选中的元素时只导出选中的） */
export async function exportPageImage(pageId: string) {
  const canvas = currentCanvas(pageId)
  if (!canvas) {
    showToast('先打开这个画布再导出图片')
    return
  }
  showToast('正在生成图片…')
  try {
    const { exportCanvasImage } = await import('./canvasImage')
    const { count, selectionOnly } = await exportCanvasImage(canvas)
    showToast(selectionOnly ? `已导出选中的 ${count} 个元素` : '已导出整个画布')
  } catch (err) {
    showToast(`导出失败：${err instanceof Error ? err.message : String(err)}`, { tone: 'error' })
  }
}

/** 打印文档（在打印对话框里可以选"存为 PDF"） */
export function printPage(pageId: string) {
  if (getPage(pageId)?.type !== 'doc') return
  window.print()
}
