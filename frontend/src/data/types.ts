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

/** 缆道批次：批次内每一项的状态。成功项不随重试再次落库，失败项可原地续做。 */
export type BatchItemStatus = 'pending' | 'succeeded' | 'failed'

export type CablewayBatchItem = {
  /** 幂等键：同一缆道重复入批、失败重试都靠它去重 */
  itemId: string
  /** 已存在缆道绑定行 id；新增项落库前为 null，落库后回填 */
  cablewayId: number | null
  code: string
  station: string
  span: string
  load: string
  status: BatchItemStatus
  /** 失败原因（逐项回执），成功时为空 */
  reason: string
  updatedAt: string
  /** 入批时绑定行的版本号，落库前若被别处改动则并发冲突；新增项为 null */
  baseVersion: number | null
}

/** 单次提交里某一项的回执，多次提交按时间挂在同一条回执链路上。 */
export type ItemReceipt = {
  itemId: string
  code: string
  span: number | string
  load: number | string
  result: '成功' | '失败'
  reason: string
}

export type BatchReceipt = {
  at: string
  succeeded: number
  failed: number
  items: ItemReceipt[]
}

export type BatchRecord = {
  id: string
  createdAt: string
  items: CablewayBatchItem[]
  receipts: BatchReceipt[]
}
