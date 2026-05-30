<!--
  AITaskConfigView.vue：AI 自动任务配置页
  ----------------------------------------------------------------------------
  设计目标：
  1. 后台管理风格，不做营销页、不做大面积装饰，用紧凑表格承载配置项。
  2. 只允许修改每一项的「是否启用」(isEnabled)，taskCode / taskName / description
     全部只读展示，避免用户改坏系统任务标识。
  3. 切换开关采用「乐观更新 + 失败回滚」：点击即翻转 UI 并进入 loading，
     PUT 成功后以服务端数据确认，失败则恢复原状态并 Toast 报错。
  4. 文案明确告知用户：关闭某项任务后，对应的保存 / 修改操作不会再自动触发该 AI 后台任务
     （例如关闭后，保存或修改章节不会再自动生成章节剧情总结）。
-->

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { listAITaskConfigs, updateAITaskConfig } from '@/api/aiTaskConfig'
import { formatDateTime } from '@/utils/datetime'

const router = useRouter()
const toast = useToast()

// ───── 列表数据 / 加载状态 ─────
const configs = ref([]) // AI 自动任务配置项（后端全量返回，无分页）
const loading = ref(false) // 是否正在拉取列表
const initialLoaded = ref(false) // 是否完成首次加载（用于区分骨架 / 空态）
const loadError = ref('') // 列表加载失败信息
const togglingCode = ref(null) // 正在切换中的任务 taskCode，用于 loading / 串行化防并发

// 已启用任务数，仅用于列表头部的轻量计数展示。
const enabledCount = computed(() => configs.value.filter((item) => item.isEnabled).length)

// 拉取全部配置项：成功写入 configs，失败写入 loadError 并 Toast。
async function fetchConfigs() {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    const res = await listAITaskConfigs()
    if (res?.code === 0) {
      configs.value = res.data?.items || []
    } else {
      loadError.value = res?.msg || 'AI 自动任务配置加载失败'
      toast.add({
        severity: 'error',
        summary: '加载失败',
        detail: res?.msg || '请稍后重试',
        life: 3000,
      })
    }
  } catch (e) {
    loadError.value = e?.message || 'AI 自动任务配置加载失败'
    toast.add({
      severity: 'error',
      summary: '网络错误',
      detail: e?.message || '请稍后重试',
      life: 3000,
    })
  } finally {
    loading.value = false
    initialLoaded.value = true
  }
}

onMounted(fetchConfigs)

// 切换某项任务的启用状态：
// 乐观更新当前行 → 调 PUT → 成功以服务端返回确认 / 失败回滚原状态。
// 用单个 togglingCode 串行化切换，避免并发请求造成行状态错乱。
async function onToggle(row) {
  if (togglingCode.value) return

  const previous = row.isEnabled // 记录原状态，用于失败回滚
  const next = !previous
  togglingCode.value = row.taskCode
  row.isEnabled = next // 乐观更新：让用户立即看到操作意图

  try {
    const res = await updateAITaskConfig(row.taskCode, next)
    if (res?.code === 0) {
      // 成功后以服务端数据为准：若 PUT 返回了更新后的 item，顺带刷新状态与更新时间；
      // 否则沿用乐观值 next，不伪造时间。
      const updated = res.data
      row.isEnabled = typeof updated?.isEnabled === 'boolean' ? updated.isEnabled : next
      if (updated?.updatedAt) row.updatedAt = updated.updatedAt
      toast.add({
        severity: 'success',
        summary: row.isEnabled ? '已启用' : '已关闭',
        detail: row.taskName,
        life: 2000,
      })
    } else {
      row.isEnabled = previous // 业务失败：回滚
      toast.add({
        severity: 'error',
        summary: '更新失败',
        detail: res?.msg || '请稍后重试',
        life: 3000,
      })
    }
  } catch (e) {
    row.isEnabled = previous // 网络异常：回滚
    toast.add({
      severity: 'error',
      summary: '网络错误',
      detail: e?.message || '请稍后重试',
      life: 3000,
    })
  } finally {
    togglingCode.value = null
  }
}

// 更新时间优先取 updatedAt，缺失时回落到 createdAt，统一交给 formatDateTime 兜底占位符。
function displayUpdatedAt(row) {
  return formatDateTime(row.updatedAt || row.createdAt)
}

