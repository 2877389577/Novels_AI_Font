<!--
  ImageAIProviderView.vue：生图 AI 提供商设置页
  ----------------------------------------------------------------------------
  设计目标：
  1. 管理图片生成专用 AI 提供商，和文本 AI 提供商分离。
  2. API Key 只在详情接口返回，页面默认遮罩，用户主动点击后才展示。
  3. 新增 / 修改仍使用弹窗承载，保持和普通 AI 提供商页一致的设置体验。
-->

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import Dialog from 'primevue/dialog'
import {
  createImageAIProvider,
  deleteImageAIProvider,
  enableImageAIProvider,
  getImageAIProvider,
  listImageAIProviders,
  updateImageAIProvider,
} from '@/api/imageAIProvider'
import { queryAIProviderModels } from '@/api/aiProvider'
import { formatDateTime } from '@/utils/datetime'

const router = useRouter()
const confirm = useConfirm()
const toast = useToast()

const pageSize = 10
const providers = ref([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const initialLoaded = ref(false)
const loadError = ref('')

const mode = ref('create')
const activeProviderId = ref(null)
const showEditor = ref(false)
const showFormApiKey = ref(false)
const detailLoading = ref(false)
const saving = ref(false)
const deletingId = ref(null)
const enablingId = ref(null)
const modelInput = ref('')
const modelCandidates = ref([])
const modelQuerying = ref(false)

// API Key 明文只在详情接口中返回，列表页统一走缓存和显隐集合控制。
const apiKeyCache = reactive({})
const visibleKeyIds = ref(new Set())
const keyLoadingId = ref(null)

const form = reactive({
  name: '',
  providerType: '',
  baseUrl: '',
  apiKey: '',
  defaultModel: '',
  models: [],
  isEnabled: false,
  configJson: '',
})

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const isEdit = computed(() => mode.value === 'edit')
const formTitle = computed(() => (isEdit.value ? '修改生图 AI' : '新增生图 AI'))
const defaultModelOptions = computed(() => normalizeModelList(form.models))
const submitLabel = computed(() => {
  if (saving.value) return isEdit.value ? '保存中' : '创建中'
  return isEdit.value ? '保存修改' : '创建提供商'
})
const canSubmit = computed(() => {
  if (saving.value || detailLoading.value) return false
  if (!form.name.trim() || !form.providerType.trim() || !form.baseUrl.trim()) return false
  return Boolean(form.apiKey.trim() && defaultModelOptions.value.includes(form.defaultModel))
})

// 页码最多展示 5 个，避免分页控件在窄屏下挤压。
const pageNumbers = computed(() => {
  const maxButtons = 5
  const pages = totalPages.value
  if (pages <= maxButtons) return Array.from({ length: pages }, (_, i) => i + 1)

  let start = Math.max(1, page.value - 2)
  let end = Math.min(pages, start + maxButtons - 1)
  start = Math.max(1, end - maxButtons + 1)
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
})

function normalizeModelList(value) {
  // 后端契约是 string[]；这里兼容逗号分隔字符串，便于用户从厂商文档中粘贴。
  const sourceItems = Array.isArray(value) ? value : [value]
  const rawItems = sourceItems.flatMap((item) => String(item || '').split(/[,，]/))
  const seen = new Set()
  const result = []

  rawItems.forEach((item) => {
    const model = String(item || '').trim()
    if (!model || seen.has(model)) return
    seen.add(model)
    result.push(model)
  })

  return result
}

function addModels(value) {
  form.models = normalizeModelList([...form.models, ...normalizeModelList(value)])
}

function commitModelInput() {
  if (!modelInput.value.trim()) return
  addModels(modelInput.value)
  modelInput.value = ''
}

function onModelInput(event) {
  if (/[,，]/.test(event.target.value)) commitModelInput()
}

function onModelKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ',' && event.key !== '，') return
  event.preventDefault()
  commitModelInput()
}

function removeModel(model) {
  form.models = form.models.filter((item) => item !== model)
  if (form.defaultModel === model) {
    // 默认生图模型必须来自当前模型列表，移除对应模型时同步清空旧选择。
    form.defaultModel = ''
  }
}

function pickCandidateModel(model) {
  addModels([model])
}

function isCandidateSelected(model) {
  return form.models.includes(model)
}

function providerModels(provider) {
  return normalizeModelList(provider?.models)
}

function visibleProviderModels(provider) {
  return providerModels(provider).slice(0, 3)
}

function hiddenProviderModelCount(provider) {
  return Math.max(0, providerModels(provider).length - 3)
}

function resetForm() {
  mode.value = 'create'
  activeProviderId.value = null
  showFormApiKey.value = false
  modelInput.value = ''
  modelCandidates.value = []
  form.name = ''
  form.providerType = ''
  form.baseUrl = ''
  form.apiKey = ''
  form.defaultModel = ''
  form.models = []
  form.isEnabled = false
  form.configJson = ''
}

function openCreate() {
  resetForm()
  showEditor.value = true
}

function closeEditor() {
  if (saving.value) return
  showEditor.value = false
}

function onEditorHide() {
  if (saving.value) return
  detailLoading.value = false
  resetForm()
}

