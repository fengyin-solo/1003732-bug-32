<template>
  <div v-if="store.panelOpen" class="modal-mask" @click.self="close">
    <section class="modal-panel" role="dialog" aria-modal="true" aria-label="缆道参数批量保存">
      <header class="modal-head">
        <div>
          <h3>缆道参数批量保存</h3>
          <p class="modal-sub">
            批次号 {{ batch?.id }} · 待落库 {{ unfinished }} 项 · 核查待办
            <button class="link" type="button" @click="tab = 'checks'">{{ store.checkCount }}</button>
            条
          </p>
        </div>
        <button class="btn ghost" type="button" @click="close">返回（保留失败项）</button>
      </header>

      <nav class="modal-tabs">
        <button
          v-for="entry in tabs"
          :key="entry.key"
          class="tab-btn"
          :class="{ active: tab === entry.key }"
          type="button"
          @click="tab = entry.key"
        >
          {{ entry.label }}
        </button>
      </nav>

      <!-- 批次填报 -->
      <div v-if="tab === 'items'" class="modal-body">
        <div class="modal-toolbar">
          <button class="btn" type="button" :disabled="store.submitting" @click="store.addBlank()">
            新增缆道入批
          </button>
          <span class="toolbar-tip">已停用缆道不会出现在可选列表，也无法提交落库</span>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>来源</th>
              <th>缆道编号</th>
              <th>所属站点</th>
              <th>跨度米数</th>
              <th>荷载能力</th>
              <th>落库状态</th>
              <th>失败原因</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in batchItems" :key="item.itemId" :class="{ 'row-failed': item.status === 'failed' }">
              <td>{{ item.cablewayId === null ? '新增' : `现有#${item.cablewayId}` }}</td>
              <td>
                <input
                  v-model="item.code"
                  class="cell-input"
                  :disabled="store.submitting"
                  @change="onEdit(item)"
                />
              </td>
              <td>
                <input
                  v-model="item.station"
                  class="cell-input"
                  :disabled="store.submitting"
                  @change="onEdit(item)"
                />
              </td>
              <td>
                <input
                  v-model="item.span"
                  class="cell-input narrow"
                  :disabled="store.submitting"
                  @change="onEdit(item)"
                />
              </td>
              <td>
                <input
                  v-model="item.load"
                  class="cell-input narrow"
                  :disabled="store.submitting"
                  @change="onEdit(item)"
                />
              </td>
              <td>
                <span class="batch-badge" :class="`badge-${item.status}`">
                  {{ statusLabel[item.status] }}
                </span>
              </td>
              <td class="reason-cell">{{ item.reason || '—' }}</td>
              <td>
                <button
                  class="link"
                  type="button"
                  :disabled="store.submitting"
                  @click="store.removeItem(item.itemId)"
                >
                  移除
                </button>
                <button
                  v-if="isConflict(item)"
                  class="link"
                  type="button"
                  :disabled="store.submitting"
                  @click="store.syncFromLatest(item.itemId)"
                >
                  同步最新后续做
                </button>
              </td>
            </tr>
            <tr v-if="!batchItems.length">
              <td colspan="8" class="empty-state">
                批次为空，可新增缆道，或从下方选择未入批的现有缆道
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="selectable.length" class="add-existing">
          <p class="toolbar-tip">选择现有缆道入批（已停用缆道已排除）：</p>
          <div class="chip-row">
            <button
              v-for="row in selectable"
              :key="String(row.id)"
              class="chip"
              :disabled="store.submitting"
              type="button"
              @click="addRow(row)"
            >
              {{ row['缆道编号'] }} · {{ row.status }}
            </button>
          </div>
        </div>

        <p v-if="submitMessage" class="submit-message" :class="submitOk ? 'ok-text' : 'error-text'">
          {{ submitMessage }}
        </p>
      </div>

      <!-- 核查待办 -->
      <div v-else-if="tab === 'checks'" class="modal-body">
        <p class="toolbar-tip">
          参数落库成功后联动生成的巡检核查待办，所有巡检入口的待办数与这里保持一致。
        </p>
        <table class="data-table">
          <thead>
            <tr>
              <th>记录编号</th>
              <th>站点/缆道</th>
              <th>巡检日期</th>
              <th>检查项目</th>
              <th>状态</th>
              <th>处理</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="todo in checkTodos" :key="String(todo.id)">
              <td>{{ todo['记录编号'] }}</td>
              <td>{{ todo['站点编号'] }}</td>
              <td>{{ todo['巡检日期'] }}</td>
              <td>{{ todo['检查项目'] }}</td>
              <td>{{ todo.status }}</td>
              <td class="row-actions">
                <button class="link" type="button" @click="completeCheck(todo)">完成巡检</button>
                <button class="link" type="button" @click="reportFault(todo)">报告故障</button>
              </td>
            </tr>
            <tr v-if="!checkTodos.length">
              <td colspan="6" class="empty-state">暂无缆道参数核查待办</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 回执记录 -->
      <div v-else class="modal-body">
        <div class="modal-toolbar">
          <button class="btn" type="button" :disabled="!receipts.length" @click="exportReceipts">
            导出批次回执 CSV
          </button>
        </div>
        <div v-for="receipt in receipts" :key="receipt.at" class="receipt-block">
          <header class="receipt-head">
            <span>{{ receipt.at }}</span>
            <span class="ok-text">成功 {{ receipt.succeeded }}</span>
            <span v-if="receipt.failed" class="error-text">失败 {{ receipt.failed }}</span>
          </header>
          <ul class="receipt-list">
            <li v-for="item in receipt.items" :key="`${receipt.at}-${item.itemId}`">
              <span class="batch-badge" :class="item.result === '成功' ? 'badge-succeeded' : 'badge-failed'">
                {{ item.result }}
              </span>
              {{ item.code }}（跨度 {{ item.span }} 米 / 荷载 {{ item.load }}）
              <span v-if="item.reason" class="error-text">— {{ item.reason }}</span>
            </li>
          </ul>
        </div>
        <p v-if="!receipts.length" class="empty-state">还没有提交回执</p>
      </div>

      <footer v-if="tab === 'items'" class="modal-foot">
        <button
          class="btn ghost"
          type="button"
          :disabled="store.submitting || !hasSucceeded"
          @click="store.clearSucceeded()"
        >
          清理已成功项
        </button>
        <div class="foot-right">
          <span class="foot-summary">
            共 {{ batchItems.length }} 项 · 成功 {{ succeededCount }} · 未完成 {{ unfinished }}
          </span>
          <button class="btn primary" type="button" :disabled="store.submitting" @click="submit">
            {{ store.submitting ? '提交中…' : unfinished ? '提交未完成项' : '全部已落库' }}
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { downloadCsv } from '@/api/csv'
import { exportBatchReceipts, runAction } from '@/api/local-service'
import { useCablewayBatchStore } from '@/stores/cableway-batch'
import { listRows, subscribe } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const store = useCablewayBatchStore()
const tab = ref<'items' | 'checks' | 'receipts'>('items')
const submitMessage = ref('')
const submitOk = ref(false)
const listTick = ref(0)

