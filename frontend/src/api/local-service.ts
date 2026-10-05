import { MODULE_BY_KEY } from '@/data/modules'
import { hashRevision, buildBatchView, clearFinishedReceipts, submitBatch } from '@/data/batch-engine'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  CABLEWAY_DISABLED_STATUS,
  cablewayFingerprint,
  checkCableway,
} from '@/data/cableway-link'
import type {
  ActionResult,
  BatchAdapter,
  BatchKind,
  BatchReceipt,
  BatchSubmitItem,
  BatchView,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// ---- CSV 导出：统一转义，字段里有逗号/引号/换列不再串行，=+-@ 开头防注入 ----
export function csvEscape(value: unknown): string {
  let text = String(value ?? '')
  if (/^[=+\-@]/.test(text)) {
    text = `\t${text}`
  }
  if (/[",\n\r]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(csvEscape).join(',')]
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}`
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const rows = listRows(key).map((row) => [
    row.id,
    ...meta.fields.map((field) => row[field] ?? ''),
    row.status,
  ])
  return { filename: `${meta.name}-清单.csv`, content: toCsv(header, rows) }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  downloadFile(filename, content)
}

export function downloadFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// ================= 批次：检修面板与巡检列表共用落库/回执链路 =================

export const BATCH_LABELS: Record<BatchKind, { title: string; noun: string; exportName: string }> = {
  'cableway-overhaul': { title: '缆道检修批次面板', noun: '检修', exportName: '缆道检修批次回执' },
  'inspection-round': { title: '巡检批次录入', noun: '巡检', exportName: '巡检批次回执' },
}

function positiveNumber(value: string): boolean {
  const n = Number(String(value).trim())
  return Number.isFinite(n) && n > 0
}

function overhaulAdapter(): BatchAdapter {
  return {
    kind: 'cableway-overhaul',
    moduleKey: 'cableway',
    codeField: '缆道编号',
    rejectStatuses: [CABLEWAY_DISABLED_STATUS],
    disabledReason: (row) => `缆道${String(row['缆道编号'] ?? '')}已停用，不得入批`,
    codeOf: (row) => String(row['缆道编号'] ?? ''),
    labelOf: (row) => String(row['所属站点'] ?? ''),
    buildDraft: (rows, successIds) =>
      rows
        .filter((row) => String(row.status) !== CABLEWAY_DISABLED_STATUS && !successIds.has(Number(row.id)))
        .map((row) => {
          const code = String(row['缆道编号'] ?? '')
          const span = String(row['跨度米数'] ?? '')
          const load = String(row['荷载能力'] ?? '')
          const worker = String(row['检修人员'] ?? '')
          return {
            entryId: Number(row.id),
            code,
            label: String(row['所属站点'] ?? ''),
            fields: { 缆道编号: code, 跨度米数: span, 荷载能力: load, 检修人员: worker },
            revision: hashRevision([code, span, load]),
            meta: { 所属站点: String(row['所属站点'] ?? ''), 当前状态: String(row.status) },
          }
        }),
    validate: (row, fields, ctx) => {
      const reasons: string[] = []
      const code = String(fields['缆道编号'] ?? '').trim()
      const span = String(fields['跨度米数'] ?? '').trim()
      const load = String(fields['荷载能力'] ?? '').trim()
      const worker = String(fields['检修人员'] ?? '').trim()
      if (!code) {
        reasons.push('缆道编号不能为空')
      } else {
        if (ctx.duplicate) {
          reasons.push(`缆道编号 ${code} 在本批次内重复，每条缆道只能有一个编号`)
        }
        const clash = listRows('cableway').find(
          (other) => Number(other.id) !== Number(row.id) && String(other['缆道编号'] ?? '').trim() === code,
        )
        if (clash) {
          reasons.push(`缆道编号 ${code} 已被其他缆道占用，编号必须唯一`)
        }
      }
      if (!positiveNumber(span)) {
        reasons.push('跨度米数必须是大于 0 的数字')
      }
      if (!positiveNumber(load)) {
        reasons.push('荷载能力必须是大于 0 的数字')
      }
      if (!worker) {
        reasons.push('检修人员不能为空')
      }
      return reasons
    },
    apply: (row, fields, ctx) => ({
      ...row,
      缆道编号: String(fields['缆道编号']).trim(),
      跨度米数: String(fields['跨度米数']).trim(),
      荷载能力: String(fields['荷载能力']).trim(),
      检修人员: String(fields['检修人员']).trim(),
      最近检修日: ctx.today,
      status: '正常运行',
      pending: false,
      abnormal: false,
    }),
    receiptMeta: (row) => ({
      所属站点: String(row['所属站点'] ?? ''),
      跨度米数: String(row['跨度米数'] ?? ''),
      荷载能力: String(row['荷载能力'] ?? ''),
      完成后状态: String(row.status),
    }),
  }
}

function inspectionMetaOf(row: EntryRow): Record<string, string> {
  const site = String(row['站点编号'] ?? '')
  const check = checkCableway(site)
  return {
    所属站点: site,
    联动缆道: check.cableway ? String(check.cableway['缆道编号'] ?? '') : '—',
    缆道状态: check.cableway ? String(check.cableway.status) : '—',
    核查结果: check.ok ? '通过' : `未通过：${check.reason}`,
  }
}

function inspectionAdapter(): BatchAdapter {
  return {
    kind: 'inspection-round',
    moduleKey: 'inspection',
    rejectStatuses: [],
    disabledReason: (row) => `记录 ${String(row['记录编号'] ?? row.id)} 已不在待巡检状态`,
    codeOf: (row) => String(row['记录编号'] ?? ''),
    labelOf: (row) => String(row['站点编号'] ?? ''),
    buildDraft: (rows, successIds) =>
      rows
        .filter((row) => String(row.status) === '待巡检' && !successIds.has(Number(row.id)))
        .map((row) => {
          const site = String(row['站点编号'] ?? '')
          const check = checkCableway(site)
          return {
            entryId: Number(row.id),
            code: String(row['记录编号'] ?? ''),
            label: site,
            fields: {},
            revision: hashRevision([
              'inspection',
              String(row.id),
              check.cableway ? cablewayFingerprint(check.cableway) : 'none',
            ]),
            meta: inspectionMetaOf(row),
          }
        }),
    validate: (row, _fields, _ctx) => {
      const reasons: string[] = []
      if (String(row.status) !== '待巡检') {
        reasons.push(`巡检状态已变为「${String(row.status)}」，本次不再重复落库`)
      }
      const check = checkCableway(String(row['站点编号'] ?? ''))
      if (!check.ok) {
        reasons.push(check.reason ?? '联动缆道核查未通过')
      }
      return reasons
    },
    apply: (row, _fields, _ctx) => ({
      ...row,
      status: '已巡检',
      pending: false,
      abnormal: false,
    }),
    receiptMeta: (row) => inspectionMetaOf(row),
  }
}

const ADAPTERS: Record<BatchKind, () => BatchAdapter> = {
  'cableway-overhaul': overhaulAdapter,
  'inspection-round': inspectionAdapter,
}

export function getBatchView(kind: BatchKind): BatchView {
  return buildBatchView(kind, ADAPTERS[kind]())
}

export function submitBatchItems(kind: BatchKind, items: BatchSubmitItem[]) {
  return submitBatch(kind, ADAPTERS[kind](), items)
}

export function clearBatchFinished(kind: BatchKind): BatchReceipt[] {
  return clearFinishedReceipts(kind)
}

export function exportBatchReceipts(kind: BatchKind): { filename: string; content: string } {
  const { receipts } = getBatchView(kind)
  const label = BATCH_LABELS[kind]
  if (kind === 'cableway-overhaul') {
    const header = ['缆道编号', '所属站点', '跨度米数', '荷载能力', '检修人员', '结果', '失败原因', '提交时间']
    const rows = receipts.map((receipt) => [
      receipt.code,
      receipt.label,
      receipt.fields['跨度米数'] ?? receipt.meta['跨度米数'] ?? '',
      receipt.fields['荷载能力'] ?? receipt.meta['荷载能力'] ?? '',
      receipt.fields['检修人员'] ?? '',
      receipt.outcome === 'success' ? '成功' : '失败',
      receipt.reason ?? '',
      receipt.submittedAt,
    ])
    return { filename: `${label.exportName}.csv`, content: toCsv(header, rows) }
  }
  const header = ['记录编号', '站点编号', '联动缆道', '缆道状态', '核查结果', '结果', '失败原因', '提交时间']
  const rows = receipts.map((receipt) => [
    receipt.code,
    receipt.label,
    receipt.meta['联动缆道'] ?? '—',
    receipt.meta['缆道状态'] ?? '—',
    receipt.meta['核查结果'] ?? '',
    receipt.outcome === 'success' ? '成功' : '失败',
    receipt.reason ?? '',
    receipt.submittedAt,
  ])
  return { filename: `${label.exportName}.csv`, content: toCsv(header, rows) }
}

/** 巡检待办：所有巡检入口（导航徽标、看板等）共用这一个口径。 */
export function inspectionTodoCount(): number {
  return listRows('inspection').filter((row) => String(row.status) === '待巡检').length
}
