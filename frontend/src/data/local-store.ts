import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'
// 结构变更时抬版本：旧版本数据做迁移而不是直接丢掉。
const STORAGE_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeModule(rows: unknown): EntryRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows.filter((row): row is EntryRow => {
    if (!row || typeof row !== 'object') {
      return false
    }
    const candidate = row as Record<string, unknown>
    return (
      typeof candidate.id === 'number' &&
      typeof candidate.status === 'string' &&
      typeof candidate.pending === 'boolean' &&
      typeof candidate.abnormal === 'boolean'
    )
  })
}

// 旧数据兼容：v1 只有裸 Record<key, EntryRow[]>，统一补齐缺失模块、过滤脏行。
function migrate(raw: unknown): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (!raw || typeof raw !== 'object') {
    return fallback
  }
  const root = raw as Record<string, unknown>
  // 兼容 { version, data } 新结构和裸表 v1 结构
  const data =
    typeof root.version === 'number' && root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : (root as Record<string, unknown>)
  const merged: Record<string, EntryRow[]> = { ...fallback }
  for (const key of Object.keys(fallback)) {
    if (key in data) {
      const migrated = normalizeModule(data[key])
      // 旧模块整段坏掉时回落到种子，而不是让列表直接崩掉
      merged[key] = migrated.length ? migrated : clone(fallback[key])
    }
  }
  return merged
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback)
    return fallback
  }
  try {
    return migrate(JSON.parse(raw))
  } catch {
    persist(fallback)
    return fallback
  }
}

function persist(rows: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, data: rows }))
  }
}

type Listener = () => void
const listeners = new Set<Listener>()

let cache: Record<string, EntryRow[]> | null = null
// 数据版本：任何一处落库都自增，依赖待办联动的页面据此重新读数。
let revision = 0

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
  revision += 1
  persist(next)
  emitChange()
}

/** 一次提交里改多张表（缆道落库 + 巡检核查待办联动）时合并成一次写入、一次通知。 */
export function commitRows(patch: Record<string, EntryRow[]>): void {
  const next = { ...allRows(), ...patch }
  cache = next
  revision += 1
  persist(next)
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

export function getRevision(): number {
  return revision
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emitChange(): void {
  for (const fn of listeners) {
    fn()
  }
}

// 跨标签页：别的标签落库后，本标签作废缓存并联动刷新。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) {
      return
    }
    cache = null
    revision += 1
    emitChange()
  })
}
