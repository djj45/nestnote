import { useStore } from '../lib/store'
import { chordStore } from '../commands/registry'
import { Kbd } from './Kbd'

/** 按了按键序列的第一个键、在等第二个键时，屏幕下方显示一个小提示 */
export function ChordHint() {
  const prefix = useStore(chordStore)
  if (!prefix) return null
  return (
    <div className="chord-hint" role="status">
      <Kbd combo={prefix} />
      <span>已按下，再按一个键…</span>
      <span className="chord-hint-esc">Esc 取消</span>
    </div>
  )
}
