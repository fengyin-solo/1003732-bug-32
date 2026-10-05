import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'

import { subscribeData } from '@/data/local-store'
import {
  BATCH_LABELS,
  clearBatchFinished,
  downloadFile,
  exportBatchReceipts,
  getBatchView,
  submitBatchItems,
} from '@/api/local-service'
import type { BatchKind, BatchReceipt, BatchSubmitItem } from '@/data/types'

/**
 * 检修批次与巡检批次共用的面板状态：
 * 未完成项（草稿）与回执分离；数据一变（含跨标签页）就联动刷新。
 */
export function useBatchPanel(kind: BatchKind) {
  const labels = BATCH_LABELS[kind]
  // entryId -> 可编辑字段，只给可编辑批次（检修）用。
  const form = reactive<Record<number, Record<string, string>>>({})
  const receipts = ref<BatchReceipt[]>([])
  const draftIds = ref<number[]>([])
  const message = ref('')
  const messageTone = ref<'info' | 'error' | 'success'>('info')
  const submitting = ref(false)
  let unsubscribe: (() => void) | undefined

  const successIds = computed(
    () => new Set(receipts.value.filter((r) => r.outcome === 'success').map((r) => r.entryId)),
  )
  const failedReceipts = computed(() => receipts.value.filter((r) => r.outcome === 'failed'))

  function hydrateForm(seed: { entryId: number; fields: Record<string, string> }[]) {
    for (const item of seed) {
      if (!form[item.entryId]) {
        form[item.entryId] = { ...item.fields }
      }
    }
  }

  function refresh() {
    const view = getBatchView(kind)
    draftIds.value = view.draft.map((item) => item.entryId)
    hydrateForm(view.draft)
    receipts.value = view.receipts
  }

  function draftView() {
    return getBatchView(kind).draft
  }

  function submit(ids: number[]) {
    message.value = ''
    if (ids.length === 0) {
      message.value = '没有需要提交的未完成项'
      messageTone.value = 'info'
      return
    }
    const draft = getBatchView(kind).draft
    const items: BatchSubmitItem[] = []
    for (const id of ids) {
      const item = draft.find((d) => d.entryId === id)
      if (!item) {
        continue
      }
      const fields = form[id] ? { ...form[id] } : { ...item.fields }
      items.push({
        entryId: id,
        fields,
        // 指纹只作回执留痕；是否重跑以「是否已成功」为准——
        // 失败项改过参数后仍会按当前内容重新核查，成功项则从草稿剔除、不会重复落库。
        revision: item.revision,
      })
    }
    submitting.value = true
    try {
      const result = submitBatchItems(kind, items)
      message.value = result.message
      messageTone.value = result.ok ? (result.summary.failed > 0 ? 'error' : 'success') : 'error'
      refresh()
    } finally {
      submitting.value = false
    }
  }

  /** 从未完成处接着做：只提交仍失败/未完成的项，成功项不重复落库。 */
  function retryFailed() {
    const failed = new Set(failedReceipts.value.map((r) => r.entryId))
    const ids = draftIds.value.filter((id) => failed.has(id))
    submit(ids)
  }

  function submitAll() {
    submit([...draftIds.value])
  }

  /** 返回后失败项保留；部分成功默认收起成功回执，需要时可再从导出留痕。 */
  function dismissFinished() {
    clearBatchFinished(kind)
    message.value = '已收起成功回执，失败项仍保留，可从未完成处接着做'
    messageTone.value = 'info'
    refresh()
  }

  function exportReceipts() {
    const { filename, content } = exportBatchReceipts(kind)
    if (receipts.value.length === 0) {
      message.value = '暂无可导出的回执'
      messageTone.value = 'info'
      return
    }
    downloadFile(filename, content)
  }

  onMounted(() => {
    refresh()
    unsubscribe = subscribeData(refresh)
  })
  onUnmounted(() => unsubscribe?.())

  return {
    labels,
    form,
    receipts,
    draftIds,
    successIds,
    failedReceipts,
    message,
    messageTone,
    submitting,
    draftView,
    refresh,
    submit,
    retryFailed,
    submitAll,
    dismissFinished,
    exportReceipts,
  }
}
