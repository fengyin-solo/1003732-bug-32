// 批次链路端到端验证：在 node 里用内存 localStorage 跑真实 TS 源码（tsc 转译）。
const fs = require('fs')
const path = require('path')
const Module = require('module')
const ts = require('/workspace/frontend/node_modules/typescript')

const root = '/workspace/frontend/src'

// ---- 内存版 localStorage ----
const mem = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
  },
  addEventListener: () => {},
}

// ---- .ts require 钩子：TS -> CommonJS ----
const originalTsLoader = Module._extensions['.ts']
Module._extensions['.ts'] = (mod, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const out = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  })
  mod._compile(out.outputText, filename)
}
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/data/') || request.startsWith('@/api/')) {
    return path.join(root, request.slice(2)) + '.ts'
  }
  return originalResolve.call(this, request, ...rest)
}

const svc0 = require(path.join(root, 'api/local-service.ts'))
function loadService() {
  // 清掉模块缓存，模拟重新开页（localStorage 桶按 mem 状态走）
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(root)) {
      delete require.cache[key]
    }
  }
  return require(path.join(root, 'api/local-service.ts'))
}

let pass = 0
let fail = 0
function assert(cond, msg) {
  if (cond) {
    pass += 1
    console.log('  ✔', msg)
  } else {
    fail += 1
    console.error('  ✘', msg)
  }
}

