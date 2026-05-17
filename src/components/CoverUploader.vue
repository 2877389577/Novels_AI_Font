<!--
  CoverUploader.vue —— 封面图片上传 + 预览组件
  ----------------------------------------------------------------------------
  用 v-model 绑定一个 coverUrl 字符串：
    · 上传成功 → emit 后端返回的 url
    · 点击移除 → emit ''
  视觉：
    · 无封面：虚线占位框，提示「点击或拖拽上传封面」
    · 已有封面：显示图片预览，悬浮显示「更换 / 移除」操作
    · 上传中：占位框上叠加 spinner 与百分比
  约束：
    · 仅接受 image/*
    · 最大 5MB（前端预校验，超限提示并阻止上传）
-->

<script setup>
import { computed, ref } from 'vue'
import { useToast } from 'primevue/usetoast'
import { uploadFile } from '@/api/upload'

const props = defineProps({
  modelValue: { type: String, default: '' }, // 当前 coverUrl
  // 允许业务方覆盖大小上限（字节）；默认 5MB
  maxSize: { type: Number, default: 5 * 1024 * 1024 },
})
const emit = defineEmits(['update:modelValue'])

const toast = useToast()

// ───── 状态 ─────
const inputRef = ref(null)
const uploading = ref(false)
const progress = ref(0) // 0~100
const dragOver = ref(false)

const hasCover = computed(() => Boolean(props.modelValue))

// ───── 选择文件 / 拖拽 ─────
function triggerPick() {
  if (uploading.value) return
  inputRef.value?.click()
}

function onPick(e) {
  const file = e.target.files?.[0]
  // 重置 input 的 value，让用户能反复选择同一个文件触发 change
  e.target.value = ''
  if (file) handleFile(file)
}

function onDrop(e) {
  e.preventDefault()
  dragOver.value = false
  if (uploading.value) return
  const file = e.dataTransfer?.files?.[0]
  if (file) handleFile(file)
}

function onDragOver(e) {
  e.preventDefault()
  if (!uploading.value) dragOver.value = true
}
function onDragLeave() {
  dragOver.value = false
}

// ───── 上传执行 ─────
async function handleFile(file) {
  // 1) 类型校验：拖拽进来的可能不是图片
  if (!file.type.startsWith('image/')) {
    toast.add({ severity: 'warn', summary: '仅支持图片文件', life: 2500 })
    return
  }
  // 2) 大小校验：避免无意义的大文件上传
  if (file.size > props.maxSize) {
    const mb = (props.maxSize / 1024 / 1024).toFixed(1)
    toast.add({ severity: 'warn', summary: `图片不能超过 ${mb}MB`, life: 2500 })
    return
  }

  uploading.value = true
  progress.value = 0
  try {
    const res = await uploadFile(file, (e) => {
      if (e.total) {
        progress.value = Math.round((e.loaded / e.total) * 100)
      }
    })
    if (res?.code === 0 && res.data?.url) {
      emit('update:modelValue', res.data.url)
      toast.add({ severity: 'success', summary: '封面已上传', life: 1800 })
    } else {
      toast.add({
        severity: 'error',
        summary: '上传失败',
        detail: res?.msg || '请稍后重试',
        life: 3000,
      })
    }
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: '上传失败',
      detail: e?.message || '请稍后重试',
      life: 3000,
    })
  } finally {
    uploading.value = false
    progress.value = 0
  }
}

// ───── 移除封面 ─────
function onRemove() {
  if (uploading.value) return
  emit('update:modelValue', '')
}
</script>

<template>
  <!-- 不要在根 div 上加 @click.stop.prevent：
       内部 input.click() 派发的 click 也会冒泡到这里，
       .prevent 会把 input 打开 picker 的 default action 一并取消。
       「弹两次 picker」的 BUG 已由调用方将外层 <label> 改为 <div> 根治。 -->
  <div class="uploader">
    <!-- 隐藏的真正文件 input；用 label/按钮触发 -->
    <input ref="inputRef" type="file" accept="image/*" class="hidden-input" @change="onPick" />

    <!-- 已有封面：显示预览；悬浮显示操作 -->
    <div
      v-if="hasCover && !uploading"
      class="preview"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      :class="{ 'is-drag': dragOver }"
    >
      <img :src="modelValue" alt="封面预览" />
      <div class="overlay">
        <button type="button" class="op" @click="triggerPick">更换</button>
        <button type="button" class="op danger" @click="onRemove">移除</button>
      </div>
    </div>

    <!-- 占位框：未上传 or 正在上传 -->
    <div
      v-else
      class="drop"
      :class="{ 'is-drag': dragOver, 'is-uploading': uploading }"
      role="button"
      tabindex="0"
      @click="triggerPick"
      @keydown.enter.prevent="triggerPick"
      @keydown.space.prevent="triggerPick"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div v-if="uploading" class="uploading">
        <span class="spinner" aria-hidden="true"></span>
        <span class="tip">上传中 {{ progress }}%</span>
      </div>
      <div v-else class="placeholder">
        <span class="icon" aria-hidden="true">＋</span>
        <span class="primary">点击或拖拽上传封面</span>
        <span class="secondary">支持 JPG / PNG，最大 5MB</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.uploader {
  width: 100%;
}
.hidden-input {
  display: none;
}

/* ─── 占位 / 拖拽落区 ─── */
.drop {
  /* 与「书」一致的 3:4 比例缩略尺寸，让上传后视觉无突变 */
  width: 180px;
  aspect-ratio: 3 / 4;
  border-radius: 8px;
  border: 1.5px dashed rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    transform 0.2s ease;
  outline: none;
}
.drop:hover,
.drop:focus-visible {
  border-color: rgba(0, 212, 255, 0.6);
  background: rgba(0, 212, 255, 0.05);
}
.drop.is-drag {
  border-color: rgba(0, 212, 255, 0.9);
  background: rgba(0, 212, 255, 0.1);
  transform: scale(1.01);
}
.drop.is-uploading {
  cursor: progress;
}

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 12px;
  color: rgba(231, 233, 245, 0.55);
}
.placeholder .icon {
  font-size: 28px;
  line-height: 1;
  margin-bottom: 8px;
  color: rgba(231, 233, 245, 0.45);
}
.placeholder .primary {
  font-size: 13px;
  color: rgba(231, 233, 245, 0.8);
  margin-bottom: 4px;
}
.placeholder .secondary {
  font-size: 11px;
  color: rgba(231, 233, 245, 0.45);
}

