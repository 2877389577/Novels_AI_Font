<!--
  ChapterPlotAnalysisView.vue：章节剧情推理结果页
  ----------------------------------------------------------------------------
  设计目标：
  1. 承载 /novels/{id}/chapters/{chapterId}/plot-analysis 的只读展示，入口来自小说详情页章节列表。
  2. 剧情总结由后端异步生成并持久化；前端只查询和展示，不触发生成、不选择模型。
  3. relationship_changes 当前文档只声明为 object[]，页面按通用键值渲染，避免后端未来新增字段时丢信息。
-->

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { getChapterPlotAnalysis } from '@/api/chapter'
import { formatDateTime } from '@/utils/datetime'

const props = defineProps({
  novelId: { type: Number, required: true },
  chapterId: { type: Number, required: true },
})

const router = useRouter()
const toast = useToast()

const analysis = ref(null)
const loading = ref(true)
const loadError = ref('')
const notGenerated = ref(false)

const updatedAtText = computed(() => {
  const value = analysis.value?.updatedAt || analysis.value?.createdAt
  return formatDateTime(value)
})

function toArray(value) {
  // 后端契约是数组；这里兼容空值和单值，保证模板永远只处理数组，减少分支。
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined)
  return value === null || value === undefined || value === '' ? [] : [value]
}

function stringifyValue(value) {
  // 关系变化里的未知字段可能是对象或数组，用稳定的 JSON 字符串保留完整信息。
  if (value === null || value === undefined || value === '') return '未填写'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function relationshipEntries(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return [{ key: '内容', value: stringifyValue(item) }]
  }
  return Object.entries(item).map(([key, value]) => ({
    key,
    value: stringifyValue(value),
  }))
}

const sections = computed(() => [
  {
    key: 'characters',
    title: '涉及角色',
    empty: '本章没有返回主要角色。',
    items: toArray(analysis.value?.characters_involved),
  },
  {
    key: 'key-events',
    title: '关键事件',
    empty: '本章没有返回关键事件。',
    items: toArray(analysis.value?.key_events),
  },
  {
    key: 'event-analysis',
    title: '事件分析',
    empty: '本章没有返回事件分析。',
    items: toArray(analysis.value?.event_analysis),
  },
  {
    key: 'foreshadowing',
    title: '伏笔',
    empty: '本章没有返回伏笔。',
    items: toArray(analysis.value?.foreshadowing),
  },
  {
    key: 'unresolved',
    title: '未解决线索',
    empty: '本章没有返回未解决线索。',
    items: toArray(analysis.value?.unresolved_threads),
  },
])

const relationshipChanges = computed(() => toArray(analysis.value?.relationship_changes))

async function fetchAnalysis() {
  loading.value = true
  loadError.value = ''
  notGenerated.value = false
  analysis.value = null

  try {
    const res = await getChapterPlotAnalysis(props.novelId, props.chapterId)
    if (res?.code === 0 && res.data) {
      analysis.value = res.data
    } else {
      // 后端在 AI 尚未完成时会用业务错误表达“不存在”，这里转换成专门的空状态。
      notGenerated.value = true
      loadError.value = res?.msg || '章节剧情总结暂未生成'
    }
  } catch (e) {
    loadError.value = e?.message || '章节剧情总结加载失败'
    toast.add({
      severity: 'error',
      summary: '加载失败',
      detail: loadError.value,
      life: 3000,
    })
  } finally {
    loading.value = false
  }
}

function goBack() {
  router.push({ name: 'novel-detail', params: { id: props.novelId } })
}

watch(
  () => [props.novelId, props.chapterId],
  () => fetchAnalysis(),
)
onMounted(fetchAnalysis)
</script>

