import { Fragment } from 'react'
import { comboParts, formatCombo, splitSequence } from '../commands/keys'
import { getBindings, useCommandsVersion } from '../commands/registry'

/** 显示一个快捷键；按键序列（例如 ⌘K S）的两段之间留一点空 */
export function Kbd({ combo, className }: { combo: string; className?: string }) {
  const steps = splitSequence(combo)
  return (
    <span className={`kbd ${className ?? ''}`} aria-label={formatCombo(combo)}>
      {steps.map((step, s) => (
        <Fragment key={s}>
          {s > 0 && <span className="kbd-then" aria-hidden />}
          <span className="kbd-step">
            {comboParts(step).map((part, i) => (
              <kbd key={i}>{part}</kbd>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  )
}

/** 命令当前的第一个快捷键（会随用户修改实时更新） */
export function useShortcut(commandId: string): string | null {
  useCommandsVersion()
  return getBindings(commandId)[0] ?? null
}

export function CommandKbd({ commandId, className }: { commandId: string; className?: string }) {
  const combo = useShortcut(commandId)
  return combo ? <Kbd combo={combo} className={className} /> : null
}

/** 给按钮 title 用的文字，例如 "新建文档 (⌥⌘N)" */
export function useTitleWithShortcut(label: string, commandId: string): string {
  const combo = useShortcut(commandId)
  return combo ? `${label}（${formatCombo(combo)}）` : label
}