function main() {
  const svc = loadService()

  console.log('1) 旧数据兼容：没有批次桶时也能正常读取')
  const view0 = svc.getBatchView('inspection-round')
  assert(view0.draft.length === 3, `初始巡检草稿 3 项，实际 ${view0.draft.length}`)
  const checks = view0.draft.map((d) => d.meta['核查结果'])
  assert(checks[0] === '通过', `记录1联动核查通过，实际：${checks[0]}`)
  assert(checks[1].startsWith('未通过') && checks[1].includes('跨度'), `记录2因跨度无效失败，实际：${checks[1]}`)
  assert(checks[2].includes('已停用'), `记录3因缆道停用失败，实际：${checks[2]}`)

  console.log('2) 巡检批次：半批完成 + 失败原因 + 停用不入批 + 待办联动')
  const r1 = svc.submitBatchItems('inspection-round', view0.draft.map((d) => ({ entryId: d.entryId, fields: {}, revision: d.revision })))
  assert(r1.ok === true, '提交返回成功')
  assert(r1.summary.success === 1 && r1.summary.failed === 2, `1 成功 2 失败，实际 ${JSON.stringify(r1.summary)}`)
  const failedReasons = r1.receipts.filter((x) => x.outcome === 'failed').map((x) => x.reason)
  assert(failedReasons.every(Boolean) && failedReasons.length === 2, '每个失败项都带明确原因')
  assert(failedReasons.some((r) => r.includes('已停用')), '停用缆道原因被单独说明')
  assert(svc.inspectionTodoCount() === 2, `待办降为 2，实际 ${svc.inspectionTodoCount()}`)
  const insp = svc.listEntries('inspection').items
  assert(insp.find((x) => x.id === 1).status === '已巡检', '记录1状态已落库为已巡检')
  assert(insp.find((x) => x.id === 2).status === '待巡检', '记录2失败保持待巡检')
  assert(insp.find((x) => x.id === 3).status === '待巡检', '记录3失败保持待巡检（停用不得入批）')

  console.log('3) 失败重试：原样再提不重复成功项，只处理未完成')
  const view1 = svc.getBatchView('inspection-round')
  assert(view1.draft.length === 2, `草稿只剩 2 项，实际 ${view1.draft.length}`)
  const r2 = svc.submitBatchItems('inspection-round', view1.draft.map((d) => ({ entryId: d.entryId, fields: {}, revision: d.revision })))
  assert(r2.summary.success === 1 && r2.summary.failed === 2, `成功项不重复（1 成功），失败项仍失败，实际 ${JSON.stringify(r2.summary)}`)

  console.log('4) 修好缆道参数后接着做：失败项转为成功，待办继续联动')
  const ov = svc.getBatchView('cableway-overhaul')
  assert(ov.draft.length === 2, `检修草稿 2 项（已停用的 CABL-0003 不入批），实际 ${ov.draft.length}`)
  assert(!ov.draft.some((d) => d.code === 'CABL-0003'), '已停用缆道不出现在检修批次')
  const d2 = ov.draft.find((d) => d.code === 'CABL-0002')
  const r3 = svc.submitBatchItems('cableway-overhaul', [
    { entryId: d2.entryId, fields: { 缆道编号: 'CABL-0002', 跨度米数: '150', 荷载能力: '600', 检修人员: '张工' }, revision: d2.revision },
  ])
  assert(r3.summary.success === 1 && r3.summary.failed === 0, `检修 1 项成功，实际 ${JSON.stringify(r3.summary)}`)
  const view2 = svc.getBatchView('inspection-round')
  const dInsp2 = view2.draft.find((d) => d.entryId === 2)
  assert(dInsp2.meta['核查结果'] === '通过', `修复后巡检记录2核查通过，实际：${dInsp2.meta['核查结果']}`)
  const r4 = svc.submitBatchItems('inspection-round', view2.draft.map((d) => ({ entryId: d.entryId, fields: {}, revision: d.revision })))
  assert(r4.summary.success === 2 && r4.summary.failed === 1, `累计 2 成功，记录3仍因停用失败，实际 ${JSON.stringify(r4.summary)}`)
  assert(svc.inspectionTodoCount() === 1, `待办降为 1（只剩停用站），实际 ${svc.inspectionTodoCount()}`)

  console.log('5) 返回后失败项保留；收起成功回执不影响失败项')
  const inspKept = svc.exportBatchReceipts('inspection-round')
  assert(inspKept.content.includes('已停用'), '回执导出包含停用失败原因')
  const afterDismiss = svc.clearBatchFinished('inspection-round')
  assert(afterDismiss.every((r) => r.outcome === 'failed'), '只保留失败回执')
  assert(afterDismiss.length === 1, `失败回执 1 条（停用项），实际 ${afterDismiss.length}`)
  const stillTodo = svc.getBatchView('inspection-round')
  assert(stillTodo.draft.some((d) => d.entryId === 3), '失败项仍在未完成草稿里，可接着做')

  console.log('6) 检修批次校验：空编号/非正数/缺检修人员/重复编号都有原因')
  mem.clear()
  const fresh = loadService()
  const ov2 = fresh.getBatchView('cableway-overhaul')
  const a = ov2.draft.find((d) => d.entryId === 1)
  const b = ov2.draft.find((d) => d.entryId === 2)
  const r5 = fresh.submitBatchItems('cableway-overhaul', [
    { entryId: a.entryId, fields: { 缆道编号: '', 跨度米数: '120', 荷载能力: '500', 检修人员: '张工' }, revision: a.revision },
    { entryId: b.entryId, fields: { 缆道编号: 'CABL-0002', 跨度米数: 'abc', 荷载能力: '-3', 检修人员: '' }, revision: b.revision },
  ])
  assert(r5.summary.success === 0 && r5.summary.failed === 2, `两项均失败，实际 ${JSON.stringify(r5.summary)}`)
  const reasons5 = r5.receipts.filter((x) => x.outcome === 'failed').map((x) => x.reason)
  assert(reasons5.some((r) => r.includes('不能为空')), '空编号原因明确')
  assert(reasons5.some((r) => r.includes('跨度')), '跨度非数字原因明确')
  assert(reasons5.some((r) => r.includes('检修人员')), '缺检修人员原因明确')
  // 一条同时有多个问题时，原因应一次列全（跨度、荷载、检修人员）
  const multi = reasons5.find((r) => r.includes('跨度') && r.includes('荷载') && r.includes('检修人员'))
  assert(Boolean(multi), `多原因合并展示：${JSON.stringify(reasons5)}`)

  const ov2b = fresh.getBatchView('cableway-overhaul')
  const dup1 = ov2b.draft.find((d) => d.entryId === 1)
  const dup2 = ov2b.draft.find((d) => d.entryId === 2)
  const r5b = fresh.submitBatchItems('cableway-overhaul', [
    { entryId: dup1.entryId, fields: { 缆道编号: 'DUP-1', 跨度米数: '120', 荷载能力: '500', 检修人员: '张工' }, revision: dup1.revision },
    { entryId: dup2.entryId, fields: { 缆道编号: 'DUP-1', 跨度米数: '150', 荷载能力: '600', 检修人员: '李工' }, revision: dup2.revision },
  ])
  assert(r5b.receipts.filter((x) => x.outcome === 'failed').every((x) => x.reason.includes('重复')), '批内重复编号的条目各自报原因')

  console.log('7) 并发提交只认第一次有效落库（锁）')
  const ov3 = fresh.getBatchView('cableway-overhaul')
  const x1 = ov3.draft.find((d) => d.entryId === 1)
  const lockKey = 'hydrology-monitor-station:batch:cableway-overhaul'
  const bucket = JSON.parse(mem.get(lockKey) || '{"receipts":[]}')
  bucket.lockUntil = Date.now() + 100000
  mem.set(lockKey, JSON.stringify(bucket))
  const r6 = fresh.submitBatchItems('cableway-overhaul', [
    { entryId: x1.entryId, fields: { 缆道编号: 'CABL-0009', 跨度米数: '120', 荷载能力: '500', 检修人员: '张工' }, revision: x1.revision },
  ])
  assert(r6.ok === false && r6.message.includes('并发'), `并发提交被拒：${r6.message}`)
  bucket.lockUntil = Date.now() - 1
  mem.set(lockKey, JSON.stringify(bucket))
  const r7 = fresh.submitBatchItems('cableway-overhaul', [
    { entryId: x1.entryId, fields: { 缆道编号: 'CABL-0009', 跨度米数: '120', 荷载能力: '500', 检修人员: '张工' }, revision: x1.revision },
  ])
  assert(r7.ok === true && r7.summary.success >= 1, '锁过期后提交恢复')

  console.log('8) CSV 导出：带 BOM、CRLF，特殊字符被正确转义')
  const csv = fresh.exportEntries('cableway').content
  assert(csv.charCodeAt(0) === 0xfeff, '带 BOM')
  assert(csv.includes('\r\n'), 'CRLF 行分隔')
  // 含逗号/引号/公式前缀的值走同一转义器，不能串行、不能注入
  const cells = ['普通', 'a,b', '说"你好"', '=1+1', '+1', '-1', '@cmd'].map((v) => fresh.csvEscape(v))
  assert(cells[1] === '"a,b"', '逗号被引号包裹')
  assert(cells[2] === '"说""你好"""', '引号双写')
  assert(cells.slice(3).every((v) => v.startsWith('\t')), '公式前缀加 tab 中和')

  console.log(`\n结果：${pass} 通过，${fail} 失败`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
