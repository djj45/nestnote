import { useEffect, useRef, useState } from 'react'
import { usePageDoc } from '../store/hooks'
import { CanvasController } from '../canvas/controller'
import { CanvasView } from '../canvas/CanvasView'

/**
 * 嵌在别处的画布：和整页打开时用同一份数据。
 * 每个嵌入位置各自记住视角（cameraKey），平时不响应鼠标，激活（active）后才能操作。
 */
export function EmbeddedCanvas({
  pageId,
  path,
  cameraKey,
  readOnly,
  active,
  onExit,
}: {
  pageId: string
  /** 从最外层页面到这个画布的路径（包括它自己） */
  path: string[]
  cameraKey: string
  readOnly: boolean
  active: boolean
  /** 在画布里按 Esc（没有别的可以取消时）退出 */
  onExit: () => void
}) {
  const doc = usePageDoc(pageId)
  const [controller, setController] = useState<CanvasController | null>(null)
  const pathKey = path.join('/')

  const initialReadOnly = useRef(readOnly)
  initialReadOnly.current = readOnly
  useEffect(() => {
    if (!doc) return
    const c = new CanvasController(pageId, doc, initialReadOnly.current, { path: pathKey.split('/'), cameraKey })
    setController(c)
    return () => c.dispose()
  }, [doc, pageId, pathKey, cameraKey])

  useEffect(() => {
    controller?.setReadOnly(readOnly)
  }, [controller, readOnly])

  if (!controller || controller.doc !== doc || controller.cameraKey !== cameraKey) {
    return <div className="canvas-viewport is-embedded is-loading" aria-busy="true" />
  }
  return <CanvasView controller={controller} embedded={{ active, onExit }} />
}
