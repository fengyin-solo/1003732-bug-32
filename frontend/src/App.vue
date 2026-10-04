<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">水文监测站网管理系统</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
          <span
            v-if="item.key === 'inspection' && batchStore.checkCount > 0"
            class="nav-badge"
          >{{ batchStore.checkCount }}</span>
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
    <CablewayBatchPanel />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'

import CablewayBatchPanel from '@/components/CablewayBatchPanel.vue'
import { useCablewayBatchStore } from '@/stores/cableway-batch'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const batchStore = useCablewayBatchStore()

onMounted(() => {
  batchStore.init()
})

const navItems = [
  { key: "dashboard", label: "运营概览", path: "/" },
  { key: "station", label: "监测站点", path: "/station" },
  { key: "waterlevel", label: "水位监测", path: "/waterlevel" },
  { key: "discharge", label: "流量监测", path: "/discharge" },
  { key: "rainfall", label: "雨量观测", path: "/rainfall" },
  { key: "waterquality", label: "水质检测", path: "/waterquality" },
  { key: "crosssection", label: "断面测量", path: "/crosssection" },
  { key: "telemetry", label: "遥测设备", path: "/telemetry" },
  { key: "compilation", label: "数据整编", path: "/compilation" },
  { key: "warning", label: "预警阈值", path: "/warning" },
  { key: "groundwater", label: "地下水观测", path: "/groundwater" },
  { key: "evaporation", label: "蒸发观测", path: "/evaporation" },
  { key: "cableway", label: "测流缆道", path: "/cableway" },
  { key: "sediment", label: "泥沙监测", path: "/sediment" },
  { key: "communication", label: "通讯系统", path: "/communication" },
  { key: "stationhouse", label: "站房维护", path: "/stationhouse" },
  { key: "calibration", label: "仪器检定", path: "/calibration" },
  { key: "inspection", label: "巡检记录", path: "/inspection" },
  { key: "plan", label: "测报方案", path: "/plan" },
]
</script>
