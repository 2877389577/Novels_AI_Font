<!--
  GeneratedCharacterCardsDialog.vue：AI 生成角色卡结果弹窗
  ----------------------------------------------------------------------------
  设计目标：
  1. 只承载本次生成结果预览，不把结果写入现有角色卡列表。
  2. 生成中用轻量骨架和旋转状态表达等待，避免用户误以为页面卡死。
  3. 结果卡片仅展示默认头像和姓名，点击头像后在同一弹窗内查看接口返回的完整字段。
-->

<script setup>
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'
import { createCharacter } from '@/api/character'
import maleAvatar from '@/assets/images/默认男性角色图像.png'
import femaleAvatar from '@/assets/images/默认女性角色图像.png'

const props = defineProps({
  visible: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  cards: { type: Array, default: () => [] },
  chapter: { type: Object, default: null },
  modelName: { type: String, default: '' },
  novelId: { type: Number, default: 0 },
})

const emit = defineEmits(['update:visible', 'retry'])

const toast = useToast()
const selectedCard = ref(null)
const selectedCardKey = ref('')
const pressedKey = ref('')
const savingKey = ref('')
const savedCardKeys = ref(new Set())

const dialogVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value),
})

const chapterTitle = computed(() => {
  if (!props.chapter) return ''
  const no = props.chapter.chapterNo ? `第 ${props.chapter.chapterNo} 章` : '当前章节'
  return props.chapter.title ? `${no}《${props.chapter.title}》` : no
})

const detailFields = computed(() => {
  const card = selectedCard.value
  if (!card) return []
  return [
    ['姓名', card.name],
    ['性别', card.gender],
    ['角色介绍', card.intro],
    ['外貌', card.appearance],
    ['性格', card.personality],
    ['能力', card.ability],
  ]
})

const firstAppearanceLabel = computed(() => {
  if (!props.chapter) return '当前章节'
  return props.chapter.chapterNo ? `第 ${props.chapter.chapterNo} 章` : '当前章节'
})

const isSavingSelectedCard = computed(() => {
  return Boolean(selectedCardKey.value) && savingKey.value === selectedCardKey.value
})

const isSelectedCardSaved = computed(() => {
  return Boolean(selectedCardKey.value) && savedCardKeys.value.has(selectedCardKey.value)
})

const saveButtonText = computed(() => {
  if (isSavingSelectedCard.value) return '保存中'
  if (isSelectedCardSaved.value) return '已保存'
  return '保存角色卡'
})

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      selectedCard.value = null
      selectedCardKey.value = ''
      pressedKey.value = ''
      savingKey.value = ''
      savedCardKeys.value = new Set()
    }
  },
)

watch(
  () => props.cards,
  () => {
    selectedCard.value = null
    selectedCardKey.value = ''
    savingKey.value = ''
    savedCardKeys.value = new Set()
  },
)

function normalizeGender(gender = '') {
  return gender === '女' ? '女' : '男'
}

function avatarOf(card = {}) {
  return normalizeGender(card.gender) === '女' ? femaleAvatar : maleAvatar
}

function cardName(card = {}) {
  return card.name?.trim() || '未命名角色'
}

function cardKey(card = {}, index) {
  return `${cardName(card)}-${index}`
}

function cardStyle(index) {
  // 用 CSS 变量控制入场延迟，避免在模板里写散落的内联动画值。
  return { '--delay': `${Math.min(index, 8) * 42}ms` }
}

function openDetail(card, index) {
  const key = cardKey(card, index)
  pressedKey.value = key
  selectedCard.value = card
  selectedCardKey.value = key
  window.setTimeout(() => {
    if (pressedKey.value === key) pressedKey.value = ''
  }, 150)
}

function textOrFallback(value) {
  return String(value || '').trim() || '暂未返回'
}

