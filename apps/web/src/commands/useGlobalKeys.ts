import { useEffect } from 'react'
import { cancelChord, dispatchKeyEvent, isChordPending, isRecordingShortcut } from './registry'
import { comboFromEvent, isTypingCombo } from './keys'
import { isEditableTarget } from '../lib/platform'

/**
 * 全局快捷键监听。文档编辑器里的按键会先由编辑器自己的插件处理（见 editor/commandKeymap.ts），
 * 处理过的事件会被 preventDefault，这里就跳过。
 */
export function useGlobalKeys() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isRecordingShortcut()) return
      const combo = comboFromEvent(e)
      if (!combo) return
      // 在输入框里打字时，不触发不带修饰键的快捷键（按键序列等第二个键时除外）
      if (isEditableTarget(e.target) && isTypingCombo(combo) && !isChordPending()) return
      dispatchKeyEvent(e, ['global'])
    }
    // 切到别的窗口、点鼠标：放弃正在等的按键序列
    const onCancel = () => cancelChord()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onCancel)
    window.addEventListener('pointerdown', onCancel, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onCancel)
      window.removeEventListener('pointerdown', onCancel, true)
    }
  }, [])
}
