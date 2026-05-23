<!--
  ChapterRow.vue：章节表格单行
  ----------------------------------------------------------------------------
  组件只负责展示和派发事件，不持有业务状态、不调用接口。
  视觉上以“章节号 / 章节标题 / 创建时间”为主体，删除按钮放在行尾弱化展示。
-->

<script setup>
import { formatDateTime } from '@/utils/datetime'

const props = defineProps({
  // 章节摘要对象：来自 /novels/{id}/chapters 列表接口。
  // 字段：id, novelId, chapterNo, title, wordCount, createdAt, updatedAt。
  chapter: { type: Object, required: true },
})

const emit = defineEmits(['click', 'delete', 'generate-character-card'])

function onClickRow() {
  emit('click', props.chapter)
}

// 生成角色卡是章节行内操作，必须阻止冒泡，避免同时进入章节编辑页。
function onClickGenerate(e) {
  e.stopPropagation()
  emit('generate-character-card', props.chapter)
}

// 删除按钮阻止冒泡，避免用户点删除时同时进入章节编辑页。
function onClickDelete(e) {
  e.stopPropagation()
  emit('delete', props.chapter)
}
</script>

<template>
  <article
    class="row"
    tabindex="0"
    role="row"
    @click="onClickRow"
    @keydown.enter.self="onClickRow"
    @keydown.space.prevent.self="onClickRow"
  >
    <span class="no" role="cell" data-label="章节号">{{ chapter.chapterNo }}</span>
    <span class="title" role="cell" data-label="章节标题" :title="chapter.title">
      {{ chapter.title || '（未命名）' }}
    </span>
    <span class="time" role="cell" data-label="创建时间">{{
      formatDateTime(chapter.createdAt)
    }}</span>
    <div class="row-actions" role="cell" data-label="操作">
      <button class="generate-row" type="button" @click="onClickGenerate">生成角色卡</button>
      <button
        class="delete-row"
        type="button"
        :aria-label="`删除第 ${chapter.chapterNo} 章`"
        title="删除章节"
        @click="onClickDelete"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16" />
          <path d="M10 11v6M14 11v6" />
          <path d="M6 7l1 14h10l1-14M9 7V4h6v3" />
        </svg>
        <span>删除</span>
      </button>
    </div>
  </article>
</template>

<style scoped>
.row {
  display: grid;
  grid-template-columns: 160px minmax(220px, 1fr) 240px 196px;
  align-items: center;
  min-height: 58px;
  padding: 0 28px;
  border-top: 1px solid oklch(90% 0.01 255);
  background: oklch(99.2% 0.004 255);
  color: oklch(28% 0.035 260);
  cursor: pointer;
  transition:
    background 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
}

.row:first-child {
  border-top: 0;
}

.row:hover,
.row:focus-visible {
  outline: none;
  background: oklch(97.2% 0.012 255);
  box-shadow: inset 0 0 0 1px oklch(83% 0.04 255);
}

.no,
.time {
  font-variant-numeric: tabular-nums;
}

.no {
  text-align: center;
  color: oklch(32% 0.03 260);
  font-size: 1rem;
}

.title {
  min-width: 0;
  color: oklch(30% 0.034 260);
  font-size: 1rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.time {
  color: oklch(35% 0.032 260);
  font-size: 1rem;
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.generate-row,
.delete-row {
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: 0.84rem;
  font-weight: 760;
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    opacity 0.18s ease,
    transform 0.18s ease;
}

.generate-row {
  min-width: 104px;
  padding: 0 10px;
  border-color: oklch(82% 0.026 255);
  color: oklch(48% 0.16 255);
  white-space: nowrap;
}

.delete-row {
  width: 36px;
  color: oklch(55% 0.22 25);
  opacity: 0.68;
}

.generate-row:hover,
.generate-row:focus-visible {
  border-color: oklch(70% 0.08 255);
  background: oklch(95% 0.022 255);
  color: oklch(48% 0.18 258);
  outline: none;
  transform: translateY(-1px);
}

.delete-row svg {
  width: 1.1rem;
  height: 1.1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.delete-row span {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.delete-row:hover,
.delete-row:focus-visible {
  border-color: oklch(84% 0.065 24);
  background: oklch(96% 0.024 24);
  opacity: 1;
  outline: none;
}

@media (max-width: 760px) {
  .row {
    grid-template-columns: 1fr auto;
    gap: 8px 14px;
    min-height: auto;
    padding: 16px;
    border: 1px solid oklch(88% 0.012 255);
    border-radius: 12px;
    box-shadow: 0 8px 20px oklch(45% 0.04 260 / 0.08);
  }

  .no,
  .title,
  .time {
    text-align: left;
  }

  .no {
    grid-column: 1;
    color: oklch(48% 0.13 255);
    font-size: 0.85rem;
    font-weight: 760;
  }

  .title {
    grid-column: 1;
    font-size: 1rem;
    font-weight: 700;
  }

  .time {
    grid-column: 1;
    color: oklch(52% 0.03 260);
    font-size: 0.875rem;
  }

  .delete-row {
    grid-column: 2;
    grid-row: 1 / span 3;
    align-self: center;
  }

  .row-actions {
    grid-column: 2;
    grid-row: 1 / span 3;
    align-self: center;
    flex-direction: column;
  }

  .generate-row {
    min-width: 88px;
    height: 34px;
    font-size: 0.78rem;
  }

  .delete-row {
    grid-column: auto;
    grid-row: auto;
  }
}
</style>
