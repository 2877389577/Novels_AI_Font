<!--
  CharacterRelationGraphPanel.vue：小说角色关系图编辑面板
  ----------------------------------------------------------------------------
  设计目标：
  1. 左侧展示小说已有角色卡，右侧用 Vue Flow 承载可拖拽、可连线的关系画布。
  2. 关系创建、节点布局保存和关系删除都走后端 character-relation 接口。
  3. 首版只删除关系线，不从画布移除角色节点，避免和后端 hidden/status 语义产生歧义。
-->

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { VueFlow } from '@vue-flow/core'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import Dialog from 'primevue/dialog'
import { getCharacter, listCharacters } from '@/api/character'
import {
  createCharacterRelation,
  deleteCharacterRelation,
  getCharacterRelationGraph,
  saveCharacterRelationNodeLayouts,
} from '@/api/characterRelation'
import CharacterRelationNode from '@/components/CharacterRelationNode.vue'
import maleAvatar from '@/assets/images/默认男性角色图像.png'
import femaleAvatar from '@/assets/images/默认女性角色图像.png'
import '@vue-flow/core/dist/style.css'

const props = defineProps({
  novelId: { type: Number, required: true },
  novelTitle: { type: String, default: '' },
})

const confirm = useConfirm()
const toast = useToast()

const RELATION_TYPE_OPTIONS = [
  { label: '家人', value: 'family' },
  { label: '好友', value: 'friend' },
  { label: '宿敌', value: 'enemy' },
  { label: '恋人', value: 'lover' },
  { label: '师徒', value: 'teacher' },
  { label: '其他', value: 'other' },
]

const STATUS_LABELS = {
  1: '在线',
  2: '下线',
}

const flowId = computed(() => `character-relation-flow-${props.novelId}`)
const flowInstance = ref(null)
const canvasShellRef = ref(null)
const flowNodes = ref([])
const flowEdges = ref([])
const characters = ref([])
const graphLoading = ref(false)
const graphError = ref('')
const initialLoaded = ref(false)
const draggedCharacter = ref(null)
const layoutSavingIds = ref(new Set())
const pendingConnection = ref(null)
const showRelationDialog = ref(false)
const relationSaving = ref(false)
const selectedEdge = ref(null)
const deletingRelationId = ref(null)
const removingNodeId = ref(null)
const showCharacterDialog = ref(false)
const characterDetail = ref(null)
const detailLoading = ref(false)
const canvasFullscreen = ref(false)

const relationForm = reactive({
  relationLabel: '',
  relationType: 'other',
})

const placedCharacterIds = computed(() => new Set(flowNodes.value.map((node) => String(node.id))))
const hasCanvasNodes = computed(() => flowNodes.value.length > 0)
const selectedEdgeRelationId = computed(() => relationIdOfEdge(selectedEdge.value))

function normalizeGender(gender = '') {
  return gender === '女' ? '女' : '男'
}

function characterIdOf(character = {}) {
  return character.id ?? character.characterId
}

function graphNodeCharacterId(node = {}) {
  return node.data?.characterId ?? node.id
}

function relationIdOfEdge(edge = {}) {
  const id = edge?.data?.relationId ?? edge?.id
  const numericId = Number(id)
  return Number.isFinite(numericId) && numericId > 0 ? numericId : null
}

function characterAvatarSrc(character = {}) {
  // 真实角色形象图优先；没有图片时，按性别使用本地默认角色图。
  const imageUrl = String(character.appearanceImgUrl || '').trim()
  if (imageUrl) return imageUrl
  return normalizeGender(character.gender) === '女' ? femaleAvatar : maleAvatar
}

function characterAvatarAlt(character = {}) {
  const name = character.name || '未命名角色'
  return character.appearanceImgUrl ? `${name}形象图` : `${name}默认形象图`
}

function statusLabel(status) {
  return STATUS_LABELS[status] || '未设定'
}

function textOrFallback(value, fallback = '暂未记录') {
  return String(value || '').trim() || fallback
}

function tagListOf(character = {}) {
  return Array.isArray(character.charactersTags) ? character.charactersTags.filter(Boolean) : []
}

function detailFields(character = {}) {
  return [
    { label: '角色介绍', value: character.intro },
    { label: '外貌', value: character.appearance },
    { label: '性格', value: character.personality },
    { label: '背景', value: character.background },
    { label: '能力', value: character.ability },
    { label: '动机', value: character.motivation },
    { label: '剧情方向', value: character.plotDirection },
  ]
}

function normalizePosition(position = {}, fallbackIndex = 0) {
  const x = Number(position.x)
  const y = Number(position.y)
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y }

  // 没有保存布局但已有关系端点时，用稳定的简易排布避免节点重叠到左上角。
  return {
    x: 120 + (fallbackIndex % 4) * 240,
    y: 90 + Math.floor(fallbackIndex / 4) * 150,
  }
}

function graphNodeToCharacter(node = {}) {
  const data = node.data || {}
  const id = Number(data.characterId ?? node.id)
  return {
    id,
    characterId: id,
    name: data.name || '未命名角色',
    gender: data.gender || '',
    status: data.characterStatus ?? data.status,
    appearanceImgUrl: data.appearanceImgUrl || '',
    charactersTags: data.charactersTags || [],
    layoutId: data.layoutId,
    nodeStatus: data.nodeStatus,
    extraData: data.extraData || {},
  }
}

function mergeCharacters(listItems = [], graphNodes = []) {
  const merged = new Map()

  listItems.forEach((item) => {
    const id = characterIdOf(item)
    if (!id) return
    merged.set(String(id), {
      ...item,
      id,
      characterId: id,
    })
  })

  graphNodes.forEach((node) => {
    const fromGraph = graphNodeToCharacter(node)
    const id = characterIdOf(fromGraph)
    if (!id) return
    merged.set(String(id), {
      ...(merged.get(String(id)) || {}),
      ...fromGraph,
    })
  })

  return [...merged.values()].sort((a, b) => Number(characterIdOf(a)) - Number(characterIdOf(b)))
}

