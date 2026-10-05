import { readBucket, writeBucket } from './local-store'
import type { BatchKind, BatchPersisted, BatchReceipt } from './types'

const STORAGE_PREFIX = 'hydrology-monitor-station:batch:'
/** 落库锁存活时间：防止页面异常退出后锁死，过期视为陈旧可重新提交。 */
export const LOCK_TTL_MS = 15_000

function bucketKey(kind: BatchKind): string {
  return `${STORAGE_PREFIX}${kind}`
}

function emptyPersisted(): BatchPersisted {
  return { receipts: [] }
}

export function loadBatch(kind: BatchKind): BatchPersisted {
  const persisted = readBucket<BatchPersisted>(bucketKey(kind), emptyPersisted())
  return {
    receipts: Array.isArray(persisted.receipts) ? persisted.receipts : [],
    lockUntil: typeof persisted.lockUntil === 'number' ? persisted.lockUntil : undefined,
  }
}

export function saveReceipts(kind: BatchKind, receipts: BatchReceipt[]): void {
  const persisted = loadBatch(kind)
  writeBucket(bucketKey(kind), { ...persisted, receipts })
}

export function saveLockUntil(kind: BatchKind, lockUntil: number | undefined): void {
  const persisted = loadBatch(kind)
  writeBucket(bucketKey(kind), { ...persisted, lockUntil })
}

/**
 * 尝试抢占落库锁。返回 true 表示抢到（本次提交有效）；
 * 返回 false 表示已有进行中的提交，并发只认第一次。
 */
export function acquireBatchLock(kind: BatchKind, now: number): boolean {
  const persisted = loadBatch(kind)
  if (persisted.lockUntil && persisted.lockUntil > now) {
    return false
  }
  writeBucket(bucketKey(kind), { ...persisted, lockUntil: now + LOCK_TTL_MS })
  return true
}

export function releaseBatchLock(kind: BatchKind): void {
  saveLockUntil(kind, undefined)
}
