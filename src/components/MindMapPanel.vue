<!--
  MindMapPanel.vue：小说思维导图工作台
  ----------------------------------------------------------------------------
  设计目标：
  1. 使用 SimpleMindMap 承载每本小说独立的思维导图数据。
  2. 前端编辑都先落在本地画布中，用户点击“保存思维导图”后再提交完整 JSON。
  3. 后端以 simple-mind-map 的完整数据结构作为持久化格式，因此保存时使用 getData(true)。
-->

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import MindMap from 'simple-mind-map'
import AssociativeLine from 'simple-mind-map/src/plugins/AssociativeLine.js'
import OuterFrame from 'simple-mind-map/src/plugins/OuterFrame.js'
import Painter from 'simple-mind-map/src/plugins/Painter.js'
import Drag from 'simple-mind-map/src/plugins/Drag.js'
import Select from 'simple-mind-map/src/plugins/Select.js'
import KeyboardNavigation from 'simple-mind-map/src/plugins/KeyboardNavigation.js'
import MiniMap from 'simple-mind-map/src/plugins/MiniMap.js'
import RichText from 'simple-mind-map/src/plugins/RichText.js'
import { getMindMap, saveMindMap } from '@/api/mindMap'
import 'simple-mind-map/dist/simpleMindMap.esm.css'

const props = defineProps({
  novelId: { type: Number, required: true },
  novelTitle: { type: String, default: '' },
})

const toast = useToast()

const pluginList = [
  AssociativeLine,
  OuterFrame,
  Painter,
  Drag,
  Select,
  KeyboardNavigation,
  MiniMap,
  RichText,
]

// SimpleMindMap 插件注册是全局行为，组件反复挂载时只补齐缺失插件，避免重复注册。
pluginList.forEach((plugin) => {
  if (MindMap.hasPlugin(plugin) === -1) {
    MindMap.usePlugin(plugin)
  }
})

const DEFAULT_MAP_DATA = {
  data: {
    text: '小说思维导图',
    expand: true,
  },
  children: [],
}

const panelRef = ref(null)
const containerRef = ref(null)
const textInputRef = ref(null)
const mindMapRef = ref(null)
const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const initialLoaded = ref(false)
const dirty = ref(false)
const savedSnapshot = ref('')
const selectedNode = ref(null)
const selectedNodeList = ref([])
const applyingRemoteData = ref(false)
const fullscreen = ref(false)
const browserFullscreenActive = ref(false)

const nodeForm = reactive({
  text: '',
  note: '',
  generalizationText: '概要',
  outerFrameText: '外框',
})

const selectedNodeUid = computed(() => selectedNode.value?.getData?.('uid') || '未生成')
const selectedNodeType = computed(() => {
  if (!selectedNode.value) return '未选择'
  if (selectedNode.value.isRoot) return '根节点'
  if (selectedNode.value.isGeneralization) return '概要节点'
  return `第 ${selectedNode.value.layerIndex + 1} 层节点`
})
const canEditSelectedNode = computed(
  () => Boolean(selectedNode.value) && !selectedNode.value.isGeneralization,
)
const canCreateSibling = computed(
  () =>
    Boolean(selectedNode.value) &&
    !selectedNode.value.isRoot &&
    !selectedNode.value.isGeneralization,
)
const hasMindMap = computed(() => Boolean(mindMapRef.value))
const selectedNodeJson = computed(() => {
  if (!selectedNode.value?.nodeData) return ''
  return JSON.stringify(selectedNode.value.nodeData.data || {}, null, 2)
})

function cloneData(data) {
  return JSON.parse(JSON.stringify(data || DEFAULT_MAP_DATA))
}

function normalizeMindMapData(value) {
  // 兼容两类后端数据：纯节点树和 getData(true) 返回的完整结构。
  if (value && typeof value === 'object' && Object.keys(value).length > 0) {
    return cloneData(value)
  }
  return cloneData(DEFAULT_MAP_DATA)
}

function syncSelectedNode(node, list = []) {
  selectedNode.value = node || null
  selectedNodeList.value = Array.isArray(list) ? list : []
  const data = node?.getData?.() || {}
  nodeForm.text = String(data.text || '')
  nodeForm.note = String(data.note || '')
}