function syncForm(provider = {}) {
  mode.value = 'edit'
  activeProviderId.value = provider.id
  form.name = provider.name || ''
  form.providerType = provider.providerType || ''
  form.baseUrl = provider.baseUrl || ''
  form.apiKey = provider.apiKey || ''
  showFormApiKey.value = Boolean(form.apiKey)
  form.models = normalizeModelList(provider.models)
  // 默认生图模型必须从模型列表中选择；历史数据不一致时要求用户重新选择。
  form.defaultModel = form.models.includes(provider.defaultModel) ? provider.defaultModel : ''
  form.isEnabled = provider.isEnabled !== false
  form.configJson = provider.configJson ? JSON.stringify(provider.configJson, null, 2) : ''
}

function toggleFormApiKey() {
  showFormApiKey.value = !showFormApiKey.value
}

async function queryModels() {
  if (modelQuerying.value || detailLoading.value) return
  commitModelInput()

  const baseUrl = form.baseUrl.trim()
  const cachedApiKey = activeProviderId.value ? apiKeyCache[activeProviderId.value] || '' : ''
  const apiKey = form.apiKey.trim() || cachedApiKey

  if (!baseUrl) {
    toast.add({ severity: 'warn', summary: '请先填写 Base URL', life: 2400 })
    return
  }
  if (!apiKey) {
    toast.add({ severity: 'warn', summary: '请先填写 API Key', life: 2400 })
    return
  }

  modelQuerying.value = true
  try {
    // 生图 AI 与普通 AI 共用模型查询接口；该请求只探测上游模型，不写入数据库。
    const res = await queryAIProviderModels({ baseUrl, apiKey })
    if (res?.code === 0) {
      modelCandidates.value = normalizeModelList(res.data?.models)
      toast.add({
        severity: modelCandidates.value.length > 0 ? 'success' : 'info',
        summary: modelCandidates.value.length > 0 ? '模型已读取' : '未查询到模型',
        life: 2200,
      })
    } else {
      toast.add({
        severity: 'error',
        summary: '模型查询失败',
        detail: res?.msg || '请检查 Base URL 和 API Key',
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
    modelQuerying.value = false
  }
}

function providerIdOf(provider) {
  return provider?.id
}

function displayUpdatedAt(provider) {
  return formatDateTime(provider.updatedAt || provider.createdAt)
}

function maskApiKey(value = '') {
  if (!value) return '••••••••••••'
  return '•'.repeat(Math.min(Math.max(value.length, 12), 24))
}

function isKeyVisible(provider) {
  return visibleKeyIds.value.has(providerIdOf(provider))
}

function keyText(provider) {
  const id = providerIdOf(provider)
  const value = apiKeyCache[id] || provider?.apiKey || ''
  return isKeyVisible(provider) ? value || '未返回密钥' : maskApiKey(value)
}

function setKeyVisible(id, visible) {
  const next = new Set(visibleKeyIds.value)
  if (visible) next.add(id)
  else next.delete(id)
  visibleKeyIds.value = next
}

async function fetchProviders(targetPage = page.value) {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    const res = await listImageAIProviders({ page: targetPage, pageSize })
    if (res?.code === 0) {
      providers.value = res.data?.items || []
      total.value = res.data?.total || 0
      page.value = res.data?.page || targetPage

      // 如果后端未来列表也返回 apiKey，仍统一写入缓存，显隐逻辑不分叉。
      providers.value.forEach((provider) => {
        if (provider?.id && provider.apiKey) apiKeyCache[provider.id] = provider.apiKey
      })
    } else {
      loadError.value = res?.msg || '生图 AI 提供商加载失败'
      toast.add({
        severity: 'error',
        summary: '加载失败',
        detail: res?.msg || '请稍后重试',
        life: 3000,
      })
    }
  } catch (e) {
    loadError.value = e?.message || '生图 AI 提供商加载失败'
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

onMounted(() => fetchProviders(1))

async function toggleApiKey(provider) {
  const id = providerIdOf(provider)
  if (!id || keyLoadingId.value) return
  if (isKeyVisible(provider)) {
    setKeyVisible(id, false)
    return
  }

  if (!apiKeyCache[id] && !provider.apiKey) {
    keyLoadingId.value = id
    try {
      const res = await getImageAIProvider(id)
      if (res?.code === 0 && res.data) {
        apiKeyCache[id] = res.data.apiKey || ''
      } else {
        toast.add({
          severity: 'error',
          summary: '密钥读取失败',
          detail: res?.msg || '请稍后重试',
          life: 3000,
        })
        return
      }
    } catch (e) {
      toast.add({
        severity: 'error',
        summary: '网络错误',
        detail: e?.message || '请稍后重试',
        life: 3000,
      })
      return
    } finally {
      keyLoadingId.value = null
    }
  }

  setKeyVisible(id, true)
}

async function openEdit(provider) {
  const id = providerIdOf(provider)
  if (!id || detailLoading.value) return
  detailLoading.value = true
  syncForm(provider)
  showEditor.value = true
  try {
    const res = await getImageAIProvider(id)
    if (res?.code === 0 && res.data) {
      apiKeyCache[id] = res.data.apiKey || ''
      syncForm(res.data)
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

function parseConfigJson() {
  const text = form.configJson.trim()
  if (!text) return { ok: true, value: undefined }
  try {
    const parsed = JSON.parse(text)
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return { ok: false, message: '额外配置必须是 JSON 对象' }
    }
    return { ok: true, value: parsed }
  } catch {
    return { ok: false, message: '额外配置不是合法 JSON' }
  }
}

function buildPayload() {
  const parsedConfig = parseConfigJson()
  if (!parsedConfig.ok) return parsedConfig
  const models = defaultModelOptions.value
  const defaultModel = form.defaultModel.trim()

  if (models.length === 0) {
    return { ok: false, message: '请先添加模型列表，再选择默认生图模型' }
  }
  if (!defaultModel) {
    return { ok: false, message: '请选择默认生图模型' }
  }
  if (!models.includes(defaultModel)) {
    return { ok: false, message: '默认生图模型必须从模型列表中选择' }
  }

  const payload = {
    name: form.name.trim(),
    providerType: form.providerType.trim(),
    baseUrl: form.baseUrl.trim(),
    apiKey: form.apiKey.trim(),
    // 图片生成接口未传 modelName 时，后端会使用该默认生图模型。
    defaultModel,
    models: [...models],
    isEnabled: form.isEnabled,
  }

  if (parsedConfig.value !== undefined) {
    payload.configJson = parsedConfig.value
  } else if (isEdit.value) {
    // 修改态清空配置时明确传空对象，让用户能删除旧配置。
    payload.configJson = {}
  }

  return { ok: true, value: payload }
}

async function onSubmit() {
  if (!canSubmit.value) return
  const payloadResult = buildPayload()
  if (!payloadResult.ok) {
    toast.add({ severity: 'warn', summary: payloadResult.message, life: 2600 })
    return
  }

  saving.value = true
  const wasEdit = isEdit.value
  try {
    const res = wasEdit
      ? await updateImageAIProvider(activeProviderId.value, payloadResult.value)
      : await createImageAIProvider(payloadResult.value)
    if (res?.code === 0) {
      toast.add({
        severity: 'success',
        summary: wasEdit ? '已保存' : '已创建',
        detail: payloadResult.value.name,
        life: 2200,
      })
      resetForm()
      showEditor.value = false
      await fetchProviders(wasEdit ? page.value : 1)
    } else {
      toast.add({
        severity: 'error',
        summary: wasEdit ? '保存失败' : '创建失败',
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
    saving.value = false
  }
}

async function onEnable(provider) {
  const id = providerIdOf(provider)
  if (!id || enablingId.value || provider?.isEnabled !== false) return

  enablingId.value = id
  try {
    const res = await enableImageAIProvider(id)
    if (res?.code === 0) {
      toast.add({
        severity: 'success',
        summary: '已启用',
        detail: provider.name || '生图 AI 提供商',
        life: 2200,
      })
      // 后端会同时关闭其它已启用生图提供商，成功后以服务端列表为准。
      await fetchProviders(page.value)
    } else {
      toast.add({
        severity: 'error',
        summary: '启用失败',
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
    enablingId.value = null
  }
}

function onDelete(provider) {
  const id = providerIdOf(provider)
  if (!id || deletingId.value) return
  confirm.require({
    header: '确认删除',
    message: `确定要删除生图 AI 提供商「${provider.name || '未命名'}」吗？`,
    acceptLabel: '删除',
    rejectLabel: '取消',
    acceptClass: 'p-button-danger',
    accept: async () => {
      deletingId.value = id
      try {
        const res = await deleteImageAIProvider(id)
        if (res?.code === 0) {
          toast.add({ severity: 'success', summary: '已删除', life: 2000 })
          if (activeProviderId.value === id) {
            showEditor.value = false
            resetForm()
          }
          await fetchProviders(page.value)
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
        deletingId.value = null
      }
    },
  })
}

function changePage(targetPage) {
  if (
    loading.value ||
    targetPage < 1 ||
    targetPage > totalPages.value ||
    targetPage === page.value
  ) {
    return
  }
  fetchProviders(targetPage)
}

function goBack() {
  router.push({ name: 'shelf' })
}
</script>

<template>
  <main class="image-provider-page">
    <header class="page-header">
      <div>
        <button class="back-button" type="button" @click="goBack">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 18 9 12l6-6" />
          </svg>
          返回书架
        </button>
        <h1>生图AI设置</h1>
        <p>管理图片生成专用 AI 提供商，供角色形象、封面和插图生成使用。</p>
      </div>

      <button class="new-button" type="button" @click="openCreate">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        新增提供商
      </button>
    </header>

    <section class="workspace">
      <section class="provider-list" aria-labelledby="image-provider-list-title">
        <div class="list-head">
          <div>
            <h2 id="image-provider-list-title">生图提供商列表</h2>
            <span v-if="initialLoaded">{{ total }} 个提供商</span>
          </div>
          <button
            class="refresh-button"
            type="button"
            :disabled="loading"
            @click="fetchProviders(page)"
          >
            刷新
          </button>
        </div>

        <div v-if="loading && !initialLoaded" class="table-skeleton" aria-hidden="true">
          <span v-for="item in 5" :key="item"></span>
        </div>

        <div v-else-if="loadError" class="state-panel">
          <h3>加载失败</h3>
          <p>{{ loadError }}</p>
          <button class="state-button" type="button" @click="fetchProviders(page)">重试</button>
        </div>

        <div v-else-if="initialLoaded && providers.length === 0" class="state-panel">
          <h3>还没有生图 AI 提供商</h3>
          <p>添加一个 OpenAI 兼容的图片生成提供商后，就可以为后续生图能力配置默认模型。</p>
          <button class="state-button" type="button" @click="openCreate">新增提供商</button>
        </div>

        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>Base URL</th>
                <th>模型</th>
                <th>API Key</th>
                <th>状态</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="provider in providers"
                :key="provider.id"
                :class="{ active: activeProviderId === provider.id }"
              >
                <td data-label="名称">
                  <strong>{{ provider.name || '未命名' }}</strong>
                </td>
                <td data-label="类型">{{ provider.providerType || '未设置' }}</td>
                <td data-label="Base URL">
                  <span class="url-text">{{ provider.baseUrl || '未设置' }}</span>
                </td>
                <td data-label="模型">
                  <div v-if="providerModels(provider).length > 0" class="model-list-cell">
                    <span
                      v-for="model in visibleProviderModels(provider)"
                      :key="model"
                      class="model-pill"
                      :class="{ default: model === provider.defaultModel }"
                    >
                      {{ model === provider.defaultModel ? `${model} 默认` : model }}
                    </span>
                    <span v-if="hiddenProviderModelCount(provider) > 0" class="model-pill more">
                      +{{ hiddenProviderModelCount(provider) }}
                    </span>
                  </div>
                  <span v-else class="muted-text">未设置</span>
                </td>
                <td data-label="API Key">
                  <div class="key-cell">
                    <code :class="{ masked: !isKeyVisible(provider) }">{{
                      keyText(provider)
                    }}</code>
                    <button class="icon-action" type="button" @click="toggleApiKey(provider)">
                      {{
                        keyLoadingId === providerIdOf(provider)
                          ? '读取中'
                          : isKeyVisible(provider)
                            ? '隐藏'
                            : '显示'
                      }}
                    </button>
                  </div>
                </td>
                <td data-label="状态">
                  <span class="status-pill" :data-enabled="provider.isEnabled !== false">
                    {{ provider.isEnabled === false ? '停用' : '启用' }}
                  </span>
                </td>
                <td data-label="更新时间">{{ displayUpdatedAt(provider) }}</td>
                <td data-label="操作">
                  <div class="row-actions">
                    <button
                      type="button"
                      :disabled="provider.isEnabled !== false || Boolean(enablingId)"
                      @click="onEnable(provider)"
                    >
                      {{ enablingId === providerIdOf(provider) ? '启用中' : '启用' }}
                    </button>
                    <button type="button" @click="openEdit(provider)">编辑</button>
                    <button
                      class="danger"
                      type="button"
                      :disabled="deletingId === providerIdOf(provider)"
                      @click="onDelete(provider)"
                    >
                      {{ deletingId === providerIdOf(provider) ? '删除中' : '删除' }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <nav v-if="initialLoaded && total > 0" class="pager" aria-label="生图 AI 提供商分页">
          <button type="button" :disabled="loading || page <= 1" @click="changePage(page - 1)">
            上一页
          </button>
          <button
            v-for="pageNo in pageNumbers"
            :key="pageNo"
            type="button"
            :class="{ current: pageNo === page }"
            :disabled="loading || pageNo === page"
            @click="changePage(pageNo)"
          >
            {{ pageNo }}
          </button>
          <button
            type="button"
            :disabled="loading || page >= totalPages"
            @click="changePage(page + 1)"
          >
            下一页
          </button>
        </nav>
      </section>
    </section>

    <!-- PrimeVue Dialog 内置关闭按钮会渲染 PrimeVue Button，这里统一使用原生按钮规避运行时 slot 异常。 -->
    <Dialog
      v-model:visible="showEditor"
      :header="formTitle"
      :modal="true"
      :draggable="false"
      :closable="false"
      :style="{ width: '680px', maxWidth: 'calc(100vw - 32px)' }"
      class="image-provider-dialog"
      @hide="onEditorHide"
    >
      <div class="editor-head">
        <p>{{ isEdit ? '详情读取后会回填 API Key' : '创建时需要填写 API Key' }}</p>
        <div class="editor-head-actions">
          <span v-if="detailLoading">读取详情中</span>
          <button
            class="dialog-close-button"
            type="button"
            :disabled="saving"
            aria-label="关闭弹窗"
            @click="closeEditor"
          >
            ×
          </button>
        </div>
      </div>

      <form class="provider-form" @submit.prevent="onSubmit">
        <label class="line-field">
          <span>名称 <em>*</em></span>
          <input
            v-model="form.name"
            type="text"
            autocomplete="off"
            placeholder="例如 OpenAI Images"
          />
        </label>

        <label class="line-field">
          <span>类型 <em>*</em></span>
          <input
            v-model="form.providerType"
            type="text"
            autocomplete="off"
            placeholder="例如 openai"
          />
        </label>

        <label class="line-field">
          <span>Base URL <em>*</em></span>
          <input
            v-model="form.baseUrl"
            type="url"
            autocomplete="off"
            placeholder="https://api.example.com/v1"
          />
        </label>

        <label class="line-field">
          <span>API Key <em>*</em></span>
          <div class="secret-input">
            <input
              v-model="form.apiKey"
              :type="showFormApiKey ? 'text' : 'password'"
              autocomplete="off"
              placeholder="请输入 API Key"
            />
            <button
              class="secret-toggle"
              type="button"
              :aria-pressed="showFormApiKey"
              @click="toggleFormApiKey"
            >
              {{ showFormApiKey ? '隐藏' : '显示' }}
            </button>
          </div>
        </label>

        <div class="model-field">
          <div class="model-field-head">
            <span>生图模型</span>
            <button
              class="query-model-button"
              type="button"
              :disabled="modelQuerying || detailLoading"
              @click="queryModels"
            >
              {{ modelQuerying ? '查询中' : '查询模型' }}
            </button>
          </div>
          <small class="field-hint">可手动添加模型 ID，也可使用当前连接信息查询上游模型。</small>
          <div class="model-input-box">
            <span v-for="model in form.models" :key="model" class="model-chip">
              {{ model }}
              <button type="button" :aria-label="`移除模型 ${model}`" @click="removeModel(model)">
                ×
              </button>
            </span>
            <input
              v-model="modelInput"
              type="text"
              autocomplete="off"
              :placeholder="form.models.length > 0 ? '继续输入模型' : 'gpt-image-1, dall-e-3'"
              @input="onModelInput"
              @keydown="onModelKeydown"
              @blur="commitModelInput"
            />
          </div>

          <div v-if="modelCandidates.length > 0" class="model-candidates">
            <button
              v-for="model in modelCandidates"
              :key="model"
              type="button"
              :class="{ selected: isCandidateSelected(model) }"
              :disabled="isCandidateSelected(model)"
              @click="pickCandidateModel(model)"
            >
              {{ model }}
            </button>
          </div>
        </div>

        <label class="line-field">
          <span>默认生图模型 <em>*</em></span>
          <select v-model="form.defaultModel" :disabled="defaultModelOptions.length === 0">
            <option value="" disabled>
              {{ defaultModelOptions.length === 0 ? '请先添加模型列表' : '请选择默认生图模型' }}
            </option>
            <option v-for="model in defaultModelOptions" :key="model" :value="model">
              {{ model }}
            </option>
          </select>
          <small class="field-hint">
            {{
              defaultModelOptions.length === 0
                ? '请先在上方模型列表中添加模型，再选择默认生图模型。'
                : '默认生图模型只能从当前模型列表中选择。'
            }}
          </small>
        </label>

        <div class="split-fields">
          <label class="switch-field">
            <input v-model="form.isEnabled" type="checkbox" />
            <span>启用此提供商</span>
          </label>
        </div>

        <label class="line-field">
          <span>额外配置 JSON</span>
          <textarea
            v-model="form.configJson"
            rows="7"
            spellcheck="false"
            placeholder='例如：{"size":"1024x1024"}'
          ></textarea>
        </label>
      </form>

      <template #footer>
        <button class="ghost-button" type="button" :disabled="saving" @click="closeEditor">
          取消
        </button>
        <button class="submit-button" type="button" :disabled="!canSubmit" @click="onSubmit">
          {{ submitLabel }}
        </button>
      </template>
    </Dialog>
  </main>
</template>

<style scoped>
.image-provider-page {
  min-height: 100vh;
  padding: 36px 48px 56px;
  background:
    radial-gradient(circle at 14% 0%, oklch(97.5% 0.012 245) 0, transparent 34rem),
    linear-gradient(180deg, oklch(99.4% 0.003 250), oklch(96.8% 0.006 250));
  color: oklch(23% 0.026 260);
  font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}

.page-header,
.workspace {
  max-width: 1760px;
  margin-inline: auto;
}

.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 28px;
}

.page-header h1 {
  margin: 10px 0 8px;
  color: oklch(22% 0.028 260);
  font-size: 2.25rem;
  line-height: 1.12;
  font-weight: 800;
  letter-spacing: 0;
}

.page-header p {
  max-width: 48rem;
  margin: 0;
  color: oklch(47% 0.028 260);
  font-size: 1rem;
  line-height: 1.7;
}

.back-button,
.new-button,
.refresh-button,
.state-button,
.row-actions button,
.icon-action,
.pager button,
.ghost-button,
.submit-button,
.secret-toggle,
.query-model-button,
.dialog-close-button,
.model-chip button,
.model-candidates button {
  border: 0;
  border-radius: 8px;
  font: inherit;
  font-weight: 740;
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.back-button,
.new-button {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.back-button {
  padding: 0;
  background: transparent;
  color: oklch(49% 0.035 260);
  font-size: 0.92rem;
}

.back-button:hover {
  color: oklch(46% 0.16 252);
  transform: translateX(-2px);
}

.new-button,
.submit-button,
.state-button {
  padding: 0 20px;
  background: oklch(18.5% 0.012 260);
  color: oklch(98.5% 0.004 250);
  box-shadow: 0 14px 30px oklch(18.5% 0.012 260 / 0.16);
}

.new-button:hover,
.submit-button:hover:not(:disabled),
.state-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 18px 36px oklch(18.5% 0.012 260 / 0.2);
}

.page-header svg,
.new-button svg {
  width: 1.15rem;
  height: 1.15rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.workspace {
  display: block;
}

.provider-list {
  overflow: hidden;
  border: 1px solid oklch(88.5% 0.012 250);
  border-radius: 16px;
  background: oklch(99.4% 0.003 250);
  box-shadow:
    0 18px 48px oklch(42% 0.035 260 / 0.09),
    0 1px 2px oklch(42% 0.035 260 / 0.06);
}

.list-head,
.editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 28px 20px;
  border-bottom: 1px solid oklch(91% 0.009 250);
}

.list-head h2 {
  margin: 0;
  color: oklch(24% 0.03 260);
  font-size: 1.24rem;
  line-height: 1.2;
  font-weight: 800;
}

.list-head span,
.editor-head p,
.editor-head-actions span {
  color: oklch(52% 0.03 260);
  font-size: 0.82rem;
  font-weight: 760;
}

.editor-head p {
  margin: 0;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.editor-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.dialog-close-button {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid oklch(84% 0.014 250);
  background: oklch(98% 0.006 250);
  color: oklch(42% 0.035 260);
  font-size: 1.25rem;
  line-height: 1;
}

.refresh-button,
.icon-action,
.secret-toggle,
.query-model-button,
.ghost-button {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid oklch(83% 0.018 250);
  background: oklch(98% 0.006 250);
  color: oklch(42% 0.035 260);
}

.refresh-button:hover:not(:disabled),
.icon-action:hover,
.secret-toggle:hover,
.secret-toggle[aria-pressed='true'],
.query-model-button:hover:not(:disabled),
.ghost-button:hover:not(:disabled),
.dialog-close-button:hover:not(:disabled) {
  border-color: oklch(70% 0.075 250);
  background: oklch(95.5% 0.02 250);
  color: oklch(46% 0.16 252);
}

.refresh-button:disabled,
.submit-button:disabled,
.ghost-button:disabled,
.dialog-close-button:disabled,
.query-model-button:disabled,
.model-candidates button:disabled,
.pager button:disabled,
.row-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
  box-shadow: none;
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  min-width: 1180px;
  border-collapse: collapse;
}

th,
td {
  padding: 18px;
  border-bottom: 1px solid oklch(91.5% 0.008 250);
  text-align: left;
  vertical-align: middle;
}

th {
  color: oklch(50% 0.032 260);
  font-size: 0.78rem;
  font-weight: 820;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
}

td {
  color: oklch(32% 0.03 260);
  font-size: 0.92rem;
}

tbody tr {
  transition:
    background 0.18s ease,
    box-shadow 0.18s ease;
}

tbody tr:hover,
tbody tr.active {
  background: oklch(97.5% 0.012 250);
}

td strong {
  color: oklch(23% 0.032 260);
  font-size: 0.98rem;
}

.url-text {
  display: inline-block;
  max-width: 22rem;
  overflow: hidden;
  color: oklch(38% 0.035 260);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.muted-text {
  color: oklch(56% 0.026 260);
}

.model-list-cell {
  display: flex;
  max-width: 20rem;
  flex-wrap: wrap;
  gap: 6px;
}

.model-pill {
  min-height: 26px;
  max-width: 13rem;
  display: inline-flex;
  align-items: center;
  padding: 0 9px;
  border-radius: 999px;
  background: oklch(94.5% 0.018 248);
  color: oklch(35% 0.055 252);
  font-size: 0.76rem;
  font-weight: 780;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-pill.default {
  background: oklch(93.5% 0.032 150);
  color: oklch(38% 0.13 150);
}

.model-pill.more {
  background: oklch(91.5% 0.012 260);
  color: oklch(44% 0.03 260);
}

.key-cell,
.row-actions,
.pager,
.split-fields {
  display: flex;
  align-items: center;
}

.key-cell {
  gap: 10px;
}

.key-cell code {
  max-width: 14rem;
  overflow: hidden;
  color: oklch(22% 0.012 260);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.84rem;
  line-height: 1.6;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.key-cell code.masked {
  color: oklch(13% 0.008 260);
  letter-spacing: 0.12em;
}

.status-pill {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border-radius: 999px;
  background: oklch(93% 0.026 150);
  color: oklch(39% 0.13 150);
  font-size: 0.76rem;
  font-weight: 800;
}

.status-pill[data-enabled='false'] {
  background: oklch(94% 0.012 260);
  color: oklch(45% 0.035 260);
}

.row-actions {
  gap: 8px;
  white-space: nowrap;
}

.row-actions button {
  min-height: 34px;
  padding: 0 11px;
  background: transparent;
  color: oklch(46% 0.15 252);
}

.row-actions button:hover:not(:disabled) {
  background: oklch(94.5% 0.02 250);
}

.row-actions .danger {
  color: oklch(53% 0.19 24);
}

.row-actions .danger:hover:not(:disabled) {
  background: oklch(96% 0.022 24);
}

.table-skeleton,
.state-panel {
  padding: 28px;
}

.table-skeleton {
  display: grid;
  gap: 14px;
}

.table-skeleton span {
  height: 48px;
  border-radius: 10px;
  background: linear-gradient(
    90deg,
    oklch(92% 0.01 250) 0%,
    oklch(97% 0.006 250) 50%,
    oklch(92% 0.01 250) 100%
  );
  background-size: 200% 100%;
  animation: shine 1.25s linear infinite;
}

@keyframes shine {
  to {
    background-position: -200% 0;
  }
}

.state-panel {
  min-height: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
}

.state-panel h3 {
  margin: 0;
  color: oklch(26% 0.032 260);
  font-size: 1.2rem;
}

.state-panel p {
  max-width: 34rem;
  margin: 0;
  color: oklch(50% 0.03 260);
  line-height: 1.7;
}

.state-button {
  min-height: 42px;
  margin-top: 6px;
}

.pager {
  justify-content: center;
  gap: 10px;
  padding: 18px 24px 24px;
}

.pager button {
  min-width: 42px;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid oklch(86% 0.012 250);
  background: oklch(99% 0.004 250);
  color: oklch(35% 0.028 260);
  font-variant-numeric: tabular-nums;
}

.pager button:hover:not(:disabled) {
  border-color: oklch(70% 0.075 250);
  transform: translateY(-1px);
}

.pager button.current {
  border-color: oklch(18.5% 0.012 260);
  background: oklch(18.5% 0.012 260);
  color: oklch(98.5% 0.004 250);
}

.provider-form {
  display: grid;
  gap: 20px;
  padding: 24px 28px 28px;
}

.line-field,
.model-field {
  display: grid;
  gap: 8px;
}

.line-field > span,
.model-field-head > span,
.switch-field span {
  color: oklch(36% 0.035 260);
  font-size: 0.86rem;
  font-weight: 780;
}

.line-field em {
  color: oklch(53% 0.19 24);
  font-style: normal;
}

/* 表单控件沿用下划线输入风格，和普通 AI 提供商页保持一致。 */
.line-field input,
.line-field textarea,
.line-field select {
  width: 100%;
  border: 0;
  border-bottom: 1px solid oklch(82% 0.018 250);
  border-radius: 0;
  outline: 0;
  background: oklch(98.2% 0.006 250);
  color: oklch(25% 0.03 260);
  font: inherit;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.line-field input,
.line-field select {
  min-height: 46px;
  padding: 0 2px;
}

.line-field select {
  cursor: pointer;
}

.line-field select:disabled {
  cursor: not-allowed;
  opacity: 0.64;
}

.line-field textarea {
  min-height: 148px;
  padding: 12px 2px;
  line-height: 1.65;
  resize: vertical;
}

.line-field input::placeholder,
.line-field textarea::placeholder,
.model-input-box input::placeholder {
  color: oklch(58% 0.028 260);
}

.line-field input:hover,
.line-field textarea:hover,
.line-field select:hover:not(:disabled) {
  border-bottom-color: oklch(68% 0.075 250);
}

.line-field input:focus,
.line-field textarea:focus,
.line-field select:focus {
  background: oklch(99.2% 0.003 250);
  border-bottom-color: oklch(48% 0.16 252);
  box-shadow: 0 8px 18px oklch(50% 0.08 252 / 0.08);
}

.field-hint {
  color: oklch(54% 0.03 260);
  font-size: 0.76rem;
  line-height: 1.6;
}

.secret-input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;
}

.secret-toggle {
  min-width: 64px;
  min-height: 42px;
  font-size: 0.86rem;
}

.model-field {
  gap: 10px;
}

.model-field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.query-model-button {
  min-height: 34px;
  font-size: 0.82rem;
}

.model-input-box {
  min-height: 48px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 2px;
  border-bottom: 1px solid oklch(82% 0.018 250);
  background: oklch(98.2% 0.006 250);
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.model-input-box:hover {
  border-bottom-color: oklch(68% 0.075 250);
}

.model-input-box:focus-within {
  background: oklch(99.2% 0.003 250);
  border-bottom-color: oklch(48% 0.16 252);
  box-shadow: 0 8px 18px oklch(50% 0.08 252 / 0.08);
}

.model-chip {
  min-height: 30px;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 6px 0 11px;
  border-radius: 999px;
  background: oklch(93.5% 0.024 248);
  color: oklch(31% 0.07 252);
  font-size: 0.82rem;
  font-weight: 760;
}

.model-chip button {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: oklch(99.4% 0.003 250 / 0.8);
  color: oklch(43% 0.05 252);
  font-size: 0.9rem;
  line-height: 1;
}

.model-chip button:hover {
  background: oklch(88% 0.035 248);
  color: oklch(32% 0.09 252);
}

.model-input-box input {
  min-width: 12rem;
  flex: 1 1 12rem;
  border: 0;
  outline: 0;
  background: transparent;
  color: oklch(25% 0.03 260);
  font: inherit;
}

/* 查询模型接口返回的候选项只作为快捷录入入口，用户点击后才写入当前模型列表。 */
.model-candidates {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 2px;
}

.model-candidates button {
  min-height: 32px;
  max-width: 100%;
  padding: 0 11px;
  border: 1px solid oklch(84% 0.014 250);
  background: oklch(99% 0.004 250);
  color: oklch(40% 0.04 260);
  font-size: 0.8rem;
  font-weight: 740;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-candidates button:hover:not(:disabled) {
  border-color: oklch(70% 0.075 250);
  background: oklch(95.5% 0.02 250);
  color: oklch(46% 0.16 252);
}

.model-candidates button.selected {
  border-color: oklch(82% 0.018 250);
  background: oklch(94.5% 0.012 250);
  color: oklch(56% 0.026 260);
}

.split-fields {
  gap: 18px;
  align-items: end;
}

.switch-field {
  min-height: 46px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 4px;
}

.switch-field input {
  width: 42px;
  height: 24px;
  flex: 0 0 auto;
  appearance: none;
  border-radius: 999px;
  background: oklch(82% 0.012 250);
  cursor: pointer;
  position: relative;
  transition:
    background 0.18s ease,
    box-shadow 0.18s ease;
}

.switch-field input::before {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: oklch(99.4% 0.003 250);
  box-shadow: 0 2px 7px oklch(30% 0.02 260 / 0.18);
  transition: transform 0.18s ease;
}

.switch-field input:checked {
  background: oklch(48% 0.16 252);
}

.switch-field input:checked::before {
  transform: translateX(18px);
}

.ghost-button,
.submit-button {
  min-height: 44px;
  padding: 0 18px;
}

.back-button:focus-visible,
.new-button:focus-visible,
.refresh-button:focus-visible,
.state-button:focus-visible,
.row-actions button:focus-visible,
.icon-action:focus-visible,
.pager button:focus-visible,
.ghost-button:focus-visible,
.submit-button:focus-visible,
.secret-toggle:focus-visible,
.query-model-button:focus-visible,
.dialog-close-button:focus-visible,
.model-chip button:focus-visible,
.model-candidates button:focus-visible,
.line-field input:focus-visible,
.line-field textarea:focus-visible,
.line-field select:focus-visible,
.model-input-box:focus-within,
.switch-field input:focus-visible {
  outline: 3px solid oklch(76% 0.14 250 / 0.55);
  outline-offset: 3px;
}

/* PrimeVue Dialog 渲染在全局浮层里，这里只覆盖生图 AI 提供商弹窗。 */
:global(.p-dialog-mask:has(.image-provider-dialog)) {
  background: oklch(20% 0.035 260 / 0.26);
  backdrop-filter: blur(3px);
}

:global(.image-provider-dialog.p-dialog) {
  overflow: hidden;
  border: 1px solid oklch(87% 0.014 250);
  border-radius: 16px;
  background: oklch(99.4% 0.003 250);
  color: oklch(24% 0.03 260);
  box-shadow:
    0 24px 70px oklch(34% 0.045 260 / 0.22),
    0 1px 2px oklch(34% 0.045 260 / 0.1);
}

:global(.image-provider-dialog .p-dialog-header),
:global(.image-provider-dialog .p-dialog-content),
:global(.image-provider-dialog .p-dialog-footer) {
  background: oklch(99.4% 0.003 250);
  color: oklch(24% 0.03 260);
}

:global(.image-provider-dialog .p-dialog-header) {
  padding: 22px 28px 16px;
  border-bottom: 1px solid oklch(91% 0.009 250);
}

:global(.image-provider-dialog .p-dialog-title) {
  font-size: 1.12rem;
  font-weight: 800;
}

:global(.image-provider-dialog .p-dialog-content) {
  padding: 0;
}

:global(.image-provider-dialog .p-dialog-footer) {
  gap: 12px;
  padding: 16px 28px 24px;
  border-top: 1px solid oklch(91% 0.009 250);
}

@media (max-width: 1180px) {
  .image-provider-page {
    padding-inline: 28px;
  }
}

@media (max-width: 980px) {
  table,
  thead,
  tbody,
  tr,
  td {
    display: block;
  }

  table {
    min-width: 0;
  }

  thead {
    display: none;
  }

  tbody {
    display: grid;
    gap: 14px;
    padding: 18px;
  }

  tbody tr {
    padding: 16px;
    border: 1px solid oklch(89% 0.012 250);
    border-radius: 14px;
    background: oklch(99% 0.004 250);
  }

  td {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid oklch(92% 0.008 250);
  }

  td:last-child {
    border-bottom: 0;
  }

  td::before {
    content: attr(data-label);
    color: oklch(52% 0.03 260);
    font-size: 0.78rem;
    font-weight: 800;
  }

  .url-text,
  .key-cell code,
  .model-list-cell {
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }
}

@media (max-width: 720px) {
  .image-provider-page {
    padding: 24px 16px 36px;
  }

  .page-header,
  .list-head,
  .editor-head,
  .split-fields {
    align-items: stretch;
    flex-direction: column;
  }

  .page-header h1 {
    font-size: 1.8rem;
  }

  .new-button,
  .refresh-button,
  .ghost-button,
  .submit-button {
    width: 100%;
  }

  .provider-form,
  .list-head,
  .editor-head {
    padding-inline: 20px;
  }

  .key-cell,
  .row-actions,
  .model-field-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .pager {
    flex-wrap: wrap;
  }
}

@media (prefers-reduced-motion: reduce) {
  .table-skeleton span {
    animation-duration: 0.01ms;
    animation-iteration-count: 1;
  }

  .back-button,
  .new-button,
  .refresh-button,
  .state-button,
  .row-actions button,
  .icon-action,
  .pager button,
  .ghost-button,
  .submit-button,
  .secret-toggle,
  .query-model-button,
  .dialog-close-button,
  .model-chip button,
  .model-candidates button {
    transition-duration: 0.01ms;
  }
}
</style>