function buildSavePayload(card = {}) {
  // 生成接口返回的是角色卡预览；保存时只提交后端角色表需要的业务字段。
  // 默认形象图只是前端占位资源，不写入 appearanceImgUrl，避免后续被误认为真实角色图片。
  const payload = {
    name: cardName(card),
    gender: normalizeGender(card.gender),
    status: 1,
    intro: String(card.intro || '').trim(),
    appearance: String(card.appearance || '').trim(),
    personality: String(card.personality || '').trim(),
    ability: String(card.ability || '').trim(),
  }

  // 这里字段名沿用后端的 firstAppearanceChapterId，但实际业务保存的是“第几章出现”。
  // 不能传章节表主键 props.chapter.id，否则第 1 章的数据库 ID 为 3 时会被误存为“第 3 章”。
  const firstChapterNo = Number(props.chapter?.chapterNo)
  if (Number.isFinite(firstChapterNo) && firstChapterNo > 0) {
    payload.firstAppearanceChapterId = firstChapterNo
  }

  return payload
}

async function saveSelectedCard() {
  if (!selectedCard.value || !selectedCardKey.value || isSavingSelectedCard.value) return
  if (isSelectedCardSaved.value) return

  if (!props.novelId) {
    toast.add({
      severity: 'warn',
      summary: '无法保存',
      detail: '缺少小说 ID，无法创建角色卡。',
      life: 3000,
    })
    return
  }

  const targetKey = selectedCardKey.value
  const payload = buildSavePayload(selectedCard.value)
  if (!payload.firstAppearanceChapterId) {
    toast.add({
      severity: 'warn',
      summary: '无法保存',
      detail: '缺少首次出现章节号，无法创建角色卡。',
      life: 3000,
    })
    return
  }

  savingKey.value = targetKey
  try {
    const res = await createCharacter(props.novelId, payload)
    if (res?.code === 0) {
      const nextSavedKeys = new Set(savedCardKeys.value)
      nextSavedKeys.add(targetKey)
      savedCardKeys.value = nextSavedKeys
      toast.add({ severity: 'success', summary: '角色卡已保存', life: 2000 })
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
    if (savingKey.value === targetKey) savingKey.value = ''
  }
}
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    header="生成角色卡"
    :modal="true"
    :draggable="false"
    :closable="!loading"
    :style="{ width: '980px', maxWidth: 'calc(100vw - 32px)' }"
    class="generated-character-dialog"
  >
    <section class="generated-shell" aria-live="polite">
      <header class="result-head">
        <div>
          <p v-if="chapterTitle">{{ chapterTitle }}</p>
          <h3>{{ modelName || '未选择模型' }}</h3>
        </div>
        <span v-if="loading" class="run-pill">生成中</span>
        <span v-else-if="cards.length > 0" class="run-pill done">已完成</span>
      </header>

      <div v-if="loading" class="loading-panel">
        <div class="loading-copy">
          <span class="spinner" aria-hidden="true"></span>
          <span>正在生成角色卡...</span>
        </div>

        <div class="card-skeleton-grid" aria-hidden="true">
          <div v-for="i in 4" :key="i" class="card-skeleton">
            <span></span>
            <strong></strong>
          </div>
        </div>
      </div>

      <div v-else-if="error" class="result-state error">
        <h4>生成失败</h4>
        <p>{{ error }}</p>
        <button type="button" @click="emit('retry')">重试</button>
      </div>

      <div v-else-if="cards.length === 0" class="result-state">
        <h4>未生成角色卡</h4>
        <p>当前章节没有返回可展示的角色信息。</p>
      </div>

      <div v-else class="result-layout" :class="{ 'has-detail': selectedCard }">
        <TransitionGroup name="card-pop" tag="div" class="generated-grid" role="list">
          <article
            v-for="(card, index) in cards"
            :key="cardKey(card, index)"
            class="generated-card"
            :style="cardStyle(index)"
            role="listitem"
          >
            <button
              class="portrait-button"
              type="button"
              :class="{ pressed: pressedKey === cardKey(card, index) }"
              :aria-label="`查看 ${cardName(card)} 详情`"
              @click="openDetail(card, index)"
            >
              <img :src="avatarOf(card)" :alt="`${cardName(card)}默认形象`" />
            </button>
            <h4>{{ cardName(card) }}</h4>
          </article>
        </TransitionGroup>

        <Transition name="detail-slide">
          <aside v-if="selectedCard" class="generated-detail" aria-label="角色详情">
            <header>
              <div class="detail-avatar">
                <img :src="avatarOf(selectedCard)" :alt="`${cardName(selectedCard)}默认形象`" />
                <span>图片为默认图片</span>
              </div>
              <div>
                <p>角色详情</p>
                <h4>{{ cardName(selectedCard) }}</h4>
                <span class="first-appearance">首次出现：{{ firstAppearanceLabel }}</span>
                <button
                  class="save-character-button"
                  type="button"
                  :disabled="isSavingSelectedCard || isSelectedCardSaved"
                  @click="saveSelectedCard"
                >
                  {{ saveButtonText }}
                </button>
              </div>
            </header>

            <dl>
              <div v-for="[label, value] in detailFields" :key="label">
                <dt>{{ label }}</dt>
                <dd>{{ textOrFallback(value) }}</dd>
              </div>
            </dl>
          </aside>
        </Transition>
      </div>
    </section>
  </Dialog>
</template>

<style scoped>
.generated-shell {
  min-height: 420px;
  color: oklch(26% 0.035 260);
}

.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding-bottom: 18px;
  border-bottom: 1px solid oklch(91% 0.01 255);
}

