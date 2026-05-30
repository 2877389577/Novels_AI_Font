<script setup>
import { computed, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useToast } from 'primevue/usetoast'
import { getNovelOutline, saveNovelOutline } from '@/api/novel'

const props = defineProps({
  novelId: { type: Number, required: true },
})

const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const outlineText = ref('')
const savedOutlineText = ref('')

const markdownOptions = {
  gfm: true,
  breaks: true,
}

const dirty = computed(() => outlineText.value !== savedOutlineText.value)
const hasOutlineText = computed(() => outlineText.value.trim() !== '')
const outlineWordCount = computed(() => outlineText.value.replace(/\s+/g, '').length)

const renderedOutlineHtml = computed(() => {
  // Markdown 预览只服务当前页面展示；保存时仍然只提交 outlineText 原文。
  const unsafeHtml = marked.parse(outlineText.value || '', markdownOptions)
  return DOMPurify.sanitize(unsafeHtml)
})

function outlineFromResponse(res, fallback = '') {
  return typeof res?.data?.novelOutline === 'string' ? res.data.novelOutline : fallback
}

async function fetchOutline() {
  if (!props.novelId) return

  loading.value = true
  loadError.value = ''
  try {
    const res = await getNovelOutline(props.novelId)
    if (res?.code === 0) {
      const outline = outlineFromResponse(res)
      outlineText.value = outline
      savedOutlineText.value = outline
    } else {
      loadError.value = res?.msg || '大纲加载失败'
    }
  } catch (e) {
    loadError.value = e?.message || '大纲加载失败'
  } finally {
    loading.value = false
  }
}

async function onSaveOutline() {
  if (saving.value || loading.value || !dirty.value) return

  saving.value = true
  try {
    const res = await saveNovelOutline(props.novelId, outlineText.value)
    if (res?.code === 0) {
      // 后端会返回保存后的原文；如果某些环境未返回，则以本次提交值作为已保存快照。
      const savedOutline = outlineFromResponse(res, outlineText.value)
      outlineText.value = savedOutline
      savedOutlineText.value = savedOutline
      toast.add({ severity: 'success', summary: '大纲已保存', life: 2200 })
    } else {
      toast.add({
        severity: 'error',
        summary: '保存失败',
        detail: res?.msg || '请稍后重试',
        life: 3000,
      })
    }
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: '网络错误',
      detail: e?.message || '请稍后重试',
      life: 3000,
    })
  } finally {
    saving.value = false
  }
}

watch(
  () => props.novelId,
  () => fetchOutline(),
  { immediate: true },
)
</script>

<template>
  <section class="outline-panel" aria-labelledby="outline-title">
    <header class="outline-head">
      <div>
        <h2 id="outline-title">大纲</h2>
        <p>{{ outlineWordCount }} 字</p>
      </div>

      <button
        class="outline-button primary"
        type="button"
        :disabled="loading || saving || !dirty"
        @click="onSaveOutline"
      >
        {{ saving ? '保存中...' : '保存大纲' }}
      </button>
    </header>

    <div v-if="loading" class="outline-skeleton" aria-live="polite">
      <span></span>
      <span></span>
      <span></span>
      <span></span>
    </div>

    <div v-else-if="loadError" class="outline-error">
      <strong>大纲加载失败</strong>
      <p>{{ loadError }}</p>
      <button class="outline-button" type="button" @click="fetchOutline">重试</button>
    </div>

    <div v-else class="outline-workspace">
      <label class="outline-editor">
        <span>Markdown 原文</span>
        <textarea
          v-model="outlineText"
          spellcheck="false"
          placeholder="# 故事主线&#10;&#10;- 第一卷：&#10;- 关键冲突："
        ></textarea>
      </label>

      <article class="outline-preview" aria-label="大纲预览">
        <span>实时预览</span>
        <div v-if="hasOutlineText" class="markdown-body" v-html="renderedOutlineHtml"></div>
        <div v-else class="preview-empty">暂无大纲</div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.outline-panel {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  margin: 0;
  border: 1px solid oklch(88% 0.012 255);
  border-radius: 16px;
  background: oklch(99.2% 0.004 255);
  box-shadow:
    0 18px 44px oklch(45% 0.04 260 / 0.1),
    0 1px 2px oklch(45% 0.04 260 / 0.08);
  overflow: hidden;
}

.outline-head {
  min-height: 74px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 24px;
  border-bottom: 1px solid oklch(88% 0.012 255);
  background: oklch(97.5% 0.007 255);
}

.outline-head h2 {
  margin: 0;
  color: oklch(25% 0.04 260);
  font-size: 1.18rem;
  line-height: 1.25;
  font-weight: 780;
}

.outline-head p {
  margin: 5px 0 0;
  color: oklch(49% 0.03 260);
  font-size: 0.86rem;
}

/* 避开当前 PrimeVue Button 渲染异常，工作台按钮统一用原生 button 承载。 */
.outline-button {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 15px;
  border: 1px solid oklch(82% 0.024 255);
  border-radius: 9px;
  background: oklch(99.4% 0.003 255);
  color: oklch(38% 0.04 260);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 760;
  cursor: pointer;
}

.outline-button.primary {
  border-color: oklch(58% 0.18 258);
  background: oklch(57% 0.2 258);
  color: oklch(99% 0.004 255);
}

.outline-button:hover {
  border-color: oklch(70% 0.08 255);
  background: oklch(95% 0.02 255);
  color: oklch(48% 0.16 255);
}