function isGraphNodePlaced(node, edgeCharacterIds) {
  const id = String(graphNodeCharacterId(node))
  const nodeStatus = Number(node?.data?.nodeStatus ?? node?.data?.status ?? node?.status)
  if (node?.hidden || nodeStatus === 2) return false
  // 后端没有显式 onCanvas 字段，因此用三类信号判断节点是否应该展示：
  // 1. layoutId：后端明确返回了已保存的布局记录；
  // 2. nodeStatus === 1：部分后端实现可能只返回布局状态，不返回 layoutId；
  // 3. 关系端点：已有关系线时必须展示连线两端角色，避免关系存在但节点被过滤。
  return Boolean(node?.data?.layoutId) || nodeStatus === 1 || edgeCharacterIds.has(id)
}

function toFlowNode(character, position, sourceNode = {}, options = {}) {
  const id = String(characterIdOf(character))
  // 从左侧列表重新拖入画布时，必须把节点恢复为启用状态。
  // 左侧列表会合并图谱节点数据，曾经被移出画布的角色可能携带 nodeStatus=2；
  // 如果继续保存这个旧状态，刷新后前端会按“停用节点”把它过滤掉。
  const shouldForceActive = Boolean(options.forceActive)
  return {
    id,
    type: 'character',
    position,
    hidden: shouldForceActive ? false : Boolean(sourceNode.hidden),
    draggable: true,
    selectable: true,
    data: {
      ...character,
      characterId: Number(id),
      layoutId: sourceNode.data?.layoutId ?? character.layoutId,
      nodeStatus: shouldForceActive
        ? 1
        : (sourceNode.data?.nodeStatus ?? character.nodeStatus ?? 1),
      locked: Boolean(sourceNode.locked || sourceNode.data?.locked),
      extraData: sourceNode.data?.extraData || character.extraData || {},
    },
  }
}

function toFlowEdge(edge = {}) {
  const data = edge.data || {}
  // 查询图谱接口返回的是 Vue Flow edge；新增关系接口返回的是业务 relation。
  // 这里同时兼容两种结构，避免新建关系后需要额外刷新才能拿到可渲染连线。
  const relationId = data.relationId ?? edge.relationId ?? edge.id
  const sourceId = edge.source ?? data.sourceCharacterId ?? edge.sourceCharacterId
  const targetId = edge.target ?? data.targetCharacterId ?? edge.targetCharacterId
  const label = edge.label || data.relationLabel || edge.relationLabel || '关系'
  return {
    id: String(relationId),
    source: String(sourceId),
    target: String(targetId),
    sourceHandle: edge.sourceHandle || 'source',
    targetHandle: edge.targetHandle || 'target',
    type: edge.type || edge.edgeType || data.edgeType || 'default',
    label,
    animated: Boolean(edge.animated),
    selectable: true,
    interactionWidth: 18,
    labelShowBg: true,
    labelBgPadding: [8, 4],
    labelBgBorderRadius: 8,
    labelStyle: {
      fill: 'oklch(30% 0.04 260)',
      fontWeight: 760,
      fontSize: '12px',
    },
    labelBgStyle: {
      fill: 'oklch(99% 0.004 255)',
      stroke: 'oklch(84% 0.018 255)',
      strokeWidth: 1,
    },
    style: {
      stroke: 'oklch(58% 0.12 255)',
      strokeWidth: 2,
      ...(edge.style || {}),
    },
    data: {
      ...data,
      relationId: Number(relationId),
      relationLabel: label,
      relationType: data.relationType || edge.relationType || 'other',
      sourceCharacterId: Number(sourceId),
      targetCharacterId: Number(targetId),
    },
  }
}

function buildLayoutPayload(node) {
  const characterId = Number(node.data?.characterId ?? node.id)
  return {
    characterId,
    positionX: Number(node.position?.x) || 0,
    positionY: Number(node.position?.y) || 0,
    width: Number(node.dimensions?.width || node.width || 184),
    height: Number(node.dimensions?.height || node.height || 74),
    hidden: Boolean(node.hidden),
    locked: Boolean(node.data?.locked || node.locked),
    status: Number(node.data?.nodeStatus) || 1,
    type: node.type || 'character',
    style: node.style || {},
    extraData: node.data?.extraData || {},
  }
}

async function fetchAllCharacters() {
  const pageSize = 100
  let page = 1
  let total = 0
  const result = []

  do {
    const res = await listCharacters(props.novelId, { page, pageSize })
    if (res?.code !== 0) throw new Error(res?.msg || '角色列表加载失败')
    const items = res.data?.items || []
    result.push(...items)
    total = Number(res.data?.total) || result.length
    if (items.length === 0) break
    page += 1
  } while (result.length < total)

  return result
}

async function refreshGraph() {
  if (graphLoading.value) return
  graphLoading.value = true
  graphError.value = ''
  selectedEdge.value = null

  try {
    const [characterItems, graphRes] = await Promise.all([
      fetchAllCharacters(),
      getCharacterRelationGraph(props.novelId),
    ])

    if (graphRes?.code !== 0) {
      throw new Error(graphRes?.msg || '角色关系图加载失败')
    }

    const graphNodes = graphRes.data?.nodes || []
    const graphEdges = graphRes.data?.edges || []
    const edgeCharacterIds = new Set()
    graphEdges.forEach((edge) => {
      if (edge.source) edgeCharacterIds.add(String(edge.source))
      if (edge.target) edgeCharacterIds.add(String(edge.target))
      if (edge.data?.sourceCharacterId) edgeCharacterIds.add(String(edge.data.sourceCharacterId))
      if (edge.data?.targetCharacterId) edgeCharacterIds.add(String(edge.data.targetCharacterId))
    })

    characters.value = mergeCharacters(characterItems, graphNodes)
    const nextNodes = graphNodes
      .filter((node) => isGraphNodePlaced(node, edgeCharacterIds))
      .map((node, index) =>
        toFlowNode(graphNodeToCharacter(node), normalizePosition(node.position, index), node),
      )
    const visibleNodeIds = new Set(nextNodes.map((node) => String(node.id)))
    flowNodes.value = nextNodes
    flowEdges.value = graphEdges
      .map(toFlowEdge)
      .filter(
        (edge) =>
          visibleNodeIds.has(String(edge.source)) && visibleNodeIds.has(String(edge.target)),
      )

    await nextTick()
    fitCanvas()
  } catch (e) {
    graphError.value = e?.message || '角色关系图加载失败'
  } finally {
    graphLoading.value = false
    initialLoaded.value = true
  }
}

