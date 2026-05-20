<!--
  ShelfView.vue：书架主页
  ----------------------------------------------------------------------------
  设计目标：
  1. 按书架设计稿重构为浅色书库界面，包含顶部栏、搜索、创建按钮、视图入口和分页器。
  2. 保留原有业务功能：创建小说、上传封面、点击书卡进详情、退出登录、Toast 反馈。
  3. 后端列表接口仅支持 page/pageSize，因此搜索与排序只作用于当前页已加载数据，
     不向后端传不存在的 query 参数，避免接口契约漂移。
-->

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import Dialog from 'primevue/dialog'
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
const initialLoaded = ref(false)
const loadError = ref('')
const searchText = ref('')

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

// 当前页本地搜索：后端没有搜索参数，因此只筛选已加载的这一页数据。
const filteredNovels = computed(() => {
  const keyword = searchText.value.trim().toLowerCase()
  if (!keyword) return novels.value
  return novels.value.filter((novel) => {
    const title = String(novel?.title || '').toLowerCase()
    const author = String(novel?.authorName || '').toLowerCase()
    return title.includes(keyword) || author.includes(keyword)
  })
})

// “最近更新”当前只能使用 createdAt，接口列表项暂时没有 updatedAt 字段。
const visibleNovels = computed(() => {
  return [...filteredNovels.value].sort((a, b) => {
    const at = Date.parse(a?.createdAt || '') || 0
    const bt = Date.parse(b?.createdAt || '') || 0
    return bt - at
  })
})

// 页码最多展示 5 个，保证窄屏下分页器仍然紧凑。
const pageNumbers = computed(() => {
  const maxButtons = 5
  const pages = totalPages.value
  if (pages <= maxButtons) {
    return Array.from({ length: pages }, (_, i) => i + 1)
  }

  let start = Math.max(1, page.value - 2)
  let end = Math.min(pages, start + maxButtons - 1)
  start = Math.max(1, end - maxButtons + 1)

  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
})

const showSearchEmpty = computed(() => {
  return (
    initialLoaded.value &&
    total.value > 0 &&
    Boolean(searchText.value.trim()) &&
    visibleNovels.value.length === 0
  )
})