.outline-button.primary:hover {
  border-color: oklch(50% 0.2 258);
  background: oklch(51% 0.21 258);
  color: oklch(99% 0.004 255);
}

.outline-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.outline-button:focus-visible {
  outline: 3px solid oklch(76% 0.14 250 / 0.55);
  outline-offset: 3px;
}

.outline-workspace {
  display: grid;
  /* 大纲是长文本工作台，桌面端固定左右平分，方便一边写原文一边看预览。 */
  grid-template-columns: repeat(2, minmax(0, 1fr));
  min-height: 0;
  overflow: hidden;
}

.outline-editor,
.outline-preview {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.outline-editor {
  border-right: 1px solid oklch(88% 0.012 255);
}

.outline-editor > span,
.outline-preview > span {
  padding: 15px 20px;
  border-bottom: 1px solid oklch(90% 0.01 255);
  color: oklch(38% 0.035 260);
  font-size: 0.86rem;
  font-weight: 760;
}

.outline-editor textarea {
  width: 100%;
  min-height: 100%;
  height: 100%;
  resize: none;
  overflow: auto;
  border: 0;
  outline: none;
  padding: 22px 24px 28px;
  background: oklch(98.8% 0.004 255);
  color: oklch(24% 0.035 260);
  font:
    0.96rem/1.8 ui-monospace,
    'SFMono-Regular',
    Consolas,
    'Liberation Mono',
    monospace;
  tab-size: 2;
}

.outline-editor textarea::placeholder {
  color: oklch(65% 0.02 260);
}

.outline-editor textarea:focus {
  background: oklch(99.4% 0.003 255);
  box-shadow: inset 0 0 0 3px oklch(55% 0.16 255 / 0.12);
}

.outline-preview {
  background: oklch(99.5% 0.003 255);
}

.markdown-body {
  min-width: 0;
  min-height: 0;
  padding: 22px 28px 34px;
  color: oklch(25% 0.035 260);
  font-size: 1rem;
  line-height: 1.85;
  overflow: auto;
  overflow-wrap: anywhere;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  margin: 1.1em 0 0.55em;
  color: oklch(22% 0.045 260);
  line-height: 1.28;
}

.markdown-body :deep(h1:first-child),
.markdown-body :deep(h2:first-child),
.markdown-body :deep(h3:first-child),
.markdown-body :deep(p:first-child) {
  margin-top: 0;
}

.markdown-body :deep(h1) {
  font-size: 1.55rem;
}

.markdown-body :deep(h2) {
  font-size: 1.3rem;
}

.markdown-body :deep(h3) {
  font-size: 1.12rem;
}

.markdown-body :deep(p),
.markdown-body :deep(ul),
.markdown-body :deep(ol),
.markdown-body :deep(blockquote),
.markdown-body :deep(pre) {
  margin: 0 0 1em;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.35em;
}

.markdown-body :deep(li + li) {
  margin-top: 0.35em;
}

.markdown-body :deep(blockquote) {
  padding: 10px 14px;
  border-radius: 10px;
  background: oklch(96.5% 0.01 255);
  color: oklch(42% 0.035 260);
}

.markdown-body :deep(code) {
  padding: 0.12em 0.34em;
  border-radius: 5px;
  background: oklch(94% 0.012 255);
  color: oklch(34% 0.08 255);
  font-family: ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: 0.92em;
}

.markdown-body :deep(pre) {
  padding: 14px 16px;
  border-radius: 12px;
  background: oklch(23% 0.035 260);
  color: oklch(96% 0.006 255);
  overflow: auto;
}

.markdown-body :deep(pre code) {
  padding: 0;
  background: transparent;
  color: inherit;
}

.markdown-body :deep(a) {
  color: oklch(48% 0.18 258);
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.18em;
}

.preview-empty,
.outline-error {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  min-height: 360px;
  padding: 34px;
  color: oklch(50% 0.03 260);
  text-align: center;
}

.outline-error strong {
  color: oklch(36% 0.05 260);
  font-size: 1.05rem;
}

.outline-error p {
  margin: 0;
  color: oklch(50% 0.03 260);
}

.outline-skeleton {
  display: grid;
  gap: 16px;
  padding: 34px;
}

.outline-skeleton span {
  height: 22px;
  border-radius: 8px;
  background: linear-gradient(
    90deg,
    oklch(93% 0.01 255) 0%,
    oklch(97% 0.006 255) 50%,
    oklch(93% 0.01 255) 100%
  );
  background-size: 200% 100%;
  animation: outline-shine 1.3s linear infinite;
}

.outline-skeleton span:nth-child(1) {
  width: 44%;
}

.outline-skeleton span:nth-child(2) {
  width: 78%;
}

.outline-skeleton span:nth-child(3) {
  width: 66%;
}

.outline-skeleton span:nth-child(4) {
  width: 52%;
}

@keyframes outline-shine {
  to {
    background-position: -200% 0;
  }
}

@media (max-width: 900px) {
  .outline-panel {
    height: auto;
  }

  .outline-head {
    align-items: stretch;
    flex-direction: column;
  }

  .outline-workspace {
    grid-template-columns: 1fr;
    min-height: 0;
    overflow: visible;
  }

  .outline-editor {
    border-right: 0;
    border-bottom: 1px solid oklch(88% 0.012 255);
  }

  .outline-editor textarea {
    height: auto;
    min-height: 360px;
    resize: vertical;
  }
}
</style>
