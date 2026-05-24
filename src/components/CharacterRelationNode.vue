<!--
  CharacterRelationNode.vue：角色关系图里的自定义 Vue Flow 节点
  ----------------------------------------------------------------------------
  设计目标：
  1. 只呈现图谱节点必要信息：角色形象、姓名和性别，避免画布过度拥挤。
  2. 左右两侧分别提供 target/source 连接桩，让一对多、多对一关系都能连线。
  3. 没有真实形象图时按性别显示本地默认图，和角色卡列表保持同一视觉语义。
-->

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import maleAvatar from '@/assets/images/默认男性角色图像.png'
import femaleAvatar from '@/assets/images/默认女性角色图像.png'

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, default: () => ({}) },
  selected: { type: Boolean, default: false },
  removing: { type: Boolean, default: false },
})

const emit = defineEmits(['remove'])

function normalizeGender(gender = '') {
  return gender === '女' ? '女' : '男'
}

const displayName = computed(() => props.data?.name || '未命名角色')
const displayGender = computed(() => props.data?.gender || '性别未设定')

const avatarSrc = computed(() => {
  const imageUrl = String(props.data?.appearanceImgUrl || '').trim()
  if (imageUrl) return imageUrl
  return normalizeGender(props.data?.gender) === '女' ? femaleAvatar : maleAvatar
})

const avatarAlt = computed(() => {
  return props.data?.appearanceImgUrl
    ? `${displayName.value}形象图`
    : `${displayName.value}默认形象图`
})
</script>

<template>
  <article class="relation-node" :class="{ selected }" :aria-label="`角色节点：${displayName}`">
    <button
      class="remove-node nodrag nopan"
      type="button"
      :aria-label="`从画布移出 ${displayName}`"
      :disabled="removing"
      @click.stop="emit('remove', id)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>

    <Handle id="target" class="node-handle target-handle" type="target" :position="Position.Left" />

    <div class="node-avatar">
      <img :src="avatarSrc" :alt="avatarAlt" draggable="false" />
    </div>

    <div class="node-copy">
      <strong>{{ displayName }}</strong>
      <span>{{ displayGender }}</span>
    </div>

    <Handle
      id="source"
      class="node-handle source-handle"
      type="source"
      :position="Position.Right"
    />
  </article>
</template>

<style scoped>
.relation-node {
  width: 184px;
  min-height: 74px;
  position: relative;
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid oklch(84% 0.018 255);
  border-radius: 12px;
  background: oklch(99.2% 0.004 255);
  color: oklch(25% 0.04 260);
  box-shadow:
    0 12px 24px oklch(38% 0.045 260 / 0.12),
    0 1px 2px oklch(38% 0.045 260 / 0.08);
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.remove-node {
  position: absolute;
  top: -10px;
  right: -10px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid oklch(84% 0.065 24);
  border-radius: 50%;
  background: oklch(99% 0.004 255);
  color: oklch(55% 0.22 25);
  cursor: pointer;
  opacity: 0;
  transform: scale(0.92);
  transition:
    opacity 0.16s ease,
    transform 0.16s ease,
    background 0.16s ease,
    border-color 0.16s ease;
  box-shadow: 0 8px 16px oklch(38% 0.05 260 / 0.16);
}

.relation-node:hover .remove-node,
.relation-node.selected .remove-node,
.remove-node:focus-visible {
  opacity: 1;
  transform: scale(1);
}

.remove-node:hover {
  border-color: oklch(68% 0.16 24);
  background: oklch(96% 0.022 24);
}

.remove-node:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.remove-node svg {
  width: 0.95rem;
  height: 0.95rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.remove-node:focus-visible {
  outline: 3px solid oklch(76% 0.14 250 / 0.55);
  outline-offset: 2px;
}

.relation-node:hover,
.relation-node.selected {
  border-color: oklch(62% 0.15 255);
  box-shadow:
    0 16px 32px oklch(42% 0.08 255 / 0.16),
    0 0 0 3px oklch(78% 0.13 255 / 0.22);
}

.relation-node.selected {
  transform: translateY(-1px);
}

.node-avatar {
  width: 46px;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: 9px;
  background: oklch(93% 0.012 255);
  box-shadow: inset 0 0 0 1px oklch(100% 0 0 / 0.7);
}

.node-avatar img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  user-select: none;
}

.node-copy {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.node-copy strong {
  color: oklch(24% 0.04 260);
  font-size: 0.95rem;
  line-height: 1.25;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.node-copy span {
  color: oklch(48% 0.032 260);
  font-size: 0.78rem;
  font-weight: 720;
}

.node-handle {
  width: 12px;
  height: 12px;
  border: 2px solid oklch(99% 0.004 255);
  background: oklch(54% 0.18 258);
  box-shadow: 0 4px 10px oklch(42% 0.08 255 / 0.24);
}

.target-handle {
  left: -6px;
}

.source-handle {
  right: -6px;
}

@media (prefers-reduced-motion: reduce) {
  .relation-node {
    transition-duration: 0.01ms;
  }

  .relation-node.selected {
    transform: none;
  }
}
</style>