function goBack() {
  router.push({ name: 'shelf' })
}
</script>

<template>
  <main class="task-config-page">
    <header class="page-header">
      <button class="back-button" type="button" @click="goBack">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 18 9 12l6-6" />
        </svg>
        返回书架
      </button>
      <h1>AI 自动任务配置</h1>
      <p>管理保存、修改内容后自动触发的 AI 后台任务。</p>
      <!-- 明确告知关闭后果，避免用户误以为关闭后系统仍会自动生成内容。 -->
      <div class="page-note" role="note">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8h.01M11 12h1v4h1" />
        </svg>
        <span>
          关闭某项任务后，对应的保存 / 修改操作将<strong>不再自动触发</strong>该 AI 后台任务。
          例如关闭「自动章节剧情总结」后，保存或修改章节不会再自动生成章节剧情总结。
        </span>
      </div>
    </header>

    <section class="workspace">
      <section class="config-list" aria-labelledby="task-config-list-title">
        <div class="list-head">
          <div>
            <h2 id="task-config-list-title">自动任务列表</h2>
            <span v-if="initialLoaded">共 {{ configs.length }} 项 · 已启用 {{ enabledCount }} 项</span>
          </div>
          <button class="refresh-button" type="button" :disabled="loading" @click="fetchConfigs">
            刷新
          </button>
        </div>

        <!-- 首次加载：骨架占位 -->
        <div v-if="loading && !initialLoaded" class="table-skeleton" aria-hidden="true">
          <span v-for="item in 3" :key="item"></span>
        </div>

        <!-- 加载失败：错误态 + 重试 -->
        <div v-else-if="loadError" class="state-panel">
          <h3>加载失败</h3>
          <p>{{ loadError }}</p>
          <button class="state-button" type="button" @click="fetchConfigs">重试</button>
        </div>

        <!-- 空列表 -->
        <div v-else-if="initialLoaded && configs.length === 0" class="state-panel">
          <h3>暂无 AI 自动任务配置</h3>
          <p>系统当前没有可管理的自动任务，后端新增任务后会显示在这里。</p>
        </div>

        <!-- 配置表格 -->
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>任务名称</th>
                <th>说明</th>
                <th>任务编码</th>
                <th>状态</th>
                <th>更新时间</th>
                <th class="op-col">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in configs" :key="row.taskCode">
                <td data-label="任务名称">
                  <strong>{{ row.taskName || '未命名任务' }}</strong>
                </td>
                <td data-label="说明">
                  <span class="desc-text">{{ row.description || '—' }}</span>
                </td>
                <td data-label="任务编码">
                  <code>{{ row.taskCode }}</code>
                </td>
                <td data-label="状态">
                  <span class="status-pill" :data-enabled="row.isEnabled">
                    {{ row.isEnabled ? '已启用' : '已关闭' }}
                  </span>
                </td>
                <td data-label="更新时间">{{ displayUpdatedAt(row) }}</td>
                <td data-label="操作" class="op-col">
                  <!--
                    Switch 开关：用原生 button + role="switch" 实现，
                    便于干净地承载 loading（spinner）与 disabled 态。
                  -->
                  <button
                    class="task-switch"
                    type="button"
                    role="switch"
                    :aria-checked="String(row.isEnabled)"
                    :aria-label="`${row.isEnabled ? '关闭' : '开启'}${row.taskName || row.taskCode}`"
                    :data-on="row.isEnabled"
                    :data-loading="togglingCode === row.taskCode"
                    :disabled="togglingCode === row.taskCode"
                    @click="onToggle(row)"
                  >
                    <span class="task-switch-track">
                      <span class="task-switch-thumb">
                        <span
                          v-if="togglingCode === row.taskCode"
                          class="task-switch-spinner"
                          aria-hidden="true"
                        ></span>
                      </span>
                    </span>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  </main>
</template>

<style scoped>
.task-config-page {
  min-height: 100vh;
  padding: 36px 48px 56px;
  background:
    radial-gradient(circle at 14% 0%, oklch(97.5% 0.012 245) 0, transparent 34rem),
    linear-gradient(180deg, oklch(99.4% 0.003 250), oklch(96.8% 0.006 250));
  color: oklch(23% 0.026 260);
  font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}

.page-header,
.workspace {
  max-width: 1240px;
  margin-inline: auto;
}

