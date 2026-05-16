<!--
  ShelfView.vue —— 书架主页
  ----------------------------------------------------------------------------
  视觉：木纹色基调 + 横向「隔板线」营造书架氛围；
        每行 4 本书形成等宽栅格（4 列 × N 行）。
  数据：
    · 分页参数 page/pageSize（pageSize=12，恰好 4×3 一屏）
    · 触底加载：IntersectionObserver 监听底部 sentinel，进入视口即拉下一页
  状态：
    · initialLoaded=false → 首次加载骨架
    · total=0           → 空书架占位 + 引导 CTA
    · hasMore=true      → 显示「加载中…」/继续观察
    · hasMore=false     → 显示「已经到底了」
  PrimeVue 用法：Dialog（新增对话框）、Button（操作按钮）、InputText/Textarea（表单）、Toast（结果反馈）
  自写部分：书架视觉、书本组件、空状态、瀑布栅格——保持设计自由度。
-->

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import { useAuthStore } from '@/stores/auth'
import { createNovel, listNovels } from '@/api/novel'
import BookCard from '@/components/BookCard.vue'
import CoverUploader from '@/components/CoverUploader.vue'

const router = useRouter()
const auth = useAuthStore()
const toast = useToast()

// ───── 列表数据 / 分页状态 ─────
const novels = ref([])
const page = ref(1)
const pageSize = 12
const total = ref(0)
const loading = ref(false)
const initialLoaded = ref(false) // 首次拉取完成（无论成功失败）

// 是否还有下一页：本地条数 < 后端 total
const hasMore = computed(() => novels.value.length < total.value)

// 用于 IntersectionObserver 的底部哨兵元素
const sentinel = ref(null)
let observer = null

