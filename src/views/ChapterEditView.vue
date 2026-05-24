<!--
  ChapterEditView.vue —— 小说章节编辑页（新建 / 查看 / 编辑 / 删除 四态合一）
  ----------------------------------------------------------------------------
  视觉规范：纸面白底 + 居中标题（第 N 章 / 标题）+ 无边框正文 + 底部 sticky 工具栏
  —— 与书架/详情页的暗色 sci-fi 风形成「浏览 vs 创作」的视觉分层，
     强调创作模式的专注感（仿纸笔写作环境）。

  路由约定：
    /novel/:id/chapter/new           → 新建模式：props.chapterId === null
    /novel/:id/chapter/:chapterId    → 查看 / 编辑模式：props.chapterId 为数字

  顶部章节号：
    · 新建态：调 GET /novels/{id}/chapters/next-no 拿建议编号，与标题同行展示
    · 编辑态：直接读 chapter.chapterNo 显示
    · **前端不可编辑**：用横线下划线 + 数字的静态展示，避免视觉误导

  正文区：
    · 用 PrimeVue Textarea + autoResize，让 textarea 顺内容增长
    · 首行自动缩进通过 CSS text-indent: 2em 实现，后端只存纯文本（含换行）
    · 字数统计 = 剔除所有空白后的字符数（含标点，符合需求）

  保存：
    · 新建调 createChapter（body 四字段全送）
    · 编辑调 updateChapter（送 chapterNo/title/content/wordCount，chapterNo 来自详情回填，不提供 UI 编辑）
    · 保存成功 → router.replace 回详情页（**replace** 避免后退栈出现 /chapter/new 死链）

  离开拦截：
    · dirty 时点底部「← 返回详情」弹 ConfirmDialog 二次确认

  关于底部工具栏的取舍：
    · 参考图里有"撤销/重做/字体格式/AI 写作/评论"等图标，但本项目这些功能尚未接入；
      为避免给用户假按钮（CLAUDE.md「不做未要求的功能」），底部工具栏只放真实有效的
      四个入口：返回详情 / 字数显示 / 删除（仅编辑态） / 保存。
-->

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import {
  createChapter,
  deleteChapter,
  getChapter,
  getNextChapterNo,
  updateChapter,
} from '@/api/chapter'
import { listAIProviderModels } from '@/api/aiProvider'
import { optimizeNovelContent } from '@/api/novel'
import { formatDateTime } from '@/utils/datetime'

const props = defineProps({
  // 所属小说 ID
  novelId: { type: Number, required: true },
  // 章节 ID：null 表示新建模式（来自路由 chapterId='new' 时的转换）
  chapterId: { type: Number, default: null },
})

const router = useRouter()
const confirm = useConfirm()
const toast = useToast()

// 是否新建模式：整页很多逻辑都靠这个分支
const isNew = computed(() => props.chapterId === null)

// ───── 状态 ─────
const chapter = ref(null) // 编辑态从后端拉到的原始数据
const suggestedChapterNo = ref(null) // 新建态从 next-no 拿到的建议编号
const loading = ref(true) // 进页初始加载（拉详情 / 拉 next-no）
const loadError = ref('') // 加载阶段错误（如 404）
const saving = ref(false)
const deleting = ref(false)

// 编辑表单：title/content 是用户可改字段；chapterNo 由后端控制不放表单里
const form = reactive({
  title: '',
  content: '',
})

// ───── 正文：contenteditable + 段落化 DOM ─────
// 为什么不再用 textarea：textarea 内所有 \n 是同段内的软换行，
// CSS text-indent 只能让"整体视觉首行"缩进一次；用户希望"每段首行都缩进"。
// 解决：用 contenteditable div + 每段独立 <p>，每个 <p> 是块级容器，
// 各自的 text-indent: 2em 自然生效；form.content 仍是纯文本（按 \n 分段），
// 后端取回时无任何额外字符，"后端只存纯文本"的契约不被破坏。
const contentRef = ref(null)
const optimizePopoverRef = ref(null)
// IME 组合输入态（中文/日文输入法）：组合中不要回写 form.content
const isComposing = ref(false)
// 防止"DOM → form.content → watch → 再渲染 DOM"的循环；
// 用户输入触发的更新只走"DOM → form.content"单程
let renderingFromWatch = false

// ───── AI 润色状态 ─────
const modelOptions = ref([])
const modelOptionsLoaded = ref(false)
const modelLoading = ref(false)
const modelError = ref('')
const selectedModelName = ref('')
const optimizeDirection = ref('')
const optimizing = ref(false)
const optimizeRejectReason = ref('')
const optimizeOriginalContent = ref('')
const optimizePreviewContent = ref('')
const contentLineCount = ref(1)

const optimizeOriginalRange = reactive({
  start: 0,
  end: 0,
})
const optimizePreviewRange = reactive({
  start: 0,
  end: 0,
})

const optimizeSelection = reactive({
  visible: false,
  left: 0,
  top: 0,
  start: 0,
  end: 0,
  selectedContent: '',
})

// HTML 转义：用户纯文本写入 innerHTML 前必做，避免 < > & 被当成标签
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function normalizeLineBreaks(text = '') {
  return String(text).replace(/\r\n?/g, '\n')
}

function lineNumbersOf(text = '') {
  return Array.from(
    { length: Math.max(1, normalizeLineBreaks(text).split('\n').length) },
    (_, i) => i + 1,
  )
}

function lineNumbersByCount(count = 1) {
  return Array.from({ length: Math.max(1, Number(count) || 1) }, (_, i) => i + 1)
}

function cssPixelNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function renderedLineHeight(el, fallback = 34) {
  if (!el) return fallback
  const style = window.getComputedStyle(el)
  const fontSize = cssPixelNumber(style.fontSize, 17)
  const lineHeight = cssPixelNumber(style.lineHeight, fontSize * 2)
  return Math.max(1, lineHeight)
}

function lineCountFromRenderedHeight(height, lineHeight) {
  if (!Number.isFinite(height) || height <= 0) return 0
  // 按真实渲染高度计算可见行数，能覆盖长段落自动换行和浏览器生成的末尾段落结构。
  return Math.max(1, Math.round(height / lineHeight))
}

function textNodeLineCount(node, lineHeight) {
  if (!node?.textContent) return 0
  const range = document.createRange()
  range.selectNodeContents(node)
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 || rect.height > 0)
  range.detach?.()

  if (rects.length > 0) {
    const visualRows = new Set(rects.map((rect) => Math.round(rect.top)))
    return Math.max(1, visualRows.size)
  }

  return Math.max(1, normalizeLineBreaks(node.textContent).split('\n').length)
}