function onFlowInit(instance) {
  flowInstance.value = instance
  fitCanvas()
}

function fitCanvas() {
  if (!flowInstance.value || flowNodes.value.length === 0) return
  flowInstance.value.fitView({ padding: 0.18, duration: 220 })
}

function refreshCanvasViewport() {
  // 画布尺寸变化后让 Vue Flow 在下一帧重新计算视口，避免全屏切换后节点停留在旧尺寸布局里。
  window.requestAnimationFrame(() => {
    fitCanvas()
  })
}

function toggleCanvasFullscreen() {
  canvasFullscreen.value = !canvasFullscreen.value
  nextTick(refreshCanvasViewport)
}

function onGlobalKeydown(event) {
  // 应用内全屏保留 Esc 快捷退出；当 PrimeVue 弹窗打开时，Esc 优先交给弹窗自身处理。
  if (
    event.key === 'Escape' &&
    canvasFullscreen.value &&
    !showRelationDialog.value &&
    !showCharacterDialog.value
  ) {
    canvasFullscreen.value = false
    nextTick(refreshCanvasViewport)
  }
}

function isCharacterPlaced(character) {
  return placedCharacterIds.value.has(String(characterIdOf(character)))
}

function onLibraryDragStart(event, character) {
  if (isCharacterPlaced(character)) {
    event.preventDefault()
    return
  }
  draggedCharacter.value = character
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('application/x-character-id', String(characterIdOf(character)))
}

function onLibraryDragEnd() {
  draggedCharacter.value = null
}

async function persistNodeLayouts(nodesToSave, options = {}) {
  const nodeList = nodesToSave.filter(Boolean)
  if (nodeList.length === 0) return true

  const ids = nodeList.map((node) => String(node.id))
  layoutSavingIds.value = new Set([...layoutSavingIds.value, ...ids])

  try {
    const res = await saveCharacterRelationNodeLayouts(
      props.novelId,
      nodeList.map((node) => buildLayoutPayload(node)),
    )
    if (res?.code === 0) {
      const savedLayouts = Array.isArray(res.data) ? res.data : []
      const layoutMap = new Map(savedLayouts.map((layout) => [String(layout.characterId), layout]))
      flowNodes.value = flowNodes.value.map((node) => {
        const layout = layoutMap.get(String(node.id))
        if (!layout) return node
        return {
          ...node,
          data: {
            ...node.data,
            layoutId: layout.id ?? node.data?.layoutId,
            nodeStatus: layout.status ?? node.data?.nodeStatus,
            locked: layout.locked ?? node.data?.locked,
            extraData: layout.extraData || node.data?.extraData || {},
          },
        }
      })
      return true
    }

    toast.add({
      severity: 'error',
      summary: '布局保存失败',
      detail: res?.msg || '请稍后重试',
      life: 3000,
    })
    return false
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: '网络错误',
      detail: e?.message || '请稍后重试',
      life: 3000,
    })
    if (options.removeOnFail) {
      flowNodes.value = flowNodes.value.filter((node) => !ids.includes(String(node.id)))
    }
    return false
  } finally {
    const nextIds = new Set(layoutSavingIds.value)
    ids.forEach((id) => nextIds.delete(id))
    layoutSavingIds.value = nextIds
  }
}

async function onCanvasDrop(event) {
  event.preventDefault()
  const characterId = event.dataTransfer.getData('application/x-character-id')
  const character =
    draggedCharacter.value ||
    characters.value.find((item) => String(characterIdOf(item)) === String(characterId))

  if (!character || !flowInstance.value) return

  if (isCharacterPlaced(character)) {
    toast.add({ severity: 'info', summary: '角色已在画布中', life: 2000 })
    draggedCharacter.value = null
    return
  }

  const position = flowInstance.value.screenToFlowCoordinate({
    x: event.clientX,
    y: event.clientY,
  })
  const node = toFlowNode(
    character,
    {
      x: Math.round(position.x - 92),
      y: Math.round(position.y - 37),
    },
    {},
    { forceActive: true },
  )

  flowNodes.value = [...flowNodes.value, node]
  draggedCharacter.value = null
  await nextTick()
  await persistNodeLayouts([node], { removeOnFail: true })
}

function onNodeDragStop(event) {
  const nodesToSave =
    Array.isArray(event?.nodes) && event.nodes.length > 0 ? event.nodes : [event?.node]
  persistNodeLayouts(nodesToSave)
}

function onNodeClick(event) {
  selectedEdge.value = null
  openCharacterDetail(event?.node?.data)
}

function resetRelationForm() {
  relationForm.relationLabel = ''
  relationForm.relationType = 'other'
}

function isRelationConflict(source = {}) {
  const message = String(source?.raw?.msg || source?.msg || source?.message || '')
  // 后端文档说明重复关系会返回 409；兼容业务码走 200 但 msg 提示“已存在”的实现。
  return source?.status === 409 || message.includes('已存在')
}

async function recoverExistingRelation() {
  // 关系已存在时，说明数据库里已经有这条边；刷新图谱比让用户继续重复提交更可靠。
  showRelationDialog.value = false
  pendingConnection.value = null
  toast.add({
    severity: 'info',
    summary: '关系已存在',
    detail: '已刷新角色关系图，请查看已有连线。',
    life: 3000,
  })
  await refreshGraph()
}

