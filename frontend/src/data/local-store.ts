import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

// ---- 数据版本订阅：同一标签页用事件总线，跨标签页靠 storage 事件 ----
const listeners = new Set<() => void>()
let storageBound = false

function emitChange() {
  listeners.forEach((listener) => listener())
}

function bindStorageEvent() {
  if (storageBound || typeof window === 'undefined') {
    return
  }
  storageBound = true
  // 别的标签页落库后，本页缓存作废，各入口的待办随之联动更新。
  window.addEventListener('storage', (event) => {
    if (event.key && event.key.startsWith('hydrology-monitor-station:')) {
      if (event.key === STORAGE_KEY) {
        cache = null
      }
      emitChange()
    }
  })
}

export function subscribeData(listener: () => void): () => void {
  bindStorageEvent()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 读取业务模块表（entries 缓存）。 */
export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  emitChange()
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// ---- 独立数据桶：批次回执等不与业务记录混在一起，旧数据天然兼容 ----
export function readBucket<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeBucket<T>(key: string, value: T): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
  emitChange()
}