function editableLineCount(el) {
  if (!el) return 1
  const rootLineHeight = renderedLineHeight(el)
  const count = [...el.childNodes].reduce((total, node) => {
    if (node.nodeType === Node.TEXT_NODE) return total + textNodeLineCount(node, rootLineHeight)
    if (node.nodeName === 'BR') return total + 1
    if (node.nodeType !== Node.ELEMENT_NODE) return total

    const nodeLineHeight = renderedLineHeight(node, rootLineHeight)
    return total + lineCountFromRenderedHeight(node.getBoundingClientRect().height, nodeLineHeight)
  }, 0)
  return Math.max(1, count)
}

function refreshContentLineCount() {
  // 行号必须跟随 contenteditable 的真实段落节点，而不只依赖 form.content。
  // 浏览器在编辑末尾段落时可能先更新 DOM、再触发文本同步；只读 form.content 会短暂少算尾部行号。
  const textLineCount = lineNumbersOf(form.content).length
  const domLineCount = editableLineCount(contentRef.value)
  contentLineCount.value = Math.max(textLineCount, domLineCount)
}

let contentLineRefreshFrame = 0
function scheduleContentLineCountRefresh() {
  if (contentLineRefreshFrame) window.cancelAnimationFrame(contentLineRefreshFrame)
  // contenteditable 的 input 事件可能早于浏览器完成段落排版，延后一帧可避免末尾行号少算。
  contentLineRefreshFrame = window.requestAnimationFrame(() => {
    contentLineRefreshFrame = 0
    refreshContentLineCount()
  })
}

function normalizeOptimizedContent(rawContent, selectedContent) {
  const sourceHasBlankLines = /\n\s*\n/.test(normalizeLineBreaks(selectedContent))
  const normalized = normalizeLineBreaks(rawContent).replace(/^\n+|\n+$/g, '')

  // AI 偶尔会把普通换行扩成空行。若用户原选区没有空段，就把连续换行压回单换行；
  // 若原选区本来有空段，则最多保留一个空段，避免接受润色后正文出现成片空白。
  return sourceHasBlankLines
    ? normalized.replace(/\n{3,}/g, '\n\n')
    : normalized.replace(/\n{2,}/g, '\n')
}

// 把纯文本反序列化为 <p> 列表 innerHTML：每段一个 <p>，空段用 <br> 占位避免高度坍塌
// 空文档也返回一个空 <p><br></p>：让用户输入有 <p> 容器落点，
// 否则 Chrome 在空 contenteditable 上首次输入会创建裸文本节点，:deep(p) 选择器无法匹配
function deserializeContent(text) {
  if (!text) return '<p><br></p>'
  return normalizeLineBreaks(text)
    .split('\n')
    .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
    .join('')
}

function renderLineWithHighlight(line, lineStart, highlightStart, highlightEnd) {
  const lineEnd = lineStart + line.length
  if (highlightEnd <= lineStart || highlightStart >= lineEnd) {
    return escapeHtml(line) || '<br>'
  }

  const startInLine = Math.max(0, highlightStart - lineStart)
  const endInLine = Math.min(line.length, highlightEnd - lineStart)
  if (endInLine <= startInLine) return escapeHtml(line) || '<br>'

  const before = line.slice(0, startInLine)
  const marked = line.slice(startInLine, endInLine)
  const after = line.slice(endInLine)
  return `${escapeHtml(before)}<mark class="optimize-highlight">${escapeHtml(marked)}</mark>${escapeHtml(after)}`
}

function deserializeContentWithHighlight(text, range) {
  const start = Number(range?.start)
  const end = Number(range?.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return deserializeContent(text)
  }

  let cursor = 0
  const lines = normalizeLineBreaks(text).split('\n')
  return lines
    .map((line) => {
      const lineStart = cursor
      const lineHtml = renderLineWithHighlight(line, lineStart, start, end)
      cursor += line.length + 1
      return `<p>${lineHtml || '<br>'}</p>`
    })
    .join('')
}

// 把当前 contenteditable 的 DOM 序列化回纯文本（按 \n 分段，无任何 HTML）
// 兼容浏览器三种自然行为：
//   · Chrome 默认：每段一个 <div> 或 <p>
//   · Firefox 默认：用 <br> 软换行（已通过 onEnterKey 强制改为段落，但兜底处理）
//   · 用户首次输入：可能是 .content-area 的直接文本节点
function serializeContent(el) {
  if (!el) return ''
  const lines = []
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      lines.push(node.textContent)
    } else if (node.nodeName === 'P' || node.nodeName === 'DIV') {
      lines.push(node.textContent || '')
    } else if (node.nodeName === 'BR') {
      lines.push('')
    }
  }
  return lines.join('\n')
}

function normalizeModelList(models) {
  if (!Array.isArray(models)) return []
  return [...new Set(models.map((item) => String(item || '').trim()).filter(Boolean))]
}

function childTextLength(node) {
  return node?.textContent?.length || 0
}

function topLevelChildOf(root, node) {
  if (!root || !node || node === root) return null
  let current = node
  while (current && current.parentNode !== root) {
    current = current.parentNode
  }
  return current?.parentNode === root ? current : null
}

function offsetWithinTopLevelChild(topChild, node, offset) {
  if (node === topChild && node.nodeType === Node.ELEMENT_NODE) {
    return [...node.childNodes]
      .slice(0, offset)
      .reduce((total, child) => total + childTextLength(child), 0)
  }

  // 用 Range 计算段落内部 offset，能兼容文本节点、内联节点以及浏览器生成的嵌套节点。
  const range = document.createRange()
  range.setStart(topChild, 0)
  range.setEnd(node, offset)
  return range.toString().length
}

function plainTextOffsetOfBoundary(root, node, offset) {
  if (!root || !node) return null

  if (node === root) {
    const children = [...root.childNodes]
    return children
      .slice(0, offset)
      .reduce(
        (total, child, index) =>
          total + childTextLength(child) + (index < children.length - 1 ? 1 : 0),
        0,
      )
  }

  const topChild = topLevelChildOf(root, node)
  if (!topChild) return null
  const topIndex = [...root.childNodes].indexOf(topChild)
  if (topIndex < 0) return null

  // serializeContent 会用 "\n" 拼接每个顶层段落，因此每个前置顶层节点后都要补 1 个换行 offset。
  const beforeTopChild = [...root.childNodes]
    .slice(0, topIndex)
    .reduce((total, child) => total + childTextLength(child) + 1, 0)

  return beforeTopChild + offsetWithinTopLevelChild(topChild, node, offset)
}

