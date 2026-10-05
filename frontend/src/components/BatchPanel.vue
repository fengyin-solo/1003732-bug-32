<template>
  <section class="batch-panel">
    <header class="batch-head">
      <div>
        <h3>{{ labels.title }}</h3>
        <p class="batch-desc">
          未完成 {{ draftIds.length }} 项 · 成功 {{ successCount }} 项 · 失败 {{ failedReceipts.length }} 项
        </p>
      </div>
      <div class="batch-actions">
        <button class="btn primary" type="button" :disabled="submitting" @click="submitAll">
          提交全部未完成
        </button>
        <button
          class="btn"
          type="button"
          :disabled="submitting || failedReceipts.length === 0"
          @click="retryFailed"
        >
          仅重试失败项
        </button>
        <button class="btn ghost" type="button" @click="dismissFinished">收起成功回执</button>
        <button class="btn ghost" type="button" @click="exportReceipts">导出回执</button>
      </div>
    </header>

    <p v-if="message" :class="['batch-message', toneClass]">{{ message }}</p>

    <table class="data-table">
      <thead>
        <tr>
          <template v-if="kind === 'cableway-overhaul'">
            <th>缆道编号</th>
            <th>所属站点</th>
            <th>跨度米数</th>
            <th>荷载能力(kg)</th>
            <th>检修人员</th>
          </template>
          <template v-else>
            <th>巡检记录</th>
            <th>站点编号</th>
            <th>联动缆道</th>
            <th>缆道状态</th>
            <th>核查结果</th>
          </template>
          <th>最近失败原因</th>
          <th>提交</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in draftRows" :key="item.entryId">
          <template v-if="kind === 'cableway-overhaul'">
            <td><input v-model="form[item.entryId]['缆道编号']" class="cell-input" /></td>
            <td>{{ item.label }}</td>
            <td><input v-model="form[item.entryId]['跨度米数']" class="cell-input" /></td>
            <td><input v-model="form[item.entryId]['荷载能力']" class="cell-input" /></td>
            <td><input v-model="form[item.entryId]['检修人员']" class="cell-input" /></td>
          </template>
          <template v-else>
            <td>{{ item.code }}</td>
            <td>{{ item.label }}</td>
            <td>{{ item.meta['联动缆道'] }}</td>
            <td>{{ item.meta['缆道状态'] }}</td>
            <td :class="item.meta['核查结果'] === '通过' ? 'ok-text' : 'warn-text'">
              {{ item.meta['核查结果'] }}
            </td>
          </template>
          <td class="reason-cell">{{ failedReason(item.entryId) || '—' }}</td>
          <td>
            <button class="link" type="button" :disabled="submitting" @click="submit([item.entryId])">
              提交此项
            </button>
          </td>
        </tr>
        <tr v-if="draftRows.length === 0">
          <td :colspan="7" class="empty-state">
            {{ kind === 'cableway-overhaul' ? '在用缆道均已完成检修' : '巡检待办已全部处理完' }}
          </td>
        </tr>
      </tbody>
    </table>

    <details v-if="receipts.length" class="receipts" open>
      <summary>批次回执（{{ receipts.length }}）· 成功与失败都已落库，返回后保留</summary>
      <table class="data-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>所属</th>
            <th>结果</th>
            <th>原因 / 说明</th>
            <th>提交时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="receipt in receipts" :key="`${receipt.entryId}-${receipt.submittedAt}`">
            <td>{{ receipt.code }}</td>
            <td>{{ receipt.label }}</td>
            <td :class="receipt.outcome === 'success' ? 'ok-text' : 'error-text'">
              {{ receipt.outcome === 'success' ? '成功' : '失败' }}
            </td>
            <td class="reason-cell">
              <span :class="receipt.outcome === 'failed' ? 'error-text' : ''">
                {{ receipt.reason || (receipt.meta['核查结果'] === '通过' ? '核查通过，已落库' : '已落库') }}
              </span>
            </td>
            <td>{{ formatTime(receipt.submittedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useBatchPanel } from '@/composables/useBatchPanel'
import type { BatchKind } from '@/data/types'

const props = defineProps<{ kind: BatchKind }>()
const kind = computed(() => props.kind)

const {
  labels,
  form,
  receipts,
  draftIds,
  failedReceipts,
  message,
  messageTone,
  submitting,
  draftView,
  submit,
  retryFailed,
  submitAll,
  dismissFinished,
  exportReceipts,
} = useBatchPanel(kind.value)

const successCount = computed(
  () => receipts.value.filter((receipt) => receipt.outcome === 'success').length,
)
const draftRows = computed(() => draftView())

const toneClass = computed(
  () =>
    ({
      info: 'batch-message-info',
      success: 'ok-text',
      error: 'error-text',
    })[messageTone.value],
)

const failedReasonMap = computed(() => {
  const map = new Map<number, string>()
  for (const receipt of receipts.value) {
    if (receipt.outcome === 'failed' && receipt.reason) {
      map.set(receipt.entryId, receipt.reason)
    }
  }
  return map
})

function failedReason(entryId: number): string | undefined {
  return failedReasonMap.value.get(entryId)
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
</script>

<style scoped>
.batch-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin: 16px 0;
}
.batch-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}
.batch-head h3 {
  margin: 0;
  font-size: 15px;
}
.batch-desc {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.batch-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.batch-message {
  margin: 10px 0;
  font-size: 13px;
}
.batch-message-info {
  color: var(--muted);
}
.cell-input {
  width: 100%;
  min-width: 90px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 13px;
}
.ok-text {
  color: #067647;
}
.warn-text {
  color: #b54708;
}
.reason-cell {
  font-size: 12px;
  max-width: 280px;
}
.receipts {
  margin-top: 12px;
  font-size: 12px;
  color: var(--muted);
}
.receipts summary {
  cursor: pointer;
  margin-bottom: 6px;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
