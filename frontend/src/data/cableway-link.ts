import { listRows } from './local-store'
import type { EntryRow } from './types'

/** 批次链路共用的核查口径：检修面板与巡检入口对缆道的判定必须一致。 */

export const CABLEWAY_DISABLED_STATUS = '已停用'

/** 正的跨度米数，允许小数；空串或非正数都视为无效。 */
export function validSpan(value: string): boolean {
  const n = Number(String(value).trim())
  return Number.isFinite(n) && n > 0
}

/** 正的荷载能力（千克），允许小数。 */
export function validLoad(value: string): boolean {
  const n = Number(String(value).trim())
  return Number.isFinite(n) && n > 0
}

/** 按所属站点找到同站的在用缆道（停用缆道不参与联动核查）。 */
export function findCablewayBySite(site: string): EntryRow | undefined {
  const target = String(site ?? '').trim()
  if (!target) {
    return undefined
  }
  return listRows('cableway').find(
    (row) =>
      String(row['所属站点'] ?? '').trim() === target &&
      String(row.status) !== CABLEWAY_DISABLED_STATUS,
  )
}

export type CablewayCheck = {
  cableway?: EntryRow
  /** 核查是否通过 */
  ok: boolean
  /** 不通过时的明确原因 */
  reason?: string
}

/** 巡检入口的联动核查：缆道必须存在、未停用，且跨度/荷载登记有效。 */
export function checkCableway(site: string): CablewayCheck {
  const target = String(site ?? '').trim()
  if (!target) {
    return { ok: false, reason: '缺少站点编号，无法联动核查缆道' }
  }
  // 停用缆道要单独点名，不能笼统报「找不到」。
  const disabled = listRows('cableway').find(
    (row) => String(row['所属站点'] ?? '').trim() === target && String(row.status) === CABLEWAY_DISABLED_STATUS,
  )
  if (disabled) {
    return {
      ok: false,
      cableway: disabled,
      reason: `缆道${String(disabled['缆道编号'] ?? '')}已停用，不得随巡检入批，请先在测流缆道中处理`,
    }
  }
  const cableway = findCablewayBySite(target)
  if (!cableway) {
    return { ok: false, reason: `站点 ${target} 未登记可核查的测流缆道` }
  }
  const span = String(cableway['跨度米数'] ?? '')
  const load = String(cableway['荷载能力'] ?? '')
  if (!validSpan(span)) {
    return { ok: false, cableway, reason: `缆道${String(cableway['缆道编号'] ?? '')}跨度米数无效，需补登后再巡检` }
  }
  if (!validLoad(load)) {
    return { ok: false, cableway, reason: `缆道${String(cableway['缆道编号'] ?? '')}荷载能力无效，需补登后再巡检` }
  }
  return { ok: true, cableway }
}

/** 内容指纹：缆道参数改过就变，失败项需要带着新参数重新核查。 */
export function cablewayFingerprint(row: EntryRow): string {
  return [
    row['缆道编号'] ?? '',
    row['跨度米数'] ?? '',
    row['荷载能力'] ?? '',
    row.status ?? '',
  ]
    .map((v) => String(v).trim())
    .join('|')
}
