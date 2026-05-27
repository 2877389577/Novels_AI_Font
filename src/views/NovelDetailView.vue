<!--
  NovelDetailView.vue：小说详情 / 编辑 / 删除
  ----------------------------------------------------------------------------
  设计目标：
  1. 按设计图重构为浅色详情页，上方是只读小说信息卡，下方是章节表格。
  2. 原有功能不丢失，编辑能力改由“修改”按钮打开弹窗承载。
  3. 标签当前没有后端字段，因此在前端写死展示，不进入任何接口请求。
-->

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import { listAIProviderModels } from '@/api/aiProvider'
import { generateCharacterCards } from '@/api/character'
import { deleteNovel, getNovel, updateNovel } from '@/api/novel'
import CoverUploader from '@/components/CoverUploader.vue'
import ChapterList from '@/components/ChapterList.vue'
import CharacterCardsPanel from '@/components/CharacterCardsPanel.vue'
import CharacterRelationGraphPanel from '@/components/CharacterRelationGraphPanel.vue'
import GeneratedCharacterCardsDialog from '@/components/GeneratedCharacterCardsDialog.vue'
import NovelOutlinePanel from '@/components/NovelOutlinePanel.vue'

const props = defineProps({
  id: { type: Number, required: true },
})

const router = useRouter()
const confirm = useConfirm()
const toast = useToast()

// 固定标签：后端暂时没有标签接口，按设计图先在前端静态展示。
const NOVEL_TAGS = ['玄幻', '东方玄幻']

// 页面一级 Tab：角色卡和小说强绑定，因此入口放在小说详情页内部。
const DETAIL_TABS = [
  { key: 'detail', label: '小说详情' },
  { key: 'outline', label: '大纲' },
  { key: 'characters', label: '角色卡' },
  { key: 'relations', label: '角色关系图' },
]

// ───── 页面与请求状态 ─────
const novel = ref(null) // 后端返回的原始小说数据，详情卡只展示该对象
const loading = ref(true)
const loadError = ref('') // 加载阶段错误，例如小说不存在或网络错误
const saving = ref(false)
const deleting = ref(false)
const showEdit = ref(false)
const activeTab = ref('detail')

// AI 生成角色卡流程：章节行只负责触发，模型选择和生成结果都由详情页统一管理。
const showModelDialog = ref(false)
const selectedChapter = ref(null)
const modelOptions = ref([])
const selectedModelName = ref('')
const modelLoading = ref(false)
const modelError = ref('')
const showGeneratedCardsDialog = ref(false)
const generatedCards = ref([])
const generatingCards = ref(false)
const generateError = ref('')

// 编辑表单与原始数据解耦：弹窗未保存的改动不会污染详情卡展示。
const form = reactive({
  title: '',
  authorName: '',
  coverUrl: '',
  intro: '',
})

// 无封面时使用稳定渐变，让同一本书每次渲染出的默认封面颜色一致。
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

function pickGradient(title = '') {
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) & 0x7fffffff
  }
  return GRADIENTS[hash % GRADIENTS.length]
}

