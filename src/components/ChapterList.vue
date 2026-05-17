<!--
  ChapterList.vue —— 小说详情页底部嵌入的「章节列表」
  ----------------------------------------------------------------------------
  · 数据：调 /novels/{id}/chapters 分页拉摘要列表（列表项不含 content）
  · 翻页：照搬 ShelfView 的 IntersectionObserver + sentinel + hasMore 模式
          —— 底部哨兵进入视口、有下一页、当前未在请求 → 自动拉下一页
  · 删除：在 List 层做二次确认 + 调 deleteChapter；删除成功后本地从 items 剔除
          并把 total -1，不重新分页拉取（避免分页错位 / 闪烁）
  · 点行：emit('edit', chapter) 把整行抛给父组件，由父决定跳哪个路由
-->

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import { deleteChapter, listChapters } from '@/api/chapter'
import ChapterRow from './ChapterRow.vue'

const props = defineProps({
  // 所属小说 ID，必传；用于拼接 /novels/{novelId}/chapters 路径
  novelId: { type: Number, required: true },
})

// 父组件决定如何处理点击：通常是 router.push 跳到 chapter-edit 路由
const emit = defineEmits(['edit'])

const confirm = useConfirm()
const toast = useToast()

// ───── 分页状态 ─────
const items = ref([]) // 已加载的章节摘要数组（按后端返回顺序 append）
const page = ref(1) // 当前请求的页码（每次成功后 +1）
const pageSize = 10 // 固定 10 条/页，对齐 Apifox 默认；前端不再暴露切换
const total = ref(0) // 后端总数，决定 hasMore
const loading = ref(false) // 单页请求中标记，用于防抖 + 「载入更多…」提示
const initialLoaded = ref(false) // 首次拉取完成（成功/失败都置 true），用于切换占位
const loadError = ref('') // 首次加载失败的错误文案

// 是否还有下一页：本地条数 < 后端 total
const hasMore = computed(() => items.value.length < total.value)

// 用于 IntersectionObserver 的底部哨兵元素
const sentinel = ref(null)
let observer = null

// 拉一页数据并 append 到 items
async function fetchPage() {
  // 防抖：正在请求 / 已经到底就不重复发
  if (loading.value) return
  if (initialLoaded.value && !hasMore.value) return
  loading.value = true
  try {
    const res = await listChapters(props.novelId, {
      page: page.value,
      pageSize,
    })
    if (res?.code === 0) {
      const list = res.data?.items || []
      items.value.push(...list)
      total.value = res.data?.total || 0
      page.value += 1
    } else if (!initialLoaded.value) {
      // 首次失败：显示错误占位让用户感知
      loadError.value = res?.msg || '加载失败'
    } else {
      // 后续页失败：用 toast 提示，不破坏已加载内容
      toast.add({
        severity: 'error',
        summary: '加载失败',
        detail: res?.msg || '请稍后重试',
        life: 3000,
      })
    }
  } catch (e) {
    if (!initialLoaded.value) {
      loadError.value = e?.message || '加载失败'
    } else {
      toast.add({
        severity: 'error',
        summary: '网络错误',
        detail: e?.message || '请稍后重试',
        life: 3000,
      })
    }
  } finally {
    loading.value = false
    initialLoaded.value = true
  }
}

// 首次拉取 + 启动触底观察（沿用 ShelfView 同套模式）
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

// 行点击：把整行章节摘要抛给父组件
function onRowClick(chapter) {
  emit('edit', chapter)
}

// 行删除：二次确认 → 调接口 → 本地剔除 + total-1
function onRowDelete(chapter) {
  confirm.require({
    header: '确认删除',
    message: `确定要删除第 ${chapter.chapterNo} 章《${chapter.title || '未命名'}》吗？\n此操作不可撤销，会同步扣减小说总字数。`,
    acceptLabel: '删除',
    rejectLabel: '取消',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        const res = await deleteChapter(props.novelId, chapter.id)
        if (res?.code === 0) {
          items.value = items.value.filter((c) => c.id !== chapter.id)
          total.value = Math.max(0, total.value - 1)
          toast.add({ severity: 'success', summary: '已删除', life: 2000 })
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
      }
    },
  })
}

// 暴露给父组件：保存章节后能主动刷新列表（避免新章节不出现）
defineExpose({
  refresh() {
    items.value = []
    page.value = 1
    total.value = 0
    initialLoaded.value = false
    loadError.value = ''
    return fetchPage()
  },
})
</script>

<template>
  <div class="chapter-list">
    <!-- 首次加载占位 -->
    <div v-if="!initialLoaded" class="state">载入中…</div>

    <!-- 首次加载失败占位 + 重试 -->
    <div v-else-if="loadError" class="state error">
      <span>{{ loadError }}</span>
      <Button label="重试" text size="small" @click="fetchPage" />
    </div>

    <!-- 空列表占位 -->
    <div v-else-if="total === 0" class="state empty">
      还没有章节，点上方「+ 新增章节」开始写作。
    </div>

    <!-- 正常列表 -->
    <div v-else class="rows">
      <ChapterRow
        v-for="c in items"
        :key="c.id"
        :chapter="c"
        @click="onRowClick"
        @delete="onRowDelete"
      />
    </div>

    <!-- 底部哨兵：用于触发下一页加载；同时承载状态文案 -->
    <div ref="sentinel" class="sentinel">
      <span v-if="loading && initialLoaded">载入更多…</span>
      <span v-else-if="initialLoaded && !hasMore && total > 0">
        已经到底了 · 共 {{ total }} 章
      </span>
    </div>
  </div>
</template>

<style scoped>
.chapter-list {
  width: 100%;
}

/* 通用状态占位：载入 / 空 / 错误 */
.state {
  padding: 40px 20px;
  text-align: center;
  color: rgba(231, 233, 245, 0.5);
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.state.error {
  color: #ff7aa2;
}
.state.empty {
  color: rgba(231, 233, 245, 0.45);
}

/* 列表容器：行间距由 ChapterRow 自己的 .row + .row 控制 */
.rows {
  display: flex;
  flex-direction: column;
}

/* 底部哨兵：固定高度 + 居中文案，避免空白时高度坍缩观察不到交叉 */
.sentinel {
  margin-top: 24px;
  text-align: center;
  color: rgba(231, 233, 245, 0.4);
  font-size: 13px;
  letter-spacing: 0.04em;
  padding: 16px 0;
  min-height: 24px;
}
</style>
