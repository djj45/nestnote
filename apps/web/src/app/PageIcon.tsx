import { FileText, Shapes } from 'lucide-react'
import type { PageType } from '../store/workspace'

export function PageIcon({ type, className }: { type: PageType; className?: string }) {
  const Icon = type === 'canvas' ? Shapes : FileText
  return <Icon className={`icon page-icon page-icon-${type} ${className ?? ''}`} aria-hidden />
}