function currentFullData() {
  return mindMapRef.value?.getData?.(true) || null
}

function currentTreeData() {
  return mindMapRef.value?.getData?.(false) || null
}

function markSaved(data = currentFullData()) {
  savedSnapshot.value = JSON.stringify(data || {})
  dirty.value = false
}

function markDirty() {
  if (applyingRemoteData.value || !initialLoaded.value) return
  const current = JSON.stringify(currentFullData() || {})
  dirty.value = current !== savedSnapshot.value
}

function runAfterCanvasSettled(callback) {
  // SimpleMindMap 的 fit/resize 会在下一帧继续触发 view_data_change，等待两帧后再记录快照。
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback)
  })
}

function applyMindMapData(rawData) {
  const instance = mindMapRef.value
  if (!instance) return

  const data = normalizeMindMapData(rawData)
  applyingRemoteData.value = true
  // getData(true) 会返回 { root, layout, theme, view }，普通节点树则直接 setData。
  if (data.root) {
    instance.setFullData(data)
  } else {
    instance.setData(data)
  }
  syncSelectedNode(null, [])
  nextTick(() => {
    instance.resize?.()
    instance.view?.fit?.()
    runAfterCanvasSettled(() => {
      markSaved(currentFullData())
      applyingRemoteData.value = false
    })
  })
}

async function fetchMindMap({ recreate = false } = {}) {
  if (!props.novelId || loading.value) return

  loading.value = true
  loadError.value = ''
  let remoteMindMapData = null
  try {
    const res = await getMindMap(props.novelId)
    if (res?.code === 0) {
      remoteMindMapData = res.data?.mindMapData
    } else {
      loadError.value = res?.msg || '思维导图加载失败'
    }
  } catch (e) {
    loadError.value = e?.message || '思维导图加载失败'
  } finally {
    initialLoaded.value = true
    loading.value = false
  }

  if (!loadError.value) {
    // 首次加载时画布在 initialLoaded=true 后才进入 DOM，必须等待 Vue 完成渲染后再初始化库实例。
    await nextTick()
    if (recreate && mindMapRef.value) {
      // 组件内刷新应等价于浏览器重新进入页面：先清掉旧实例，再用服务端最新数据重建画布。
      destroyMindMap()
      await nextTick()
    }
    initMindMap()
    applyMindMapData(remoteMindMapData)
  }
}

