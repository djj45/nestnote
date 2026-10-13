import { useEffect } from 'react'
import { getCommandContext } from './commands/registry'
import { endOfDoc, insertFiles } from './editor/insertFiles'
import { showToast } from './app/toast'
import { useWorkspaceReady } from './store/hooks'
import { useGlobalKeys } from './commands/useGlobalKeys'
import { Layout } from './app/Layout'
import { setPageChangeListener } from './store/docPool'
import { touchPage } from './store/workspace'
import { useStore } from './lib/store'
import { session } from './sync/session'
import { LoginView } from './app/LoginView'

setPageChangeListener(touchPage)

/**
 * 文件被拖到页面上编辑器以外的地方时，浏览器默认会直接打开这个文件、离开笔记。
 * 这里拦下来：当前是文档就加到文末，否则提示一下。
 */
function useFileDropGuard() {
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return
      e.preventDefault()
      const { canvas, editor } = getCommandContext()
      const files = [...e.dataTransfer!.files]
      if (canvas) {
        if (!canvas.readOnly) void canvas.addFiles(files)
      } else if (editor?.isEditable) void insertFiles(editor, files, endOfDoc(editor))
      else showToast('先打开一个文档或画布，再把文件拖进去')
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])
}

export function App() {
  const ready = useWorkspaceReady()
  const { status } = useStore(session)

  useEffect(() => {
    if (ready && (status === 'ready' || status === 'local')) document.documentElement.dataset.ready = '1'
  }, [ready, status])

  if (status === 'login') return <LoginView />
  if (!ready || status === 'checking') {
    return (
      <div className="splash" aria-busy="true">
        正在读取笔记…
      </div>
    )
  }
  return <AppShell />
}

/** 快捷键和拖放文件只在主界面生效（登录页上不能新建页面之类） */
function AppShell() {
  useGlobalKeys()
  useFileDropGuard()
  return <Layout />
}
