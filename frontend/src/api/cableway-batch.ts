import { allRows, commitRows } from '@/data/local-store'
import type {
  BatchItemStatus,
  CablewayBatchItem,
  EntryRow,
  ItemReceipt,
} from '@/data/types'

// 缆道参数批量保存：校验、逐项落库、回执原因、巡检核查待办联动都在这里。
// 修的正是「整表覆盖写 + 写库与回执不共账 + 重试无幂等键」这条共同根因。

const DISABLED_STATUS = '已停用'
const PENDING_INSPECTION_STATUS = ['待巡检', '发现故障']
const CHECK_TAG = '缆道参数核查'

export type CommitOutcome = {
  item: CablewayBatchItem
  receipt: ItemReceipt
}

function parsePositive(value: string): number | null {
  if (value.trim() === '') {
    return null
  }
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : null
}

export function validateItemDraft(
  draft: Pick<CablewayBatchItem, 'code' | 'span' | 'load' | 'cablewayId'>,
  options: { peers?: CablewayBatchItem[]; selfItemId?: string } = {},
): string {
  const code = draft.code.trim()
  if (!code) {
    return '缆道编号不能为空'
  }
  if (parsePositive(draft.span) === null) {
    return '跨度米数必须为大于 0 的数字'
  }
  if (parsePositive(draft.load) === null) {
    return '荷载能力必须为大于 0 的数字'
  }
  const duplicatedInTable = listCableways().some(
    (row) => row['缆道编号'] === code && Number(row.id) !== draft.cablewayId,
  )
  if (duplicatedInTable) {
    return `缆道编号 ${code} 已被其他缆道占用`
  }
  const duplicatedInBatch = (options.peers ?? []).some(
    (item) =>
      item.itemId !== options.selfItemId &&
      item.status !== 'succeeded' &&
      item.code.trim() === code,
  )
  if (duplicatedInBatch) {
    return `缆道编号 ${code} 在本批次中重复`
  }
  return ''
}

/** 已停用缆道不得入批：选现有缆道入批前先过这道闸。 */
export function ensureEligible(row: EntryRow): string {
  if (String(row.status) === DISABLED_STATUS) {
    return `缆道 ${row['缆道编号']} 已停用，不能入批修改`
  }
  return ''
}

export function listCableways(): EntryRow[] {
  return allRows().cableway ?? []
}

