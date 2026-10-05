<template>
  <section class="page" data-module="inspection">
    <header class="page-head">
      <div>
        <h2>巡检记录管理</h2>
        <p class="page-desc">维护巡检记录，围绕记录编号、站点编号、巡检日期、巡检人员做登记、筛选与状态流转；巡检批次会联动核查站点缆道。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡检记录</button>
        <button class="btn" type="button" @click="exportRows">导出巡检记录清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <BatchPanel kind="inspection-round" />

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
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无巡检记录数据，可先登记巡检记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条巡检记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'

import BatchPanel from '@/components/BatchPanel.vue'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { subscribeData } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('inspection')
const columns = ["记录编号", "站点编号", "巡检日期", "巡检人员", "检查项目", "发现问题", "处理措施", "巡检状态"]
const statuses = ["待巡检", "已巡检", "发现故障", "已处置"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = reactive<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = computed(() => [
  { label: "本月巡检次数", value: rows.value.filter((row) => row.status !== '待巡检').length },
  { label: "已巡检站点", value: rows.value.filter((row) => String(row.status) === '已巡检').length },
  { label: "待处置故障", value: rows.value.filter((row) => String(row.status) === '发现故障').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

/** 单条动作同样受状态约束：避免和批次落库互相打架。 */
function availableActions(row: EntryRow): string[] {
  const status = String(row.status)
  if (status === '待巡检') {
    return ["完成巡检", "报告故障"]
  }
  if (status === '已巡检') {
    return ["报告故障"]
  }
  if (status === '发现故障') {
    return ["确认处置"]
  }
  return []
}

function resetFilters() {
  for (const key of Object.keys(filters)) {
    delete filters[key]
  }
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡检记录登记入口尚未接入审批流'
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
    const payload = listEntries(meta.key, filters)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '巡检记录列表读取失败'
  }
}

let unsubscribe: (() => void) | undefined
onMounted(() => {
  reload()
  // 任意入口（缆道检修、别的标签页）落库后，待办与统计联动更新。
  unsubscribe = subscribeData(reload)
})
onUnmounted(() => unsubscribe?.())
</script>
