/** 从侧边栏拖动页面时 dataTransfer 里的类型：拖到侧边栏里是移动，拖到文档或画布里是嵌入 */
export const PAGE_DRAG_TYPE = 'application/x-note-page'

export function draggedPageId(data: DataTransfer | null | undefined): string | null {
  const id = data?.getData(PAGE_DRAG_TYPE)
  return id ? id : null
}

export function isPageDrag(data: DataTransfer | null | undefined): boolean {
  return !!data && [...data.types].includes(PAGE_DRAG_TYPE)
}
