<template>
  <section class="page" data-module="cableway">
    <header class="page-head">
      <div>
        <h2>测流缆道管理</h2>
        <p class="page-desc">维护测流缆道，围绕缆道编号、所属站点、跨度米数、建成日期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记测流缆道</button>
        <button class="btn" type="button" @click="exportRows">导出测流缆道清单</button>
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

    <BatchPanel kind="cableway-overhaul" />

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

const meta = moduleMeta('cableway')
const columns = ["缆道编号", "所属站点", "跨度米数", "建成日期", "最近检修日", "荷载能力", "检修人员", "缆道状态"]
const allActions = ["安排检修", "完成检修", "停用缆道"]
const statuses = ["正常运行", "需检修", "检修中", "已停用"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = reactive<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = computed(() => [
  { label: "缆道总数", value: rows.value.length },
  { label: "正常运行数", value: rows.value.filter((row) => String(row.status) === '正常运行').length },
  { label: "需检修数", value: rows.value.filter((row) => String(row.status) === '需检修').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

/** 已停用缆道不能再停用，也不入检修批次；状态对应的动作只显示合法的。 */
function availableActions(row: EntryRow): string[] {
  const status = String(row.status)
  if (status === '已停用') {
    return []
  }
  return allActions.filter((action) => {
    if (action === '停用缆道') {
      return true
    }
    if (action === '完成检修') {
      return status === '检修中' || status === '需检修'
    }
    if (action === '安排检修') {
      return status === '正常运行'
    }
    return true
  })
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
  errorMessage.value = '测流缆道登记入口尚未接入审批流'
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
    errorMessage.value = error instanceof Error ? error.message : '测流缆道列表读取失败'
  }
}

let unsubscribe: (() => void) | undefined
onMounted(() => {
  reload()
  // 批次落库（含别的标签页）后，列表、统计、图例一起联动更新。
  unsubscribe = subscribeData(reload)
})
onUnmounted(() => unsubscribe?.())
</script>