function getSelectionInsideContent() {
  const root = contentRef.value
  const selection = window.getSelection()
  if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null

  const range = selection.getRangeAt(0)
  const commonNode =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentNode
  if (!root.contains(commonNode)) return null

  const start = plainTextOffsetOfBoundary(root, range.startContainer, range.startOffset)
  const end = plainTextOffsetOfBoundary(root, range.endContainer, range.endOffset)
  if (start === null || end === null || start === end) return null

  const orderedStart = Math.min(start, end)
  const orderedEnd = Math.max(start, end)
  const selectedContent = form.content.slice(orderedStart, orderedEnd)
  if (!selectedContent.trim()) return null

  return {
    start: orderedStart,
    end: orderedEnd,
    selectedContent,
    rect: range.getBoundingClientRect(),
  }
}

function positionOptimizePopover(rect) {
  const popoverWidth = 360
  const left = Math.min(
    Math.max(16, rect.left + rect.width / 2 - popoverWidth / 2),
    window.innerWidth - popoverWidth - 16,
  )
  const below = rect.bottom + 12
  const above = rect.top - 280
  const top = below > window.innerHeight - 260 && above > 16 ? above : below
  optimizeSelection.left = Math.round(left)
  optimizeSelection.top = Math.round(Math.max(16, top))
}

function resetOptimizeForm() {
  selectedModelName.value = ''
  optimizeDirection.value = ''
  optimizeRejectReason.value = ''
  modelError.value = ''
}

function closeOptimizePopover(force = false) {
  if (optimizing.value && !force) return
  optimizeSelection.visible = false
  optimizeSelection.selectedContent = ''
  optimizeSelection.start = 0
  optimizeSelection.end = 0
  resetOptimizeForm()
}

function restoreOptimizePopoverAfterFailure() {
  if (!optimizeSelection.selectedContent) return
  optimizeSelection.visible = true
}

async function fetchModelOptions(force = false) {
  if (modelLoading.value) return
  if (modelOptionsLoaded.value && !force) return

  modelLoading.value = true
  modelError.value = ''
  try {
    const res = await listAIProviderModels()
    if (res?.code === 0) {
      modelOptions.value = normalizeModelList(res.data?.models)
      modelOptionsLoaded.value = true
    } else {
      modelError.value = res?.msg || '模型列表加载失败'
      modelOptions.value = []
    }
  } catch (e) {
    modelError.value = e?.message || '模型列表加载失败'
    modelOptions.value = []
  } finally {
    modelLoading.value = false
  }
}

function showOptimizePopoverFromSelection() {
  if (loading.value || loadError.value || optimizing.value || hasOptimizeComparison.value) return

  const selected = getSelectionInsideContent()
  if (!selected) {
    closeOptimizePopover(true)
    return
  }

  optimizeSelection.start = selected.start
  optimizeSelection.end = selected.end
  optimizeSelection.selectedContent = selected.selectedContent
  positionOptimizePopover(selected.rect)
  optimizeSelection.visible = true
  resetOptimizeForm()
  fetchModelOptions()
}

function onContentSelectionIntent() {
  // 鼠标释放或键盘选区结束后，等浏览器先落定 Selection，再读取纯文本 offset。
  window.setTimeout(showOptimizePopoverFromSelection, 0)
}

function onGlobalMouseDown(event) {
  if (!optimizeSelection.visible || optimizing.value) return
  const target = event.target
  if (optimizePopoverRef.value?.contains(target) || contentRef.value?.contains(target)) return
  closeOptimizePopover()
}

// 把 form.content 同步到 DOM：仅在 form.content 被外部赋值（如 fetchDetail）时调用
function renderToDOM() {
  const el = contentRef.value
  if (!el) return
  const html = deserializeContent(form.content)
  if (el.innerHTML !== html) {
    el.innerHTML = html
  }
  refreshContentLineCount()
  scheduleContentLineCountRefresh()
}

// 用户输入：从 DOM 反向同步到 form.content
function onContentInput() {
  if (isComposing.value) return
  closeOptimizePopover()
  const text = serializeContent(contentRef.value)
  if (text !== form.content) {
    // 标记本次 form.content 变化是由用户输入触发，watch 应跳过，避免重渲染光标错位
    renderingFromWatch = true
    form.content = text
    nextTick(() => {
      renderingFromWatch = false
      refreshContentLineCount()
      scheduleContentLineCountRefresh()
    })
  }
  refreshContentLineCount()
  scheduleContentLineCountRefresh()
}

// 中文/日文输入法组合开始：暂停同步，避免拼音过程的中间态写回 form.content
function onCompositionStart() {
  isComposing.value = true
}
// 组合结束：拼音落地，立即触发一次同步把最终结果写入 form.content
function onCompositionEnd() {
  isComposing.value = false
  onContentInput()
}

// Enter 键：强制走"段落分隔"语义，统一 Chrome / Firefox / Safari 行为
// execCommand 虽已废弃但所有现代浏览器仍支持，且能自动处理"段中间分裂"
function onEnterKey() {
  document.execCommand('insertParagraph', false)
  // 上面通常会触发 input 事件；这里额外排一帧刷新，兜住少数浏览器不立即派发 input 的情况。
  scheduleContentLineCountRefresh()
}

// 粘贴：剥离任何来源格式（富文本/HTML），只插入纯文本
// 否则用户从 Word / 网页粘贴时会带样式标签污染 DOM
function onPaste(e) {
  e.preventDefault()
  const text = (e.clipboardData || window.clipboardData).getData('text/plain')
  document.execCommand('insertText', false, text)
}

// 监听外部 form.content 变化（如 fetchDetail 回填、新建态首次拉 next-no 后切换）
// 用户输入触发的变化由 renderingFromWatch 屏蔽，避免光标位置丢失
watch(
  () => form.content,
  () => {
    if (renderingFromWatch) return
    nextTick(renderToDOM)
  },
)

// 顶部显示的章节号：编辑态读 chapter.chapterNo，新建态读 suggestedChapterNo
const displayChapterNo = computed(() => chapter.value?.chapterNo ?? suggestedChapterNo.value ?? '—')