const tabs = [
  { key: 'items' as const, label: '批次填报' },
  { key: 'checks' as const, label: '核查待办' },
  { key: 'receipts' as const, label: '回执记录' },
]

const statusLabel: Record<string, string> = {
  pending: '待提交',
  succeeded: '已落库',
  failed: '失败可续做',
}

const batch = computed(() => store.active)
const batchItems = computed(() => batch.value?.items ?? [])
const receipts = computed(() => batch.value?.receipts ?? [])
const unfinished = computed(() => store.unfinishedCount)
const succeededCount = computed(
  () => batchItems.value.filter((item) => item.status === 'succeeded').length,
)
const hasSucceeded = computed(() => succeededCount.value > 0)

const selectable = computed(() => {
  // 订阅数据版本：其他入口改了状态（如停用）后这里即时重算
  void listTick.value
  void store.dataTick
  return store.selectableCableways()
})

const checkTodos = computed<EntryRow[]>(() => {
  void listTick.value
  void store.dataTick
  return listRows('inspection').filter(
    (row) =>
      ['待巡检', '发现故障'].includes(String(row.status)) &&
      String(row['检查项目'] ?? '').includes('缆道参数核查'),
  )
})

watch(
  () => store.panelOpen,
  (open) => {
    if (open) {
      store.refreshChecks()
      listTick.value += 1
    } else {
      submitMessage.value = ''
    }
  },
)

subscribe(() => {
  listTick.value += 1
})

function onEdit(item: { itemId: string }) {
  // v-model 已改值，这里只触发状态从 failed 回到 pending 并持久化
  store.updateItem(item.itemId, {})
}

function isConflict(item: { status: string; reason: string }): boolean {
  return item.status === 'failed' && item.reason.includes('已被其他操作修改')
}

function addRow(row: EntryRow) {
  const message = store.addCablewayRow(row)
  if (message) {
    submitOk.value = false
    submitMessage.value = message
  } else {
    submitMessage.value = ''
  }
  listTick.value += 1
}

async function submit() {
  const result = await store.submit()
  submitOk.value = result.ok
  submitMessage.value = result.message
  listTick.value += 1
}

function close() {
  // 返回后失败项、成功项都保留：批次本身已持久化，重新打开可从失败处接着做
  store.closePanel()
}

function completeCheck(todo: EntryRow) {
  runAction('inspection', Number(todo.id), '完成巡检')
  store.refreshChecks()
  listTick.value += 1
}

function reportFault(todo: EntryRow) {
  runAction('inspection', Number(todo.id), '报告故障')
  store.refreshChecks()
  listTick.value += 1
}

function exportReceipts() {
  if (!batch.value || !receipts.value.length) {
    return
  }
  const { filename, content } = exportBatchReceipts(batch.value.id, receipts.value)
  downloadCsv(filename, content)
}
</script>
