<!--
  ChapterList.vue：小说详情页嵌入的章节表格
  ----------------------------------------------------------------------------
  数据与行为沿用原实现：
  1. 分页读取 /novels/{id}/chapters，并用 IntersectionObserver 触底加载下一页。
  2. 点击章节行 emit('edit', chapter)，由详情页跳转到章节编辑页。
  3. 删除仍在列表层做二次确认和接口调用，成功后从本地列表移除。
  视觉重构目标：
  1. 按设计图改为浅色表格，展示“章节号 / 章节标题 / 创建时间”。
  2. 删除操作保留在行尾，视觉弱化，避免破坏设计图的三列表格主体。
-->

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import { deleteChapter, listChapters } from '@/api/chapter'
import ChapterRow from './ChapterRow.vue'

const props = defineProps({
  // 所属小说 ID，必传；用于拼接 /novels/{id}/chapters 路径。
  novelId: { type: Number, required: true },
})

// 父组件决定章节点击后的路由行为，列表只负责把章节对象抛出。
const emit = defineEmits(['edit'])

const confirm = useConfirm()
const toast = useToast()

// ───── 分页状态 ─────
const items = ref([])
const page = ref(1)
const pageSize = 10
const total = ref(0)
const loading = ref(false)
const initialLoaded = ref(false)
const loadError = ref('')

const hasMore = computed(() => items.value.length < total.value)

// 触底加载哨兵：观察到进入视口时尝试加载下一页。
const sentinel = ref(null)
let observer = null

async function fetchPage() {
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
      loadError.value = res?.msg || '加载失败'
    } else {
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

onMounted(async () => {
  await fetchPage()
  await nextTick()
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && hasMore.value && !loading.value) {
        fetchPage()
      }
    },
    { rootMargin: '200px' },
  )
  if (sentinel.value) observer.observe(sentinel.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
})

function onRowClick(chapter) {
  emit('edit', chapter)
}

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

// 暴露刷新方法：未来章节保存成功后，父组件可以主动刷新列表。
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
    <div v-if="!initialLoaded" class="state">载入中…</div>

    <div v-else-if="loadError" class="state error">
      <span>{{ loadError }}</span>
      <Button label="重试" text size="small" @click="fetchPage" />
    </div>

    <div v-else-if="total === 0" class="state empty">
      还没有章节，点上方「添加章节」开始写作。
    </div>

    <div v-else class="chapter-table" role="table" aria-label="章节列表">
      <div class="table-head" role="row">
        <span role="columnheader">章节号</span>
        <span role="columnheader">章节标题</span>
        <span role="columnheader">创建时间</span>
        <span class="action-head" aria-hidden="true"></span>
      </div>

      <div class="rows" role="rowgroup">
        <ChapterRow
          v-for="c in items"
          :key="c.id"
          :chapter="c"
          @click="onRowClick"
          @delete="onRowDelete"
        />
      </div>
    </div>

    <div ref="sentinel" class="sentinel" aria-live="polite">
      <span v-if="loading && initialLoaded">载入更多…</span>
      <span v-else-if="initialLoaded && !hasMore && total > 0">已经到底了 · 共 {{ total }} 章</span>
    </div>
  </div>
</template>

<style scoped>
.chapter-list {
  width: 100%;
  color: oklch(28% 0.035 260);
}

.state {
  min-height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: oklch(52% 0.03 260);
  font-size: 0.95rem;
}

.state.error {
  color: oklch(55% 0.22 25);
}

.state.empty {
  color: oklch(50% 0.035 260);
}

.chapter-table {
  overflow: hidden;
  border: 1px solid oklch(88% 0.012 255);
  border-radius: 10px;
  background: oklch(99.2% 0.004 255);
}

.table-head {
  display: grid;
  grid-template-columns: 180px minmax(220px, 1fr) 260px 56px;
  align-items: center;
  min-height: 54px;
  padding: 0 28px;
  color: oklch(34% 0.032 260);
  font-size: 1rem;
  font-weight: 760;
}

.rows {
  border-top: 1px solid oklch(90% 0.01 255);
}

.sentinel {
  min-height: 40px;
  padding: 18px 0 2px;
  text-align: center;
  color: oklch(56% 0.028 260);
  font-size: 0.875rem;
}

@media (max-width: 760px) {
  .chapter-table {
    border-radius: 12px;
    border-color: transparent;
    background: transparent;
  }

  .table-head {
    display: none;
  }

  .rows {
    display: grid;
    gap: 10px;
    border-top: 0;
  }
}
</style>
