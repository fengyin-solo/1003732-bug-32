import {
  acquireBatchLock,
  loadBatch,
  releaseBatchLock,
  saveReceipts,
} from './batch-store'
import { listRows, saveRows } from './local-store'
import type {
  BatchAdapter,
  BatchAdapterContext,
  BatchDraftItem,
  BatchKind,
  BatchReceipt,
  BatchSubmitItem,
  BatchSubmitResult,
  BatchView,
  EntryRow,
} from './types'

/**
 * 批次落库 + 回执的共用链路。检修面板与巡检列表共用同一套：
 * 1. 落库锁：并发提交只认第一次有效落库；
 * 2. 逐条核查 + 幂等：成功过的条目不再重复落库；
 * 3. 一次原子写入：部分成功时成功的已落库、失败的带原因留下，可接着做；
 * 4. 条目级回执持久化：返回后保留，导出可留痕。
 */
function todayString(): string {
  return new Date().toISOString().slice(0, 10)
}

function nowString(): string {
  return new Date().toISOString()
}

function hashRevision(parts: string[]): string {
  const text = parts.map((part) => String(part ?? '').trim()).join('§')
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i)
    hash |= 0
  }
  return `r${Math.abs(hash)}`
}

export { hashRevision }

export function buildBatchView(kind: BatchKind, adapter: BatchAdapter): BatchView {
  const persisted = loadBatch(kind)
  const receipts = persisted.receipts
  const successIds = new Set(
    receipts.filter((receipt) => receipt.outcome === 'success').map((receipt) => receipt.entryId),
  )
  const rows = listRows(adapter.moduleKey)
  const draft = adapter.buildDraft(rows, successIds)
  return { draft, receipts }
}

/**
 * 提交批次。只提交入参里的条目（典型场景：未完成项接着做），
 * 历史成功回执始终保留并参与汇总。
 */
export function submitBatch(
  kind: BatchKind,
  adapter: BatchAdapter,
  items: BatchSubmitItem[],
): BatchSubmitResult {
  const nowMs = Date.now()
  // 并发提交：只认第一次抢到锁、完成有效落库的提交。
  if (!acquireBatchLock(kind, nowMs)) {
    return {
      ok: false,
      message: '有同一批次正在落库，并发提交只认第一次，请稍后查看回执',
      receipts: loadBatch(kind).receipts,
      summary: summarize(loadBatch(kind).receipts),
    }
  }

  try {
    const rows = listRows(adapter.moduleKey)
    const rowById = new Map(rows.map((row) => [Number(row.id), row]))
    const persisted = loadBatch(kind)
    // 已成功的条目不再重复处理：失败重试不会把成功项再做一遍。
    const successById = new Map(
      persisted.receipts
        .filter((receipt) => receipt.outcome === 'success')
        .map((receipt) => [receipt.entryId, receipt]),
    )
    const priorReceipts = persisted.receipts.filter(
      (receipt) => !items.some((item) => item.entryId === receipt.entryId),
    )

    const ctx: BatchAdapterContext = {
      today: todayString(),
      now: nowString(),
      duplicate: false,
    }

    // 批内编号计数：唯一编号被多次填写时，重复的每一条都给明确原因。
    const codeCounts = new Map<string, number>()
    if (adapter.codeField) {
      for (const item of items) {
        const row = rowById.get(item.entryId)
        const code = String(item.fields[adapter.codeField] ?? row?.[adapter.codeField] ?? '').trim()
        if (code) {
          codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1)
        }
      }
    }

    const nextRows = [...rows]
    const newReceipts: BatchReceipt[] = []
    let success = 0
    let failed = 0

    for (const item of items) {
      const index = nextRows.findIndex((row) => Number(row.id) === item.entryId)
      const row = index >= 0 ? nextRows[index] : undefined

      const fail = (reason: string, source: EntryRow | undefined): BatchReceipt => {
        failed += 1
        const receipt: BatchReceipt = {
          entryId: item.entryId,
          code: source ? adapter.codeOf(source) : String(item.entryId),
          label: source ? adapter.labelOf(source) : '',
          outcome: 'failed',
          reason,
          revision: item.revision,
          fields: { ...item.fields },
          meta: source && adapter.receiptMeta ? adapter.receiptMeta(source, item.fields) : {},
          submittedAt: ctx.now,
        }
        if (!source) {
          receipt.code = `#${item.entryId}`
        }
        return receipt
      }

      if (!row || index < 0) {
        newReceipts.push(fail('记录已不存在，无法落库', undefined))
        continue
      }
      if (adapter.rejectStatuses.includes(String(row.status))) {
        newReceipts.push(fail(adapter.disabledReason(row), row))
        continue
      }

      // 幂等：第一次有效落库后，原样重试不再产生重复结果。
      const existing = successById.get(item.entryId)
      if (existing) {
        newReceipts.push(existing)
        success += 1
        continue
      }

      const code = adapter.codeField ? String(item.fields[adapter.codeField] ?? '').trim() : ''
      const itemCtx: BatchAdapterContext = {
        ...ctx,
        duplicate: Boolean(code && (codeCounts.get(code) ?? 0) > 1),
      }
      const reasons = adapter.validate(row, item.fields, itemCtx)
      if (reasons.length > 0) {
        newReceipts.push(fail(reasons.join('；'), row))
        continue
      }

      const updated = adapter.apply(row, item.fields, itemCtx)
      nextRows[index] = updated
      success += 1
      newReceipts.push({
        entryId: item.entryId,
        code: adapter.codeOf(updated),
        label: adapter.labelOf(updated),
        outcome: 'success',
        reason: undefined,
        revision: item.revision,
        fields: { ...item.fields },
        meta: adapter.receiptMeta ? adapter.receiptMeta(updated, item.fields) : {},
        submittedAt: ctx.now,
      })
    }

    // 部分成功：一次原子写入，成功项已改状态、失败项原封不动并带原因。
    saveRows(adapter.moduleKey, nextRows)
    // 本次未涉及的历史回执保留；本次条目以最新回执覆盖旧的失败回执。
    const merged = [...priorReceipts, ...newReceipts]
    saveReceipts(kind, merged)

    const total = merged.length
    return {
      ok: true,
      message:
        failed === 0
          ? `批次已落库，成功 ${success} 项`
          : `批次部分完成：成功 ${success} 项、失败 ${failed} 项，失败项可从未完成处接着做`,
      receipts: merged,
      summary: { total, success: countOutcome(merged, 'success'), failed: countOutcome(merged, 'failed') },
    }
  } finally {
    releaseBatchLock(kind)
  }
}

/** 清空已完成回执（成功项已落库），失败项保留以便接着做。 */
export function clearFinishedReceipts(kind: BatchKind): BatchReceipt[] {
  const kept = loadBatch(kind).receipts.filter((receipt) => receipt.outcome !== 'success')
  saveReceipts(kind, kept)
  return kept
}

function countOutcome(receipts: BatchReceipt[], outcome: BatchReceipt['outcome']): number {
  return receipts.filter((receipt) => receipt.outcome === outcome).length
}

function summarize(receipts: BatchReceipt[]): BatchSubmitResult['summary'] {
  return {
    total: receipts.length,
    success: countOutcome(receipts, 'success'),
    failed: countOutcome(receipts, 'failed'),
  }
}