.page-header {
  margin-bottom: 28px;
}

.page-header h1 {
  margin: 10px 0 8px;
  color: oklch(22% 0.028 260);
  font-size: 2rem;
  line-height: 1.14;
  font-weight: 800;
}

.page-header p {
  max-width: 48rem;
  margin: 0;
  color: oklch(47% 0.028 260);
  font-size: 1rem;
  line-height: 1.7;
}

.back-button {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: oklch(49% 0.035 260);
  font: inherit;
  font-size: 0.92rem;
  font-weight: 740;
  cursor: pointer;
  transition:
    color 0.18s ease,
    transform 0.18s ease;
}

.back-button:hover {
  color: oklch(46% 0.16 252);
  transform: translateX(-2px);
}

.back-button svg {
  width: 1.15rem;
  height: 1.15rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* 关闭后果提示条：低饱和琥珀色，提示但不抢眼。 */
.page-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  max-width: 48rem;
  margin-top: 16px;
  padding: 12px 16px;
  border: 1px solid oklch(88% 0.05 85);
  border-radius: 12px;
  background: oklch(97.5% 0.03 85);
  color: oklch(45% 0.06 80);
  font-size: 0.86rem;
  line-height: 1.65;
}

.page-note svg {
  flex: 0 0 auto;
  width: 1.15rem;
  height: 1.15rem;
  margin-top: 1px;
  fill: none;
  stroke: oklch(58% 0.12 75);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.page-note strong {
  color: oklch(40% 0.1 70);
  font-weight: 820;
}

.config-list {
  overflow: hidden;
  border: 1px solid oklch(88.5% 0.012 250);
  border-radius: 16px;
  background: oklch(99.4% 0.003 250);
  box-shadow:
    0 18px 48px oklch(42% 0.035 260 / 0.09),
    0 1px 2px oklch(42% 0.035 260 / 0.06);
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 28px 20px;
  border-bottom: 1px solid oklch(91% 0.009 250);
}

.list-head h2 {
  margin: 0;
  color: oklch(24% 0.03 260);
  font-size: 1.24rem;
  line-height: 1.2;
  font-weight: 800;
}

.list-head span {
  color: oklch(52% 0.03 260);
  font-size: 0.82rem;
  font-weight: 760;
}

.refresh-button {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid oklch(83% 0.018 250);
  border-radius: 8px;
  background: oklch(98% 0.006 250);
  color: oklch(42% 0.035 260);
  font: inherit;
  font-weight: 740;
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease;
}

.refresh-button:hover:not(:disabled) {
  border-color: oklch(70% 0.075 250);
  background: oklch(95.5% 0.02 250);
  color: oklch(46% 0.16 252);
}

.refresh-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  min-width: 880px;
  border-collapse: collapse;
}

th,
td {
  padding: 18px;
  border-bottom: 1px solid oklch(91.5% 0.008 250);
  text-align: left;
  vertical-align: middle;
}

th {
  color: oklch(50% 0.032 260);
  font-size: 0.78rem;
  font-weight: 820;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
}

td {
  color: oklch(32% 0.03 260);
  font-size: 0.92rem;
}

tbody tr {
  transition: background 0.18s ease;
}

tbody tr:hover {
  background: oklch(97.5% 0.012 250);
}

td strong {
  color: oklch(23% 0.032 260);
  font-size: 0.98rem;
  font-weight: 780;
}

.desc-text {
  display: inline-block;
  max-width: 26rem;
  color: oklch(40% 0.03 260);
  line-height: 1.6;
}

td code {
  display: inline-block;
  padding: 3px 9px;
  border-radius: 7px;
  background: oklch(95.5% 0.012 255);
  color: oklch(36% 0.05 258);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.82rem;
}

/* 状态徽标：启用绿色 / 关闭灰色，由 data-enabled 切换。 */
.status-pill {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  padding: 0 12px;
  border-radius: 999px;
  background: oklch(94% 0.012 260);
  color: oklch(45% 0.035 260);
  font-size: 0.78rem;
  font-weight: 800;
}

.status-pill[data-enabled='true'] {
  background: oklch(93% 0.026 150);
  color: oklch(39% 0.13 150);
}

.op-col {
  width: 96px;
  text-align: center;
}