function onConnect(connection) {
  if (!connection?.source || !connection?.target) return
  if (connection.source === connection.target) {
    toast.add({ severity: 'warn', summary: '不能连接同一个角色', life: 2500 })
    return
  }

  pendingConnection.value = {
    ...connection,
    sourceHandle: connection.sourceHandle || 'source',
    targetHandle: connection.targetHandle || 'target',
  }
  resetRelationForm()
  showRelationDialog.value = true
}

function closeRelationDialog() {
  if (relationSaving.value) return
  pendingConnection.value = null
  showRelationDialog.value = false
}

async function savePendingRelation() {
  if (relationSaving.value || !pendingConnection.value) return
  const label = relationForm.relationLabel.trim()
  if (!label) {
    toast.add({ severity: 'warn', summary: '请填写关系注释', life: 2500 })
    return
  }

  relationSaving.value = true
  try {
    const payload = {
      sourceCharacterId: Number(pendingConnection.value.source),
      targetCharacterId: Number(pendingConnection.value.target),
      sourceHandle: pendingConnection.value.sourceHandle || 'source',
      targetHandle: pendingConnection.value.targetHandle || 'target',
      relationLabel: label,
      relationType: relationForm.relationType || 'other',
      direction: 2,
      status: 1,
      edgeType: 'default',
    }
    const res = await createCharacterRelation(props.novelId, payload)
    if (res?.code === 0 && res.data) {
      flowEdges.value = [...flowEdges.value, toFlowEdge({ ...res.data, label })]
      showRelationDialog.value = false
      pendingConnection.value = null
      toast.add({ severity: 'success', summary: '关系已保存', life: 2000 })
    } else if (isRelationConflict(res)) {
      await recoverExistingRelation()
    } else {
      toast.add({
        severity: 'error',
        summary: '关系保存失败',
        detail: res?.msg || '请稍后重试',
        life: 3000,
      })
    }
  } catch (e) {
    if (isRelationConflict(e)) {
      await recoverExistingRelation()
      return
    }

    toast.add({
      severity: 'error',
      summary: '网络错误',
      detail: e?.message || '请稍后重试',
      life: 3000,
    })
  } finally {
    relationSaving.value = false
  }
}

function onEdgeClick(event) {
  event?.event?.stopPropagation?.()
  selectedEdge.value = event?.edge || null
}

function clearSelectedEdge() {
  selectedEdge.value = null
}

function removeNodeFromCanvas(nodeId) {
  const node = flowNodes.value.find((item) => String(item.id) === String(nodeId))
  if (!node || removingNodeId.value) return

  const connectedEdges = flowEdges.value.filter(
    (edge) => String(edge.source) === String(node.id) || String(edge.target) === String(node.id),
  )
  const relationIds = connectedEdges.map((edge) => relationIdOfEdge(edge)).filter(Boolean)
  const message =
    relationIds.length > 0
      ? `确定要把「${node.data?.name || '该角色'}」移出画布吗？这会同时删除 ${relationIds.length} 条关联关系。`
      : `确定要把「${node.data?.name || '该角色'}」移出画布吗？`

  confirm.require({
    header: '移出画布',
    message,
    acceptLabel: '移出',
    rejectLabel: '取消',
    acceptClass: 'p-button-danger',
    accept: async () => {
      removingNodeId.value = String(node.id)
      try {
        // 节点没有独立删除接口；按后端布局契约，用 hidden + status=2 表示从关系图停用。
        const layoutRes = await saveCharacterRelationNodeLayouts(props.novelId, [
          {
            ...buildLayoutPayload(node),
            hidden: true,
            status: 2,
          },
        ])
        if (layoutRes?.code !== 0) {
          throw new Error(layoutRes?.msg || '节点移出失败')
        }

        const deleteResults = await Promise.all(
          relationIds.map((relationId) => deleteCharacterRelation(props.novelId, relationId)),
        )
        const failedResult = deleteResults.find((res) => res?.code !== 0)
        if (failedResult) {
          throw new Error(failedResult?.msg || '关联关系删除失败')
        }

        flowNodes.value = flowNodes.value.filter((item) => String(item.id) !== String(node.id))
        flowEdges.value = flowEdges.value.filter(
          (edge) =>
            String(edge.source) !== String(node.id) && String(edge.target) !== String(node.id),
        )
        selectedEdge.value = null
        toast.add({ severity: 'success', summary: '已移出画布', life: 2000 })
      } catch (e) {
        toast.add({
          severity: 'error',
          summary: '移出失败',
          detail: e?.message || '请稍后重试',
          life: 3000,
        })
        refreshGraph()
      } finally {
        removingNodeId.value = null
      }
    },
  })
}