<template>
  <main class="analysis-page">
    <header class="page-head">
      <div>
        <button class="back-link" type="button" @click="goBack">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 18 9 12l6-6" />
          </svg>
          返回小说详情
        </button>
        <h1>剧情推理</h1>
        <p>章节 ID {{ chapterId }} 的 AI 剧情总结。</p>
      </div>

      <button class="refresh-button" type="button" :disabled="loading" @click="fetchAnalysis">
        {{ loading ? '读取中' : '刷新' }}
      </button>
    </header>

    <section v-if="loading" class="state-card" aria-live="polite">
      <div class="state-lines">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </section>

    <section v-else-if="notGenerated || loadError" class="empty-card">
      <h2>{{ notGenerated ? '剧情总结暂未生成' : '加载失败' }}</h2>
      <p>{{ loadError || '后端还没有返回这一章的剧情推理结果。' }}</p>
      <div class="state-actions">
        <button type="button" @click="fetchAnalysis">重试</button>
        <button class="ghost" type="button" @click="goBack">返回小说详情</button>
      </div>
    </section>

    <template v-else-if="analysis">
      <section class="summary-card" aria-labelledby="summary-title">
        <div class="summary-copy">
          <span class="eyebrow">Chapter ID {{ analysis.chapterId || chapterId }}</span>
          <h2 id="summary-title">剧情概述</h2>
          <p>{{ analysis.summary || '本章没有返回剧情概述。' }}</p>
        </div>
        <dl class="meta-list">
          <div>
            <dt>小说 ID</dt>
            <dd>{{ analysis.novelId || novelId }}</dd>
          </div>
          <div>
            <dt>章节 ID</dt>
            <dd>{{ analysis.chapterId || chapterId }}</dd>
          </div>
          <div>
            <dt>更新时间</dt>
            <dd>{{ updatedAtText || '未返回' }}</dd>
          </div>
        </dl>
      </section>

      <section class="analysis-grid" aria-label="剧情推理详情">
        <article v-for="section in sections" :key="section.key" class="analysis-section">
          <h2>{{ section.title }}</h2>
          <ul v-if="section.items.length > 0">
            <li v-for="(item, index) in section.items" :key="`${section.key}-${index}`">
              {{ stringifyValue(item) }}
            </li>
          </ul>
          <p v-else class="section-empty">{{ section.empty }}</p>
        </article>

        <article class="analysis-section relations-section">
          <h2>人物关系变化</h2>
          <div v-if="relationshipChanges.length > 0" class="relation-list">
            <dl v-for="(item, index) in relationshipChanges" :key="index" class="relation-item">
              <div v-for="entry in relationshipEntries(item)" :key="entry.key">
                <dt>{{ entry.key }}</dt>
                <dd>{{ entry.value }}</dd>
              </div>
            </dl>
          </div>
          <p v-else class="section-empty">本章没有返回人物关系变化。</p>
        </article>
      </section>
    </template>
  </main>
</template>

<style scoped>
.analysis-page {
  min-height: 100vh;
  padding: 36px 68px 48px;
  background:
    radial-gradient(circle at 18% 8%, oklch(96% 0.018 250) 0, transparent 34rem),
    linear-gradient(180deg, oklch(99% 0.006 255), oklch(96.5% 0.008 255));
  color: oklch(24% 0.035 260);
  font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}

.page-head,
.summary-card,
.analysis-grid,
.state-card,
.empty-card {
  max-width: 1440px;
  margin-inline: auto;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 24px;
}

.page-head h1 {
  margin: 8px 0 6px;
  color: oklch(24% 0.035 260);
  font-size: 2rem;
  line-height: 1.15;
  font-weight: 780;
  letter-spacing: 0;
}

.page-head p {
  margin: 0;
  color: oklch(48% 0.032 260);
  font-size: 0.96rem;
  line-height: 1.7;
}

.back-link,
.refresh-button,
.state-actions button {
  border: 0;
  border-radius: 8px;
  font: inherit;
  font-weight: 740;
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.back-link {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  background: transparent;
  color: oklch(50% 0.04 260);
  font-size: 0.875rem;
}

.back-link:hover {
  color: oklch(48% 0.18 258);
  transform: translateX(-2px);
}

.back-link svg {
  width: 1.25rem;
  height: 1.25rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.refresh-button,
.state-actions button {
  min-height: 42px;
  padding: 0 16px;
  border: 1px solid oklch(82% 0.026 255);
  background: oklch(99% 0.004 255);
  color: oklch(48% 0.16 255);
}

.refresh-button:hover:not(:disabled),
.state-actions button:hover {
  border-color: oklch(70% 0.08 255);
  background: oklch(95% 0.022 255);
  transform: translateY(-1px);
}

.refresh-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
  transform: none;
}

.summary-card,
.analysis-section,
.state-card,
.empty-card {
  border: 1px solid oklch(88% 0.012 255);
  border-radius: 16px;
  background: oklch(99.2% 0.004 255);
  box-shadow:
    0 18px 44px oklch(45% 0.04 260 / 0.1),
    0 1px 2px oklch(45% 0.04 260 / 0.08);
}

.summary-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 42px;
  align-items: start;
  padding: 34px 38px;
}

