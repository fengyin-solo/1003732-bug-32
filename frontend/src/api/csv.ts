/** CSV 导出统一走这里：RFC4180 转义，失败原因里的逗号不会再把列冲乱。 */

function escapeCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)
  // 防公式注入：表格软件会把 =/+/-/@ 开头当公式执行，回执文本尤其可能命中
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(escapeCell).join(',')]
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','))
  }
  // BOM：Excel 打开中文不乱码
  return `﻿${lines.join('\r\n')}`
}

export function downloadCsv(filename: string, content: string): void {
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