// 字数统计：剔除所有空白后的字符数（含标点）
// 注：保存到后端的 form.content 仍是含换行的原始纯文本，这里只是显示统计
function countChars(text) {
  if (!text) return 0
  // \s 匹配空格 / 制表 / 换行 等所有空白
  return text.replace(/\s+/g, '').length
}
const wordCount = computed(() => countChars(form.content))
const hasOptimizeComparison = computed(
  () => Boolean(optimizeOriginalContent.value) && Boolean(optimizePreviewContent.value),
)
const optimizeOriginalHtml = computed(() =>
  deserializeContentWithHighlight(optimizeOriginalContent.value, optimizeOriginalRange),
)
const optimizePreviewHtml = computed(() =>
  deserializeContentWithHighlight(optimizePreviewContent.value, optimizePreviewRange),
)
const contentLineNumbers = computed(() =>
  lineNumbersByCount(Math.max(contentLineCount.value, lineNumbersOf(form.content).length)),
)
const optimizeOriginalLineNumbers = computed(() => lineNumbersOf(optimizeOriginalContent.value))
const optimizePreviewLineNumbers = computed(() => lineNumbersOf(optimizePreviewContent.value))
const canSubmitOptimize = computed(
  () =>
    optimizeSelection.visible &&
    Boolean(selectedModelName.value) &&
    Boolean(optimizeSelection.selectedContent.trim()) &&
    !modelLoading.value &&
    !optimizing.value,
)

// dirty：决定保存按钮是否可点、离开是否拦截
const dirty = computed(() => {
  if (isNew.value) {
    // 新建态：标题非空或正文非空即视为 dirty（保证首次保存可点）
    return form.title.trim() !== '' || form.content !== ''
  }
  // 编辑态：对比表单与原始 chapter
  const c = chapter.value
  if (!c) return false
  return form.title !== (c.title || '') || form.content !== (c.content || '')
})

// 拉章节详情（编辑态）
async function fetchDetail() {
  try {
    const res = await getChapter(props.novelId, props.chapterId)
    if (res?.code === 0 && res.data) {
      chapter.value = res.data
      form.title = res.data.title || ''
      form.content = res.data.content || ''
    } else {
      loadError.value = res?.msg || '加载失败'
    }
  } catch (e) {
    loadError.value = e?.status === 404 ? '章节不存在或已被删除' : e?.message || '加载失败'
  }
}

// 拉下一章建议编号（新建态）
async function fetchNextNo() {
  try {
    const res = await getNextChapterNo(props.novelId)
    if (res?.code === 0 && res.data) {
      suggestedChapterNo.value = res.data.chapterNo
    } else {
      loadError.value = res?.msg || '获取章节编号失败'
    }
  } catch (e) {
    loadError.value = e?.status === 404 ? '小说不存在或已被删除' : e?.message || '获取章节编号失败'
  }
}

// 初次加载：按模式走不同分支
async function bootstrap() {
  loading.value = true
  loadError.value = ''
  try {
    if (isNew.value) await fetchNextNo()
    else await fetchDetail()
  } finally {
    loading.value = false
  }
}

// 路由参数变化时重新初始化（理论上不会，但保留以防编程式 push 复用同组件）
watch(
  () => [props.novelId, props.chapterId],
  () => {
    closeOptimizePopover(true)
    clearOptimizeComparison()
    bootstrap()
  },
)
onMounted(async () => {
  // 强制后续 execCommand（如 insertParagraph）用 <p> 包裹新段，而不是 Chrome 默认的 <div>
  // 全局状态，只需调一次；某些 Chromium 内核浏览器不支持时会静默失败，无副作用
  try {
    document.execCommand('defaultParagraphSeparator', false, 'p')
  } catch {
    // 老浏览器不支持，忽略——后续按 <div> 包裹兜底由 CSS 处理
  }
  // bootstrap 完成后 form.content 才有值（编辑态）或保持空（新建态）
  // 然后再调 renderToDOM 把 form.content 反序列化为 <p> 列表渲染到 contenteditable
  await bootstrap()
  await nextTick()
  renderToDOM()
})

onMounted(() => {
  document.addEventListener('mousedown', onGlobalMouseDown)
  window.addEventListener('resize', scheduleContentLineCountRefresh)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onGlobalMouseDown)
  window.removeEventListener('resize', scheduleContentLineCountRefresh)
  if (contentLineRefreshFrame) window.cancelAnimationFrame(contentLineRefreshFrame)
})

async function submitOptimize() {
  if (!canSubmitOptimize.value) return

  optimizing.value = true
  optimizeRejectReason.value = ''
  optimizeSelection.visible = false
  try {
    const res = await optimizeNovelContent(props.novelId, selectedModelName.value, {
      selectedContent: optimizeSelection.selectedContent,
      optimizeDirection: optimizeDirection.value.trim(),
    })

    if (res?.code !== 0) {
      toast.add({
        severity: 'error',
        summary: '润色失败',
        detail: res?.msg || '请稍后重试',
        life: 3200,
      })
      restoreOptimizePopoverAfterFailure()
      return
    }

    const result = res.data || {}
    if (result.approved === false) {
      optimizeRejectReason.value = result.rejectReason || '该优化方向涉及剧情修改，AI 已拒绝润色。'
      toast.add({
        severity: 'warn',
        summary: 'AI 已拒绝润色',
        detail: optimizeRejectReason.value,
        life: 4500,
      })
      restoreOptimizePopoverAfterFailure()
      return
    }

    const optimizedContent = normalizeOptimizedContent(
      result.optimizedContent || '',
      optimizeSelection.selectedContent,
    )
    if (!optimizedContent.trim()) {
      toast.add({
        severity: 'error',
        summary: '润色失败',
        detail: '接口没有返回优化后的正文。',
        life: 3200,
      })
      restoreOptimizePopoverAfterFailure()
      return
    }

    // 后端只返回选中片段的优化结果；这里按记录的纯文本 offset 拼回完整章节正文。
    optimizeOriginalContent.value = form.content
    optimizePreviewContent.value =
      form.content.slice(0, optimizeSelection.start) +
      optimizedContent +
      form.content.slice(optimizeSelection.end)
    optimizeOriginalRange.start = optimizeSelection.start
    optimizeOriginalRange.end = optimizeSelection.end
    optimizePreviewRange.start = optimizeSelection.start
    optimizePreviewRange.end = optimizeSelection.start + optimizedContent.length
    closeOptimizePopover(true)
    window.getSelection()?.removeAllRanges()
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: '网络错误',
      detail: e?.message || '请稍后重试',
      life: 3200,
    })
    restoreOptimizePopoverAfterFailure()
  } finally {
    optimizing.value = false
  }
}

function clearOptimizeComparison() {
  optimizeOriginalContent.value = ''
  optimizePreviewContent.value = ''
  optimizeOriginalRange.start = 0
  optimizeOriginalRange.end = 0
  optimizePreviewRange.start = 0
  optimizePreviewRange.end = 0
}