.result-head p {
  margin: 0 0 6px;
  color: oklch(52% 0.032 260);
  font-size: 0.82rem;
  font-weight: 760;
}

.result-head h3 {
  margin: 0;
  color: oklch(24% 0.04 260);
  font-size: 1.25rem;
  line-height: 1.2;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.run-pill {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  padding: 0 11px;
  border-radius: 999px;
  background: oklch(94% 0.018 255);
  color: oklch(48% 0.16 255);
  font-size: 0.78rem;
  font-weight: 780;
  white-space: nowrap;
}

.run-pill.done {
  background: oklch(93% 0.026 150);
  color: oklch(41% 0.13 150);
}

.loading-panel {
  display: grid;
  gap: 22px;
  padding-top: 28px;
}

.loading-copy {
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 12px;
  color: oklch(48% 0.035 260);
  font-size: 0.94rem;
}

.spinner {
  width: 22px;
  height: 22px;
  border: 2px solid oklch(84% 0.02 255);
  border-top-color: oklch(54% 0.18 258);
  border-radius: 50%;
  animation: spin 0.82s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.card-skeleton-grid,
.generated-grid {
  display: grid;
  gap: 16px;
}

.card-skeleton-grid {
  /* loading 固定展示 4 个占位卡，等分容器宽度，避免 auto-fill 预留空轨道造成右侧留白。 */
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.generated-grid {
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
}

.card-skeleton,
.generated-card {
  min-height: 230px;
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 14px;
  border: 1px solid oklch(88% 0.012 255);
  border-radius: 12px;
  background: oklch(99% 0.004 255);
}

.card-skeleton span,
.card-skeleton strong {
  border-radius: 10px;
  background: linear-gradient(
    90deg,
    oklch(92% 0.01 255) 0%,
    oklch(97% 0.006 255) 50%,
    oklch(92% 0.01 255) 100%
  );
  background-size: 200% 100%;
  animation: shine 1.18s linear infinite;
}

.card-skeleton span {
  aspect-ratio: 3 / 4;
}

.card-skeleton strong {
  width: 70%;
  height: 18px;
}

@keyframes shine {
  to {
    background-position: -200% 0;
  }
}

.result-state {
  min-height: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 34px;
  text-align: center;
}

.result-state h4 {
  margin: 0;
  color: oklch(28% 0.04 260);
  font-size: 1.15rem;
}

.result-state p {
  max-width: 34rem;
  margin: 0;
  color: oklch(50% 0.03 260);
  line-height: 1.7;
}

.result-state.error {
  color: oklch(55% 0.2 25);
}

.result-state button {
  min-height: 38px;
  padding: 0 16px;
  border: 1px solid oklch(82% 0.026 255);
  border-radius: 8px;
  background: oklch(98% 0.012 255);
  color: oklch(48% 0.16 255);
  font: inherit;
  font-weight: 760;
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    transform 0.18s ease;
}

.result-state button:hover {
  border-color: oklch(70% 0.08 255);
  background: oklch(95% 0.022 255);
  transform: translateY(-1px);
}

.result-layout {
  display: grid;
  gap: 18px;
  padding-top: 24px;
}

.result-layout.has-detail {
  grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
  align-items: start;
}

.generated-card {
  box-shadow: 0 10px 24px oklch(42% 0.04 260 / 0.08);
}

.portrait-button {
  width: 100%;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border: 0;
  border-radius: 10px;
  background: oklch(93% 0.012 255);
  box-shadow:
    0 12px 24px oklch(38% 0.055 260 / 0.14),
    inset 0 0 0 1px oklch(100% 0 0 / 0.72);
  cursor: pointer;
  transform-origin: center;
  transition:
    box-shadow 0.18s ease,
    transform 0.14s cubic-bezier(0.25, 1, 0.5, 1);
}

.portrait-button:hover,
.portrait-button:focus-visible {
  outline: none;
  box-shadow:
    0 16px 30px oklch(38% 0.055 260 / 0.18),
    0 0 0 3px oklch(76% 0.14 250 / 0.42);
  transform: translateY(-1px);
}

.portrait-button:active,
.portrait-button.pressed {
  transform: scale(0.975);
}

.portrait-button img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.generated-card h4 {
  margin: 0;
  color: oklch(26% 0.04 260);
  font-size: 1rem;
  line-height: 1.3;
  font-weight: 800;
  text-align: center;
  overflow-wrap: anywhere;
}

.generated-detail {
  position: sticky;
  top: 12px;
  max-height: min(560px, calc(100vh - 240px));
  display: grid;
  gap: 18px;
  padding: 18px;
  border: 1px solid oklch(88% 0.012 255);
  border-radius: 14px;
  background: oklch(98.5% 0.006 255);
  box-shadow: 0 12px 30px oklch(42% 0.04 260 / 0.1);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  /* 详情内容仍可滚动，但隐藏原生滚动条，避免破坏右侧档案卡的视觉完整性。 */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.generated-detail::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.generated-detail header {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  padding-bottom: 14px;
  border-bottom: 1px solid oklch(89% 0.012 255);
}

.detail-avatar {
  display: grid;
  gap: 7px;
  justify-items: center;
}

.detail-avatar img {
  width: 74px;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border-radius: 9px;
  box-shadow: 0 10px 22px oklch(38% 0.055 260 / 0.14);
}

.detail-avatar span {
  max-width: 88px;
  color: oklch(52% 0.032 260);
  font-size: 0.7rem;
  line-height: 1.25;
  font-weight: 760;
  text-align: center;
}

.generated-detail header p {
  margin: 0 0 5px;
  color: oklch(54% 0.03 260);
  font-size: 0.76rem;
  font-weight: 780;
}

.generated-detail header h4 {
  margin: 0;
  color: oklch(24% 0.04 260);
  font-size: 1.28rem;
  line-height: 1.2;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.first-appearance {
  margin-top: 8px;
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 9px;
  border-radius: 999px;
  background: oklch(94% 0.018 255);
  color: oklch(45% 0.14 255);
  font-size: 0.76rem;
  font-weight: 780;
}

.save-character-button {
  width: 100%;
  min-height: 38px;
  margin-top: 12px;
  border: 1px solid oklch(76% 0.08 255);
  border-radius: 9px;
  background: oklch(97% 0.018 255);
  color: oklch(48% 0.17 258);
  font: inherit;
  font-size: 0.88rem;
  font-weight: 800;
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.save-character-button:hover:not(:disabled),
.save-character-button:focus-visible {
  outline: none;
  border-color: oklch(60% 0.16 258);
  background: oklch(94% 0.032 255);
  box-shadow: 0 9px 20px oklch(48% 0.1 255 / 0.13);
  transform: translateY(-1px);
}

.save-character-button:disabled {
  cursor: not-allowed;
  border-color: oklch(84% 0.018 255);
  background: oklch(94.5% 0.008 255);
  color: oklch(52% 0.03 260);
  box-shadow: none;
  transform: none;
}

.generated-detail dl {
  display: grid;
  gap: 0;
  margin: 0;
}

.generated-detail dl div {
  display: grid;
  gap: 6px;
  padding: 13px 0;
  border-bottom: 1px solid oklch(90% 0.01 255);
}

.generated-detail dl div:first-child {
  padding-top: 0;
}

.generated-detail dl div:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.generated-detail dt {
  color: oklch(43% 0.15 255);
  font-size: 0.82rem;
  font-weight: 860;
  letter-spacing: 0.02em;
}

.generated-detail dd {
  margin: 0;
  color: oklch(31% 0.032 260);
  font-size: 0.94rem;
  line-height: 1.7;
  white-space: pre-wrap;
}

.card-pop-enter-active {
  transition:
    opacity 0.24s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
  transition-delay: var(--delay);
}

.card-pop-enter-from {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}

.card-pop-leave-active,
.detail-slide-enter-active,
.detail-slide-leave-active {
  transition:
    opacity 0.18s cubic-bezier(0.25, 1, 0.5, 1),
    transform 0.18s cubic-bezier(0.25, 1, 0.5, 1);
}

.card-pop-leave-to,
.detail-slide-enter-from,
.detail-slide-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

:global(.p-dialog-mask:has(.generated-character-dialog)) {
  background: oklch(20% 0.035 260 / 0.28);
  backdrop-filter: blur(3px);
}

:global(.generated-character-dialog.p-dialog) {
  overflow: hidden;
  border: 1px solid oklch(87% 0.014 255);
  border-radius: 16px;
  background: oklch(99.2% 0.004 255);
  color: oklch(26% 0.035 260);
  box-shadow:
    0 24px 70px oklch(34% 0.045 260 / 0.22),
    0 1px 2px oklch(34% 0.045 260 / 0.1);
}

:global(.generated-character-dialog .p-dialog-header),
:global(.generated-character-dialog .p-dialog-content),
:global(.generated-character-dialog .p-dialog-footer) {
  background: oklch(99.2% 0.004 255);
  color: oklch(24% 0.035 260);
}

:global(.generated-character-dialog .p-dialog-header) {
  padding: 22px 24px 16px;
  border-bottom: 1px solid oklch(91% 0.01 255);
}

:global(.generated-character-dialog .p-dialog-title) {
  font-size: 1.125rem;
  font-weight: 760;
}

:global(.generated-character-dialog .p-dialog-content) {
  padding: 22px 24px 24px;
}

:global(.generated-character-dialog .p-dialog-header-icon) {
  color: oklch(42% 0.035 260);
}

:global(.generated-character-dialog .p-dialog-header-icon:hover) {
  background: oklch(94% 0.014 255);
  color: oklch(48% 0.18 258);
}

@media (max-width: 820px) {
  .result-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .card-skeleton-grid,
  .generated-grid,
  .result-layout.has-detail {
    grid-template-columns: 1fr;
  }

  .generated-card {
    max-width: 240px;
    width: 100%;
    justify-self: center;
  }

  .generated-detail {
    position: static;
    max-height: min(520px, calc(100vh - 220px));
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner,
  .card-skeleton span,
  .card-skeleton strong {
    animation-duration: 0.01ms;
    animation-iteration-count: 1;
  }

  .card-pop-enter-active,
  .card-pop-leave-active,
  .detail-slide-enter-active,
  .detail-slide-leave-active,
  .portrait-button,
  .save-character-button,
  .result-state button {
    transition-duration: 0.01ms;
    transition-delay: 0ms;
  }

  .card-pop-enter-from,
  .card-pop-leave-to,
  .detail-slide-enter-from,
  .detail-slide-leave-to,
  .portrait-button:hover,
  .portrait-button:active,
  .portrait-button.pressed,
  .save-character-button:hover:not(:disabled) {
    transform: none;
  }
}
</style>
