<!--
  NovelDetailView.vue —— 小说详情 / 编辑 / 删除
  ----------------------------------------------------------------------------
  · 进入路由后立即按 props.id 拉详情
  · 左侧渲染书本预览（与 BookCard 风格一致）
  · 右侧表单允许修改 title / authorName / coverUrl / intro，
    保存调用 PUT /novels/update（按 OAS 字面路径，id 放 body 内）
  · 删除走 PrimeVue ConfirmDialog 二次确认，避免误删
  · 操作结果用 Toast 反馈
-->

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import { deleteNovel, getNovel, updateNovel } from '@/api/novel'
import CoverUploader from '@/components/CoverUploader.vue'

const props = defineProps({
  id: { type: Number, required: true },
})

const router = useRouter()
const confirm = useConfirm()
const toast = useToast()

// ───── 状态 ─────
const novel = ref(null) // 后端返回的原始数据
const loading = ref(true)
const loadError = ref('') // 加载阶段错误（如 404）
const saving = ref(false)
const deleting = ref(false)

// 编辑表单：与原始数据解耦，「取消」时可恢复
const form = reactive({
  title: '',
  authorName: '',
  coverUrl: '',
  intro: '',
})

// 同样的渐变池（与 BookCard 保持视觉一致）
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
function pickGradient(title = '') {
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) & 0x7fffffff
  }
  return GRADIENTS[hash % GRADIENTS.length]
}
const gradient = computed(() => {
  const [a, b] = pickGradient(novel.value?.title || form.title)
  return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`
})

// 是否有任何字段被改过：决定「保存」是否可点
const dirty = computed(() => {
  const n = novel.value
  if (!n) return false
  return (
    form.title !== (n.title || '') ||
    form.authorName !== (n.authorName || '') ||
    form.coverUrl !== (n.coverUrl || '') ||
    form.intro !== (n.intro || '')
  )
})

// 将后端数据同步到表单
function syncForm(n) {
  form.title = n?.title || ''
  form.authorName = n?.authorName || ''
  form.coverUrl = n?.coverUrl || ''
  form.intro = n?.intro || ''
}

// 拉详情
async function fetchDetail() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await getNovel(props.id)
    if (res?.code === 0 && res.data) {
      novel.value = res.data
      syncForm(res.data)
    } else {
      loadError.value = res?.msg || '加载失败'
    }
  } catch (e) {
    // 404 表示「小说不存在」，单独提示
    loadError.value = e?.status === 404 ? '小说不存在或已被删除' : e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

// 路由参数变化（理论上不会，但保留以防万一通过编程式 push 复用页面）
watch(
  () => props.id,
  () => fetchDetail(),
)
onMounted(fetchDetail)

// 保存：把表单字段连同 id 一起 PUT 给后端
async function onSave() {
  if (!dirty.value || saving.value) return
  const title = form.title.trim()
  if (!title) {
    toast.add({ severity: 'warn', summary: '书名不能为空', life: 2500 })
    return
  }
  saving.value = true
  try {
    const payload = {
      id: novel.value.id,
      title,
      authorName: form.authorName.trim(),
      coverUrl: form.coverUrl.trim(),
      intro: form.intro.trim(),
    }
    const res = await updateNovel(payload)
    if (res?.code === 0) {
      // 用后端返回的最新数据回填，避免本地与服务端出现微妙差异
      novel.value = res.data || { ...novel.value, ...payload }
      syncForm(novel.value)
      toast.add({ severity: 'success', summary: '已保存', life: 2000 })
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

// 删除：弹 ConfirmDialog 二次确认，确认后才真删
function onDelete() {
  if (deleting.value || !novel.value) return
  confirm.require({
    header: '确认删除',
    message: `确定要删除《${novel.value.title}》吗？此操作不可撤销。`,
    acceptLabel: '删除',
    rejectLabel: '取消',
    acceptClass: 'p-button-danger',
    accept: async () => {
      deleting.value = true
      try {
        const res = await deleteNovel(novel.value.id)
        if (res?.code === 0) {
          toast.add({ severity: 'success', summary: '已删除', life: 2000 })
          // 删完回书架
          router.replace({ name: 'shelf' })
        } else {
          toast.add({
            severity: 'error',
            summary: '删除失败',
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
        deleting.value = false
      }
    },
  })
}

// 取消编辑：把表单恢复成原始数据
function onCancel() {
  if (novel.value) syncForm(novel.value)
}

// 返回书架
function goBack() {
  router.push({ name: 'shelf' })
}

// 格式化创建时间 / 字数等只读字段
const createdAtText = computed(() => {
  const v = novel.value?.createdAt
  if (!v) return '—'
  // 直接展示后端原值；如有需要可在此格式化
  return String(v).replace('T', ' ').replace(/\..*$/, '')
})
</script>

<template>
  <main class="detail">
    <header class="top">
      <button class="back" type="button" @click="goBack">
        <span aria-hidden="true">←</span>
        返回书架
      </button>
      <h1 v-if="novel">{{ novel.title }}</h1>
      <h1 v-else-if="loadError">小说不存在</h1>
      <h1 v-else>载入中…</h1>
    </header>

    <!-- 加载错误：把入口收敛，提供一键返回 -->
    <section v-if="loadError" class="error-block">
      <p>{{ loadError }}</p>
      <Button label="返回书架" @click="goBack" />
    </section>

    <!-- 加载完成且无错：双栏布局 -->
    <section v-else-if="novel" class="content">
      <!-- 左侧：书本预览 + 只读元数据 -->
      <aside class="preview">
        <div class="book">
          <span class="spine"></span>
          <div class="cover" :style="!form.coverUrl ? { background: gradient } : null">
            <img v-if="form.coverUrl" :src="form.coverUrl" :alt="form.title" />
            <div v-else class="fallback">
              <p class="fb-title">{{ form.title || '未命名' }}</p>
              <p v-if="form.authorName" class="fb-author">{{ form.authorName }}</p>
            </div>
            <span class="gloss"></span>
          </div>
        </div>
        <dl class="meta">
          <div>
            <dt>字数</dt>
            <dd>{{ novel.wordCount ?? 0 }}</dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>{{ createdAtText }}</dd>
          </div>
          <div>
            <dt>小说 ID</dt>
            <dd>#{{ novel.id }}</dd>
          </div>
        </dl>
      </aside>

      <!-- 右侧：编辑表单 -->
      <div class="form">
        <label class="row">
          <span class="lbl">书名 <em>*</em></span>
          <InputText v-model="form.title" placeholder="请输入书名" />
        </label>
        <label class="row">
          <span class="lbl">作者</span>
          <InputText v-model="form.authorName" placeholder="选填" />
        </label>
        <!-- 注：这里用 div 而非 label 包裹 CoverUploader。
             label 会让浏览器把内部第一个 labelable 元素（隐藏的 file input）
             作为它的 control，点 .drop 区域时浏览器会再触发一次 input.click()，
             造成「弹两次文件选择器」的 BUG。 -->
        <div class="row">
          <span class="lbl">封面</span>
          <CoverUploader v-model="form.coverUrl" />
          <span class="hint">未上传时使用书名作为默认封面</span>
        </div>
        <label class="row">
          <span class="lbl">简介</span>
          <Textarea v-model="form.intro" rows="6" placeholder="选填" />
        </label>

        <!-- 操作区：左侧危险操作（删除），右侧主操作（保存/取消） -->
        <div class="actions">
          <Button
            label="删除小说"
            severity="danger"
            :loading="deleting"
            @click="onDelete"
          />
          <div class="grow"></div>
          <Button label="撤销修改" text :disabled="!dirty || saving" @click="onCancel" />
          <Button
            label="保存"
            :disabled="!dirty || saving"
            :loading="saving"
            @click="onSave"
          />
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.detail {
  min-height: 100vh;
  background:
    radial-gradient(120% 80% at 0% 0%, #1b1f4a 0%, #0b0f24 55%, #06070f 100%);
  color: #e7e9f5;
  font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}

.top {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 18px 40px;
  background: rgba(11, 15, 36, 0.7);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  color: rgba(231, 233, 245, 0.85);
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    color 0.2s ease;
}
.back:hover {
  border-color: rgba(0, 212, 255, 0.6);
  color: #fff;
}
.top h1 {
  margin: 0;
  font-size: 18px;
  letter-spacing: 0.04em;
  /* 超长书名省略 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.error-block {
  padding: 80px 40px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: rgba(231, 233, 245, 0.6);
}

.content {
  max-width: 1080px;
  margin: 0 auto;
  padding: 40px;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 48px;
  align-items: start;
}

/* ─── 左侧：书本预览 ─── */
.preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  position: sticky;
  top: 90px;
}
.book {
  position: relative;
  width: 220px;
}
.spine {
  position: absolute;
  left: -6px;
  top: 6px;
  bottom: 0;
  width: 8px;
  border-radius: 2px 0 0 2px;
  background: linear-gradient(to right, #1a1d36 0%, #2a2e52 70%, #353a66 100%);
  box-shadow: inset -1px 0 0 rgba(0, 0, 0, 0.4);
  z-index: 0;
}
.cover {
  position: relative;
  aspect-ratio: 3 / 4;
  border-radius: 4px 8px 8px 4px;
  overflow: hidden;
  background: #1a1d36;
  box-shadow:
    0 18px 36px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  z-index: 1;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.fallback {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;
  color: #fff;
  text-align: center;
}
.fb-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.35;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.fb-author {
  margin: 12px 0 0;
  font-size: 12px;
  opacity: 0.85;
  letter-spacing: 0.06em;
}
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

/* 只读元数据：dl 表格化展示 */
.meta {
  width: 100%;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.meta > div {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.meta dt {
  color: rgba(231, 233, 245, 0.5);
}
.meta dd {
  margin: 0;
  color: rgba(231, 233, 245, 0.9);
}

/* ─── 右侧：表单 ─── */
.form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lbl {
  font-size: 13px;
  color: rgba(231, 233, 245, 0.7);
}
.lbl em {
  color: #ff7aa2;
  font-style: normal;
  margin-left: 2px;
}
.hint {
  font-size: 11px;
  color: rgba(231, 233, 245, 0.45);
  margin-top: 2px;
}
.row :deep(.p-inputtext),
.row :deep(.p-textarea) {
  width: 100%;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding-top: 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.grow {
  flex: 1;
}

@media (max-width: 960px) {
  .content {
    grid-template-columns: 1fr;
  }
  .preview {
    position: static;
  }
}
</style>
