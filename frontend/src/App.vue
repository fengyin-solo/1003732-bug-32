<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">水文监测站网管理系统</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          <span>{{ item.label }}</span>
          <span v-if="item.badge" class="nav-badge">{{ item.badge }}</span>
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向水文监测站点运行、水位流量雨量数据采集、遥测设备维护与数据整编发布的水文站网管理平台。</span>
        <span class="head-user">当前值班：{{ store.operator }} · {{ store.shiftLabel }}</span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { useSessionStore } from '@/stores/session'
import { inspectionTodoCount } from '@/api/local-service'
import { subscribeData } from '@/data/local-store'

const store = useSessionStore()
const inspectionTodo = ref(0)

const baseNav: { label: string; path: string; badge?: number }[] = [
  { label: "运营概览", path: "/" },
  { label: "监测站点", path: "/station" },
  { label: "水位监测", path: "/waterlevel" },
  { label: "流量监测", path: "/discharge" },
  { label: "雨量观测", path: "/rainfall" },
  { label: "水质检测", path: "/waterquality" },
  { label: "断面测量", path: "/crosssection" },
  { label: "遥测设备", path: "/telemetry" },
  { label: "数据整编", path: "/compilation" },
  { label: "预警阈值", path: "/warning" },
  { label: "地下水观测", path: "/groundwater" },
  { label: "蒸发观测", path: "/evaporation" },
  { label: "测流缆道", path: "/cableway" },
  { label: "泥沙监测", path: "/sediment" },
  { label: "通讯系统", path: "/communication" },
  { label: "站房维护", path: "/stationhouse" },
  { label: "仪器检定", path: "/calibration" },
  { label: "巡检记录", path: "/inspection" },
  { label: "测报方案", path: "/plan" },
]

const navItems = computed(() =>
  baseNav.map((item) =>
    item.path === '/inspection' && inspectionTodo.value > 0
      ? { ...item, badge: inspectionTodo.value }
      : item,
  ),
)

function refreshTodo() {
  inspectionTodo.value = inspectionTodoCount()
}

let unsubscribe: (() => void) | undefined
onMounted(() => {
  refreshTodo()
  // 巡检批次在任何入口落库后，导航上的待办徽标都跟着更新（含跨标签页）。
  unsubscribe = subscribeData(refreshTodo)
})
onUnmounted(() => unsubscribe?.())
</script>

<style scoped>
.nav-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.nav-badge {
  background: #d92d20;
  color: #fff;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1;
  min-width: 18px;
  padding: 3px 6px;
  text-align: center;
}
</style>
