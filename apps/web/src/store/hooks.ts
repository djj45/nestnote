import { useEffect, useState, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import {
  getPagesSnapshot,
  isWorkspaceReady,
  onWorkspaceReady,
  subscribePages,
  type PageMeta,
  type PagesSnapshot,
} from './workspace'
import { acquirePageDoc, releasePageDoc } from './docPool'

export function usePages(): PagesSnapshot {
  return useSyncExternalStore(subscribePages, getPagesSnapshot)
}

export function usePage(id: string | null): PageMeta | undefined {
  const snap = usePages()
  return id ? snap.byId.get(id) : undefined
}

export function useWorkspaceReady(): boolean {
  return useSyncExternalStore(onWorkspaceReady, isWorkspaceReady)
}

/** 加载页面正文的 Y.Doc；本地数据读完之前返回 null */
export function usePageDoc(id: string): Y.Doc | null {
  const [loaded, setLoaded] = useState<{ id: string; doc: Y.Doc } | null>(null)
  useEffect(() => {
    let alive = true
    const entry = acquirePageDoc(id)
    entry.whenSynced.then(() => {
      if (alive) setLoaded({ id, doc: entry.doc })
    })
    return () => {
      alive = false
      releasePageDoc(id)
    }
  }, [id])
  return loaded && loaded.id === id ? loaded.doc : null
}