async function acceptOptimize() {
  if (!hasOptimizeComparison.value) return
  form.content = optimizePreviewContent.value
  clearOptimizeComparison()
  await nextTick()
  renderToDOM()
  toast.add({
    severity: 'success',
    summary: '已接受润色',
    detail: '点击保存后才会写入数据库。',
    life: 2600,
  })
}

async function rejectOptimize() {
  if (!hasOptimizeComparison.value) return
  form.content = optimizeOriginalContent.value
  clearOptimizeComparison()
  await nextTick()
  renderToDOM()
  toast.add({ severity: 'info', summary: '已保留原文', life: 2200 })
}

// 保存：新建 vs 编辑两套 body
async function onSave() {
  if (!dirty.value || saving.value) return
  const title = form.title.trim()
  if (!title) {
    toast.add({ severity: 'warn', summary: '章节标题不能为空', life: 2500 })
    return
  }

  saving.value = true
  try {
    let res
    if (isNew.value) {
      // 新建：四字段全送；wordCount 来自 computed 实时计算
      res = await createChapter(props.novelId, {
        chapterNo: suggestedChapterNo.value,
        title,
        content: form.content,
        wordCount: wordCount.value,
      })
    } else {
      // 编辑：chapterNo 虽然前端不可编辑，但后端更新校验需要该字段；
      // 因此从详情接口已回填的 chapter 中携带原章节号，避免用户修改正文时触发参数错误。
      res = await updateChapter(props.novelId, props.chapterId, {
        chapterNo: chapter.value?.chapterNo,
        title,
        content: form.content,
        wordCount: wordCount.value,
      })
    }

    if (res?.code === 0) {
      toast.add({ severity: 'success', summary: '已保存', life: 2000 })
      // replace 而非 push：避免后退栈出现 /chapter/new 死链
      router.replace({ name: 'novel-detail', params: { id: props.novelId } })
    } else {
      // 409 章节编号已存在（仅新建态有可能触发）
      if (/编号已存在/.test(res?.msg || '')) {
        toast.add({
          severity: 'error',
          summary: '章节编号已存在',
          detail: '请返回详情页刷新后重试',
          life: 3500,
        })
      } else {
        toast.add({
          severity: 'error',
          summary: '保存失败',
          detail: res?.msg || '请稍后重试',
          life: 3000,
        })
      }
    }
  } catch (e) {
    // http.js 把 4xx/5xx 归一化为 { status, message, raw }
    if (e?.status === 409) {
      toast.add({
        severity: 'error',
        summary: '章节编号已存在',
        detail: '可能已有他人创建相同编号，请返回详情页刷新',
        life: 3500,
      })
    } else {
      toast.add({
        severity: 'error',
        summary: '网络错误',
        detail: e?.message || '请稍后重试',
        life: 3000,
      })
    }
  } finally {
    saving.value = false
  }
}