// 拉取指定页：分页模式下每次切页都替换当前 novels，而不是 append。
async function fetchPage(targetPage = page.value) {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    const res = await listNovels({ page: targetPage, pageSize })
    if (res?.code === 0) {
      novels.value = res.data?.items || []
      total.value = res.data?.total || 0
      page.value = res.data?.page || targetPage
    } else {
      loadError.value = res?.msg || '加载失败'
      toast.add({
        severity: 'error',
        summary: '加载失败',
        detail: res?.msg || '请稍后重试',
        life: 3000,
      })
    }
  } catch (e) {
    loadError.value = e?.message || '加载失败'
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

onMounted(() => fetchPage(1))

// 创建成功后回到第一页，避免新小说因为分页顺序出现在用户看不到的位置。
function resetAndReload() {
  page.value = 1
  searchText.value = ''
  return fetchPage(1)
}

// ───── 新增小说对话框 ─────
const showCreate = ref(false)
const submitting = ref(false)
const form = reactive({ title: '', authorName: '', coverUrl: '', intro: '' })

function openCreate() {
  form.title = ''
  form.authorName = ''
  form.coverUrl = ''
  form.intro = ''
  showCreate.value = true
}

async function onCreate() {
  const title = form.title.trim()
  if (!title || submitting.value) return

  submitting.value = true
  try {
    // 选填字段去掉首尾空格，空字符串不传给后端，保持原接口行为。
    const payload = {
      title,
      authorName: form.authorName.trim() || undefined,
      coverUrl: form.coverUrl.trim() || undefined,
      intro: form.intro.trim() || undefined,
    }
    const res = await createNovel(payload)
    if (res?.code === 0) {
      toast.add({ severity: 'success', summary: '已创建', detail: title, life: 2000 })
      showCreate.value = false
      await resetAndReload()
    } else {
      toast.add({
        severity: 'error',
        summary: '创建失败',
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

function changePage(targetPage) {
  if (loading.value || targetPage === page.value) return
  if (targetPage < 1 || targetPage > totalPages.value) return
  fetchPage(targetPage)
}

function clearSearch() {
  searchText.value = ''
}

function toDetail(novel) {
  router.push({ name: 'novel-detail', params: { id: novel.id } })
}

function onLogout() {
  auth.logout()
  router.replace('/login')
}
</script>

<template>
  <main class="shelf">
    <header class="topbar">
      <div class="brand">
        <span class="brand-icon" aria-hidden="true">
          <svg viewBox="0 0 28 28">
            <path d="M5 4h9a3 3 0 0 1 3 3v17H8a3 3 0 0 1-3-3V4Z" />
            <path d="M17 7h6v14h-6" />
            <path d="M9 8v8" />
          </svg>
        </span>
        <h1>我的书架</h1>
      </div>

      <div class="top-actions">
        <label class="search-box">
          <span class="sr-only">搜索小说</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m16.5 16.5 4 4" />
          </svg>
          <input v-model="searchText" type="search" placeholder="搜索小说" />
        </label>

        <button class="create-button" type="button" @click="openCreate">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          创建小说
        </button>

        <button class="logout-button" type="button" @click="onLogout">退出</button>
      </div>
    </header>

    <section class="library" aria-labelledby="library-title">
      <div class="section-head">
        <div class="section-title">
          <h2 id="library-title">我的小说</h2>
          <span v-if="initialLoaded">({{ total }})</span>
        </div>

        <div class="view-tools">
          <div class="sort-control" aria-label="当前排序：最近更新">
            最近更新
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m7 10 5 5 5-5" />
            </svg>
          </div>

          <div class="view-switch" aria-label="视图切换">
            <button class="view-button is-active" type="button" aria-label="网格视图">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
              </svg>
            </button>
            <button class="view-button" type="button" aria-label="列表视图暂未启用" disabled>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 7h14M5 12h14M5 17h14" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div v-if="!initialLoaded" class="books-grid loading-grid" aria-live="polite">
        <article v-for="i in 12" :key="i" class="book-skeleton">
          <span class="skel-cover"></span>
          <span class="skel-line short"></span>
          <span class="skel-line"></span>
        </article>
      </div>

      <section v-else-if="loadError" class="state-block">
        <h3>加载失败</h3>
        <p>{{ loadError }}</p>
        <button class="state-button" type="button" @click="fetchPage(page)">重试</button>
      </section>

      <section v-else-if="total === 0" class="state-block empty-state">
        <svg viewBox="0 0 180 140" aria-hidden="true">
          <path d="M34 38h42a12 12 0 0 1 12 12v58H46a12 12 0 0 1-12-12V38Z" />
          <path d="M92 50h54v58H92" />
          <path d="M52 56h18M52 70h24M52 84h18" />
        </svg>
        <h3>书架空空如也</h3>
        <p>创建你的第一本小说，开始整理灵感和章节。</p>
        <button class="state-button" type="button" @click="openCreate">创建小说</button>
      </section>

      <section v-else-if="showSearchEmpty" class="state-block">
        <h3>当前页没有匹配小说</h3>
        <p>可以换一个关键词，或清空搜索查看这一页全部小说。</p>
        <button class="state-button" type="button" @click="clearSearch">清空搜索</button>
      </section>

      <div v-else class="books-grid">
        <BookCard v-for="novel in visibleNovels" :key="novel.id" :novel="novel" @click="toDetail" />
      </div>

      <nav v-if="initialLoaded && total > 0" class="pager" aria-label="小说分页">
        <button
          class="page-button arrow"
          type="button"
          :disabled="loading || page <= 1"
          aria-label="上一页"
          @click="changePage(page - 1)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>

        <button
          v-for="pageNo in pageNumbers"
          :key="pageNo"
          class="page-button"
          :class="{ 'is-current': pageNo === page }"
          type="button"
          :disabled="loading || pageNo === page"
          :aria-current="pageNo === page ? 'page' : undefined"
          @click="changePage(pageNo)"
        >
          {{ pageNo }}
        </button>

        <button
          class="page-button arrow"
          type="button"
          :disabled="loading || page >= totalPages"
          aria-label="下一页"
          @click="changePage(page + 1)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </nav>
    </section>

    <Dialog
      v-model:visible="showCreate"
      header="创建小说"
      :modal="true"
      :draggable="false"
      :closable="!submitting"
      :style="{ width: '520px', maxWidth: 'calc(100vw - 32px)' }"
      class="create-dialog"
    >
      <form class="create-form" @submit.prevent="onCreate">
        <label class="form-field">
          <span>书名 <em>*</em></span>
          <InputText v-model="form.title" placeholder="请输入书名" autofocus />
        </label>

        <label class="form-field">
          <span>作者</span>
          <InputText v-model="form.authorName" placeholder="选填" />
        </label>

        <!--
          CoverUploader 内部含隐藏 file input。
          外层必须保持 div，而不是 label，避免浏览器 label 默认行为再次触发 picker。
        -->
        <div class="form-field">
          <span>封面</span>
          <CoverUploader v-model="form.coverUrl" />
          <small>未上传时使用书名生成默认封面</small>
        </div>

        <label class="form-field">
          <span>简介</span>
          <Textarea v-model="form.intro" rows="4" placeholder="选填" />
        </label>
      </form>

      <template #footer>
        <button
          class="dialog-button ghost"
          type="button"
          :disabled="submitting"
          @click="showCreate = false"
        >
          取消
        </button>
        <button
          class="dialog-button primary"
          type="button"
          :disabled="!form.title.trim() || submitting"
          @click="onCreate"
        >
          {{ submitting ? '创建中' : '创建' }}
        </button>
      </template>
    </Dialog>
  </main>
</template>

<style scoped>
.shelf {
  min-height: 100vh;
  background:
    radial-gradient(circle at 20% 0%, oklch(97% 0.01 255) 0, transparent 34rem),
    linear-gradient(180deg, oklch(99.2% 0.004 255), oklch(96.8% 0.006 255));
  color: oklch(22% 0.02 260);
  font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}

.topbar {
  min-height: 108px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 0 40px;
  border-bottom: 1px solid oklch(91% 0.008 255);
  background: oklch(99.4% 0.003 255 / 0.92);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.brand,
.top-actions,
.section-title,
.view-tools,
.view-switch {
  display: flex;
  align-items: center;
}

.brand {
  gap: 14px;
  min-width: max-content;
}

.brand-icon {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: oklch(18% 0.018 260);
}

.brand-icon svg,
.search-box svg,
.create-button svg,
.sort-control svg,
.view-button svg,
.page-button svg {
  width: 1.25rem;
  height: 1.25rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.brand h1 {
  margin: 0;
  font-size: 1.45rem;
  line-height: 1.2;
  font-weight: 760;
}

.top-actions {
  gap: 18px;
}

.search-box {
  width: 312px;
  min-height: 58px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
  border: 1px solid oklch(89% 0.012 255);
  border-radius: 8px;
  background: oklch(99.2% 0.004 255);
  color: oklch(58% 0.026 260);
  box-shadow: 0 8px 24px oklch(40% 0.03 260 / 0.04);
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.search-box:focus-within {
  border-color: oklch(62% 0.13 255);
  box-shadow: 0 0 0 3px oklch(78% 0.12 255 / 0.25);
}

.search-box input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: oklch(26% 0.026 260);
  font: inherit;
}

.search-box input::placeholder {
  color: oklch(62% 0.02 260);
}

.create-button,
.state-button,
.dialog-button {
  min-height: 46px;
  border: 0;
  border-radius: 8px;
  font: inherit;
  font-weight: 720;
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.create-button {
  min-width: 180px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: oklch(18% 0.01 260);
  color: oklch(98% 0.004 255);
  box-shadow: 0 12px 28px oklch(18% 0.01 260 / 0.18);
}

.create-button:hover,
.state-button:hover,
.dialog-button.primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 30px oklch(18% 0.01 260 / 0.2);
}

.logout-button {
  min-height: 44px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: oklch(50% 0.03 260);
  font: inherit;
  cursor: pointer;
}

.logout-button:hover {
  color: oklch(22% 0.02 260);
}

.library {
  max-width: 1720px;
  margin: 0 auto;
  padding: 58px 40px 70px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 52px;
}

.section-title {
  gap: 18px;
}

.section-title h2 {
  margin: 0;
  font-size: 1.45rem;
  line-height: 1.2;
  font-weight: 780;
}

.section-title span {
  color: oklch(48% 0.03 260);
  font-size: 1rem;
}

.view-tools {
  gap: 34px;
}

.sort-control {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: oklch(48% 0.03 260);
  font-size: 1rem;
  user-select: none;
}

.sort-control svg {
  width: 1rem;
  height: 1rem;
}

.view-switch {
  gap: 12px;
}

.view-button {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: oklch(48% 0.03 260);
  cursor: pointer;
}

.view-button.is-active {
  background: oklch(96% 0.006 255);
  color: oklch(20% 0.018 260);
}

.view-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.books-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 52px 60px;
  align-items: start;
}

.books-grid > * {
  min-width: 0;
}

.book-skeleton {
  overflow: hidden;
  border: 1px solid oklch(90% 0.01 255);
  border-radius: 8px;
  background: oklch(99.2% 0.004 255);
  box-shadow:
    0 14px 34px oklch(42% 0.035 260 / 0.08),
    0 1px 2px oklch(42% 0.035 260 / 0.06);
}

.skel-cover,
.skel-line {
  display: block;
  background: linear-gradient(
    90deg,
    oklch(92% 0.01 255) 0%,
    oklch(97% 0.006 255) 50%,
    oklch(92% 0.01 255) 100%
  );
  background-size: 200% 100%;
  animation: shine 1.25s linear infinite;
}

.skel-cover {
  aspect-ratio: 3 / 4;
}

.skel-line {
  height: 14px;
  margin: 14px 18px 0;
  border-radius: 999px;
}

.skel-line.short {
  width: 64%;
}

.skel-line:last-child {
  width: 42%;
  margin-bottom: 18px;
}

@keyframes shine {
  to {
    background-position: -200% 0;
  }
}

.state-block {
  min-height: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 42px;
  border: 1px solid oklch(90% 0.01 255);
  border-radius: 14px;
  background: oklch(99.2% 0.004 255);
  text-align: center;
  box-shadow: 0 16px 40px oklch(42% 0.035 260 / 0.08);
}

.state-block svg {
  width: 150px;
  height: auto;
  margin-bottom: 8px;
  fill: none;
  stroke: oklch(32% 0.024 260);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.state-block h3 {
  margin: 0;
  font-size: 1.25rem;
}

.state-block p {
  max-width: 34rem;
  margin: 0;
  color: oklch(48% 0.03 260);
  line-height: 1.7;
}

.state-button,
.dialog-button.primary {
  margin-top: 10px;
  padding: 0 22px;
  background: oklch(18% 0.01 260);
  color: oklch(98% 0.004 255);
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin-top: 52px;
}

.page-button {
  width: 48px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid oklch(88% 0.012 255);
  border-radius: 8px;
  background: oklch(99.2% 0.004 255);
  color: oklch(24% 0.02 260);
  font: inherit;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.page-button:hover:not(:disabled) {
  border-color: oklch(70% 0.08 255);
  transform: translateY(-1px);
}

.page-button.is-current {
  border-color: oklch(18% 0.01 260);
  background: oklch(18% 0.01 260);
  color: oklch(98% 0.004 255);
}

.page-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.page-button.arrow svg {
  width: 1.1rem;
  height: 1.1rem;
}

.create-form {
  display: grid;
  gap: 18px;
  padding-top: 4px;
}

.form-field {
  display: grid;
  gap: 8px;
}

.form-field > span {
  color: oklch(34% 0.035 260);
  font-size: 0.875rem;
  font-weight: 700;
}

.form-field em {
  color: oklch(55% 0.22 25);
  font-style: normal;
}

.form-field small {
  color: oklch(52% 0.03 260);
  font-size: 0.75rem;
}

.form-field :deep(.p-inputtext),
.form-field :deep(.p-textarea) {
  width: 100%;
}

.dialog-button {
  min-width: 88px;
  padding: 0 18px;
  border: 1px solid transparent;
}

.dialog-button.ghost {
  background: transparent;
  color: oklch(42% 0.04 260);
}

.dialog-button.ghost:hover {
  background: oklch(94% 0.014 255);
}

.dialog-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
  box-shadow: none;
}

.create-button:focus-visible,
.logout-button:focus-visible,
.search-box:focus-within,
.view-button:focus-visible,
.page-button:focus-visible,
.state-button:focus-visible,
.dialog-button:focus-visible {
  outline: 3px solid oklch(76% 0.14 250 / 0.55);
  outline-offset: 3px;
}

/* PrimeVue Dialog 和 CoverUploader 都需要在这个浅色页面内局部覆盖默认深色感。 */
:global(.p-dialog-mask:has(.create-dialog)) {
  background: oklch(20% 0.035 260 / 0.28);
  backdrop-filter: blur(3px);
}

:global(.create-dialog.p-dialog) {
  overflow: hidden;
  border: 1px solid oklch(87% 0.014 255);
  border-radius: 16px;
  background: oklch(99.2% 0.004 255);
  color: oklch(26% 0.035 260);
  box-shadow:
    0 24px 70px oklch(34% 0.045 260 / 0.22),
    0 1px 2px oklch(34% 0.045 260 / 0.1);
}

:global(.create-dialog .p-dialog-header),
:global(.create-dialog .p-dialog-content),
:global(.create-dialog .p-dialog-footer) {
  background: oklch(99.2% 0.004 255);
  color: oklch(26% 0.035 260);
}

:global(.create-dialog .p-dialog-header) {
  padding: 22px 24px 16px;
  border-bottom: 1px solid oklch(91% 0.01 255);
}

:global(.create-dialog .p-dialog-title) {
  font-size: 1.125rem;
  font-weight: 760;
}

:global(.create-dialog .p-dialog-content) {
  padding: 22px 24px 8px;
}

:global(.create-dialog .p-dialog-footer) {
  gap: 10px;
  padding: 16px 24px 22px;
  border-top: 1px solid oklch(91% 0.01 255);
}

:global(.create-dialog .p-dialog-header-icon) {
  color: oklch(42% 0.035 260);
}

:global(.create-dialog .p-dialog-header-icon:hover) {
  background: oklch(94% 0.014 255);
  color: oklch(20% 0.018 260);
}

:global(.create-dialog .p-inputtext),
:global(.create-dialog .p-textarea) {
  border-color: oklch(84% 0.018 255);
  background: oklch(99% 0.004 255);
  color: oklch(26% 0.035 260);
}

:global(.create-dialog .p-inputtext::placeholder),
:global(.create-dialog .p-textarea::placeholder) {
  color: oklch(58% 0.028 260);
}

:global(.create-dialog .p-inputtext:hover),
:global(.create-dialog .p-textarea:hover) {
  border-color: oklch(72% 0.08 255);
}

:global(.create-dialog .p-inputtext:enabled:focus),
:global(.create-dialog .p-textarea:enabled:focus) {
  border-color: oklch(56% 0.17 258);
  box-shadow: 0 0 0 3px oklch(78% 0.13 255 / 0.32);
}

:global(.create-dialog .uploader .drop) {
  border-color: oklch(82% 0.026 255);
  background: oklch(97% 0.01 255);
}

:global(.create-dialog .uploader .drop:hover),
:global(.create-dialog .uploader .drop:focus-visible) {
  border-color: oklch(62% 0.15 255);
  background: oklch(95% 0.026 255);
}

:global(.create-dialog .uploader .placeholder) {
  color: oklch(50% 0.03 260);
}

:global(.create-dialog .uploader .placeholder .icon) {
  color: oklch(30% 0.02 260);
}

:global(.create-dialog .uploader .placeholder .primary) {
  color: oklch(34% 0.035 260);
}

:global(.create-dialog .uploader .placeholder .secondary),
:global(.create-dialog .uploader .uploading) {
  color: oklch(55% 0.028 260);
}

:global(.create-dialog .uploader .spinner) {
  border-color: oklch(82% 0.026 255);
  border-top-color: oklch(22% 0.02 260);
}

:global(.create-dialog .uploader .preview) {
  box-shadow:
    0 12px 28px oklch(38% 0.055 260 / 0.18),
    inset 0 0 0 1px oklch(100% 0 0 / 0.72);
}

.sr-only {
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

@media (max-width: 1180px) {
  .books-grid {
    gap: 40px 34px;
  }

  .topbar {
    align-items: flex-start;
    flex-direction: column;
    padding-block: 22px;
  }

  .top-actions {
    width: 100%;
  }

  .search-box {
    width: min(420px, 100%);
  }
}

@media (max-width: 760px) {
  .topbar {
    padding: 18px;
  }

  .top-actions,
  .section-head {
    align-items: stretch;
    flex-direction: column;
  }

  .search-box,
  .create-button {
    width: 100%;
  }

  .library {
    padding: 34px 18px 44px;
  }

  .section-head {
    gap: 18px;
    margin-bottom: 28px;
  }

  .view-tools {
    justify-content: space-between;
  }

  .books-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 26px 16px;
  }

  .pager {
    gap: 10px;
    margin-top: 34px;
  }

  .page-button {
    width: 42px;
    height: 40px;
  }
}

@media (max-width: 420px) {
  .books-grid {
    grid-template-columns: 1fr;
  }
}
</style>
