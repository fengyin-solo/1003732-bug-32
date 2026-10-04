import { defineStore } from 'pinia'

import {
  commitBatchItems,
  ensureEligible,
  listCableways,
  validateItemDraft,
} from '@/api/cableway-batch'
import { listRows, subscribe } from '@/data/local-store'
import type { BatchRecord, BatchReceipt, CablewayBatchItem, EntryRow } from '@/data/types'

// 缆道批次：检修面板与巡检列表共用同一份批次/待办数据，入口之间靠本地存储订阅联动。

const BATCH_STORAGE_KEY = 'hydrology-monitor-station:cableway-batches'
const CHECK_TAG = '缆道参数核查'
const PENDING_CHECK_STATUS = ['待巡检', '发现故障']

type PersistedBatches = { activeId: string | null; batches: BatchRecord[] }

function loadBatches(): PersistedBatches {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { activeId: null, batches: [] }
  }
  const raw = window.localStorage.getItem(BATCH_STORAGE_KEY)
  if (!raw) {
    return { activeId: null, batches: [] }
  }
  try {
    const parsed = JSON.parse(raw)
    // 旧数据兼容：结构不对就按空批次起步，不抛到页面上
    if (Array.isArray(parsed)) {
      return { activeId: null, batches: sanitize(parsed) }
    }
    if (parsed && Array.isArray(parsed.batches)) {
      return {
        activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
        batches: sanitize(parsed.batches),
      }
    }
    return { activeId: null, batches: [] }
  } catch {
    return { activeId: null, batches: [] }
  }
}

function sanitize(rows: unknown[]): BatchRecord[] {
  return (rows as BatchRecord[]).filter(
    (batch) =>
      batch &&
      typeof batch.id === 'string' &&
      Array.isArray(batch.items) &&
      Array.isArray(batch.receipts),
  )
}

let itemSeq = 0
function makeItemId(): string {
  itemSeq += 1
  return `item-${Date.now().toString(36)}-${itemSeq}`
}

export function pendingCheckTodos(): EntryRow[] {
  return listRows('inspection').filter(
    (row) =>
      PENDING_CHECK_STATUS.includes(String(row.status)) &&
      String(row['检查项目'] ?? '').includes(CHECK_TAG),
  )
}

type State = {
  batches: BatchRecord[]
  activeId: string | null
  submitting: boolean
  checkCount: number
  /** 检修/巡检等各入口共用同一个批次面板 */
  panelOpen: boolean
  /** 数据被别处（其他入口/标签页）改动的版本戳，页面 watch 它做刷新 */
  dataTick: number
}