async function onSaveMindMap() {
  if (!mindMapRef.value || saving.value || loading.value || !dirty.value) return

  saving.value = true
  try {
    const fullData = currentFullData()
    const res = await saveMindMap(props.novelId, fullData)
    if (res?.code === 0) {
      const savedData = res.data?.mindMapData || fullData
      markSaved(savedData)
      toast.add({ severity: 'success', summary: '思维导图已保存', life: 2200 })
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

function initMindMap() {
  if (!containerRef.value || mindMapRef.value) return

  // 初始化只放一个轻量默认根节点，真实数据随后由后端 mindMapData 覆盖。
  mindMapRef.value = new MindMap({
    el: containerRef.value,
    data: cloneData(DEFAULT_MAP_DATA),
    layout: 'logicalStructure',
    theme: 'default',
    fit: true,
    enableCtrlKeyNodeSelection: true,
    enableAutoEnterTextEditWhenKeydown: true,
    defaultInsertSecondLevelNodeText: '新节点',
    defaultInsertBelowSecondLevelNodeText: '新节点',
    defaultGeneralizationText: '概要',
    defaultAssociativeLineText: '关联',
    defaultOuterFrameText: '外框',
    fitPadding: 64,
  })

  mindMapRef.value.on('node_active', syncSelectedNode)
  mindMapRef.value.on('data_change', markDirty)
  // 视图平移、缩放和自动适配不属于思维导图内容修改，避免刷新后误显示“有未保存修改”。
}

function destroyMindMap() {
  const instance = mindMapRef.value
  if (!instance) return
  instance.off('node_active', syncSelectedNode)
  instance.off('data_change', markDirty)
  instance.destroy()
  mindMapRef.value = null
  syncSelectedNode(null, [])
}

function refreshCanvasSize() {
  if (!mindMapRef.value) return
  mindMapRef.value.resize?.()
}

function refreshCanvasViewport() {
  // 全屏切换会改变画布容器尺寸，下一帧再适配可避免 SimpleMindMap 继续使用旧视口。
  window.requestAnimationFrame(() => {
    fitMindMap()
  })
}

function syncFullscreenState() {
  // 浏览器全屏可能被 Esc 或系统 UI 退出，需要从 fullscreenchange 事件反向同步按钮状态。
  const isCurrentPanelFullscreen = document.fullscreenElement === panelRef.value
  fullscreen.value = isCurrentPanelFullscreen
  browserFullscreenActive.value = isCurrentPanelFullscreen
  nextTick(refreshCanvasViewport)
}

async function enterFullscreen() {
  if (!panelRef.value || fullscreen.value) return

  // 优先使用浏览器 Fullscreen API；不支持或被策略拦截时退回到应用内 fixed 全屏。
  if (panelRef.value.requestFullscreen) {
    try {
      await panelRef.value.requestFullscreen()
      return
    } catch (e) {
      browserFullscreenActive.value = false
    }
  }

  fullscreen.value = true
  await nextTick()
  refreshCanvasViewport()
}

async function exitFullscreen() {
  if (!fullscreen.value) return

  if (browserFullscreenActive.value && document.fullscreenElement === panelRef.value) {
    try {
      await document.exitFullscreen?.()
      return
    } catch (e) {
      browserFullscreenActive.value = false
    }
  }

  fullscreen.value = false
  browserFullscreenActive.value = false
  await nextTick()
  refreshCanvasViewport()
}

async function toggleFullscreen() {
  if (fullscreen.value) {
    await exitFullscreen()
  } else {
    await enterFullscreen()
  }
}

function onGlobalKeydown(event) {
  // 应用内全屏没有浏览器默认 Esc 行为，这里补齐退出能力；真实浏览器全屏由系统处理。
  if (event.key === 'Escape' && fullscreen.value && !browserFullscreenActive.value) {
    exitFullscreen()
  }
}

function reloadMindMap() {
  if (loading.value) return
  fetchMindMap({ recreate: true })
}

function warnSelectNode() {
  toast.add({ severity: 'warn', summary: '请先选择节点', life: 2200 })
}

function requireSelectedNode() {
  if (!selectedNode.value) {
    warnSelectNode()
    return null
  }
  return selectedNode.value
}

function resolveInsertTargetNodes({ allowRoot = true } = {}) {
  if (!mindMapRef.value) return []

  // SimpleMindMap 在没有 activeNodeList 且未传 appointNodes 时会静默跳过插入命令；
  // 工具栏按钮不能依赖画布当前激活态，必须显式传入要插入的目标节点。
  const activeNodes = selectedNodeList.value.filter((node) => {
    if (!node || node.isGeneralization) return false
    return allowRoot || !node.isRoot
  })
  if (activeNodes.length > 0) return activeNodes

  if (selectedNode.value && !selectedNode.value.isGeneralization) {
    if (allowRoot || !selectedNode.value.isRoot) return [selectedNode.value]
  }

  const root = mindMapRef.value.renderer?.root
  return allowRoot && root ? [root] : []
}

function createLocalNodeData(text = '新节点') {
  // 后端按 SimpleMindMap 的整图数据持久化，前端本地新增时只补齐库需要的最小节点字段。
  return {
    data: {
      text,
      uid: globalThis.crypto?.randomUUID?.() || `mind-map-node-${Date.now()}-${Math.random()}`,
      expand: true,
    },
    children: [],
  }
}

function findNodeDataByUid(root, uid) {
  if (!root || !uid) return null
  if (root.data?.uid === uid) return root
  const children = Array.isArray(root.children) ? root.children : []
  for (const child of children) {
    const matched = findNodeDataByUid(child, uid)
    if (matched) return matched
  }
  return null
}

function findNodeParentByUid(root, uid, parent = null) {
  if (!root || !uid) return null
  if (root.data?.uid === uid) return { parent, node: root }
  const children = Array.isArray(root.children) ? root.children : []
  for (const child of children) {
    const matched = findNodeParentByUid(child, uid, root)
    if (matched) return matched
  }
  return null
}

function renderLocalTreeData(treeData) {
  mindMapRef.value?.updateData?.(treeData)
  markDirty()
}

function addChildNode() {
  if (!mindMapRef.value) return
  const treeData = currentTreeData()
  if (!treeData) return

  const targetNode = resolveInsertTargetNodes()[0]
  const targetUid = targetNode?.getData?.('uid') || targetNode?.nodeData?.data?.uid
  const targetData = findNodeDataByUid(treeData, targetUid) || treeData
  targetData.data = { ...(targetData.data || {}), expand: true }
  targetData.children = Array.isArray(targetData.children) ? targetData.children : []
  targetData.children.push(createLocalNodeData())
  renderLocalTreeData(treeData)
}

function addSiblingNode() {
  if (!mindMapRef.value || !canCreateSibling.value) {
    toast.add({ severity: 'warn', summary: '根节点不能新增同级节点', life: 2200 })
    return
  }
  const treeData = currentTreeData()
  const targetNode = resolveInsertTargetNodes({ allowRoot: false })[0]
  const targetUid = targetNode?.getData?.('uid') || targetNode?.nodeData?.data?.uid
  const matched = findNodeParentByUid(treeData, targetUid)
  if (!treeData || !matched?.parent) return

  matched.parent.children = Array.isArray(matched.parent.children) ? matched.parent.children : []
  const index = matched.parent.children.findIndex((child) => child.data?.uid === targetUid)
  if (index < 0) return
  matched.parent.children.splice(index + 1, 0, createLocalNodeData())
  renderLocalTreeData(treeData)
}

function deleteSelectedNode() {
  const node = requireSelectedNode()
  if (!node || !mindMapRef.value) return
  if (node.isRoot) {
    toast.add({ severity: 'warn', summary: '根节点不能删除', life: 2200 })
    return
  }
  const targetNodes = resolveInsertTargetNodes({ allowRoot: false })
  if (targetNodes.length === 0) return
  mindMapRef.value.execCommand('REMOVE_NODE', targetNodes)
}

function focusTextEditor() {
  if (!requireSelectedNode()) return
  nextTick(() => textInputRef.value?.focus?.())
}

function applyNodeText() {
  const node = requireSelectedNode()
  const text = nodeForm.text.trim()
  if (!node || !mindMapRef.value) return
  if (!text) {
    toast.add({ severity: 'warn', summary: '节点文本不能为空', life: 2200 })
    return
  }
  mindMapRef.value.execCommand('SET_NODE_TEXT', node, text)
  syncSelectedNode(node, selectedNodeList.value)
}

function applyNodeNote() {
  const node = requireSelectedNode()
  if (!node || !mindMapRef.value || node.isGeneralization) return
  mindMapRef.value.execCommand('SET_NODE_NOTE', node, nodeForm.note)
  syncSelectedNode(node, selectedNodeList.value)
}

function addGeneralization() {
  const node = requireSelectedNode()
  if (!node || !mindMapRef.value) return
  if (node.isRoot || node.isGeneralization) {
    toast.add({ severity: 'warn', summary: '请选择普通节点添加概要', life: 2200 })
    return
  }
  const text = nodeForm.generalizationText.trim() || '概要'
  mindMapRef.value.execCommand('ADD_GENERALIZATION', { text }, false)
}

function startAssociativeLine() {
  const node = requireSelectedNode()
  if (!node || !mindMapRef.value) return
  mindMapRef.value.associativeLine?.createLineFromActiveNode?.()
  toast.add({
    severity: 'info',
    summary: '请选择目标节点',
    detail: '移动鼠标到目标节点并点击，即可完成关联线。',
    life: 3200,
  })
}

function targetFrameNodes() {
  const activeList = selectedNodeList.value.filter((node) => !node.isRoot && !node.isGeneralization)
  return activeList.length > 0 ? activeList : []
}

function addOrUpdateOuterFrame() {
  if (!mindMapRef.value) return
  const nodes = targetFrameNodes()
  if (nodes.length === 0) {
    toast.add({ severity: 'warn', summary: '请选择普通节点添加外框', life: 2200 })
    return
  }
  mindMapRef.value.execCommand('ADD_OUTER_FRAME', nodes, {
    text: nodeForm.outerFrameText.trim() || '外框',
    strokeColor: '#3b82f6',
    fill: 'rgba(59, 130, 246, 0.08)',
    textFill: '#3b82f6',
    color: '#ffffff',
  })
}

function removeOuterFrame() {
  if (!mindMapRef.value) return
  const nodes = targetFrameNodes()
  if (nodes.length === 0) return
  // 外框数据保存在节点 data.outerFrame 上，显式清空后会随整图保存一起持久化。
  nodes.forEach((node) => {
    mindMapRef.value.execCommand('SET_NODE_DATA', node, { outerFrame: null })
  })
}

function fitMindMap() {
  if (!mindMapRef.value) return
  mindMapRef.value.resize?.()
  mindMapRef.value.view?.fit?.()
}

function undoMindMap() {
  mindMapRef.value?.execCommand?.('BACK')
}

function redoMindMap() {
  mindMapRef.value?.execCommand?.('FORWARD')
}

watch(
  () => props.novelId,
  () => {
    initialLoaded.value = false
    loadError.value = ''
    dirty.value = false
    if (mindMapRef.value) {
      fetchMindMap({ recreate: true })
    }
  },
)

onMounted(() => {
  fetchMindMap()
  window.addEventListener('resize', refreshCanvasSize)
  document.addEventListener('fullscreenchange', syncFullscreenState)
  document.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', refreshCanvasSize)
  document.removeEventListener('fullscreenchange', syncFullscreenState)
  document.removeEventListener('keydown', onGlobalKeydown)
  if (document.fullscreenElement === panelRef.value) {
    document.exitFullscreen?.()?.catch?.(() => {})
  }
  destroyMindMap()
})
</script>

<template>
  <section
    ref="panelRef"
    class="mind-map-panel"
    :class="{ fullscreen }"
    aria-labelledby="mind-map-title"
  >
    <header class="mind-map-head">
      <div>
        <p class="eyebrow">{{ novelTitle ? `《${novelTitle}》` : 'Mind Map' }}</p>
        <h2 id="mind-map-title">思维导图</h2>
        <p class="save-state">{{ dirty ? '有未保存修改' : '已保存到最新状态' }}</p>
      </div>

      <div class="panel-actions" aria-label="思维导图操作">
        <button class="tool-button" type="button" :disabled="loading" @click="reloadMindMap">
          刷新
        </button>
        <button class="tool-button" type="button" :disabled="!hasMindMap" @click="fitMindMap">
          适配画布
        </button>
        <button
          class="tool-button"
          type="button"
          :aria-pressed="fullscreen"
          :disabled="!hasMindMap"
          @click="toggleFullscreen"
        >
          {{ fullscreen ? '退出全屏' : '全屏' }}
        </button>
        <button
          class="tool-button primary"
          type="button"
          :disabled="loading || saving || !dirty"
          @click="onSaveMindMap"
        >
          {{ saving ? '保存中...' : '保存思维导图' }}
        </button>
      </div>
    </header>

    <div v-if="!initialLoaded" class="mind-map-state" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <span>正在载入思维导图...</span>
    </div>

    <div v-else-if="loadError" class="mind-map-state error">
      <strong>思维导图加载失败</strong>
      <p>{{ loadError }}</p>
      <button class="tool-button" type="button" @click="reloadMindMap">重试</button>
    </div>

    <div v-else class="mind-map-workspace">
      <section class="canvas-column" aria-label="思维导图画布">
        <div class="map-toolbar" aria-label="节点工具栏">
          <button class="tool-button" type="button" @click="addChildNode">新增子节点</button>
          <button
            class="tool-button"
            type="button"
            :disabled="!canCreateSibling"
            @click="addSiblingNode"
          >
            新增同级
          </button>
          <button
            class="tool-button danger"
            type="button"
            :disabled="!canCreateSibling"
            @click="deleteSelectedNode"
          >
            删除节点
          </button>
          <button
            class="tool-button"
            type="button"
            :disabled="!selectedNode"
            @click="focusTextEditor"
          >
            编辑文本
          </button>
          <button
            class="tool-button"
            type="button"
            :disabled="!selectedNode"
            @click="addGeneralization"
          >
            添加概要
          </button>
          <button
            class="tool-button"
            type="button"
            :disabled="!selectedNode"
            @click="startAssociativeLine"
          >
            关联线
          </button>
          <button
            class="tool-button"
            type="button"
            :disabled="!selectedNode"
            @click="addOrUpdateOuterFrame"
          >
            添加外框
          </button>
          <button class="tool-button" type="button" :disabled="!hasMindMap" @click="undoMindMap">
            撤销
          </button>
          <button class="tool-button" type="button" :disabled="!hasMindMap" @click="redoMindMap">
            重做
          </button>
        </div>

        <div class="map-shell">
          <div ref="containerRef" class="mind-map-canvas"></div>
          <div v-if="!selectedNode" class="canvas-hint">
            <strong>选择一个节点开始编辑</strong>
            <p>可以新增子节点、添加概要、备注、外框和关联线，完成后点击保存。</p>
          </div>
        </div>
      </section>

      <aside class="node-panel" aria-label="节点属性">
        <div class="node-panel-head">
          <span>当前节点</span>
          <strong>{{ selectedNodeType }}</strong>
        </div>

        <div v-if="!selectedNode" class="node-empty">
          点击画布中的节点后，这里会显示节点数据和可编辑属性。
        </div>

        <template v-else>
          <dl class="node-meta">
            <div>
              <dt>UID</dt>
              <dd>{{ selectedNodeUid }}</dd>
            </div>
            <div>
              <dt>子节点</dt>
              <dd>{{ selectedNode.children?.length || 0 }}</dd>
            </div>
          </dl>

          <label class="property-field">
            <span>节点文本</span>
            <input
              ref="textInputRef"
              v-model="nodeForm.text"
              type="text"
              :disabled="!canEditSelectedNode"
              placeholder="请输入节点文本"
            />
          </label>
          <button
            class="property-button"
            type="button"
            :disabled="!canEditSelectedNode"
            @click="applyNodeText"
          >
            更新文本
          </button>

          <label class="property-field">
            <span>备注</span>
            <textarea
              v-model="nodeForm.note"
              :disabled="!canEditSelectedNode"
              rows="5"
              placeholder="记录节点备注"
            ></textarea>
          </label>
          <button
            class="property-button"
            type="button"
            :disabled="!canEditSelectedNode"
            @click="applyNodeNote"
          >
            更新备注
          </button>

          <label class="property-field">
            <span>概要文本</span>
            <input
              v-model="nodeForm.generalizationText"
              type="text"
              :disabled="!canEditSelectedNode"
              placeholder="例如：本卷核心冲突"
            />
          </label>
          <button
            class="property-button"
            type="button"
            :disabled="!canEditSelectedNode"
            @click="addGeneralization"
          >
            添加概要
          </button>

          <label class="property-field">
            <span>外框标题</span>
            <input
              v-model="nodeForm.outerFrameText"
              type="text"
              :disabled="!canCreateSibling"
              placeholder="例如：第一卷"
            />
          </label>
          <div class="property-actions">
            <button
              class="property-button"
              type="button"
              :disabled="!canCreateSibling"
              @click="addOrUpdateOuterFrame"
            >
              添加外框
            </button>
            <button
              class="property-button ghost"
              type="button"
              :disabled="!canCreateSibling"
              @click="removeOuterFrame"
            >
              移除外框
            </button>
          </div>

          <details class="raw-node">
            <summary>节点原始数据</summary>
            <pre>{{ selectedNodeJson }}</pre>
          </details>
        </template>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.mind-map-panel {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border: 1px solid oklch(88% 0.012 255);
  border-radius: 16px;
  background: oklch(99.2% 0.004 255);
  box-shadow:
    0 18px 44px oklch(45% 0.04 260 / 0.1),
    0 1px 2px oklch(45% 0.04 260 / 0.08);
  color: oklch(26% 0.035 260);
  overflow: hidden;
}

/*
  全屏同时支持浏览器 Fullscreen API 与应用内 fixed 回退。
  两套选择器保持相同尺寸规则，保证退出/进入时 SimpleMindMap 的容器测量一致。
*/
.mind-map-panel.fullscreen {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.mind-map-panel.fullscreen,
.mind-map-panel:fullscreen {
  width: 100vw;
  height: 100vh;
  max-height: 100vh;
  border: 0;
  border-radius: 0;
  background: oklch(99.2% 0.004 255);
  box-shadow: none;
}

.mind-map-panel.fullscreen .mind-map-workspace,
.mind-map-panel:fullscreen .mind-map-workspace {
  min-height: 0;
}

.mind-map-panel.fullscreen .map-shell,
.mind-map-panel:fullscreen .map-shell,
.mind-map-panel.fullscreen .mind-map-canvas,
.mind-map-panel:fullscreen .mind-map-canvas {
  height: 100%;
  min-height: 0;
}

.mind-map-head {
  min-height: 98px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 26px;
  border-bottom: 1px solid oklch(91% 0.01 255);
  background: oklch(97.8% 0.006 255);
}

.eyebrow,
.save-state {
  margin: 0;
  color: oklch(52% 0.04 260);
  font-size: 0.8rem;
  font-weight: 760;
}

.eyebrow {
  margin-bottom: 7px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.mind-map-head h2 {
  margin: 0;
  color: oklch(24% 0.04 260);
  font-size: 1.55rem;
  line-height: 1.15;
  font-weight: 800;
}

.save-state {
  margin-top: 6px;
}

.panel-actions,
.map-toolbar,
.property-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.tool-button,
.property-button {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 14px;
  border: 1px solid oklch(82% 0.024 255);
  border-radius: 9px;
  background: oklch(99.4% 0.003 255);
  color: oklch(38% 0.04 260);
  font: inherit;
  font-size: 0.88rem;
  font-weight: 760;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.tool-button:hover,
.tool-button[aria-pressed='true'],
.property-button:hover {
  border-color: oklch(70% 0.08 255);
  background: oklch(95% 0.02 255);
  color: oklch(48% 0.16 255);
  transform: translateY(-1px);
}

.tool-button.danger {
  border-color: oklch(84% 0.065 24);
  color: oklch(55% 0.22 25);
}

.tool-button.primary {
  border-color: oklch(58% 0.18 258);
  background: oklch(57% 0.2 258);
  color: oklch(99% 0.004 255);
}

.tool-button.primary:hover {
  border-color: oklch(50% 0.2 258);
  background: oklch(51% 0.21 258);
  color: oklch(99% 0.004 255);
}

.tool-button:disabled,
.property-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
}

.tool-button:focus-visible,
.property-button:focus-visible,
.property-field input:focus-visible,
.property-field textarea:focus-visible {
  outline: 3px solid oklch(76% 0.14 250 / 0.55);
  outline-offset: 3px;
}

.mind-map-state {
  min-height: 420px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 42px 24px;
  color: oklch(52% 0.03 260);
  text-align: center;
}

.mind-map-state.error {
  flex-direction: column;
  color: oklch(55% 0.2 25);
}

.mind-map-state p {
  margin: 0;
  color: oklch(50% 0.03 260);
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid oklch(84% 0.02 255);
  border-top-color: oklch(54% 0.18 258);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.mind-map-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  min-height: 0;
  overflow: hidden;
}

.canvas-column {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border-right: 1px solid oklch(91% 0.01 255);
  background: oklch(99.2% 0.004 255);
}

.map-toolbar {
  min-height: 62px;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid oklch(91% 0.01 255);
  background: oklch(98.5% 0.006 255);
}

.map-shell {
  position: relative;
  min-height: 680px;
  overflow: hidden;
  background-color: oklch(99.4% 0.003 255);
  background-image:
    linear-gradient(oklch(89% 0.012 255) 1px, transparent 1px),
    linear-gradient(90deg, oklch(89% 0.012 255) 1px, transparent 1px);
  background-size: 24px 24px;
}

.mind-map-canvas {
  width: 100%;
  height: 100%;
  min-height: 680px;
}

.canvas-hint {
  position: absolute;
  left: 22px;
  bottom: 22px;
  width: min(360px, calc(100% - 44px));
  padding: 18px 20px;
  border: 1px dashed oklch(78% 0.04 255);
  border-radius: 12px;
  background: oklch(99% 0.004 255 / 0.92);
  color: oklch(48% 0.032 260);
  pointer-events: none;
  box-shadow: 0 14px 28px oklch(38% 0.04 260 / 0.08);
}

.canvas-hint strong {
  color: oklch(28% 0.04 260);
  font-size: 1rem;
  font-weight: 800;
}

.canvas-hint p {
  margin: 8px 0 0;
  line-height: 1.65;
}

:deep(.smm-mind-map-container) {
  width: 100%;
  height: 100%;
  background: transparent;
}

:deep(.smm-node.active .smm-node-shape) {
  filter: drop-shadow(0 8px 16px oklch(45% 0.08 255 / 0.18));
}

/*
  SimpleMindMap 的富文本节点会渲染为 foreignObject + p。
  浏览器默认 p margin 会把文字顶到节点下缘，导致只露出底部笔画；这里把库内部段落复位到测量高度。
*/
:deep(.smm-richtext-node-wrap),
:deep(.smm-richtext-node-wrap p) {
  margin: 0;
  padding: 0;
  line-height: 1.2;
}

.node-panel {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-auto-rows: max-content;
  gap: 14px;
  padding: 18px;
  overflow: auto;
  background: oklch(98.4% 0.006 255);
}

.node-panel-head {
  display: grid;
  gap: 5px;
  padding: 14px 16px;
  border: 1px solid oklch(88% 0.012 255);
  border-radius: 12px;
  background: oklch(99.2% 0.004 255);
}

.node-panel-head span,
.property-field span,
.node-meta dt {
  color: oklch(52% 0.032 260);
  font-size: 0.78rem;
  font-weight: 780;
}

.node-panel-head strong {
  color: oklch(25% 0.04 260);
  font-size: 1rem;
  font-weight: 800;
}

.node-empty {
  padding: 28px 18px;
  border: 1px dashed oklch(80% 0.026 255);
  border-radius: 12px;
  color: oklch(50% 0.032 260);
  line-height: 1.7;
  text-align: center;
}

.node-meta {
  display: grid;
  gap: 10px;
  margin: 0;
}

.node-meta div {
  display: grid;
  gap: 5px;
  padding: 12px 14px;
  border: 1px solid oklch(89% 0.01 255);
  border-radius: 10px;
  background: oklch(99% 0.004 255);
}

.node-meta dd {
  min-width: 0;
  margin: 0;
  color: oklch(30% 0.035 260);
  font-size: 0.9rem;
  font-weight: 740;
  overflow-wrap: anywhere;
}

.property-field {
  display: grid;
  gap: 8px;
}

.property-field input,
.property-field textarea {
  width: 100%;
  border: 1px solid oklch(84% 0.018 255);
  border-radius: 9px;
  outline: 0;
  background: oklch(99% 0.004 255);
  color: oklch(26% 0.035 260);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 680;
}

.property-field input {
  min-height: 42px;
  padding: 0 12px;
}

.property-field textarea {
  resize: vertical;
  min-height: 112px;
  padding: 10px 12px;
  line-height: 1.65;
}

.property-button {
  width: 100%;
}

.property-button.ghost {
  background: transparent;
}

.raw-node {
  border: 1px solid oklch(89% 0.01 255);
  border-radius: 10px;
  background: oklch(99% 0.004 255);
  overflow: hidden;
}

.raw-node summary {
  padding: 12px 14px;
  color: oklch(42% 0.04 260);
  font-size: 0.86rem;
  font-weight: 760;
  cursor: pointer;
}

.raw-node pre {
  max-height: 220px;
  margin: 0;
  padding: 12px 14px;
  overflow: auto;
  border-top: 1px solid oklch(91% 0.01 255);
  color: oklch(31% 0.035 260);
  font:
    0.78rem/1.55 ui-monospace,
    'SFMono-Regular',
    Consolas,
    'Liberation Mono',
    monospace;
  white-space: pre-wrap;
}

@media (max-width: 980px) {
  .mind-map-panel {
    height: auto;
  }

  .mind-map-head {
    align-items: stretch;
    flex-direction: column;
  }

  .panel-actions,
  .panel-actions :deep(.p-button),
  .tool-button {
    width: 100%;
  }

  .mind-map-workspace {
    grid-template-columns: 1fr;
    overflow: visible;
  }

  .canvas-column {
    border-right: 0;
    border-bottom: 1px solid oklch(91% 0.01 255);
  }

  .map-shell,
  .mind-map-canvas {
    min-height: 560px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 0.01ms;
    animation-iteration-count: 1;
  }

  .tool-button,
  .property-button {
    transition-duration: 0.01ms;
  }

  .tool-button:hover,
  .property-button:hover {
    transform: none;
  }
}
</style>
