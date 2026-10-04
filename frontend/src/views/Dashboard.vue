<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="batchStore.openPanel()">缆道参数批量保存</button>
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <div class="stat-row">
      <article
        class="stat-card quick-card"
        :class="{ 'stat-alert': batchStore.checkCount > 0 }"
        role="button"
        tabindex="0"
        @click="batchStore.openPanel()"
        @keyup.enter="batchStore.openPanel()"
      >
        <span class="stat-label">缆道参数核查待办（点击进入批次面板补核查）</span>
        <strong class="stat-value">{{ batchStore.checkCount }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

import { loadOverview } from '@/api/local-service'
import { useCablewayBatchStore } from '@/stores/cableway-batch'
import type { OverviewResult } from '@/data/types'

const batchStore = useCablewayBatchStore()
const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  batchStore.refreshChecks()
}

// 批次落库联动巡检待办后，看板数字跟着更新
watch(() => batchStore.dataTick, refresh)

onMounted(refresh)
</script>