export const useCablewayBatchStore = defineStore('cableway-batch', {
  state: (): State => {
    const persisted = loadBatches()
    return {
      batches: persisted.batches,
      activeId: persisted.activeId,
      submitting: false,
      checkCount: pendingCheckTodos().length,
      panelOpen: false,
      dataTick: 0,
    }
  },
  getters: {
    active(state): BatchRecord | null {
      return state.batches.find((batch) => batch.id === state.activeId) ?? null
    },
    unfinishedCount(state): number {
      const batch = state.batches.find((entry) => entry.id === state.activeId)
      return batch
        ? batch.items.filter((item) => item.status !== 'succeeded').length
        : 0
    },
  },
  actions: {
    init() {
      // 落库/其他入口动作后统一从这里联动：批次项、核查待办、列表都重读数
      subscribe(() => {
        this.checkCount = pendingCheckTodos().length
        this.dataTick += 1
      })
    },
    openPanel() {
      this.openBatch()
      this.panelOpen = true
      this.refreshChecks()
    },
    closePanel() {
      this.panelOpen = false
    },
    persist() {
      if (typeof window !== 'undefined' && window.localStorage) {
        const payload: PersistedBatches = { activeId: this.activeId, batches: this.batches }
        window.localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify(payload))
      }
    },
    openBatch(): BatchRecord {
      let batch = this.active
      if (!batch) {
        batch = {
          id: `BATCH-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`,
          createdAt: new Date().toISOString(),
          items: [],
          receipts: [],
        }
        this.batches.push(batch)
        this.activeId = batch.id
        this.persist()
      }
      return batch
    },
    /** 从缆道列表选行入批；已停用缆道在这一步就被拦住。 */
    addCablewayRow(row: EntryRow): string {
      const blocked = ensureEligible(row)
      if (blocked) {
        return blocked
      }
      const batch = this.openBatch()
      if (batch.items.some((item) => item.cablewayId === Number(row.id))) {
        return `缆道 ${row['缆道编号']} 已在本批次中`
      }
      if (batch.items.some((item) => item.code === String(row['缆道编号'] ?? ''))) {
        return `缆道编号 ${row['缆道编号']} 在本批次中重复`
      }
      const item: CablewayBatchItem = {
        itemId: makeItemId(),
        cablewayId: Number(row.id),
        code: String(row['缆道编号'] ?? ''),
        station: String(row['所属站点'] ?? ''),
        span: String(row['跨度米数'] ?? ''),
        load: String(row['荷载能力'] ?? ''),
        status: 'pending',
        reason: '',
        updatedAt: new Date().toISOString(),
        baseVersion: Number(row.version ?? 1),
      }
      batch.items.push(item)
      this.persist()
      return ''
    },
    addBlank(): void {
      const batch = this.openBatch()
      batch.items.push({
        itemId: makeItemId(),
        cablewayId: null,
        code: '',
        station: '',
        span: '',
        load: '',
        status: 'pending',
        reason: '',
        updatedAt: new Date().toISOString(),
        baseVersion: null,
      })
      this.persist()
    },
    updateItem(itemId: string, patch: Partial<Pick<CablewayBatchItem, 'code' | 'station' | 'span' | 'load'>>) {
      const batch = this.active
      if (!batch || this.submitting) {
        return
      }
      const item = batch.items.find((entry) => entry.itemId === itemId)
      if (!item) {
        return
      }
      Object.assign(item, patch, { updatedAt: new Date().toISOString() })
      // 改了内容就允许再试一次：失败原因清掉
      if (item.status === 'failed') {
        item.status = 'pending'
        item.reason = ''
      }
      this.persist()
    },
    validateItem(itemId: string): string {
      const batch = this.active
      if (!batch) {
        return ''
      }
      const item = batch.items.find((entry) => entry.itemId === itemId)
      if (!item) {
        return ''
      }
      return validateItemDraft(item, { peers: batch.items, selfItemId: itemId })
    },
    removeItem(itemId: string) {
      const batch = this.active
      if (!batch) {
        return
      }
      batch.items = batch.items.filter((item) => item.itemId !== itemId)
      this.persist()
    },
    /**
     * 并发冲突后以第一次落库的最新数据为基线继续：
     * 行内字段刷新成库中现值，版本基线对齐，用户在最新结果上改完再提交。
     */
    syncFromLatest(itemId: string) {
      const batch = this.active
      if (!batch) {
        return
      }
      const item = batch.items.find((entry) => entry.itemId === itemId)
      if (!item || item.cablewayId === null) {
        return
      }
      const row = listCableways().find((entry) => Number(entry.id) === item.cablewayId)
      if (!row) {
        return
      }
      item.code = String(row['缆道编号'] ?? item.code)
      item.station = String(row['所属站点'] ?? item.station)
      item.span = String(row['跨度米数'] ?? item.span)
      item.load = String(row['荷载能力'] ?? item.load)
      item.baseVersion = Number(row.version ?? 1)
      item.status = 'pending'
      item.reason = ''
      item.updatedAt = new Date().toISOString()
      this.persist()
    },
    clearSucceeded() {
      const batch = this.active
      if (!batch) {
        return
      }
      batch.items = batch.items.filter((item) => item.status !== 'succeeded')
      this.persist()
    },
    /** 提交未完成项；成功项幂等跳过，失败项从失败处接着做。 */
    async submit(): Promise<{ ok: boolean; message: string }> {
      const batch = this.active
      if (!batch) {
        return { ok: false, message: '当前没有打开的批次' }
      }
      // 并发提交只认第一次：提交进行中的重复点击直接并掉
      if (this.submitting) {
        return { ok: false, message: '本批次正在提交中，请勿重复提交' }
      }
      const pending = batch.items.filter((item) => item.status !== 'succeeded')
      if (!pending.length) {
        return { ok: false, message: '没有未完成项，失败项可从失败处接着做' }
      }
      this.submitting = true
      try {
        // 与真实回执链路对齐：落库是异步动作，模拟极小延迟让并发拦截可观测
        await new Promise((resolve) => window.setTimeout(resolve, 120))
        if (this.activeId !== batch.id) {
          return { ok: false, message: '批次已切换，本次提交作废' }
        }
        const outcomes = commitBatchItems(batch.items)
        for (const outcome of outcomes) {
          const index = batch.items.findIndex((item) => item.itemId === outcome.item.itemId)
          if (index >= 0) {
            batch.items[index] = outcome.item
          }
        }
        const succeeded = outcomes.filter((outcome) => outcome.receipt.result === '成功').length
        const failed = outcomes.length - succeeded
        const receipt: BatchReceipt = {
          at: new Date().toISOString(),
          succeeded,
          failed,
          items: outcomes.map((outcome) => outcome.receipt),
        }
        batch.receipts.unshift(receipt)
        this.persist()
        this.checkCount = pendingCheckTodos().length
        if (failed === 0) {
          return { ok: true, message: `本批 ${succeeded} 项全部落库成功，核查待办已联动生成` }
        }
        // 逐项回执：总数 + 每条失败原因，不再只说「半批完成」
        const detail = outcomes
          .filter((outcome) => outcome.receipt.result === '失败')
          .map((outcome) => `· ${outcome.receipt.code}：${outcome.receipt.reason}`)
          .join('\n')
        return {
          ok: succeeded > 0,
          message: `成功 ${succeeded} 项、失败 ${failed} 项（成功项已保留，失败项可直接重试）：\n${detail}`,
        }
      } finally {
        this.submitting = false
      }
    },
    refreshChecks() {
      this.checkCount = pendingCheckTodos().length
    },
    selectableCableways(): EntryRow[] {
      const batch = this.active
      const inBatch = new Set(batch ? batch.items.map((item) => item.cablewayId) : [])
      // 已停用缆道不得入批：不在可选列表出现，入批闸口 addCablewayRow 再拦一道
      return listCableways().filter(
        (row) => !inBatch.has(Number(row.id)) && String(row.status) !== '已停用',
      )
    },
  },
})
