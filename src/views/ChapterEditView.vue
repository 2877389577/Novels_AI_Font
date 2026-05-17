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
    · 编辑调 updateChapter（只送 title/content/wordCount，不送 chapterNo 避免无意义 409）
    · 保存成功 → router.replace 回详情页（**replace** 避免后退栈出现 /chapter/new 死链）

  离开拦截：
    · dirty 时点底部「← 返回详情」弹 ConfirmDialog 二次确认

  关于底部工具栏的取舍：
    · 参考图里有"撤销/重做/字体格式/AI 写作/评论"等图标，但本项目这些功能尚未接入；
      为避免给用户假按钮（CLAUDE.md「不做未要求的功能」），底部工具栏只放真实有效的
      四个入口：返回详情 / 字数显示 / 删除（仅编辑态） / 保存。
-->

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
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
// IME 组合输入态（中文/日文输入法）：组合中不要回写 form.content
const isComposing = ref(false)
// 防止"DOM → form.content → watch → 再渲染 DOM"的循环；
// 用户输入触发的更新只走"DOM → form.content"单程
let renderingFromWatch = false

// HTML 转义：用户纯文本写入 innerHTML 前必做，避免 < > & 被当成标签
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 把纯文本反序列化为 <p> 列表 innerHTML：每段一个 <p>，空段用 <br> 占位避免高度坍塌
// 空文档也返回一个空 <p><br></p>：让用户输入有 <p> 容器落点，
// 否则 Chrome 在空 contenteditable 上首次输入会创建裸文本节点，:deep(p) 选择器无法匹配
function deserializeContent(text) {
  if (!text) return '<p><br></p>'
  return text
    .split('\n')
    .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
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

// 把 form.content 同步到 DOM：仅在 form.content 被外部赋值（如 fetchDetail）时调用
function renderToDOM() {
  const el = contentRef.value
  if (!el) return
  const html = deserializeContent(form.content)
  if (el.innerHTML !== html) {
    el.innerHTML = html
  }
}

// 用户输入：从 DOM 反向同步到 form.content
function onContentInput() {
  if (isComposing.value) return
  const text = serializeContent(contentRef.value)
  if (text !== form.content) {
    // 标记本次 form.content 变化是由用户输入触发，watch 应跳过，避免重渲染光标错位
    renderingFromWatch = true
    form.content = text
    nextTick(() => {
      renderingFromWatch = false
    })
  }
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
  // 上面会触发 input 事件，由 onContentInput 接管同步，这里不用手动调
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
  () => bootstrap(),
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
      // 编辑：故意不送 chapterNo（前端不可编辑，避免触发无意义 409）
      res = await updateChapter(props.novelId, props.chapterId, {
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
  if (dirty.value) {
    confirm.require({
      header: '放弃修改？',
      message: '当前修改尚未保存，确定要离开吗？',
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
  <main class="editor">
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

      <!-- 正文：contenteditable + 每段 <p> 渲染，纯纸面观感
           · form.content 始终是纯文本（按 \n 分段），后端无感
           · 每段独立 <p>，CSS .content-area :deep(p) text-indent:2em 让"每段首行"都缩进
           · 浏览器换行行为差异通过 @keydown.enter.exact.prevent + execCommand 统一
           · IME 通过 composition 事件保护，避免中文/日文输入法误同步
           · paste 拦截剥离 HTML 格式，只保留纯文本 -->
      <div
        v-else
        ref="contentRef"
        class="content-area"
        :class="{ 'is-empty': form.content === '' }"
        :contenteditable="loading ? 'false' : 'true'"
        role="textbox"
        aria-multiline="true"
        data-placeholder="请输入正文……"
        @input="onContentInput"
        @keydown.enter.exact.prevent="onEnterKey"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
        @paste="onPaste"
      ></div>
    </article>

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

      <div class="tool-actions">
        <Button
          v-if="!isNew && chapter"
          label="删除"
          severity="danger"
          text
          :loading="deleting"
          @click="onDelete"
        />
        <Button
          label="保存"
          :disabled="!dirty || saving || loading || !!loadError"
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
    padding: 40px 20px 24px;
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
    padding: 10px 16px;
    gap: 8px;
  }
  .status {
    display: none; /* 窄屏隐藏字数显示，给两侧按钮腾空间 */
  }
}
</style>
