/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 批次业务：检修面板（缆道）与巡检列表共用同一条「落库 + 回执」链路。 */
export type BatchKind = 'cableway-overhaul' | 'inspection-round'

export type BatchOutcome = 'success' | 'failed'

/** 批次候选项：面板里每一行未完成的入批记录。 */
export type BatchDraftItem = {
  entryId: number
  /** 主业务编号，如缆道编号 / 巡检记录编号 */
  code: string
  /** 辅助说明，如所属站点 */
  label: string
  /** 可编辑字段（检修批次）；巡检批次为空对象 */
  fields: Record<string, string>
  /** 内容指纹：用于区分「改完再试」与原样重提，并做幂等核对 */
  revision: string
  /** 只读核查信息，如巡检联动到的缆道编号/状态 */
  meta: Record<string, string>
}

/** 条目级回执：成功或失败都落库，失败必须带原因，返回后保留。 */
export type BatchReceipt = {
  entryId: number
  code: string
  label: string
  outcome: BatchOutcome
  reason?: string
  revision: string
  /** 提交时的字段快照，重试时回填、导出时留痕 */
  fields: Record<string, string>
  meta: Record<string, string>
  submittedAt: string
}

export type BatchPersisted = {
  receipts: BatchReceipt[]
  /** 跨标签页的落库锁到期时间戳（毫秒），只认第一次有效落库 */
  lockUntil?: number
}

export type BatchSubmitItem = {
  entryId: number
  fields: Record<string, string>
  revision: string
}

export type BatchSubmitResult = {
  ok: boolean
  message: string
  receipts: BatchReceipt[]
  summary: { total: number; success: number; failed: number }
}

export type BatchView = {
  draft: BatchDraftItem[]
  receipts: BatchReceipt[]
}

export type BatchAdapterContext = {
  today: string
  now: string
  /** 同批内编号是否重复（重复的条目各自给原因） */
  duplicate: boolean
}

/** 批次适配器：两个入口的差异收敛在这里，落库/回执/并发逻辑共用一套。 */
export type BatchAdapter = {
  kind: BatchKind
  moduleKey: string
  /** 编号字段：用于批内/库内唯一性校验，巡检批次可留空 */
  codeField?: string
  /** 命中这些状态的记录视为已停用、不得入批 */
  rejectStatuses: string[]
  disabledReason: (row: EntryRow) => string
  buildDraft: (rows: EntryRow[], successIds: Set<number>) => BatchDraftItem[]
  /** 返回该条目的全部不通过原因（空数组表示通过），一次说清，避免逐条试错 */
  validate: (
    row: EntryRow,
    fields: Record<string, string>,
    ctx: BatchAdapterContext,
  ) => string[]
  apply: (row: EntryRow, fields: Record<string, string>, ctx: BatchAdapterContext) => EntryRow
  /** 写进回执的只读联动信息（如巡检核查到的缆道），用于留痕与导出 */
  receiptMeta?: (row: EntryRow, fields: Record<string, string>) => Record<string, string>
  codeOf: (row: EntryRow) => string
  labelOf: (row: EntryRow) => string
}
