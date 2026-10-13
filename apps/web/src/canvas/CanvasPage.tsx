import { useEffect, useRef, useState } from 'react'
import { usePageDoc } from '../store/hooks'
import { CanvasController } from './controller'
import { CanvasView } from './CanvasView'

/** 加载画布页面的数据，创建控制器 */
export function CanvasPage({ pageId, readOnly }: { pageId: string; readOnly: boolean }) {
  const doc = usePageDoc(pageId)
  const [controller, setController] = useState<CanvasController | null>(null)

  // 只读开关只是切换控制器的状态，不重建画布（重建会让整个画布闪一下）
  const initialReadOnly = useRef(readOnly)
  initialReadOnly.current = readOnly
  useEffect(() => {
    if (!doc) return
    const c = new CanvasController(pageId, doc, initialReadOnly.current)
    setController(c)
    return () => c.dispose()
  }, [doc, pageId])

  useEffect(() => {
    controller?.setReadOnly(readOnly)
  }, [controller, readOnly])

  if (!controller || controller.doc !== doc) {
    return <div className="canvas-viewport is-loading" aria-busy="true" />
  }
  return <CanvasView key={pageId} controller={controller} />
}
