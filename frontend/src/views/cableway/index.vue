<template>
  <section class="page" data-module="cableway">
    <header class="page-head">
      <div>
        <h2>测流缆道管理</h2>
        <p class="page-desc">维护测流缆道，围绕缆道编号、所属站点、跨度米数、荷载能力做登记、批量保存与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openBatch">缆道参数批量保存</button>
        <button class="btn" type="button" @click="exportRows">导出测流缆道清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card" :class="{ 'stat-alert': item.hot }">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button
              class="link"
              type="button"
              :disabled="String(row.status) === '已停用'"
              @click="addToBatch(row)"
            >
              加入批次
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无测流缆道数据，可先登记测流缆道</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条测流缆道记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { useCablewayBatchStore } from '@/stores/cableway-batch'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('cableway')
const columns = ["缆道编号", "所属站点", "跨度米数", "建成日期", "最近检修日", "荷载能力", "检修人员", "缆道状态"]
const actions = ["安排检修", "完成检修", "停用缆道"]
const statuses = ["正常运行", "需检修", "检修中", "已停用"]

const batchStore = useCablewayBatchStore()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => {
  const all = listRows(meta.key)
  return [
    { label: "缆道总数", value: all.length, hot: false },
    { label: "正常运行数", value: all.filter((row) => String(row.status) === "正常运行").length, hot: false },
    { label: "需检修数", value: all.filter((row) => String(row.status) === "需检修").length, hot: false },
    { label: "缆道参数核查待办", value: batchStore.checkCount, hot: batchStore.checkCount > 0 },
  ]
})

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openBatch() {
  batchStore.openPanel()
}

function addToBatch(row: EntryRow) {
  if (String(row.status) === '已停用') {
    errorMessage.value = `缆道 ${row['缆道编号']} 已停用，不能入批`
    return
  }
  const message = batchStore.addCablewayRow(row)
  if (message) {
    errorMessage.value = message
    return
  }
  batchStore.openPanel()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '测流缆道列表读取失败'
  }
}

// 其他入口/标签页落库后联动刷新本页（含状态、统计、核查待办）
watch(() => batchStore.dataTick, reload)

onMounted(reload)
</script>
