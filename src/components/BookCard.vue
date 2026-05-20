<!--
  BookCard.vue：书架网格中的单本小说卡片
  ----------------------------------------------------------------------------
  设计目标：
  1. 按书架设计稿呈现为扁平白色卡片，不再使用深色 3D 书本效果。
  2. 上方展示竖向小说封面，下方展示书名、作者和三点入口。
  3. 整张卡片可点击进入详情；三点按钮暂不展开菜单，点击同样进入详情，避免伪造未设计的菜单功能。
-->

<script setup>
import { computed } from 'vue'

const props = defineProps({
  novel: { type: Object, required: true },
})

const emit = defineEmits(['click'])

// 无封面时使用稳定渐变兜底，让同一本小说每次刷新都有一致的默认封面。
const GRADIENTS = [
  ['oklch(58% 0.19 276)', 'oklch(68% 0.16 225)'],
  ['oklch(66% 0.19 344)', 'oklch(57% 0.2 279)'],
  ['oklch(74% 0.16 67)', 'oklch(64% 0.2 13)'],
  ['oklch(72% 0.15 161)', 'oklch(64% 0.16 215)'],
  ['oklch(82% 0.17 91)', 'oklch(64% 0.2 18)'],
  ['oklch(57% 0.15 230)', 'oklch(32% 0.08 236)'],
  ['oklch(55% 0.22 294)', 'oklch(61% 0.18 252)'],
  ['oklch(60% 0.22 354)', 'oklch(67% 0.2 44)'],
]

function pickGradient(title) {
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) & 0x7fffffff
  }
  return GRADIENTS[hash % GRADIENTS.length]
}

const hasCover = computed(() => Boolean(props.novel?.coverUrl))
const displayTitle = computed(() => props.novel?.title || '未命名')
const displayAuthor = computed(() => props.novel?.authorName || '佚名')
const gradient = computed(() => {
  const [a, b] = pickGradient(displayTitle.value)
  return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`
})

function openDetail() {
  emit('click', props.novel)
}
</script>

<template>
  <article
    class="book-card"
    tabindex="0"
    :title="displayTitle"
    @click="openDetail"
    @keydown.enter="openDetail"
    @keydown.space.prevent="openDetail"
  >
    <div class="cover" :style="!hasCover ? { background: gradient } : null">
      <img v-if="hasCover" :src="novel.coverUrl" :alt="`${displayTitle}封面`" loading="lazy" />
      <div v-else class="fallback">
        <strong>{{ displayTitle }}</strong>
        <span>{{ displayAuthor }}</span>
      </div>
    </div>

    <footer class="meta">
      <div class="copy">
        <h3>{{ displayTitle }}</h3>
        <p>{{ displayAuthor }}</p>
      </div>

      <button
        class="more-button"
        type="button"
        :aria-label="`查看《${displayTitle}》详情`"
        @click.stop="openDetail"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="6" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="18" cy="12" r="1.5" />
        </svg>
      </button>
    </footer>
  </article>
</template>

<style scoped>
.book-card {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid oklch(89% 0.01 255);
  border-radius: 8px;
  background: oklch(99.4% 0.003 255);
  box-shadow:
    0 14px 34px oklch(42% 0.035 260 / 0.08),
    0 1px 2px oklch(42% 0.035 260 / 0.06);
  cursor: pointer;
  outline: none;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.book-card:hover,
.book-card:focus-visible {
  border-color: oklch(78% 0.04 255);
  box-shadow:
    0 18px 42px oklch(42% 0.035 260 / 0.13),
    0 1px 2px oklch(42% 0.035 260 / 0.08);
  transform: translateY(-2px);
}

.book-card:focus-visible,
.more-button:focus-visible {
  outline: 3px solid oklch(76% 0.14 250 / 0.55);
  outline-offset: 3px;
}

.cover {
  position: relative;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  background: oklch(93% 0.012 255);
}

.cover img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.fallback {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 20px;
  color: oklch(98% 0.006 255);
  text-align: center;
}

.fallback strong {
  max-width: 8em;
  font-size: 1.35rem;
  line-height: 1.25;
  font-weight: 780;
  text-wrap: balance;
}

.fallback span {
  max-width: 10em;
  font-size: 0.82rem;
  opacity: 0.84;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta {
  min-height: 88px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px;
  align-items: end;
  gap: 12px;
  padding: 16px 18px 18px;
  border-top: 1px solid oklch(91% 0.008 255);
}

.copy {
  min-width: 0;
}

.copy h3 {
  margin: 0;
  color: oklch(22% 0.02 260);
  font-size: 1rem;
  line-height: 1.35;
  font-weight: 720;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.copy p {
  margin: 8px 0 0;
  color: oklch(52% 0.026 260);
  font-size: 0.9rem;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.more-button {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  justify-self: end;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: oklch(52% 0.026 260);
  cursor: pointer;
  transition:
    background 0.18s ease,
    color 0.18s ease;
}

.more-button:hover {
  background: oklch(95% 0.008 255);
  color: oklch(26% 0.02 260);
}

.more-button svg {
  width: 1.25rem;
  height: 1.25rem;
  fill: currentColor;
}
</style>