const fallbackCoverStyle = computed(() => {
  const [a, b] = pickGradient(novel.value?.title || form.title)
  return { background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)` }
})

// 是否有任何字段被改过：用于控制“保存”和“撤销修改”的可用状态。
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

// 详情简介展示：后端没有简介时给出克制占位，避免信息卡出现突兀空洞。
const introText = computed(() => novel.value?.intro?.trim() || '这本小说还没有简介。')

const selectedChapterLabel = computed(() => {
  if (!selectedChapter.value) return '当前章节'
  const no = selectedChapter.value.chapterNo
    ? `第 ${selectedChapter.value.chapterNo} 章`
    : '当前章节'
  return selectedChapter.value.title ? `${no}《${selectedChapter.value.title}》` : no
})

const canStartGeneration = computed(() => {
  return !modelLoading.value && !generatingCards.value && Boolean(selectedModelName.value)
})

// 将后端数据同步到编辑表单，用于打开弹窗、撤销修改、关闭弹窗后的状态复原。
function syncForm(n) {
  form.title = n?.title || ''
  form.authorName = n?.authorName || ''
  form.coverUrl = n?.coverUrl || ''
  form.intro = n?.intro || ''
}

// 拉取小说详情：业务码仍由调用方分流，保持 API 层既有契约。
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
    loadError.value = e?.status === 404 ? '小说不存在或已被删除' : e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

watch(
  () => props.id,
  () => fetchDetail(),
)
onMounted(fetchDetail)

// 打开编辑弹窗前先回填表单，保证用户看到的是服务端最新详情。
function openEdit() {
  if (!novel.value) return
  syncForm(novel.value)
  showEdit.value = true
}

// 关闭弹窗时丢弃未保存草稿，详情卡始终只反映已保存的数据。
function closeEdit() {
  syncForm(novel.value)
  showEdit.value = false
}

function onEditDialogHide() {
  syncForm(novel.value)
}

// 保存：沿用原接口，把 id 和可编辑字段一起 PUT 给后端。
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
      // 优先使用后端返回，若后端只返回成功码，则用本次 payload 合成本地展示数据。
      novel.value = res.data || { ...novel.value, ...payload }
      syncForm(novel.value)
      showEdit.value = false
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

// 删除仍走全局 ConfirmDialog，避免误删小说。
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

function goBack() {
  router.push({ name: 'shelf' })
}

// 新增章节仍进入原章节编辑页，chapterId='new' 会由路由 props 转为 null。
function toNewChapter() {
  router.push({
    name: 'chapter-edit',
    params: { id: props.id, chapterId: 'new' },
  })
}

function toEditChapter(chapter) {
  router.push({
    name: 'chapter-edit',
    params: { id: props.id, chapterId: chapter.id },
  })
}

function toChapterPlotAnalysis(payload) {
  const novelId = Number(payload?.novelId || payload?.chapter?.novelId || novel.value?.id || props.id)
  const chapterId = Number(payload?.chapterId || payload?.chapter?.id)
  if (!Number.isFinite(novelId) || !Number.isFinite(chapterId)) return
  router.push({
    name: 'chapter-plot-analysis',
    params: { novelId, chapterId },
  })
}

function normalizeModelList(value) {
  // 模型列表来自后端保存值，仍做去重和空值过滤，避免下拉框出现不可选择的空项。
  const source = Array.isArray(value) ? value : []
  const seen = new Set()
  const result = []
  source.forEach((item) => {
    const model = String(item || '').trim()
    if (!model || seen.has(model)) return
    seen.add(model)
    result.push(model)
  })
  return result
}

function normalizeGeneratedCards(value) {
  // 生成接口按数组一次性返回，这里只过滤掉非对象项，具体字段展示交给结果弹窗兜底。
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object').map((item) => ({ ...item }))
    : []
}

async function fetchModelOptions() {
  if (modelLoading.value) return
  modelLoading.value = true
  modelError.value = ''
  try {
    const res = await listAIProviderModels()
    if (res?.code === 0) {
      modelOptions.value = normalizeModelList(res.data?.models)
      selectedModelName.value = ''
    } else {
      modelError.value = res?.msg || '模型列表加载失败'
      toast.add({
        severity: 'error',
        summary: '模型加载失败',
        detail: res?.msg || '请稍后重试',
        life: 3000,
      })
    }
  } catch (e) {
    modelError.value = e?.message || '模型列表加载失败'
    toast.add({
      severity: 'error',
      summary: '网络错误',
      detail: e?.message || '请稍后重试',
      life: 3000,
    })
  } finally {
    modelLoading.value = false
  }
}

function openCharacterCardGenerator(chapter) {
  if (!chapter?.id || generatingCards.value) return
  selectedChapter.value = chapter
  selectedModelName.value = ''
  modelOptions.value = []
  modelError.value = ''
  showModelDialog.value = true
  fetchModelOptions()
}

function closeModelDialog() {
  if (modelLoading.value) return
  showModelDialog.value = false
}

function onModelSelectionChange() {
  if (!selectedModelName.value) return
  startGenerateCharacterCards()
}

async function startGenerateCharacterCards() {
  if (!canStartGeneration.value || !selectedChapter.value?.id) return
  showModelDialog.value = false
  showGeneratedCardsDialog.value = true
  generatingCards.value = true
  generatedCards.value = []
  generateError.value = ''

  try {
    const res = await generateCharacterCards(selectedChapter.value.id, selectedModelName.value)
    if (res?.code === 0) {
      generatedCards.value = normalizeGeneratedCards(res.data)
    } else {
      generateError.value = res?.msg || '角色卡生成失败'
      toast.add({
        severity: 'error',
        summary: '生成失败',
        detail: res?.msg || '请稍后重试',
        life: 3000,
      })
    }
  } catch (e) {
    generateError.value = e?.message || '角色卡生成失败'
    toast.add({
      severity: 'error',
      summary: '网络错误',
      detail: e?.message || '请稍后重试',
      life: 3000,
    })
  } finally {
    generatingCards.value = false
  }
}

function selectDetailTab(tabKey) {
  activeTab.value = tabKey
}
</script>

<template>
  <main class="detail" :class="{ 'is-outline-tab': activeTab === 'outline' }">
    <header class="page-head">
      <div>
        <button class="back-link" type="button" @click="goBack">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 18 9 12l6-6" />
          </svg>
          返回书架
        </button>
        <h1>小说详情</h1>
      </div>
    </header>

    <section v-if="loading" class="state-card" aria-live="polite">
      <div class="state-cover"></div>
      <div class="state-lines">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </section>

    <section v-else-if="loadError" class="error-card">
      <h2>小说不存在</h2>
      <p>{{ loadError }}</p>
      <Button label="返回书架" @click="goBack" />
    </section>

    <template v-else-if="novel">
      <nav class="detail-tabs" role="tablist" aria-label="小说详情分区">
        <button
          v-for="tab in DETAIL_TABS"
          :id="`detail-tab-${tab.key}`"
          :key="tab.key"
          class="tab-button"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.key"
          :aria-controls="`detail-panel-${tab.key}`"
          @click="selectDetailTab(tab.key)"
        >
          {{ tab.label }}
        </button>
      </nav>

      <div
        v-if="activeTab === 'detail'"
        id="detail-panel-detail"
        role="tabpanel"
        aria-labelledby="detail-tab-detail"
      >
        <section class="hero-card" aria-labelledby="novel-title">
          <div class="cover-panel">
            <img
              v-if="novel.coverUrl"
              :src="novel.coverUrl"
              :alt="`${novel.title || '未命名'}封面`"
            />
            <div v-else class="cover-fallback" :style="fallbackCoverStyle">
              <strong>{{ novel.title || '未命名' }}</strong>
              <span v-if="novel.authorName">{{ novel.authorName }} 著</span>
            </div>
          </div>

          <div class="novel-copy">
            <h2 id="novel-title">{{ novel.title || '未命名' }}</h2>

            <p class="author-line">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm7 9a7 7 0 0 0-14 0" />
              </svg>
              <span>小说作者：</span>
              <strong>{{ novel.authorName || '佚名' }}</strong>
            </p>

            <div class="tags" aria-label="小说标签">
              <span v-for="tag in NOVEL_TAGS" :key="tag">{{ tag }}</span>
            </div>

            <p class="intro">{{ introText }}</p>
          </div>

          <div class="hero-actions" aria-label="小说操作">
            <button
              class="action-button"
              type="button"
              :aria-label="`修改《${novel.title || '未命名'}》`"
              @click="openEdit"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m4 20 4.4-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" />
                <path d="m14 6 4 4" />
              </svg>
              修改
            </button>

            <button class="action-button primary" type="button" @click="toNewChapter">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              添加章节
            </button>

            <button
              class="action-button danger"
              type="button"
              :disabled="deleting"
              @click="onDelete"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16" />
                <path d="M10 11v6M14 11v6" />
                <path d="M6 7l1 14h10l1-14M9 7V4h6v3" />
              </svg>
              {{ deleting ? '删除中' : '删除小说' }}
            </button>
          </div>
        </section>

        <section class="chapters-card" aria-labelledby="chapters-title">
          <h2 id="chapters-title" class="sr-only">章节列表</h2>
          <ChapterList
            :novel-id="novel.id"
            @edit="toEditChapter"
            @generate-character-card="openCharacterCardGenerator"
            @plot-analysis="toChapterPlotAnalysis"
          />
        </section>
      </div>

      <div
        v-else-if="activeTab === 'outline'"
        id="detail-panel-outline"
        class="outline-tab-panel"
        role="tabpanel"
        aria-labelledby="detail-tab-outline"
      >
        <NovelOutlinePanel :novel-id="novel.id" />
      </div>

      <div
        v-else-if="activeTab === 'characters'"
        id="detail-panel-characters"
        class="characters-tab-panel"
        role="tabpanel"
        aria-labelledby="detail-tab-characters"
      >
        <CharacterCardsPanel :novel-id="novel.id" :novel-title="novel.title || ''" />
      </div>

      <div
        v-else-if="activeTab === 'relations'"
        id="detail-panel-relations"
        class="relations-tab-panel"
        role="tabpanel"
        aria-labelledby="detail-tab-relations"
      >
        <CharacterRelationGraphPanel :novel-id="novel.id" :novel-title="novel.title || ''" />
      </div>

      <Dialog
        v-model:visible="showEdit"
        header="修改小说"
        :modal="true"
        :draggable="false"
        :closable="!saving"
        :style="{ width: '560px', maxWidth: 'calc(100vw - 32px)' }"
        class="edit-dialog"
        @hide="onEditDialogHide"
      >
        <form class="edit-form" @submit.prevent="onSave">
          <label class="field">
            <span>书名 <em>*</em></span>
            <InputText v-model="form.title" placeholder="请输入书名" autofocus />
          </label>

          <label class="field">
            <span>作者</span>
            <InputText v-model="form.authorName" placeholder="选填" />
          </label>

          <!--
            这里继续使用 div 包裹 CoverUploader。
            若改成 label，浏览器会把内部隐藏 file input 识别为 control，
            点击上传区域时会额外触发一次默认行为，导致文件选择器弹两次。
          -->
          <div class="field">
            <span>封面</span>
            <CoverUploader v-model="form.coverUrl" />
            <small>未上传时使用书名作为默认封面</small>
          </div>

          <label class="field">
            <span>简介</span>
            <Textarea v-model="form.intro" rows="5" placeholder="选填" />
          </label>
        </form>

        <template #footer>
          <Button label="撤销修改" text :disabled="!dirty || saving" @click="syncForm(novel)" />
          <Button label="取消" text :disabled="saving" @click="closeEdit" />
          <Button label="保存" :disabled="!dirty || saving" :loading="saving" @click="onSave" />
        </template>
      </Dialog>

      <Dialog
        v-model:visible="showModelDialog"
        header="选择生成模型"
        :modal="true"
        :draggable="false"
        :closable="!modelLoading"
        :style="{ width: '520px', maxWidth: 'calc(100vw - 32px)' }"
        class="model-dialog"
      >
        <section class="model-picker" aria-live="polite">
          <div class="model-target">
            <span>章节</span>
            <strong>{{ selectedChapterLabel }}</strong>
          </div>

          <div v-if="modelLoading" class="model-loading">
            <span class="model-spinner" aria-hidden="true"></span>
            <span>正在读取可用模型...</span>
          </div>

          <div v-else-if="modelError" class="model-state error">
            <p>{{ modelError }}</p>
            <button type="button" @click="fetchModelOptions">重试</button>
          </div>

          <div v-else-if="modelOptions.length === 0" class="model-state">
            <p>当前启用的 AI 提供商没有可用模型。</p>
          </div>

          <label v-else class="model-field">
            <span>模型</span>
            <select v-model="selectedModelName" @change="onModelSelectionChange">
              <option value="" disabled>请选择模型</option>
              <option v-for="model in modelOptions" :key="model" :value="model">
                {{ model }}
              </option>
            </select>
          </label>
        </section>

        <template #footer>
          <Button label="取消" text :disabled="modelLoading" @click="closeModelDialog" />
        </template>
      </Dialog>

      <GeneratedCharacterCardsDialog
        v-model:visible="showGeneratedCardsDialog"
        :loading="generatingCards"
        :error="generateError"
        :cards="generatedCards"
        :chapter="selectedChapter"
        :model-name="selectedModelName"
        :novel-id="novel.id"
        @retry="startGenerateCharacterCards"
      />
    </template>
  </main>
</template>

<style scoped>
.detail {
  min-height: 100vh;
  padding: 36px 68px 40px;
  background:
    radial-gradient(circle at 18% 8%, oklch(96% 0.018 250) 0, transparent 34rem),
    linear-gradient(180deg, oklch(99% 0.006 255), oklch(96.5% 0.008 255));
  color: oklch(24% 0.035 260);
  font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}

.detail.is-outline-tab {
  /* 大纲是整屏写作工作台：外层锁在当前视口内，滚动交给左右编辑/预览面板。 */
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.detail.is-outline-tab .page-head {
  position: relative;
  width: 100%;
  max-width: none;
  flex: 0 0 auto;
}

.detail.is-outline-tab .back-link {
  /* 大纲页头部标题仍居中，但返回入口必须保持在左上角，避免被整屏 flex 布局居中。 */
  position: absolute;
  left: 0;
  top: 0;
}

.detail.is-outline-tab .page-head > div {
  width: 100%;
  text-align: center;
}

.page-head {
  max-width: 1780px;
  margin: 0 auto 28px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.page-head h1 {
  margin: 8px 0 0;
  font-size: 2rem;
  line-height: 1.15;
  font-weight: 750;
  color: oklch(24% 0.035 260);
}

.back-link {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: oklch(50% 0.04 260);
  font-size: 0.875rem;
  cursor: pointer;
  transition:
    color 0.18s ease,
    transform 0.18s ease;
}

.back-link svg,
.action-button svg,
.author-line svg {
  width: 1.25rem;
  height: 1.25rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.back-link:hover {
  color: oklch(48% 0.18 258);
  transform: translateX(-2px);
}

.back-link:focus-visible,
.tab-button:focus-visible,
.action-button:focus-visible,
.delete-row:focus-visible,
.model-field select:focus-visible,
.model-state button:focus-visible {
  outline: 3px solid oklch(76% 0.14 250 / 0.55);
  outline-offset: 3px;
}

.detail-tabs {
  width: fit-content;
  max-width: 1780px;
  margin: 0 auto 18px;
  display: flex;
  gap: 6px;
  padding: 5px;
  border: 1px solid oklch(87% 0.014 255);
  border-radius: 13px;
  background: oklch(96.5% 0.008 255);
}

.tab-button {
  min-width: 128px;
  min-height: 42px;
  padding: 0 20px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: oklch(42% 0.035 260);
  font-size: 0.95rem;
  font-weight: 740;
  cursor: pointer;
  transition:
    background 0.18s ease,
    box-shadow 0.18s ease,
    color 0.18s ease;
}

.tab-button:hover {
  color: oklch(48% 0.16 255);
}

.tab-button[aria-selected='true'] {
  background: oklch(99.2% 0.004 255);
  color: oklch(48% 0.18 258);
  box-shadow: 0 8px 18px oklch(42% 0.04 260 / 0.1);
}

.hero-card,
.chapters-card,
.state-card,
.error-card {
  max-width: 1780px;
  margin: 0 auto;
  border: 1px solid oklch(88% 0.012 255);
  border-radius: 16px;
  background: oklch(99.2% 0.004 255);
  box-shadow:
    0 18px 44px oklch(45% 0.04 260 / 0.1),
    0 1px 2px oklch(45% 0.04 260 / 0.08);
}

.hero-card {
  min-height: 492px;
  display: grid;
  grid-template-columns: minmax(220px, 320px) minmax(360px, 1fr) auto;
  gap: 84px;
  align-items: center;
  padding: 32px 42px 28px 72px;
}

.cover-panel {
  width: min(100%, 320px);
  /* 小说封面更接近手机/书封的竖向比例，避免把真实封面裁成方图。 */
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: 12px;
  background: oklch(93% 0.012 255);
  box-shadow:
    0 16px 32px oklch(38% 0.06 260 / 0.18),
    inset 0 0 0 1px oklch(100% 0 0 / 0.72);
}

.cover-panel img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.cover-fallback {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 28px;
  color: oklch(98% 0.008 255);
  text-align: center;
}

.cover-fallback strong {
  max-width: 12ch;
  font-size: 2rem;
  line-height: 1.22;
  font-weight: 760;
  text-wrap: balance;
}

.cover-fallback span {
  font-size: 0.9rem;
  opacity: 0.82;
}

.novel-copy {
  min-width: 0;
  align-self: center;
  padding-top: 8px;
}

.novel-copy h2 {
  margin: 0;
  color: oklch(23% 0.045 260);
  font-size: 3.75rem;
  line-height: 1.08;
  font-weight: 800;
  letter-spacing: 0;
  text-wrap: balance;
}

.author-line {
  margin: 34px 0 0;
  display: flex;
  align-items: center;
  gap: 10px;
  color: oklch(32% 0.035 260);
  font-size: 1.25rem;
  line-height: 1.4;
}

.author-line svg {
  color: oklch(58% 0.16 254);
  fill: oklch(72% 0.12 254 / 0.28);
}

.author-line strong {
  font-weight: 720;
}

.tags {
  margin-top: 28px;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.tags span {
  display: inline-flex;
  align-items: center;
  min-height: 38px;
  padding: 0 24px;
  border-radius: 10px;
  background: oklch(94% 0.018 255);
  color: oklch(48% 0.16 254);
  font-size: 1rem;
  font-weight: 700;
}

.intro {
  max-width: 66ch;
  margin: 26px 0 0;
  color: oklch(43% 0.025 260);
  font-size: 1.125rem;
  line-height: 1.85;
  text-wrap: pretty;
}

.hero-actions {
  align-self: start;
  display: grid;
  grid-template-columns: repeat(3, minmax(132px, 1fr));
  gap: 14px;
  min-width: 470px;
  padding-top: 34px;
  white-space: nowrap;
}

.action-button {
  min-width: 0;
  min-height: 58px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 0 18px;
  border: 1px solid oklch(82% 0.024 255);
  border-radius: 9px;
  background: oklch(99.4% 0.003 255);
  color: oklch(35% 0.035 260);
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.action-button:hover {
  border-color: oklch(72% 0.1 255);
  box-shadow: 0 10px 24px oklch(52% 0.08 255 / 0.12);
  transform: translateY(-1px);
}

.action-button.primary {
  color: oklch(52% 0.2 258);
}

.action-button.danger {
  border-color: oklch(84% 0.065 24);
  color: oklch(55% 0.22 25);
}

.action-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
  transform: none;
  box-shadow: none;
}

.chapters-card {
  margin-top: 28px;
  padding: 30px 34px 18px;
}

.characters-tab-panel,
.relations-tab-panel {
  max-width: 1780px;
  margin: 0 auto;
}

.outline-tab-panel {
  width: 100%;
  max-width: none;
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  margin: 0;
}

.state-card {
  min-height: 360px;
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 48px;
  align-items: center;
  padding: 42px 72px;
}

.state-cover,
.state-lines span {
  border-radius: 12px;
  background: linear-gradient(
    90deg,
    oklch(93% 0.01 255) 0%,
    oklch(97% 0.006 255) 50%,
    oklch(93% 0.01 255) 100%
  );
  background-size: 200% 100%;
  animation: shine 1.3s linear infinite;
}

.state-cover {
  aspect-ratio: 3 / 4;
}

.state-lines {
  display: grid;
  gap: 22px;
}

.state-lines span {
  height: 22px;
}

.state-lines span:first-child {
  width: min(480px, 70%);
  height: 56px;
}

.state-lines span:nth-child(2) {
  width: min(360px, 54%);
}

.state-lines span:nth-child(3) {
  width: min(680px, 88%);
}

@keyframes shine {
  to {
    background-position: -200% 0;
  }
}

.error-card {
  min-height: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 48px;
  text-align: center;
}

.error-card h2 {
  margin: 0;
  color: oklch(28% 0.04 260);
  font-size: 1.5rem;
}

.error-card p {
  margin: 0 0 8px;
  color: oklch(48% 0.035 260);
}

.edit-form {
  display: grid;
  gap: 18px;
  padding-top: 4px;
}

.field {
  display: grid;
  gap: 8px;
}

.field > span {
  color: oklch(34% 0.035 260);
  font-size: 0.875rem;
  font-weight: 700;
}

.field em {
  color: oklch(55% 0.22 25);
  font-style: normal;
}

.field small {
  color: oklch(52% 0.03 260);
  font-size: 0.75rem;
}

.field :deep(.p-inputtext),
.field :deep(.p-textarea) {
  width: 100%;
}

.model-picker {
  display: grid;
  gap: 18px;
}

.model-target {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid oklch(88% 0.012 255);
  border-radius: 12px;
  background: oklch(98.5% 0.006 255);
}

.model-target span,
.model-field > span {
  color: oklch(52% 0.03 260);
  font-size: 0.8rem;
  font-weight: 760;
}

.model-target strong {
  color: oklch(26% 0.04 260);
  font-size: 1rem;
  line-height: 1.45;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.model-loading {
  min-height: 96px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: oklch(48% 0.035 260);
  font-size: 0.94rem;
}

.model-spinner {
  width: 21px;
  height: 21px;
  border: 2px solid oklch(84% 0.02 255);
  border-top-color: oklch(54% 0.18 258);
  border-radius: 50%;
  animation: model-spin 0.82s linear infinite;
}

@keyframes model-spin {
  to {
    transform: rotate(360deg);
  }
}

.model-state {
  min-height: 116px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  border: 1px solid oklch(88% 0.012 255);
  border-radius: 12px;
  background: oklch(98.5% 0.006 255);
  text-align: center;
}

.model-state.error {
  border-color: oklch(86% 0.05 24);
  background: oklch(98% 0.014 24);
}

.model-state p {
  max-width: 30rem;
  margin: 0;
  color: oklch(48% 0.032 260);
  line-height: 1.7;
}

.model-state.error p {
  color: oklch(52% 0.18 24);
}

.model-state button {
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid oklch(82% 0.026 255);
  border-radius: 8px;
  background: oklch(99% 0.004 255);
  color: oklch(48% 0.16 255);
  font: inherit;
  font-size: 0.86rem;
  font-weight: 760;
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    transform 0.18s ease;
}

.model-state button:hover {
  border-color: oklch(70% 0.08 255);
  background: oklch(95% 0.022 255);
  transform: translateY(-1px);
}

.model-field {
  display: grid;
  gap: 8px;
}

.model-field select {
  min-height: 46px;
  width: 100%;
  padding: 0 12px;
  border: 1px solid oklch(84% 0.018 255);
  border-radius: 9px;
  outline: 0;
  background: oklch(99% 0.004 255);
  color: oklch(26% 0.035 260);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}

.model-field select:hover {
  border-color: oklch(72% 0.08 255);
  background: oklch(98% 0.008 255);
}

/*
  PrimeVue Dialog 会渲染到浮层层级，组件内部的 header/content/footer
  不会完全吃到本页 scoped 选择器。因此这里用 :global 精准覆盖
  .edit-dialog 这一处弹窗，把默认深色主题压成和详情页一致的浅色卡片。
*/
:global(.p-dialog-mask:has(.edit-dialog)) {
  background: oklch(20% 0.035 260 / 0.28);
  backdrop-filter: blur(3px);
}

:global(.edit-dialog.p-dialog) {
  overflow: hidden;
  border: 1px solid oklch(87% 0.014 255);
  border-radius: 16px;
  background: oklch(99.2% 0.004 255);
  color: oklch(26% 0.035 260);
  box-shadow:
    0 24px 70px oklch(34% 0.045 260 / 0.22),
    0 1px 2px oklch(34% 0.045 260 / 0.1);
}

:global(.edit-dialog .p-dialog-header) {
  padding: 22px 24px 16px;
  border-bottom: 1px solid oklch(91% 0.01 255);
  background: oklch(99.2% 0.004 255);
  color: oklch(24% 0.035 260);
}

:global(.edit-dialog .p-dialog-title) {
  font-size: 1.125rem;
  font-weight: 760;
}

:global(.edit-dialog .p-dialog-header-icon) {
  color: oklch(42% 0.035 260);
}

:global(.edit-dialog .p-dialog-header-icon:hover) {
  background: oklch(94% 0.014 255);
  color: oklch(48% 0.18 258);
}

:global(.edit-dialog .p-dialog-content) {
  padding: 22px 24px 8px;
  background: oklch(99.2% 0.004 255);
  color: oklch(28% 0.035 260);
}

:global(.edit-dialog .p-dialog-footer) {
  gap: 10px;
  padding: 16px 24px 22px;
  border-top: 1px solid oklch(91% 0.01 255);
  background: oklch(99.2% 0.004 255);
}

:global(.edit-dialog .p-inputtext),
:global(.edit-dialog .p-textarea) {
  border-color: oklch(84% 0.018 255);
  background: oklch(99% 0.004 255);
  color: oklch(26% 0.035 260);
}

:global(.edit-dialog .p-inputtext::placeholder),
:global(.edit-dialog .p-textarea::placeholder) {
  color: oklch(58% 0.028 260);
}

:global(.edit-dialog .p-inputtext:hover),
:global(.edit-dialog .p-textarea:hover) {
  border-color: oklch(72% 0.08 255);
}

:global(.edit-dialog .p-inputtext:enabled:focus),
:global(.edit-dialog .p-textarea:enabled:focus) {
  border-color: oklch(56% 0.17 258);
  box-shadow: 0 0 0 3px oklch(78% 0.13 255 / 0.32);
}

:global(.edit-dialog .p-button) {
  border-radius: 9px;
}

:global(.edit-dialog .p-button-text) {
  color: oklch(42% 0.04 260);
}

:global(.edit-dialog .p-button-text:hover) {
  background: oklch(94% 0.014 255);
  color: oklch(48% 0.18 258);
}

:global(.p-dialog-mask:has(.model-dialog)) {
  background: oklch(20% 0.035 260 / 0.28);
  backdrop-filter: blur(3px);
}

:global(.model-dialog.p-dialog) {
  overflow: hidden;
  border: 1px solid oklch(87% 0.014 255);
  border-radius: 16px;
  background: oklch(99.2% 0.004 255);
  color: oklch(26% 0.035 260);
  box-shadow:
    0 24px 70px oklch(34% 0.045 260 / 0.22),
    0 1px 2px oklch(34% 0.045 260 / 0.1);
}

:global(.model-dialog .p-dialog-header),
:global(.model-dialog .p-dialog-content),
:global(.model-dialog .p-dialog-footer) {
  background: oklch(99.2% 0.004 255);
  color: oklch(24% 0.035 260);
}

:global(.model-dialog .p-dialog-header) {
  padding: 22px 24px 16px;
  border-bottom: 1px solid oklch(91% 0.01 255);
}

:global(.model-dialog .p-dialog-title) {
  font-size: 1.125rem;
  font-weight: 760;
}

:global(.model-dialog .p-dialog-content) {
  padding: 22px 24px 8px;
}

:global(.model-dialog .p-dialog-footer) {
  gap: 10px;
  padding: 16px 24px 22px;
  border-top: 1px solid oklch(91% 0.01 255);
}

:global(.model-dialog .p-dialog-header-icon) {
  color: oklch(42% 0.035 260);
}

:global(.model-dialog .p-dialog-header-icon:hover) {
  background: oklch(94% 0.014 255);
  color: oklch(48% 0.18 258);
}

:global(.model-dialog .p-button) {
  border-radius: 9px;
}

:global(.model-dialog .p-button-text) {
  color: oklch(42% 0.04 260);
}

:global(.model-dialog .p-button-text:hover) {
  background: oklch(94% 0.014 255);
  color: oklch(48% 0.18 258);
}

/*
  CoverUploader 是复用组件，默认服务深色书架/旧详情页。
  在浅色编辑弹窗内用更高特异性的全局选择器局部覆盖，不改组件自身，
  避免影响书架新增小说弹窗等既有深色场景。
*/
:global(.edit-dialog .uploader .drop) {
  border-color: oklch(82% 0.026 255);
  background: oklch(97% 0.01 255);
}

:global(.edit-dialog .uploader .drop:hover),
:global(.edit-dialog .uploader .drop:focus-visible) {
  border-color: oklch(62% 0.15 255);
  background: oklch(95% 0.026 255);
}

:global(.edit-dialog .uploader .drop.is-drag) {
  border-color: oklch(56% 0.18 258);
  background: oklch(93% 0.042 255);
}

:global(.edit-dialog .uploader .placeholder) {
  color: oklch(50% 0.03 260);
}

:global(.edit-dialog .uploader .placeholder .icon) {
  color: oklch(52% 0.16 258);
}

:global(.edit-dialog .uploader .placeholder .primary) {
  color: oklch(34% 0.035 260);
}

:global(.edit-dialog .uploader .placeholder .secondary),
:global(.edit-dialog .uploader .uploading) {
  color: oklch(55% 0.028 260);
}

:global(.edit-dialog .uploader .spinner) {
  border-color: oklch(82% 0.026 255);
  border-top-color: oklch(56% 0.18 258);
}

:global(.edit-dialog .uploader .preview) {
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

@media (max-width: 1320px) {
  .detail {
    padding-inline: 40px;
  }

  .hero-card {
    grid-template-columns: 280px minmax(0, 1fr);
    gap: 48px;
    padding: 34px 40px;
  }

  .hero-actions {
    grid-column: 1 / -1;
    width: 100%;
    padding-top: 0;
    grid-template-columns: repeat(3, minmax(132px, 170px));
    justify-content: flex-end;
  }
}

@media (max-width: 820px) {
  .detail {
    padding: 24px 18px 32px;
  }

  .detail.is-outline-tab {
    height: auto;
    min-height: 100vh;
    overflow: visible;
  }

  .page-head {
    margin-bottom: 18px;
  }

  .page-head h1 {
    font-size: 1.75rem;
  }

  .detail-tabs {
    width: 100%;
    margin-bottom: 14px;
  }

  .tab-button {
    flex: 1 1 0;
    min-width: 0;
  }

  .hero-card {
    grid-template-columns: 1fr;
    gap: 28px;
    padding: 24px;
  }

  .cover-panel {
    width: min(100%, 280px);
    justify-self: center;
  }

  .novel-copy h2 {
    font-size: 2.45rem;
  }

  .author-line {
    margin-top: 22px;
    font-size: 1rem;
  }

  .tags {
    gap: 10px;
    margin-top: 20px;
  }

  .tags span {
    min-height: 34px;
    padding-inline: 16px;
    font-size: 0.875rem;
  }

  .intro {
    font-size: 1rem;
  }

  .hero-actions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .action-button {
    width: 100%;
    min-height: 52px;
  }

  .chapters-card {
    margin-top: 18px;
    padding: 18px 14px 10px;
  }

  .state-card {
    grid-template-columns: 1fr;
    padding: 24px;
  }

  .state-cover {
    width: min(100%, 220px);
    justify-self: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .model-spinner {
    animation-duration: 0.01ms;
    animation-iteration-count: 1;
  }

  .model-state button,
  .model-field select {
    transition-duration: 0.01ms;
  }

  .model-state button:hover {
    transform: none;
  }
}
</style>