function deleteSelectedEdge() {
  const relationId = selectedEdgeRelationId.value
  if (!selectedEdge.value || !relationId || deletingRelationId.value) return

  confirm.require({
    header: '删除关系',
    message: `确定要删除「${selectedEdge.value.label || '这条关系'}」吗？`,
    acceptLabel: '删除',
    rejectLabel: '取消',
    acceptClass: 'p-button-danger',
    accept: async () => {
      deletingRelationId.value = relationId
      try {
        const res = await deleteCharacterRelation(props.novelId, relationId)
        if (res?.code === 0) {
          flowEdges.value = flowEdges.value.filter((edge) => relationIdOfEdge(edge) !== relationId)
          selectedEdge.value = null
          toast.add({ severity: 'success', summary: '关系已删除', life: 2000 })
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
        deletingRelationId.value = null
      }
    },
  })
}

async function openCharacterDetail(character) {
  const id = characterIdOf(character)
  if (!id) {
    toast.add({
      severity: 'warn',
      summary: '无法打开详情',
      detail: '角色缺少 ID，无法查询完整资料。',
      life: 3000,
    })
    return
  }

  characterDetail.value = { ...character, id, characterId: id }
  showCharacterDialog.value = true
  detailLoading.value = true

  try {
    const res = await getCharacter(props.novelId, id)
    if (res?.code === 0 && res.data) {
      characterDetail.value = { ...res.data, id: characterIdOf(res.data) || id }
    } else {
      toast.add({
        severity: 'error',
        summary: '详情加载失败',
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
    detailLoading.value = false
  }
}

watch(
  () => props.novelId,
  () => {
    initialLoaded.value = false
    flowNodes.value = []
    flowEdges.value = []
    characters.value = []
    refreshGraph()
  },
)

onMounted(() => {
  refreshGraph()
  window.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <section class="relation-panel" aria-labelledby="relation-title">
    <header class="panel-head">
      <div>
        <p class="eyebrow">{{ novelTitle ? `《${novelTitle}》` : 'Character Graph' }}</p>
        <h2 id="relation-title">角色关系图</h2>
      </div>

      <div class="panel-actions" aria-label="关系图操作">
        <button class="tool-button" type="button" :disabled="graphLoading" @click="refreshGraph">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 12a8 8 0 1 1-2.34-5.66" />
            <path d="M20 4v6h-6" />
          </svg>
          刷新
        </button>
        <button class="tool-button" type="button" :disabled="!hasCanvasNodes" @click="fitCanvas">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"
            />
          </svg>
          适配画布
        </button>
      </div>
    </header>

    <div v-if="!initialLoaded" class="graph-state" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <span>正在载入角色关系图...</span>
    </div>

    <div v-else-if="graphError" class="graph-state error">
      <span>{{ graphError }}</span>
      <button class="tool-button" type="button" @click="refreshGraph">重试</button>
    </div>

    <div v-else class="graph-workspace">
      <aside class="character-library" aria-label="角色卡列表">
        <div class="library-head">
          <strong>角色卡</strong>
          <span>{{ characters.length }} 位角色</span>
        </div>

        <div v-if="characters.length === 0" class="library-empty">
          还没有角色卡，先在「角色卡」Tab 中添加角色。
        </div>

        <div v-else class="library-list" role="list">
          <article
            v-for="character in characters"
            :key="characterIdOf(character)"
            class="library-card"
            :class="{ placed: isCharacterPlaced(character) }"
            role="listitem"
            tabindex="0"
            :draggable="!isCharacterPlaced(character)"
            @click="openCharacterDetail(character)"
            @keydown.enter.prevent="openCharacterDetail(character)"
            @keydown.space.prevent="openCharacterDetail(character)"
            @dragstart="onLibraryDragStart($event, character)"
            @dragend="onLibraryDragEnd"
          >
            <div class="library-avatar">
              <img :src="characterAvatarSrc(character)" :alt="characterAvatarAlt(character)" />
            </div>
            <div class="library-copy">
              <strong>{{ character.name || '未命名角色' }}</strong>
              <span>{{ character.gender || '性别未设定' }}</span>
            </div>
            <span v-if="isCharacterPlaced(character)" class="placed-pill">已在画布</span>
          </article>
        </div>
      </aside>

      <section
        ref="canvasShellRef"
        class="canvas-shell"
        :class="{ fullscreen: canvasFullscreen }"
        aria-label="角色关系图画布"
      >
        <div class="canvas-tip">
          <span>拖动左侧角色到画布，再从节点右侧连接到另一节点左侧。</span>
          <button
            class="canvas-fullscreen-button"
            type="button"
            :aria-pressed="canvasFullscreen"
            @click="toggleCanvasFullscreen"
          >
            <svg v-if="!canvasFullscreen" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"
              />
            </svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M8 21v-3a2 2 0 0 0-2-2H3M16 21v-3a2 2 0 0 1 2-2h3"
              />
            </svg>
            {{ canvasFullscreen ? '退出全屏' : '全屏画布' }}
          </button>
        </div>

        <div class="flow-wrap" @dragover.prevent @drop="onCanvasDrop">
          <VueFlow
            :id="flowId"
            v-model:nodes="flowNodes"
            v-model:edges="flowEdges"
            class="relation-flow"
            :min-zoom="0.35"
            :max-zoom="1.5"
            :snap-to-grid="true"
            :snap-grid="[16, 16]"
            :fit-view-on-init="true"
            :auto-connect="false"
            :delete-key-code="null"
            :default-edge-options="{ type: 'default' }"
            @init="onFlowInit"
            @connect="onConnect"
            @node-click="onNodeClick"
            @node-drag-stop="onNodeDragStop"
            @edge-click="onEdgeClick"
            @pane-click="clearSelectedEdge"
          >
            <template #node-character="nodeProps">
              <CharacterRelationNode
                v-bind="nodeProps"
                :removing="removingNodeId === nodeProps.id"
                @remove="removeNodeFromCanvas"
              />
            </template>
          </VueFlow>

          <div v-if="flowNodes.length === 0" class="canvas-empty">
            <h3>把角色拖到这里</h3>
            <p>角色进入画布后会自动保存位置，随后就可以用连线记录人物关系。</p>
          </div>

          <div v-if="layoutSavingIds.size > 0" class="saving-badge" aria-live="polite">
            正在保存布局
          </div>

          <aside v-if="selectedEdge" class="edge-popover" aria-label="关系线操作">
            <span>已选择关系</span>
            <strong>{{ selectedEdge.label || '未命名关系' }}</strong>
            <button
              type="button"
              :disabled="deletingRelationId === selectedEdgeRelationId"
              @click="deleteSelectedEdge"
            >
              {{ deletingRelationId === selectedEdgeRelationId ? '删除中' : '删除关系' }}
            </button>
          </aside>
        </div>
      </section>
    </div>

    <Dialog
      v-model:visible="showRelationDialog"
      header="关系注释"
      :modal="true"
      :draggable="false"
      :closable="!relationSaving"
      :style="{ width: '480px', maxWidth: 'calc(100vw - 32px)' }"
      class="relation-dialog"
      @hide="closeRelationDialog"
    >
      <form class="relation-form" @submit.prevent="savePendingRelation">
        <label class="field">
          <span>关系名称 <em>*</em></span>
          <input
            v-model="relationForm.relationLabel"
            type="text"
            placeholder="例如：恋人、师徒、宿敌"
            autofocus
          />
        </label>

        <label class="field">
          <span>关系类型</span>
          <select v-model="relationForm.relationType">
            <option
              v-for="option in RELATION_TYPE_OPTIONS"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
      </form>

      <template #footer>
        <div class="dialog-actions">
          <button
            class="tool-button"
            type="button"
            :disabled="relationSaving"
            @click="closeRelationDialog"
          >
            取消
          </button>
          <button
            class="tool-button primary"
            type="button"
            :disabled="relationSaving"
            @click="savePendingRelation"
          >
            {{ relationSaving ? '保存中...' : '保存关系' }}
          </button>
        </div>
      </template>
    </Dialog>

    <Dialog
      v-model:visible="showCharacterDialog"
      :header="characterDetail?.name || '角色详情'"
      :modal="true"
      :draggable="false"
      :style="{ width: '780px', maxWidth: 'calc(100vw - 32px)' }"
      class="relation-character-dialog"
    >
      <section v-if="characterDetail" class="character-detail" aria-live="polite">
        <div v-if="detailLoading" class="detail-loading">
          <span class="spinner" aria-hidden="true"></span>
          <span>正在读取角色详情...</span>
        </div>

        <div class="detail-hero">
          <div class="detail-avatar">
            <img
              :src="characterAvatarSrc(characterDetail)"
              :alt="characterAvatarAlt(characterDetail)"
            />
          </div>
          <div class="detail-copy">
            <p class="profile-kicker">Character File</p>
            <h3>{{ characterDetail.name || '未命名角色' }}</h3>
            <div class="detail-meta">
              <span>{{ characterDetail.gender || '性别未设定' }}</span>
              <span>{{ statusLabel(characterDetail.status) }}</span>
              <span>
                {{
                  characterDetail.firstAppearanceChapterId
                    ? `首次出现：第 ${characterDetail.firstAppearanceChapterId} 章`
                    : '首次出现未记录'
                }}
              </span>
            </div>
            <div class="detail-tags">
              <span v-for="tag in tagListOf(characterDetail)" :key="tag">{{ tag }}</span>
              <span v-if="tagListOf(characterDetail).length === 0" class="muted-tag">暂无标签</span>
            </div>
          </div>
        </div>

        <div class="detail-section-grid">
          <section
            v-for="field in detailFields(characterDetail)"
            :key="field.label"
            class="detail-section"
          >
            <span>{{ field.label }}</span>
            <p>{{ textOrFallback(field.value) }}</p>
          </section>
        </div>
      </section>
    </Dialog>
  </section>
</template>

<style scoped>
.relation-panel {
  width: 100%;
  border: 1px solid oklch(88% 0.012 255);
  border-radius: 16px;
  background: oklch(99.2% 0.004 255);
  box-shadow:
    0 18px 44px oklch(45% 0.04 260 / 0.1),
    0 1px 2px oklch(45% 0.04 260 / 0.08);
  color: oklch(26% 0.035 260);
}

.panel-head {
  min-height: 112px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 28px 34px 22px;
  border-bottom: 1px solid oklch(91% 0.01 255);
}

.eyebrow {
  margin: 0 0 8px;
  color: oklch(52% 0.04 260);
  font-size: 0.8rem;
  font-weight: 760;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.panel-head h2 {
  margin: 0;
  color: oklch(24% 0.04 260);
  font-size: 1.75rem;
  line-height: 1.15;
  font-weight: 800;
  letter-spacing: 0;
}

.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.tool-button {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 0 15px;
  border: 1px solid oklch(82% 0.024 255);
  border-radius: 9px;
  background: oklch(99.4% 0.003 255);
  color: oklch(38% 0.04 260);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 760;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.tool-button svg {
  width: 1.08rem;
  height: 1.08rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tool-button:hover {
  border-color: oklch(70% 0.08 255);
  background: oklch(95% 0.02 255);
  color: oklch(48% 0.16 255);
  transform: translateY(-1px);
}

/* 关系弹窗也避开 PrimeVue Button，所有操作按钮统一走原生按钮样式。 */
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

.tool-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
}

.tool-button:focus-visible,
.library-card:focus-visible,
.edge-popover button:focus-visible,
.field input:focus-visible,
.field select:focus-visible {
  outline: 3px solid oklch(76% 0.14 250 / 0.55);
  outline-offset: 3px;
}

.graph-state {
  min-height: 420px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 42px 24px;
  color: oklch(52% 0.03 260);
  text-align: center;
}

.graph-state.error {
  color: oklch(55% 0.2 25);
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

.graph-workspace {
  display: grid;
  grid-template-columns: 318px minmax(0, 1fr);
  min-height: 680px;
}

.character-library {
  min-width: 0;
  border-right: 1px solid oklch(91% 0.01 255);
  background: oklch(98.2% 0.006 255);
}

.library-head {
  min-height: 68px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 20px;
  border-bottom: 1px solid oklch(91% 0.01 255);
}

.library-head strong {
  color: oklch(28% 0.04 260);
  font-size: 1rem;
  font-weight: 800;
}

.library-head span {
  color: oklch(52% 0.032 260);
  font-size: 0.82rem;
  font-weight: 720;
}

.library-empty {
  padding: 34px 24px;
  color: oklch(50% 0.032 260);
  line-height: 1.7;
  text-align: center;
}

.library-list {
  max-height: 612px;
  overflow: auto;
  display: grid;
  gap: 12px;
  padding: 16px;
  scrollbar-width: none;
}

.library-list::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.library-card {
  position: relative;
  min-height: 104px;
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  gap: 13px;
  align-items: center;
  padding: 14px;
  border: 1px solid oklch(88% 0.012 255);
  border-radius: 12px;
  background: oklch(99.2% 0.004 255);
  cursor: grab;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.library-card:hover {
  border-color: oklch(68% 0.11 255);
  background: oklch(96% 0.024 255);
  box-shadow: 0 12px 24px oklch(42% 0.05 260 / 0.1);
  transform: translateY(-1px);
}

.library-card.placed {
  cursor: pointer;
  background: oklch(96.5% 0.008 255);
  color: oklch(48% 0.032 260);
}

.library-avatar {
  width: 54px;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: 9px;
  background: oklch(93% 0.012 255);
  box-shadow: inset 0 0 0 1px oklch(100% 0 0 / 0.7);
}

.library-avatar img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.library-copy {
  min-width: 0;
  display: grid;
  gap: 6px;
  padding-right: 4px;
}

.library-copy strong {
  color: oklch(25% 0.04 260);
  font-size: 0.98rem;
  line-height: 1.25;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.library-copy span {
  color: oklch(48% 0.032 260);
  font-size: 0.82rem;
  font-weight: 720;
}

.placed-pill {
  position: absolute;
  top: 9px;
  right: 10px;
  min-height: 22px;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border-radius: 999px;
  background: oklch(93% 0.026 150);
  color: oklch(42% 0.13 150);
  font-size: 0.7rem;
  font-weight: 760;
}

.canvas-shell {
  min-width: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: oklch(99.2% 0.004 255);
}

.canvas-shell.fullscreen {
  position: fixed;
  inset: 0;
  z-index: 1000;
  width: 100vw;
  height: 100vh;
  border-radius: 0;
  box-shadow: none;
}

.canvas-tip {
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 22px;
  border-bottom: 1px solid oklch(91% 0.01 255);
  color: oklch(48% 0.032 260);
  font-size: 0.88rem;
  font-weight: 680;
}

.canvas-fullscreen-button {
  flex: 0 0 auto;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid oklch(82% 0.024 255);
  border-radius: 9px;
  background: oklch(99.4% 0.003 255);
  color: oklch(42% 0.04 260);
  font: inherit;
  font-size: 0.84rem;
  font-weight: 760;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.canvas-fullscreen-button svg {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.canvas-fullscreen-button:hover,
.canvas-fullscreen-button[aria-pressed='true'] {
  border-color: oklch(62% 0.14 255);
  background: oklch(94% 0.028 255);
  color: oklch(48% 0.17 258);
  transform: translateY(-1px);
}

.canvas-fullscreen-button:focus-visible {
  outline: 3px solid oklch(76% 0.14 250 / 0.55);
  outline-offset: 3px;
}

.flow-wrap {
  position: relative;
  min-height: 628px;
  overflow: hidden;
  background-color: oklch(99.4% 0.003 255);
  background-image:
    linear-gradient(oklch(89% 0.012 255) 1px, transparent 1px),
    linear-gradient(90deg, oklch(89% 0.012 255) 1px, transparent 1px);
  background-size: 24px 24px;
}

.relation-flow {
  width: 100%;
  height: 100%;
  min-height: 628px;
  background: transparent;
}

.canvas-shell.fullscreen .flow-wrap {
  height: calc(100vh - 52px);
  min-height: 0;
}

.canvas-shell.fullscreen .relation-flow {
  height: 100%;
  min-height: 0;
}

.canvas-empty {
  position: absolute;
  inset: 50%;
  width: min(360px, calc(100% - 40px));
  transform: translate(-50%, -50%);
  padding: 24px 26px;
  border: 1px dashed oklch(78% 0.04 255);
  border-radius: 14px;
  background: oklch(99% 0.004 255 / 0.92);
  color: oklch(48% 0.032 260);
  text-align: center;
  pointer-events: none;
}

.canvas-empty h3 {
  margin: 0;
  color: oklch(28% 0.04 260);
  font-size: 1.12rem;
  font-weight: 800;
}

.canvas-empty p {
  margin: 10px 0 0;
  line-height: 1.7;
}

.saving-badge {
  position: absolute;
  top: 16px;
  right: 16px;
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  padding: 0 12px;
  border: 1px solid oklch(84% 0.018 255);
  border-radius: 999px;
  background: oklch(99% 0.004 255 / 0.94);
  color: oklch(48% 0.16 255);
  font-size: 0.8rem;
  font-weight: 760;
  box-shadow: 0 10px 20px oklch(42% 0.04 260 / 0.12);
}

.edge-popover {
  position: absolute;
  right: 16px;
  bottom: 16px;
  width: min(260px, calc(100% - 32px));
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid oklch(86% 0.014 255);
  border-radius: 12px;
  background: oklch(99% 0.004 255);
  box-shadow: 0 18px 40px oklch(34% 0.045 260 / 0.18);
}

.edge-popover span {
  color: oklch(52% 0.032 260);
  font-size: 0.78rem;
  font-weight: 760;
}

.edge-popover strong {
  color: oklch(25% 0.04 260);
  font-size: 1rem;
  line-height: 1.35;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.edge-popover button {
  min-height: 38px;
  border: 1px solid oklch(84% 0.065 24);
  border-radius: 9px;
  background: oklch(97% 0.018 24);
  color: oklch(55% 0.22 25);
  font: inherit;
  font-size: 0.86rem;
  font-weight: 760;
  cursor: pointer;
}

.edge-popover button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.relation-form {
  display: grid;
  gap: 16px;
}

.field {
  display: grid;
  gap: 8px;
}

.field > span {
  color: oklch(34% 0.035 260);
  font-size: 0.875rem;
  font-weight: 760;
}

.field em {
  color: oklch(55% 0.22 25);
  font-style: normal;
}

.field input,
.field select {
  min-height: 44px;
  width: 100%;
  padding: 0 12px;
  border: 1px solid oklch(84% 0.018 255);
  border-radius: 9px;
  outline: 0;
  background: oklch(99% 0.004 255);
  color: oklch(26% 0.035 260);
  font: inherit;
  font-weight: 700;
}

.field input:hover,
.field select:hover {
  border-color: oklch(72% 0.08 255);
}

.character-detail {
  display: grid;
  gap: 16px;
}

.detail-loading {
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border: 1px solid oklch(88% 0.012 255);
  border-radius: 10px;
  background: oklch(97% 0.01 255);
  color: oklch(48% 0.035 260);
  font-size: 0.9rem;
}

.detail-hero {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 22px;
  padding: 18px;
  border: 1px solid oklch(88% 0.012 255);
  border-radius: 14px;
  background:
    radial-gradient(circle at 16% 10%, oklch(96% 0.026 255) 0, transparent 20rem),
    oklch(98.5% 0.006 255);
}

.detail-avatar {
  width: 150px;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: 12px;
  background: oklch(93% 0.012 255);
  box-shadow:
    0 14px 28px oklch(38% 0.055 260 / 0.16),
    inset 0 0 0 1px oklch(100% 0 0 / 0.7);
}

.detail-avatar img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.detail-copy {
  min-width: 0;
}

.profile-kicker {
  margin: 0 0 6px;
  color: oklch(55% 0.04 260);
  font-size: 0.76rem;
  font-weight: 780;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.detail-copy h3 {
  margin: 0;
  color: oklch(23% 0.04 260);
  font-size: 1.75rem;
  line-height: 1.18;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.detail-meta,
.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.detail-meta {
  margin-top: 14px;
}

.detail-tags {
  margin-top: 16px;
}

.detail-meta span,
.detail-tags span {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border-radius: 999px;
  background: oklch(94.5% 0.01 255);
  color: oklch(43% 0.032 260);
  font-size: 0.82rem;
  font-weight: 720;
}

.detail-tags span {
  border-radius: 8px;
  background: oklch(94% 0.018 255);
  color: oklch(48% 0.15 254);
}

.detail-tags .muted-tag {
  background: oklch(94% 0.008 255);
  color: oklch(54% 0.026 260);
}

.detail-section-grid {
  max-height: min(52vh, 520px);
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding-right: 2px;
  scrollbar-width: none;
}

.detail-section-grid::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.detail-section {
  display: grid;
  gap: 7px;
  padding: 16px;
  border: 1px solid oklch(89% 0.01 255);
  border-radius: 12px;
  background: oklch(99% 0.004 255);
}

.detail-section span {
  color: oklch(48% 0.16 255);
  font-size: 0.8rem;
  font-weight: 800;
}

.detail-section p {
  margin: 0;
  color: oklch(33% 0.032 260);
  font-size: 0.95rem;
  line-height: 1.75;
  white-space: pre-wrap;
}

:deep(.vue-flow__edge.selected .vue-flow__edge-path),
:deep(.vue-flow__edge:hover .vue-flow__edge-path) {
  stroke: oklch(52% 0.18 258);
  stroke-width: 3;
}

:deep(.vue-flow__connection-path) {
  stroke: oklch(52% 0.18 258);
  stroke-width: 2;
}

:global(.p-dialog-mask:has(.relation-dialog)),
:global(.p-dialog-mask:has(.relation-character-dialog)) {
  background: oklch(20% 0.035 260 / 0.28);
  backdrop-filter: blur(3px);
}

:global(.relation-dialog.p-dialog),
:global(.relation-character-dialog.p-dialog) {
  overflow: hidden;
  border: 1px solid oklch(87% 0.014 255);
  border-radius: 16px;
  background: oklch(99.2% 0.004 255);
  color: oklch(26% 0.035 260);
  box-shadow:
    0 24px 70px oklch(34% 0.045 260 / 0.22),
    0 1px 2px oklch(34% 0.045 260 / 0.1);
}

:global(.relation-dialog .p-dialog-header),
:global(.relation-dialog .p-dialog-content),
:global(.relation-dialog .p-dialog-footer),
:global(.relation-character-dialog .p-dialog-header),
:global(.relation-character-dialog .p-dialog-content),
:global(.relation-character-dialog .p-dialog-footer) {
  background: oklch(99.2% 0.004 255);
  color: oklch(24% 0.035 260);
}

:global(.relation-dialog .p-dialog-header),
:global(.relation-character-dialog .p-dialog-header) {
  padding: 22px 24px 16px;
  border-bottom: 1px solid oklch(91% 0.01 255);
}

:global(.relation-dialog .p-dialog-title),
:global(.relation-character-dialog .p-dialog-title) {
  font-size: 1.125rem;
  font-weight: 760;
}

:global(.relation-dialog .p-dialog-content),
:global(.relation-character-dialog .p-dialog-content) {
  padding: 22px 24px 8px;
}

:global(.relation-dialog .p-dialog-footer),
:global(.relation-character-dialog .p-dialog-footer) {
  gap: 10px;
  padding: 16px 24px 22px;
  border-top: 1px solid oklch(91% 0.01 255);
}

:global(.relation-dialog .p-dialog-header-icon),
:global(.relation-character-dialog .p-dialog-header-icon) {
  color: oklch(42% 0.035 260);
}

:global(.relation-dialog .p-dialog-header-icon:hover),
:global(.relation-character-dialog .p-dialog-header-icon:hover) {
  background: oklch(94% 0.014 255);
  color: oklch(48% 0.18 258);
}

:global(.relation-dialog .p-button),
:global(.relation-character-dialog .p-button) {
  border-radius: 9px;
}

:global(.relation-dialog .p-button-text),
:global(.relation-character-dialog .p-button-text) {
  color: oklch(42% 0.04 260);
}

:global(.relation-dialog .p-button-text:hover),
:global(.relation-character-dialog .p-button-text:hover) {
  background: oklch(94% 0.014 255);
  color: oklch(48% 0.18 258);
}

@media (max-width: 980px) {
  .panel-head {
    align-items: stretch;
    flex-direction: column;
    padding: 24px 20px 18px;
  }

  .panel-actions,
  .tool-button {
    width: 100%;
  }

  .graph-workspace {
    grid-template-columns: 1fr;
  }

  .character-library {
    border-right: 0;
    border-bottom: 1px solid oklch(91% 0.01 255);
  }

  .library-list {
    max-height: 300px;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }

  .detail-hero,
  .detail-section-grid {
    grid-template-columns: 1fr;
  }

  .detail-avatar {
    width: min(100%, 180px);
    justify-self: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 0.01ms;
    animation-iteration-count: 1;
  }

  .tool-button,
  .library-card,
  .canvas-fullscreen-button {
    transition-duration: 0.01ms;
  }

  .tool-button:hover,
  .library-card:hover,
  .canvas-fullscreen-button:hover {
    transform: none;
  }
}
</style>