.eyebrow {
  display: inline-flex;
  margin-bottom: 12px;
  color: oklch(50% 0.14 255);
  font-size: 0.78rem;
  font-weight: 820;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.summary-copy h2,
.analysis-section h2,
.empty-card h2 {
  margin: 0;
  color: oklch(24% 0.04 260);
  font-size: 1.25rem;
  line-height: 1.25;
  font-weight: 800;
}

.summary-copy p {
  max-width: 72ch;
  margin: 18px 0 0;
  color: oklch(36% 0.032 260);
  font-size: 1.05rem;
  line-height: 1.9;
  white-space: pre-wrap;
}

.meta-list {
  display: grid;
  gap: 12px;
  margin: 0;
}

.meta-list div {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid oklch(90% 0.01 255);
  border-radius: 10px;
  background: oklch(97.8% 0.008 255);
}

.meta-list dt {
  color: oklch(54% 0.03 260);
  font-size: 0.76rem;
  font-weight: 780;
}

.meta-list dd {
  margin: 0;
  color: oklch(28% 0.035 260);
  font-size: 0.92rem;
  font-weight: 760;
  overflow-wrap: anywhere;
}

.analysis-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  margin-top: 20px;
}

.analysis-section {
  min-height: 220px;
  padding: 24px 26px;
}

.analysis-section ul {
  display: grid;
  gap: 12px;
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
}

.analysis-section li {
  padding: 12px 14px;
  border-radius: 10px;
  background: oklch(97.2% 0.01 255);
  color: oklch(35% 0.032 260);
  line-height: 1.75;
  overflow-wrap: anywhere;
}

.section-empty {
  margin: 18px 0 0;
  color: oklch(52% 0.03 260);
  line-height: 1.7;
}

.relations-section {
  grid-column: 1 / -1;
}

.relation-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-top: 18px;
}

.relation-item {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 16px;
  border: 1px solid oklch(90% 0.01 255);
  border-radius: 12px;
  background: oklch(97.8% 0.008 255);
}

.relation-item div {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 12px;
}

.relation-item dt {
  color: oklch(50% 0.032 260);
  font-size: 0.82rem;
  font-weight: 780;
  overflow-wrap: anywhere;
}

.relation-item dd {
  margin: 0;
  color: oklch(32% 0.034 260);
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.state-card,
.empty-card {
  min-height: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 44px;
  text-align: center;
}

.state-lines {
  width: min(680px, 100%);
  display: grid;
  gap: 18px;
}

.state-lines span {
  height: 22px;
  border-radius: 10px;
  background: linear-gradient(
    90deg,
    oklch(93% 0.01 255) 0%,
    oklch(97% 0.006 255) 50%,
    oklch(93% 0.01 255) 100%
  );
  background-size: 200% 100%;
  animation: shine 1.3s linear infinite;
}

.state-lines span:first-child {
  width: 68%;
  height: 42px;
}

.state-lines span:nth-child(2) {
  width: 100%;
}

.state-lines span:nth-child(3) {
  width: 84%;
}

.empty-card p {
  max-width: 42rem;
  margin: 0;
  color: oklch(48% 0.032 260);
  line-height: 1.75;
}

.state-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 4px;
}

.state-actions .ghost {
  border-color: transparent;
  background: transparent;
  color: oklch(42% 0.04 260);
}

.state-actions .ghost:hover {
  background: oklch(94% 0.014 255);
}

.back-link:focus-visible,
.refresh-button:focus-visible,
.state-actions button:focus-visible {
  outline: 3px solid oklch(76% 0.14 250 / 0.55);
  outline-offset: 3px;
}

@keyframes shine {
  to {
    background-position: -200% 0;
  }
}

@media (max-width: 920px) {
  .analysis-page {
    padding: 24px 18px 36px;
  }

  .page-head,
  .summary-card {
    grid-template-columns: 1fr;
  }

  .page-head {
    align-items: stretch;
    flex-direction: column;
  }

  .refresh-button {
    width: 100%;
  }

  .summary-card {
    gap: 24px;
    padding: 26px 22px;
  }

  .analysis-grid,
  .relation-list {
    grid-template-columns: 1fr;
  }

  .analysis-section {
    min-height: 0;
    padding: 22px 20px;
  }

  .relation-item div {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .state-actions {
    width: 100%;
    flex-direction: column;
  }

  .state-actions button {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .state-lines span {
    animation-duration: 0.01ms;
    animation-iteration-count: 1;
  }
}
</style>