// 删除：仅编辑态可用；二次确认后调接口
function onDelete() {
  if (isNew.value || deleting.value || !chapter.value) return
  confirm.require({
    header: '确认删除',
    message: `确定要删除第 ${chapter.value.chapterNo} 章《${chapter.value.title || '未命名'}》吗？\n此操作不可撤销，会同步扣减小说总字数。`,
    acceptLabel: '删除',
    rejectLabel: '取消',
    acceptClass: 'p-button-danger',
    accept: async () => {
      deleting.value = true
      try {
        const res = await deleteChapter(props.novelId, props.chapterId)
        if (res?.code === 0) {
          toast.add({ severity: 'success', summary: '已删除', life: 2000 })
          router.replace({ name: 'novel-detail', params: { id: props.novelId } })
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

// 返回详情：dirty 时拦截弹确认；用户决策 3
function goBack() {
  if (dirty.value || hasOptimizeComparison.value) {
    confirm.require({
      header: '放弃修改？',
      message: hasOptimizeComparison.value
        ? '当前润色结果尚未选择，确定要离开吗？'
        : '当前修改尚未保存，确定要离开吗？',
      acceptLabel: '放弃修改',
      rejectLabel: '继续编辑',
      acceptClass: 'p-button-danger',
      accept: () => {
        router.push({ name: 'novel-detail', params: { id: props.novelId } })
      },
    })
  } else {
    router.push({ name: 'novel-detail', params: { id: props.novelId } })
  }
}

// 仅编辑态显示「最后修改于 …」状态提示（底部工具栏中用）；新建态返回空字符串
const updatedAtHint = computed(() => {
  if (isNew.value || !chapter.value?.updatedAt) return ''
  return `最后修改 ${formatDateTime(chapter.value.updatedAt)}`
})
</script>

<template>
  <main class="editor" :class="{ 'is-comparing': hasOptimizeComparison }">
    <!-- 左上角返回按钮：fixed 在视口左上，独立于纸面布局
         按用户要求从底部工具栏迁到左上角 -->
    <button class="back-btn" type="button" @click="goBack">
      <span aria-hidden="true">←</span>
      返回详情
    </button>
    <!-- 纸面容器：居中、白底、留白足够，营造写作专注感 -->
    <article class="paper">
      <!-- 标题行：第 [N] 章   请输入标题
           居中布局；章节号下划线视觉强调「来自后端 / 不可编辑」 -->
      <header class="title-row">
        <span class="ch-num" aria-label="章节编号">
          第<strong>{{ displayChapterNo }}</strong
          >章
        </span>
        <input
          v-model="form.title"
          type="text"
          class="title-input"
          placeholder="请输入标题"
          :disabled="loading || !!loadError"
          autocomplete="off"
        />
      </header>

      <!-- 加载错误占位（替代正文） -->
      <p v-if="loadError" class="error-text">{{ loadError }}</p>

      <section
        v-else-if="hasOptimizeComparison"
        class="optimize-comparison"
        aria-label="润色结果对比"
      >
        <article class="comparison-pane">
          <header class="comparison-head">
            <strong>原文</strong>
            <span>{{ countChars(optimizeOriginalContent) }} 字</span>
          </header>
          <div class="comparison-body">
            <ol class="line-numbers comparison-lines" aria-hidden="true">
              <li v-for="line in optimizeOriginalLineNumbers" :key="line">{{ line }}</li>
            </ol>
            <div class="comparison-content" v-html="optimizeOriginalHtml"></div>
          </div>
        </article>

        <article class="comparison-pane optimized">
          <header class="comparison-head">
            <strong>优化后</strong>
            <span>{{ countChars(optimizePreviewContent) }} 字</span>
          </header>
          <div class="comparison-body">
            <ol class="line-numbers comparison-lines" aria-hidden="true">
              <li v-for="line in optimizePreviewLineNumbers" :key="line">{{ line }}</li>
            </ol>
            <div class="comparison-content" v-html="optimizePreviewHtml"></div>
          </div>
        </article>
      </section>

      <!-- 正文：contenteditable + 每段 <p> 渲染，纯纸面观感
           · form.content 始终是纯文本（按 \n 分段），后端无感
           · 每段独立 <p>，CSS .content-area :deep(p) text-indent:2em 让"每段首行"都缩进
           · 浏览器换行行为差异通过 @keydown.enter.exact.prevent + execCommand 统一
           · IME 通过 composition 事件保护，避免中文/日文输入法误同步
           · paste 拦截剥离 HTML 格式，只保留纯文本 -->
      <div v-else class="content-editor-shell">
        <ol class="line-numbers editor-lines" aria-hidden="true">
          <li v-for="line in contentLineNumbers" :key="line">{{ line }}</li>
        </ol>
        <div
          ref="contentRef"
          class="content-area"
          :class="{ 'is-empty': form.content === '' }"
          :contenteditable="loading ? 'false' : 'true'"
          role="textbox"
          aria-multiline="true"
          data-placeholder="请输入正文……"
          @input="onContentInput"
          @keydown.enter.exact.prevent="onEnterKey"
          @keyup="onContentSelectionIntent"
          @mouseup="onContentSelectionIntent"
          @touchend="onContentSelectionIntent"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
          @paste="onPaste"
        ></div>
      </div>
    </article>

    <aside
      v-if="optimizeSelection.visible"
      ref="optimizePopoverRef"
      class="optimize-popover"
      :style="{ left: `${optimizeSelection.left}px`, top: `${optimizeSelection.top}px` }"
      aria-live="polite"
      @mousedown.stop
      @click.stop
    >
      <div class="optimize-popover-head">
        <strong>优化此段文案？</strong>
        <span>{{ countChars(optimizeSelection.selectedContent) }} 字</span>
      </div>
      <p class="optimize-popover-copy">AI 只润色文笔，不会修改剧情。</p>

      <div v-if="optimizeRejectReason" class="optimize-reject">
        {{ optimizeRejectReason }}
      </div>

      <div v-if="modelLoading" class="optimize-inline-state">
        <span class="mini-spinner" aria-hidden="true"></span>
        <span>正在读取模型...</span>
      </div>

      <div v-else-if="modelError" class="optimize-inline-state error">
        <span>{{ modelError }}</span>
        <button type="button" @click="fetchModelOptions(true)">重试</button>
      </div>

      <div v-else-if="modelOptions.length === 0" class="optimize-inline-state empty">
        当前启用的 AI 提供商没有可用模型。
      </div>

      <template v-else>
        <label class="optimize-field">
          <span>执行模型</span>
          <select v-model="selectedModelName">
            <option value="" disabled>请选择模型</option>
            <option v-for="model in modelOptions" :key="model" :value="model">
              {{ model }}
            </option>
          </select>
        </label>

        <label v-if="selectedModelName" class="optimize-field">
          <span>优化方向</span>
          <textarea
            v-model="optimizeDirection"
            rows="3"
            placeholder="例如：语言更细腻、节奏更紧凑、氛围更压抑"
          ></textarea>
          <em>可以不填写，系统会使用默认文笔润色提示词。</em>
        </label>
      </template>

      <div class="optimize-actions">
        <Button
          label="取消"
          text
          size="small"
          :disabled="optimizing"
          @click="closeOptimizePopover()"
        />
        <Button
          label="确认"
          size="small"
          :loading="optimizing"
          :disabled="!canSubmitOptimize"
          @click="submitOptimize"
        />
      </div>
    </aside>

    <Transition name="optimize-loading-fade">
      <div v-if="optimizing" class="optimize-loading-overlay" role="status" aria-live="polite">
        <div class="optimize-loading-box">
          <div class="ink-loader" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <strong>AI 正在润色</strong>
          <p>正在保持剧情不变，只调整文笔表达。</p>
        </div>
      </div>
    </Transition>

    <!-- 底部工具栏：fixed 在底部，半透明背景 + blur，不抢正文注意力
         返回按钮已迁到左上角（.back-btn），工具栏只保留状态条 + 操作按钮 -->
    <footer class="toolbar">
      <!-- 中间状态条：字数 + 最后修改时间（编辑态） -->
      <div class="status">
        <span class="word-count">
          <strong>{{ wordCount }}</strong> 字
        </span>
        <span v-if="updatedAtHint" class="updated-hint">· {{ updatedAtHint }}</span>
      </div>

      <div v-if="hasOptimizeComparison" class="optimize-decision" aria-label="选择是否接受润色">
        <Button label="不接受" text @click="rejectOptimize" />
        <Button label="接受优化" @click="acceptOptimize" />
      </div>

      <div class="tool-actions">
        <Button
          v-if="!isNew && chapter"
          label="删除"
          severity="danger"
          text
          :disabled="hasOptimizeComparison"
          :loading="deleting"
          @click="onDelete"
        />
        <Button
          label="保存"
          :disabled="!dirty || saving || loading || !!loadError || hasOptimizeComparison"
          :loading="saving"
          @click="onSave"
        />
      </div>
    </footer>
  </main>
</template>

<style scoped>
/* ─── 整页：纸面白底 ─── */
.editor {
  min-height: 100vh;
  /* 暖白纸面：略带米黄，避免纯白刺眼，与「写作」语境契合 */
  background: radial-gradient(120% 80% at 50% 0%, #fdfcf8 0%, #fbf9f4 60%, #f7f4eb 100%), #fbf9f4;
  color: #2a2a2a;
  /* 中文写作优先衬线感，但保留无衬线 fallback；
     用 system-ui 让 Windows / Mac 都尽量舒服 */
  font-family:
    'PingFang SC',
    'Microsoft YaHei',
    'Source Han Sans SC',
    system-ui,
    -apple-system,
    sans-serif;
  /* 给固定的底部工具栏腾出空间，避免最后一行正文被遮 */
  padding-bottom: 88px;
  position: relative;
}

/* ─── 纸面容器：占 80vw，无上限
   严格按用户要求「占满 80vw」，不再加 max-width 上限；
   4K/超宽屏会得到很长的行，请自行权衡 */
.paper {
  width: 80vw;
  margin: 0 auto;
  padding: 80px 0 40px;
}

.editor.is-comparing .paper {
  width: 100vw;
  padding: 72px 0 40px;
}

/* ─── 标题行：居中 ─── */
.title-row {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 20px;
  margin-bottom: 56px;
  flex-wrap: wrap;
}

/* 章节号：弱化、灰色，强调"非用户输入"；
   strong 段是真实数字，加横线下划线表达"来自系统填入" */
.ch-num {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 26px;
  color: #b8b3a7;
  letter-spacing: 0.06em;
  font-weight: 300;
  white-space: nowrap;
}
.ch-num strong {
  font-weight: 400;
  color: #2a2a2a;
  border-bottom: 1px solid #b8b3a7;
  padding: 0 12px 2px;
  min-width: 48px;
  display: inline-block;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* 标题输入：原生 input，无边框，与章节号同字号同字重 */
.title-input {
  flex: 1;
  min-width: 220px;
  max-width: 520px;
  background: transparent;
  border: none;
  outline: none;
  font-size: 26px;
  font-weight: 300;
  color: #2a2a2a;
  padding: 4px 0;
  font-family: inherit;
  letter-spacing: 0.04em;
}
.title-input::placeholder {
  color: #c8c2b5;
  font-weight: 300;
}
.title-input:focus::placeholder {
  color: #ddd6c6;
}
.title-input:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.error-text {
  text-align: center;
  color: #c1502e;
  padding: 60px 20px;
  font-size: 15px;
  margin: 0;
}

/* ─── 正文区：contenteditable div + 每段 <p>，纯纸面观感 ───
   用 div + 每段独立 <p> 替代 textarea，是为了实现"每段首行缩进 2em"：
   textarea 内所有 \n 都在同一文本节点里，text-indent 只能影响整体首行；
   改成每段一个 <p> 后，每个 <p> 是块级容器，自己的 text-indent 各自生效。
   contenteditable 内的 <p> 由 innerHTML 动态生成，没有 scoped 属性，
   必须用 :deep() 让样式穿透。 */
.content-editor-shell {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  align-items: start;
}
.line-numbers {
  list-style: none;
  margin: 0;
  padding: 0;
  color: #b8b3a7;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  line-height: 34px;
  text-align: right;
  user-select: none;
}
.editor-lines {
  padding-right: 18px;
}
.content-area {
  display: block;
  /* 让伪元素 placeholder 能 absolute 锚定到本容器 */
  position: relative;
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  box-shadow: none;
  padding: 0;
  /* 容器层 text-indent 作"首行兜底"：
     · 浏览器在空 contenteditable 上首次输入可能创建裸文本节点（无 <p> 包裹），
       这时 :deep(p) 选择器匹配不到——容器自身的 text-indent 让裸文本也缩进
     · 当所有内容已被 <p> 包裹时，容器层 text-indent 不会重复生效（无直接文本节点），
       完全由内部 <p> 自管 */
  text-indent: 2em;
  /* 阅读流畅：行高 2 + 17px 字号，与成书排版接近 */
  line-height: 2;
  font-size: 17px;
  color: #2a2a2a;
  font-family: inherit;
  /* 空文档的最小高度，让点击区域足够大；contenteditable 内容会自动撑高 */
  min-height: 60vh;
  word-break: normal;
  /* caret 与文字同色，避免默认蓝色光标在暖白纸面上突兀 */
  caret-color: #2a2a2a;
}
/* 每段：text-indent 自然作用于"段落首行"，这才是"每段都缩进"的核心
   同时覆盖 <p>（用户按 Enter 走 defaultParagraphSeparator=p 的产物）
   和 <div>（部分 Chromium 内核 / 老浏览器在 execCommand 时仍可能产生）
   两种自然包裹形式，确保跨浏览器一致 */
.content-area :deep(p),
.content-area :deep(div) {
  margin: 0;
  text-indent: 2em;
  line-height: 2;
}
/* placeholder：用 ::before + data-placeholder 属性模拟原生 placeholder
   · .is-empty class 由 form.content === '' 控制（精确，能覆盖 <p><br></p> 占位）
   · absolute 让 placeholder 叠加在空段占位上，而不是另起一行 */
.content-area.is-empty::before {
  content: attr(data-placeholder);
  color: #c8c2b5;
  pointer-events: none;
  position: absolute;
  top: 0;
  left: 0;
  text-indent: 2em;
}
.content-area[contenteditable='false'] {
  cursor: not-allowed;
  opacity: 0.6;
}

/* ─── AI 润色浮层：跟随正文选区出现，避免打断写作流 ─── */
.optimize-popover {
  position: fixed;
  z-index: 30;
  width: 360px;
  max-width: calc(100vw - 32px);
  padding: 14px;
  border: 1px solid rgba(42, 42, 42, 0.14);
  border-radius: 12px;
  background: rgba(255, 254, 250, 0.96);
  box-shadow:
    0 18px 42px rgba(74, 62, 38, 0.16),
    0 2px 8px rgba(74, 62, 38, 0.1);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #2a2a2a;
}

.optimize-popover-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.optimize-popover-head strong {
  font-size: 14px;
  font-weight: 650;
}
.optimize-popover-head span {
  color: #9b9385;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.optimize-popover-copy {
  margin: 6px 0 12px;
  color: #7a7367;
  font-size: 12px;
  line-height: 1.6;
}
.optimize-reject {
  margin: 0 0 10px;
  padding: 9px 10px;
  border-radius: 8px;
  background: rgba(193, 80, 46, 0.08);
  color: #b24d2d;
  font-size: 12px;
  line-height: 1.55;
}

.optimize-field {
  display: grid;
  gap: 7px;
  margin-top: 10px;
}
.optimize-field span {
  color: #6f685d;
  font-size: 12px;
  font-weight: 600;
}
.optimize-field select,
.optimize-field textarea {
  width: 100%;
  border: 1px solid rgba(42, 42, 42, 0.14);
  border-radius: 8px;
  background: rgba(251, 249, 244, 0.86);
  color: #2a2a2a;
  font: inherit;
  font-size: 13px;
  outline: none;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}
.optimize-field select {
  min-height: 36px;
  padding: 0 10px;
}
.optimize-field textarea {
  resize: vertical;
  min-height: 78px;
  max-height: 160px;
  padding: 9px 10px;
  line-height: 1.6;
}
.optimize-field select:focus,
.optimize-field textarea:focus {
  border-color: #8e7d59;
  background: #fffefa;
  box-shadow: 0 0 0 3px rgba(142, 125, 89, 0.14);
}
.optimize-field em {
  color: #a0988b;
  font-size: 12px;
  font-style: normal;
  line-height: 1.5;
}

.optimize-inline-state {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 9px 10px;
  border-radius: 8px;
  background: rgba(247, 244, 235, 0.82);
  color: #7a7367;
  font-size: 12px;
}
.optimize-inline-state.error {
  justify-content: space-between;
  color: #b24d2d;
  background: rgba(193, 80, 46, 0.08);
}
.optimize-inline-state.empty {
  color: #8a8174;
}
.optimize-inline-state button {
  border: none;
  background: transparent;
  color: #7a5a21;
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}
.mini-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(142, 125, 89, 0.22);
  border-top-color: #8e7d59;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.optimize-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
.optimize-actions :deep(.p-button) {
  font-size: 12px;
}

/* ─── AI 润色对比：左右都是完整章节正文，只改变被选中的片段 ─── */
.optimize-comparison {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0;
  min-height: calc(100vh - 190px);
}
.comparison-pane {
  min-width: 0;
  background: rgba(255, 254, 250, 0.46);
}
.comparison-pane.optimized {
  border-left: 1px solid rgba(42, 42, 42, 0.14);
  background: rgba(255, 253, 244, 0.62);
}
.comparison-head {
  min-height: 46px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 0 34px;
  border-bottom: 1px solid rgba(42, 42, 42, 0.08);
  background: rgba(247, 244, 235, 0.72);
}
.comparison-head strong {
  font-size: 14px;
  font-weight: 650;
}
.comparison-head span {
  color: #9b9385;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.comparison-body {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  align-items: start;
}
.comparison-lines {
  padding: 28px 14px 44px 0;
}
.comparison-content {
  padding: 28px 42px 44px;
  color: #2a2a2a;
  font-size: 17px;
  line-height: 2;
  text-indent: 2em;
}
.comparison-content :deep(p),
.comparison-content :deep(div) {
  margin: 0;
  text-indent: 2em;
  line-height: 2;
}
.comparison-content :deep(.optimize-highlight) {
  margin: 0 2px;
  padding: 1px 3px 2px;
  border-radius: 4px;
  background: rgba(223, 166, 57, 0.28);
  box-shadow: inset 0 -1px 0 rgba(152, 104, 23, 0.28);
  color: inherit;
}
.comparison-pane.optimized .comparison-content :deep(.optimize-highlight) {
  background: rgba(111, 153, 83, 0.26);
  box-shadow: inset 0 -1px 0 rgba(74, 121, 46, 0.26);
}

.optimize-loading-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: rgba(247, 244, 235, 0.58);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.optimize-loading-box {
  width: min(340px, calc(100vw - 40px));
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 28px 24px;
  border: 1px solid rgba(42, 42, 42, 0.1);
  border-radius: 14px;
  background: rgba(255, 254, 250, 0.94);
  box-shadow:
    0 18px 44px rgba(74, 62, 38, 0.15),
    0 2px 8px rgba(74, 62, 38, 0.08);
}
.optimize-loading-box strong {
  color: #2a2a2a;
  font-size: 15px;
  font-weight: 700;
}
.optimize-loading-box p {
  margin: 0;
  color: #7a7367;
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
}
.ink-loader {
  position: relative;
  width: 72px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.ink-loader span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #8e7d59;
  opacity: 0.38;
  transform: translateY(0);
  animation: inkPulse 0.9s ease-in-out infinite;
}
.ink-loader span:nth-child(2) {
  animation-delay: 0.12s;
}
.ink-loader span:nth-child(3) {
  animation-delay: 0.24s;
}
.optimize-loading-fade-enter-active,
.optimize-loading-fade-leave-active {
  transition: opacity 0.18s ease;
}
.optimize-loading-fade-enter-from,
.optimize-loading-fade-leave-to {
  opacity: 0;
}

.optimize-decision {
  position: absolute;
  left: 50%;
  top: 50%;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  transform: translate(-50%, -50%);
}
.optimize-decision :deep(.p-button) {
  font-size: 13px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes inkPulse {
  0%,
  100% {
    opacity: 0.32;
    transform: translateY(0) scale(0.92);
  }
  45% {
    opacity: 1;
    transform: translateY(-7px) scale(1);
  }
}

/* ─── 底部工具栏：fixed 在底部 ─── */
.toolbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 40px;
  /* 半透明 + blur：仍能看到正文末尾文字隐隐透出，体感更轻 */
  background: rgba(251, 249, 244, 0.88);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

/* 左上角返回按钮：fixed 在视口左上，独立于纸面布局
   半透明纸色背景 + blur，让按钮悬浮在内容之上又不抢眼 */
.back-btn {
  position: fixed;
  top: 20px;
  left: 24px;
  z-index: 10;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(251, 249, 244, 0.88);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  color: #6a6a6a;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition:
    border-color 0.2s ease,
    color 0.2s ease,
    background 0.2s ease;
}
.back-btn:hover {
  border-color: #2a2a2a;
  color: #2a2a2a;
  background: rgba(255, 255, 255, 0.95);
}

/* 中间状态条：字数 + 最后修改时间 */
.status {
  display: inline-flex;
  align-items: baseline;
  gap: 10px;
  color: #999;
  font-size: 13px;
  letter-spacing: 0.02em;
}
.word-count strong {
  color: #2a2a2a;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  margin-right: 2px;
}
.updated-hint {
  color: #b8b3a7;
}

.tool-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tool-actions :deep(.p-button) {
  font-size: 13px;
}

/* ─── 移动端 ─── */
@media (max-width: 720px) {
  .paper {
    width: auto;
    padding: 40px 20px 24px;
  }
  .editor.is-comparing .paper {
    width: auto;
  }
  .title-row {
    margin-bottom: 32px;
    gap: 12px;
  }
  .ch-num,
  .title-input {
    font-size: 22px;
  }
  .toolbar {
    min-height: 58px;
    padding: 10px 16px;
    gap: 8px;
  }
  .status {
    display: none; /* 窄屏隐藏字数显示，给两侧按钮腾空间 */
  }
  .optimize-comparison {
    grid-template-columns: 1fr;
    gap: 14px;
  }
  .content-editor-shell,
  .comparison-body {
    grid-template-columns: 38px minmax(0, 1fr);
  }
  .editor-lines {
    padding-right: 10px;
  }
  .comparison-lines {
    padding: 18px 10px 22px 0;
  }
  .comparison-content {
    padding: 18px 16px 22px;
    font-size: 15px;
  }
  .optimize-popover {
    left: 16px !important;
    right: 16px;
    width: auto;
  }
  .optimize-decision {
    position: static;
    transform: none;
    margin-left: auto;
  }
  .tool-actions {
    margin-left: auto;
  }
}
</style>
