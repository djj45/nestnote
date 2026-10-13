import { useSyncExternalStore } from 'react'

/** 一个极简的状态容器，配合 useSyncExternalStore 使用 */
export interface Store<T> {
  get(): T
  set(next: T | ((prev: T) => T)): void
  subscribe(listener: () => void): () => void
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(state) : next
      if (Object.is(value, state)) return
      state = value
      listeners.forEach((l) => l())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

/** 只适合选择原始值（字符串、数字、布尔），否则会无限重渲染 */
export function useStoreValue<T, S>(store: Store<T>, selector: (state: T) => S): S {
  const get = () => selector(store.get())
  return useSyncExternalStore(store.subscribe, get, get)
}

/** 简单的事件总线 */
export function createEmitter<E>() {
  const listeners = new Set<(event: E) => void>()
  return {
    emit(event: E) {
      listeners.forEach((l) => l(event))
    },
    on(listener: (event: E) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
