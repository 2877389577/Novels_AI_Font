<!--
  BookCard.vue —— 书架上的单本「书」组件
  ----------------------------------------------------------------------------
  视觉目标：让小说以「立体书本」的形态站在书架上，而不是普通卡片。
    · 左侧用一条深色窄条作为「书脊」，主体作为「封面」
    · 顶部一道高光线模拟书的边缘
    · 悬浮时上抬 + 阴影变重，反馈"可点击"
  封面策略：
    · 有 coverUrl 时直接显示封面图
    · 无 coverUrl 时用「书名 + 根据书名 hash 选定的渐变色」作为默认封面，
      让书架视觉丰富，同时避免找不到图就一片空白
-->

<script setup>
import { computed } from 'vue'

const props = defineProps({
  novel: { type: Object, required: true },
})
defineEmits(['click'])

// 预设几组渐变作为「默认封面」配色，让书架上的书五颜六色
const GRADIENTS = [
  ['#7b6cff', '#00d4ff'],
  ['#ff8fd1', '#7b6cff'],
  ['#ffb86b', '#ff5e8a'],
  ['#3ed5a1', '#1fb6d6'],
  ['#ffd166', '#ef476f'],
  ['#118ab2', '#073b4c'],
  ['#8338ec', '#3a86ff'],
  ['#ff006e', '#fb5607'],
]

// 用书名做简单 hash 选定一组渐变，保证同一本书每次刷新颜色稳定
function pickGradient(title) {
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) & 0x7fffffff
  }
  return GRADIENTS[hash % GRADIENTS.length]
}

const hasCover = computed(() => Boolean(props.novel?.coverUrl))
const gradient = computed(() => {
  const [a, b] = pickGradient(props.novel?.title || '未命名')
  return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`
})

// 默认封面里展示的「标题」：完整书名；CSS 处理换行省略
const displayTitle = computed(() => props.novel?.title || '未命名')
</script>

<template>
  <!-- v-pointer-glow.tilt：让每本书 hover 时按鼠标位置 3D 倾斜，
       同时 .cover::after 用 --gx/--gy 做一道跟随的高光，强化「拿在手里翻」的质感。 -->
  <article
    v-pointer-glow.tilt="{ maxTilt: 10 }"
    class="book"
    tabindex="0"
    :title="novel?.title"
    @click="$emit('click', novel)"
  >
    <!-- 书脊：左侧一条深色窄条，配合 box-shadow 营造立体厚度 -->
    <span class="spine" aria-hidden="true"></span>

    <!-- 封面：有 coverUrl 用图片，否则渐变 + 居中书名 -->
    <div class="cover" :style="!hasCover ? { background: gradient } : null">
      <img v-if="hasCover" :src="novel.coverUrl" :alt="novel.title" loading="lazy" />
      <div v-else class="fallback">
        <p class="fallback-title">{{ displayTitle }}</p>
        <p v-if="novel?.authorName" class="fallback-author">{{ novel.authorName }}</p>
      </div>
      <!-- 顶部高光：模拟书边缘反光 -->
      <span class="gloss" aria-hidden="true"></span>
    </div>

    <!-- 书本底部：书名 + 作者，永远展示，方便有封面时也能看清楚 -->
    <footer class="meta">
      <p class="title">{{ novel?.title }}</p>
      <p v-if="novel?.authorName" class="author">{{ novel.authorName }}</p>
    </footer>
  </article>
</template>

<style scoped>
.book {
  /* 让整本书包括书脊都参与点击 */
  position: relative;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  outline: none;
  /* 给「书」一个 3D 透视舞台；600px 是 3:4 比例书本较自然的视距 */
  perspective: 600px;
  transition:
    transform 0.25s ease,
    filter 0.25s ease;
}

/* 书脊：absolute 定位在封面左侧，制造厚度幻觉 */
.spine {
  position: absolute;
  left: -6px;
  top: 6px;
  bottom: 36px; /* 给底部 meta 让出位置 */
  width: 8px;
  border-radius: 2px 0 0 2px;
  background: linear-gradient(to right, #1a1d36 0%, #2a2e52 70%, #353a66 100%);
  box-shadow: inset -1px 0 0 rgba(0, 0, 0, 0.4);
  z-index: 0;
}

.cover {
  position: relative;
  aspect-ratio: 3 / 4; /* 书的标准比例，避免不同封面图尺寸破坏栅格 */
  border-radius: 4px 8px 8px 4px;
  overflow: hidden;
  background: #1a1d36;
  box-shadow:
    0 10px 24px rgba(0, 0, 0, 0.45),
    inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  z-index: 1; /* 盖在书脊上方 */
  /* 3D 倾斜：tilt 变量由 v-pointer-glow.tilt 写入，默认 0deg。
     transform-style 与父级 perspective 配合形成立体；
     translateZ(0) 把 cover 提升为合成层，防止子元素抗锯齿抖动。 */
  transform: rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg)) translateZ(0);
  transform-style: preserve-3d;
  transition:
    transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1),
    box-shadow 0.25s ease;
}
/* 封面表面跟随指针的高光：radial-gradient 圆心绑定 --gx/--gy。
   overlay 混合模式让高光与底图颜色发生关系，而不是死白覆盖。
   hover 才显形，避免书架上一堆书永远「自带聚光灯」的卡通感。 */
.cover::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    140px circle at var(--gx, 50%) var(--gy, 50%),
    rgba(255, 255, 255, 0.28) 0%,
    rgba(255, 255, 255, 0.08) 35%,
    transparent 65%
  );
  mix-blend-mode: overlay;
  opacity: 0;
  transition: opacity 0.25s ease;
  pointer-events: none;
  z-index: 2;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* 无封面时的默认渲染：渐变底 + 居中书名 */
.fallback {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 14px;
  color: #fff;
  text-align: center;
}
.fallback-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.35;
  letter-spacing: 0.02em;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  /* 最多三行省略 */
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.fallback-author {
  margin: 10px 0 0;
  font-size: 11px;
  opacity: 0.85;
  letter-spacing: 0.06em;
}

/* 顶部一道半透明高光，制造书边缘反光 */
.gloss {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0.18) 0%,
    rgba(255, 255, 255, 0) 30%,
    rgba(255, 255, 255, 0) 70%,
    rgba(0, 0, 0, 0.2) 100%
  );
  pointer-events: none;
}

.meta {
  margin-top: 10px;
  text-align: center;
  /* 与 spine bottom:36px 对应，给 meta 留出空间 */
  min-height: 36px;
}
.title {
  margin: 0;
  font-size: 13px;
  color: rgba(231, 233, 245, 0.92);
  line-height: 1.4;
  /* 两行省略 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.author {
  margin: 2px 0 0;
  font-size: 11px;
  color: rgba(231, 233, 245, 0.5);
  letter-spacing: 0.04em;
}

.book:hover,
.book:focus-visible {
  transform: translateY(-6px);
  filter: brightness(1.08);
}
.book:hover .cover,
.book:focus-visible .cover {
  box-shadow:
    0 22px 44px rgba(0, 0, 0, 0.6),
    inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}
/* 鼠标进入封面时显形跟随光斑 */
.book:hover .cover::after,
.book:focus-visible .cover::after {
  opacity: 1;
}
</style>