/* 上传中：spinner + 百分比 */
.uploading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: rgba(231, 233, 245, 0.7);
  font-size: 12px;
}
.spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: #00d4ff;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ─── 已上传：预览 + 悬浮操作 ─── */
.preview {
  position: relative;
  width: 180px;
  aspect-ratio: 3 / 4;
  border-radius: 8px;
  overflow: hidden;
  box-shadow:
    0 12px 28px rgba(0, 0, 0, 0.45),
    inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}
.preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.preview.is-drag {
  outline: 2px solid rgba(0, 212, 255, 0.9);
  outline-offset: 2px;
}
.overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.65) 0%, rgba(0, 0, 0, 0) 60%);
  opacity: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  transition: opacity 0.2s ease;
}
.preview:hover .overlay,
.preview:focus-within .overlay {
  opacity: 1;
}
.op {
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.22);
  color: #fff;
  padding: 5px 12px;
  font-size: 12px;
  border-radius: 6px;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition: background 0.2s ease;
}
.op:hover {
  background: rgba(255, 255, 255, 0.22);
}
.op.danger {
  background: rgba(255, 80, 120, 0.25);
  border-color: rgba(255, 80, 120, 0.5);
}
.op.danger:hover {
  background: rgba(255, 80, 120, 0.4);
}
</style>