/* ───── Switch 开关：button + role="switch" ───── */
.task-switch {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.task-switch:disabled {
  cursor: progress;
}

.task-switch-track {
  position: relative;
  display: inline-block;
  width: 46px;
  height: 26px;
  border-radius: 999px;
  background: oklch(82% 0.012 250);
  transition:
    background 0.18s ease,
    box-shadow 0.18s ease;
}

.task-switch[data-on='true'] .task-switch-track {
  background: oklch(58% 0.15 150);
}

.task-switch-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: oklch(99.4% 0.003 250);
  box-shadow: 0 2px 7px oklch(30% 0.02 260 / 0.22);
  transition: transform 0.2s ease;
}

.task-switch[data-on='true'] .task-switch-thumb {
  transform: translateX(20px);
}

/* loading 态：开关整体淡出 + thumb 内显示旋转 spinner，提示请求进行中。 */
.task-switch[data-loading='true'] .task-switch-track {
  opacity: 0.78;
}

.task-switch-spinner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid oklch(80% 0.02 250);
  border-top-color: oklch(50% 0.14 250);
  animation: task-switch-spin 0.7s linear infinite;
}

@keyframes task-switch-spin {
  to {
    transform: rotate(360deg);
  }
}

.task-switch:focus-visible {
  outline: none;
}

.task-switch:focus-visible .task-switch-track {
  box-shadow: 0 0 0 3px oklch(76% 0.14 250 / 0.55);
}

/* ───── 加载骨架 ───── */
.table-skeleton {
  display: grid;
  gap: 14px;
  padding: 28px;
}

.table-skeleton span {
  height: 56px;
  border-radius: 10px;
  background: linear-gradient(
    90deg,
    oklch(92% 0.01 250) 0%,
    oklch(97% 0.006 250) 50%,
    oklch(92% 0.01 250) 100%
  );
  background-size: 200% 100%;
  animation: task-shine 1.25s linear infinite;
}

@keyframes task-shine {
  to {
    background-position: -200% 0;
  }
}

/* ───── 错误 / 空态 ───── */
.state-panel {
  min-height: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 28px;
  text-align: center;
}

.state-panel h3 {
  margin: 0;
  color: oklch(26% 0.032 260);
  font-size: 1.2rem;
}

.state-panel p {
  max-width: 34rem;
  margin: 0;
  color: oklch(50% 0.03 260);
  line-height: 1.7;
}

.state-button {
  min-height: 42px;
  margin-top: 6px;
  padding: 0 20px;
  border: 0;
  border-radius: 8px;
  background: oklch(18.5% 0.012 260);
  color: oklch(98.5% 0.004 250);
  font: inherit;
  font-weight: 740;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.state-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 30px oklch(18.5% 0.012 260 / 0.2);
}

/* ───── 响应式：窄屏下表格转为卡片式堆叠（与生图 AI 设置页一致） ───── */
@media (max-width: 1180px) {
  .task-config-page {
    padding-inline: 28px;
  }
}

@media (max-width: 860px) {
  table,
  thead,
  tbody,
  tr,
  td {
    display: block;
  }

  table {
    min-width: 0;
  }

  thead {
    display: none;
  }

  tbody {
    display: grid;
    gap: 14px;
    padding: 18px;
  }

  tbody tr {
    padding: 16px;
    border: 1px solid oklch(89% 0.012 250);
    border-radius: 14px;
    background: oklch(99% 0.004 250);
  }

  td {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid oklch(92% 0.008 250);
  }

  td:last-child {
    border-bottom: 0;
  }

  td::before {
    content: attr(data-label);
    color: oklch(52% 0.03 260);
    font-size: 0.78rem;
    font-weight: 800;
  }

  .op-col {
    width: auto;
    text-align: left;
  }

  .desc-text {
    max-width: 100%;
  }
}

@media (max-width: 720px) {
  .task-config-page {
    padding: 24px 16px 36px;
  }

  .page-header h1 {
    font-size: 1.7rem;
  }

  .list-head {
    align-items: stretch;
    flex-direction: column;
    padding-inline: 20px;
  }

  .refresh-button {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .table-skeleton span,
  .task-switch-spinner {
    animation-duration: 0.01ms;
    animation-iteration-count: 1;
  }

  .back-button,
  .task-switch-thumb,
  .task-switch-track,
  .state-button {
    transition-duration: 0.01ms;
  }
}
</style>
