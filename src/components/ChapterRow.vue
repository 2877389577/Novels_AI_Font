<!--
  ChapterRow.vue —— 章节列表单行
  ----------------------------------------------------------------------------
  纯展示 + emit 组件，不持有任何业务状态、不调任何 API：
  · 单击整行 → emit('click', chapter)，由父组件（ChapterList）决定跳转
  · 单击删除按钮 → 阻止冒泡 + emit('delete', chapter)，由父组件做二次确认并调接口
  · CSS Grid 单行布局：章节号 / 标题 / 字数 / 创建时间 / 修改时间 / 删除按钮
  · 时间格式化统一走 @/utils/datetime，保持与详情页视觉一致
-->

<script setup>
import Button from 'primevue/button'
import { formatDateTime } from '@/utils/datetime'

const props = defineProps({
  // 章节摘要对象：来自 /novels/{id}/chapters 列表接口
  // 字段：id, novelId, chapterNo, title, wordCount, createdAt, updatedAt
  chapter: { type: Object, required: true },
})

// 行点击 / 行删除两路事件：父组件决定如何处理
const emit = defineEmits(['click', 'delete'])

function onClickRow() {
  emit('click', props.chapter)
}

// 删除按钮在行内部：阻止冒泡，避免同时触发行点击导致进入编辑页
function onClickDelete(e) {
  e.stopPropagation()
  emit('delete', props.chapter)
}
</script>

<template>
  <article class="row" tabindex="0" @click="onClickRow" @keydown.enter="onClickRow">
    <span class="no">第 {{ chapter.chapterNo }} 章</span>
    <span class="title" :title="chapter.title">{{ chapter.title || '（未命名）' }}</span>
    <span class="wc">{{ chapter.wordCount ?? 0 }} 字</span>
    <span class="time">创建 {{ formatDateTime(chapter.createdAt) }}</span>
    <span class="time">修改 {{ formatDateTime(chapter.updatedAt) }}</span>
    <Button label="删除" severity="danger" text size="small" @click="onClickDelete" />
  </article>
</template>

<style scoped>
/* 单行：CSS Grid 6 列布局
   章节号 / 标题（弹性） / 字数 / 创建时间 / 修改时间 / 删除按钮 */
.row {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr) 90px 168px 168px 64px;
  gap: 16px;
  align-items: center;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    transform 0.2s ease;
}
.row + .row {
  margin-top: 10px;
}
.row:hover,
.row:focus-visible {
  outline: none;
  border-color: rgba(0, 212, 255, 0.45);
  background: rgba(255, 255, 255, 0.05);
  transform: translateY(-1px);
}

/* 章节号：弱化展示，强调标题 */
.no {
  color: rgba(231, 233, 245, 0.55);
  font-size: 12px;
  letter-spacing: 0.04em;
}

/* 标题：超长省略，title attribute 提供 tooltip */
.title {
  font-size: 15px;
  color: rgba(231, 233, 245, 0.95);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 字数：数字右对齐，tabular-nums 让多行数字对齐美观 */
.wc {
  color: rgba(231, 233, 245, 0.7);
  font-size: 13px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.time {
  color: rgba(231, 233, 245, 0.5);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

/* 窄屏：折叠掉两个时间列，保留章节号/标题/删除按钮 */
@media (max-width: 960px) {
  .row {
    grid-template-columns: 80px minmax(0, 1fr) 64px;
  }
  .row .wc,
  .row .time {
    display: none;
  }
}
</style>