// 拉一页数据并 append 到 novels
async function fetchPage() {
  // 防抖：正在请求或已经到底就不重复发
  if (loading.value) return
  if (initialLoaded.value && !hasMore.value) return
  loading.value = true
  try {
    const res = await listNovels({ page: page.value, pageSize })
    if (res?.code === 0) {
      const items = res.data?.items || []
      novels.value.push(...items)
      total.value = res.data?.total || 0
      page.value += 1
    } else {
      toast.add({
        severity: 'error',
        summary: '加载失败',
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
    loading.value = false
    initialLoaded.value = true
  }
}

// 首次拉取 + 启动触底观察
onMounted(async () => {
  await fetchPage()
  await nextTick()
  observer = new IntersectionObserver(
    (entries) => {
      // sentinel 进入视口、还有下一页、当前没在请求 → 触发加载
      if (entries[0]?.isIntersecting && hasMore.value && !loading.value) {
        fetchPage()
      }
    },
    // rootMargin 200px：还没真正触底就提前预加载，体感更顺
    { rootMargin: '200px' },
  )
  if (sentinel.value) observer.observe(sentinel.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
})

// 在新增成功后重置列表，避免新书出现在末尾、被分页打散
function resetAndReload() {
  novels.value = []
  page.value = 1
  total.value = 0
  initialLoaded.value = false
  return fetchPage()
}

// ───── 新增小说对话框 ─────
const showCreate = ref(false)
const submitting = ref(false)
const form = reactive({ title: '', authorName: '', coverUrl: '', intro: '' })

function openCreate() {
  // 打开前清空表单，避免上次输入残留
  form.title = ''
  form.authorName = ''
  form.coverUrl = ''
  form.intro = ''
  showCreate.value = true
}

async function onCreate() {
  const title = form.title.trim()
  if (!title) return
  submitting.value = true
  try {
    // 选填字段统一去空格，空串改为 undefined 不传给后端
    const payload = {
      title,
      authorName: form.authorName.trim() || undefined,
      coverUrl: form.coverUrl.trim() || undefined,
      intro: form.intro.trim() || undefined,
    }
    const res = await createNovel(payload)
    if (res?.code === 0) {
      toast.add({ severity: 'success', summary: '已添加', detail: title, life: 2000 })
      showCreate.value = false
      await resetAndReload()
    } else {
      toast.add({
        severity: 'error',
        summary: '新增失败',
        detail: res?.msg || '请检查字段',
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
    submitting.value = false
  }
}

// 跳转详情：点击书本时触发
function toDetail(novel) {
  router.push({ name: 'novel-detail', params: { id: novel.id } })
}

// 退出登录：清前端登录标记，跳回登录页
function onLogout() {
  auth.logout()
  router.replace('/login')
}
</script>

<template>
  <main class="shelf">
    <!-- 顶栏：品牌 / 操作 -->
    <header class="top">
      <div class="brand">
        <span class="brand-mark">
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
            <path
              d="M6 4h14a6 6 0 0 1 6 6v18l-6-4-7 4-7-4z"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linejoin="round"
            />
            <path
              d="M11 11h10M11 16h10M11 21h6"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </span>
        <h1>我的书架</h1>
        <span v-if="initialLoaded" class="count">共 {{ total }} 本</span>
      </div>
      <div class="actions">
        <Button label="新增小说" severity="primary" @click="openCreate" />
        <button class="logout" type="button" @click="onLogout">退出登录</button>
      </div>
    </header>

    <!-- 主体：根据加载状态/数量分支展示 -->
    <section class="board">
      <!-- 首次加载：简单骨架占位 -->
      <div v-if="!initialLoaded" class="loading-skeleton">
        <div v-for="i in 8" :key="i" class="skel"></div>
      </div>

      <!-- 完全空：引导用户添加第一本 -->
      <div v-else-if="total === 0" class="empty">
        <svg class="empty-art" viewBox="0 0 240 160" aria-hidden="true">
          <!-- 一个简约的空书架插画：两层托板 + 一本斜倒的书 -->
          <rect x="20" y="40" width="200" height="6" rx="2" fill="#3a2f24" />
          <rect x="20" y="100" width="200" height="6" rx="2" fill="#3a2f24" />
          <rect x="20" y="44" width="6" height="60" fill="#3a2f24" />
          <rect x="214" y="44" width="6" height="60" fill="#3a2f24" />
          <g transform="translate(150 60) rotate(12)">
            <rect width="34" height="42" rx="3" fill="url(#g)" />
          </g>
          <defs>
            <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stop-color="#7b6cff" />
              <stop offset="100%" stop-color="#00d4ff" />
            </linearGradient>
          </defs>
        </svg>
        <h2>书架空空如也</h2>
        <p>添加你的第一本小说，开始 AI 协作创作。</p>
        <Button label="添加第一本" severity="primary" @click="openCreate" />
      </div>

      <!-- 正常列表：等宽栅格 + 木纹隔板背景 -->
      <div v-else class="rack-wrap">
        <div class="rack">
          <BookCard v-for="n in novels" :key="n.id" :novel="n" @click="toDetail" />
        </div>

        <!-- 底部哨兵：用于触发下一页加载 -->
        <div ref="sentinel" class="sentinel">
          <span v-if="loading">载入更多…</span>
          <span v-else-if="!hasMore && novels.length > 0">已经到底了 · 共 {{ total }} 本</span>
        </div>
      </div>
    </section>

    <!-- 新增小说对话框：用 PrimeVue Dialog，自动处理遮罩/动效/拖拽/关闭 -->
    <Dialog
      v-model:visible="showCreate"
      header="新增小说"
      :modal="true"
      :draggable="false"
      :style="{ width: '480px' }"
      class="novel-dialog"
    >
      <form class="form" @submit.prevent="onCreate">
        <label class="row">
          <span class="lbl">书名 <em>*</em></span>
          <InputText v-model="form.title" placeholder="请输入书名" autofocus />
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
          <Textarea v-model="form.intro" rows="4" placeholder="选填" />
        </label>
      </form>
      <template #footer>
        <Button label="取消" text @click="showCreate = false" />
        <Button
          label="创建"
          :disabled="!form.title.trim() || submitting"
          :loading="submitting"
          @click="onCreate"
        />
      </template>
    </Dialog>
  </main>
</template>

<style scoped>
.shelf {
  min-height: 100vh;
  background:
    radial-gradient(120% 80% at 0% 0%, #2a2030 0%, #16101c 60%, #0c0712 100%),
    #0c0712;
  color: #e7e9f5;
  font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}

/* ─── 顶栏 ─── */
.top {
  position: sticky; /* 滚动时品牌/操作常驻顶部，便于随时加书 */
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 40px;
  background: rgba(12, 7, 18, 0.7);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, #7b6cff, #00d4ff);
  color: #0b0f24;
  box-shadow: 0 8px 20px rgba(123, 108, 255, 0.35);
}
.brand h1 {
  margin: 0;
  font-size: 18px;
  letter-spacing: 0.04em;
}
.count {
  font-size: 12px;
  color: rgba(231, 233, 245, 0.5);
  margin-left: 4px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.logout {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: rgba(231, 233, 245, 0.8);
  padding: 8px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  transition:
    border-color 0.2s ease,
    color 0.2s ease;
}
.logout:hover {
  border-color: rgba(0, 212, 255, 0.6);
  color: #fff;
}

/* ─── 书架主体 ─── */
.board {
  max-width: 1280px;
  margin: 0 auto;
  padding: 40px 40px 80px;
}

/* 骨架加载：和书本同尺寸的灰块 */
.loading-skeleton {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 56px 40px;
}
.skel {
  aspect-ratio: 3 / 4;
  border-radius: 6px;
  background:
    linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 0%,
      rgba(255, 255, 255, 0.1) 50%,
      rgba(255, 255, 255, 0.04) 100%
    );
  background-size: 200% 100%;
  animation: shine 1.4s linear infinite;
}
@keyframes shine {
  to {
    background-position: -200% 0;
  }
}

/* 空状态 */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 0 40px;
  text-align: center;
}
.empty-art {
  width: 260px;
  height: auto;
  margin-bottom: 24px;
  opacity: 0.95;
}
.empty h2 {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 600;
}
.empty p {
  margin: 0 0 24px;
  color: rgba(231, 233, 245, 0.55);
}

/* 书架托板：原本想画横向隔板，但隔板位置依赖列宽（max-width + padding 会让 100vw/4 失准），
   不同视口下会错位。改成统一的木色纹理底，依然有「书架」的氛围，又不会对不齐。*/
.rack-wrap {
  position: relative;
}
.rack {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  /* 列间距 40，行间距 64：行间距大让书架更透气，配合书脊营造立体感 */
  gap: 64px 40px;
  padding: 24px 16px;
  border-radius: 12px;
  /* 木色暗纹：双层径向 + 一层柔和的木纹横线 */
  background:
    radial-gradient(ellipse at top, rgba(180, 120, 70, 0.08) 0%, transparent 60%),
    repeating-linear-gradient(
      to bottom,
      rgba(125, 86, 60, 0) 0,
      rgba(125, 86, 60, 0) 22px,
      rgba(125, 86, 60, 0.06) 22px,
      rgba(125, 86, 60, 0.06) 24px
    ),
    linear-gradient(180deg, rgba(45, 30, 22, 0.4) 0%, rgba(28, 18, 14, 0.3) 100%);
  box-shadow: inset 0 0 0 1px rgba(125, 86, 60, 0.15);
}

.sentinel {
  margin-top: 32px;
  text-align: center;
  color: rgba(231, 233, 245, 0.4);
  font-size: 13px;
  letter-spacing: 0.04em;
  padding: 16px 0;
}

/* 表单：让 InputText/Textarea 占满宽度并跟随暗色风格 */
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 4px;
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

@media (max-width: 960px) {
  .rack,
  .loading-skeleton {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