function listInspections(): EntryRow[] {
  return allRows().inspection ?? []
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

/**
 * 缆道参数核查待办：参数落库成功后联动巡检。
 * 同一缆道已有待巡检/发现故障的核查记录就补写进去，不再重复造一条。
 */
function upsertInspectionChecks(
  success: { code: string; station: string; span: number; load: number }[],
): EntryRow[] {
  const rows = listInspections().map((row) => ({ ...row }))
  for (const item of success) {
    const detail = `${CHECK_TAG}：缆道 ${item.code}，跨度 ${item.span} 米，荷载 ${item.load}`
    const existing = rows.find(
      (row) =>
        PENDING_INSPECTION_STATUS.includes(String(row.status)) &&
        String(row['检查项目'] ?? '').includes(CHECK_TAG) &&
        String(row['检查项目'] ?? '').includes(item.code),
    )
    if (existing) {
      const previous = String(existing['检查项目'] ?? '')
      existing['检查项目'] = previous.includes(detail) ? previous : `${previous}；${detail}`
      continue
    }
    const id = nextId(rows)
    rows.push({
      id,
      status: '待巡检',
      pending: true,
      abnormal: false,
      '记录编号': `INSP-${String(id).padStart(4, '0')}`,
      '站点编号': item.station || item.code,
      '巡检日期': new Date().toISOString().slice(0, 10),
      '巡检人员': '',
      '检查项目': detail,
      '发现问题': '',
      '处理措施': '',
      '巡检状态': '',
    })
  }
  return rows
}

function buildItemFromRow(
  row: EntryRow,
  overrides: { code: string; station: string; span: number; load: number },
  isNew: boolean,
): EntryRow {
  const now = new Date().toISOString().slice(0, 10)
  const next: EntryRow = isNew
    ? {
        id: row.id,
        status: '正常运行',
        pending: true,
        abnormal: false,
        '缆道编号': overrides.code,
        '所属站点': overrides.station,
        '跨度米数': overrides.span,
        '建成日期': now,
        '最近检修日': '',
        '荷载能力': overrides.load,
        '检修人员': '',
        '缆道状态': '',
        version: 1,
      }
    : {
        ...row,
        '缆道编号': overrides.code,
        '所属站点': overrides.station,
        '跨度米数': overrides.span,
        '荷载能力': overrides.load,
        version: Number(row.version ?? 1) + 1,
      }
  return next
}

/**
 * 逐项落库。成功项直接跳过（幂等：并发/重试只认第一次有效落库），
 * 失败项带着原因回来，可从失败处接着做。只改命中行，绝不整表覆盖。
 */
export function commitBatchItems(items: CablewayBatchItem[]): CommitOutcome[] {
  const cableRows = listCableways().map((row) => ({ ...row }))
  const outcomes: CommitOutcome[] = []
  const successForCheck: { code: string; station: string; span: number; load: number }[] = []

  for (const item of items) {
    if (item.status === 'succeeded') {
      continue
    }
    const code = item.code.trim()
    const span = parsePositive(item.span)
    const load = parsePositive(item.load)
    const receipt: ItemReceipt = {
      itemId: item.itemId,
      code,
      span: span ?? item.span,
      load: load ?? item.load,
      result: '成功',
      reason: '',
    }
    let nextStatus: BatchItemStatus = 'succeeded'
    let reason: string
    let committedId: number | null = item.cablewayId
    let committedVersion: number | null = item.baseVersion

    if (!code) {
      reason = '缆道编号不能为空'
    } else if (span === null) {
      reason = '跨度米数必须为大于 0 的数字'
    } else if (load === null) {
      reason = '荷载能力必须为大于 0 的数字'
    } else if (
      cableRows.some((row) => row['缆道编号'] === code && Number(row.id) !== item.cablewayId)
    ) {
      // 工作副本里查重：拦住与本批次已落库新增项撞号
      reason = `缆道编号 ${code} 已被其他缆道占用`
    } else if (
      items.some(
        (peer) =>
          peer.itemId !== item.itemId &&
          peer.status !== 'succeeded' &&
          peer.code.trim() === code,
      )
    ) {
      reason = `缆道编号 ${code} 在本批次中重复`
    } else if (item.cablewayId === null) {
      // 新增项：校验通过即在本批次内建行
      const id = nextId(cableRows)
      const created = buildItemFromRow(
        { id } as EntryRow,
        { code, station: item.station.trim(), span, load },
        true,
      )
      cableRows.push(created)
      committedId = id
      committedVersion = 1
      reason = ''
    } else {
      const target = cableRows.find((row) => Number(row.id) === item.cablewayId)
      if (!target) {
        reason = `缆道 ${code} 不存在或已被删除`
      } else if (String(target.status) === DISABLED_STATUS) {
        reason = `缆道 ${code} 已停用，拒绝落库`
      } else {
        // CAS 乐观锁：入批后行被别处改过（含并发提交的第一次落库），本次放弃
        const liveVersion = Number(target.version ?? 1)
        if (liveVersion !== item.baseVersion) {
          reason = `缆道 ${code} 在提交前已被其他操作修改，已保留第一次落库结果，请刷新后重试`
        } else {
          const updated = buildItemFromRow(
            target,
            { code, station: item.station.trim(), span, load },
            false,
          )
          cableRows[cableRows.indexOf(target)] = updated
          committedVersion = Number(updated.version ?? 1)
          reason = ''
        }
      }
    }

    if (!reason) {
      successForCheck.push({ code, station: item.station.trim(), span: span as number, load: load as number })
    } else {
      nextStatus = 'failed'
      receipt.result = '失败'
      receipt.reason = reason
    }
    outcomes.push({
      item: {
        ...item,
        cablewayId: committedId,
        baseVersion: committedVersion,
        status: nextStatus,
        reason,
        updatedAt: new Date().toISOString(),
      },
      receipt,
    })
  }

  // 缆道表与巡检核查待办合并为一次原子写入，避免「缆道改了、核查没挂上」
  commitRows({
    cableway: cableRows,
    ...(successForCheck.length ? { inspection: upsertInspectionChecks(successForCheck) } : {}),
  })
  return outcomes
}
