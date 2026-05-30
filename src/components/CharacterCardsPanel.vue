<!--
  CharacterCardsPanel.vue：小说角色卡列表与增删改查面板
  ----------------------------------------------------------------------------
  设计目标：
  1. 作为 NovelDetailView 的「角色卡」Tab 主体，同时兼容备用路由页复用。
  2. 列表只展示摘要信息；点击卡片后调用详情接口，再在弹窗中查看和修改完整资料。
  3. 详情弹窗默认以角色档案呈现，用户进入具体区块后再编辑，避免全屏表单压迫感。
  4. 删除入口放在卡片右上角的 x 按钮，使用全局 ConfirmDialog 做二次确认。
-->

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import {
  createCharacter,
  deleteCharacter,
  getCharacter,
  listCharacters,
  updateCharacter,
} from '@/api/character'
import CoverUploader from '@/components/CoverUploader.vue'
import maleAvatar from '@/assets/images/默认男性角色图像.png'
import femaleAvatar from '@/assets/images/默认女性角色图像.png'

const props = defineProps({
  // 所属小说 ID，来自小说详情页或备用角色卡路由。
  novelId: { type: Number, required: true },
  // 用于空状态文案与无图卡片的语义补充，备用路由可不传。
  novelTitle: { type: String, default: '' },
})

const confirm = useConfirm()
const toast = useToast()

const STATUS_OPTIONS = [
  { label: '在线', value: 1 },
  { label: '下线', value: 2 },
]

const GENDER_OPTIONS = ['男', '女']

const PROFILE_SECTIONS = [
  {
    key: 'intro',
    title: '角色介绍',
    fields: [
      {
        key: 'intro',
        label: '定位摘要',
        placeholder: '角色的一句话定位或摘要',
      },
    ],
  },
  {
    key: 'shape',
    title: '外貌与性格',
    fields: [
      {
        key: 'appearance',
        label: '外貌',
        placeholder: '外貌、服饰、辨识特征',
      },
      {
        key: 'personality',
        label: '性格',
        placeholder: '性格关键词与行为倾向',
      },
    ],
  },
  {
    key: 'origin',
    title: '背景与能力',
    fields: [
      {
        key: 'background',
        label: '背景',
        placeholder: '身世、经历、关系网络',
      },
      {
        key: 'ability',
        label: '能力',
        placeholder: '能力、限制、代价',
      },
    ],
  },
  {
    key: 'plot',
    title: '动机与剧情',
    fields: [
      {
        key: 'motivation',
        label: '动机',
        placeholder: '想要什么，害怕什么',
      },
      {
        key: 'plotDirection',
        label: '剧情方向',
        placeholder: '后续成长、冲突或结局方向',
      },
    ],
  },
]

// ───── 列表状态 ─────
const items = ref([])
const page = ref(1)
const pageSize = 50
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const loadError = ref('')
const initialLoaded = ref(false)

// ───── 弹窗与表单状态 ─────
const showDialog = ref(false)
const dialogMode = ref('create')
const activeCharacterId = ref(null)
const detailLoading = ref(false)
const saving = ref(false)
const deletingId = ref(null)
const activeEditSection = ref('')
const detailSnapshot = ref('')

const form = reactive({
  name: '',
  gender: '',
  status: 1,
  appearanceImgUrl: '',
  tagsText: '',
  firstAppearanceChapterId: '',
  intro: '',
  appearance: '',
  personality: '',
  background: '',
  ability: '',
  motivation: '',
  plotDirection: '',
})

const hasMore = computed(() => items.value.length < total.value)
const dialogTitle = computed(() => (dialogMode.value === 'create' ? '添加角色' : '角色档案'))
const parsedTags = computed(() => parseTags())
const dirty = computed(
  () => dialogMode.value === 'create' || payloadSignature() !== detailSnapshot.value,
)

function resetForm() {
  form.name = ''
  form.gender = '男'
  form.status = 1
  form.appearanceImgUrl = ''
  form.tagsText = ''
  form.firstAppearanceChapterId = ''
  form.intro = ''
  form.appearance = ''
  form.personality = ''
  form.background = ''
  form.ability = ''
  form.motivation = ''
  form.plotDirection = ''
}

// 将后端角色详情同步到弹窗表单。列表接口只返回摘要，详情接口返回完整资料。
function syncForm(character = {}) {
  form.name = character.name || ''
  form.gender = normalizeGender(character.gender)
  form.status = character.status || 1
  form.appearanceImgUrl = character.appearanceImgUrl || ''
  form.tagsText = Array.isArray(character.charactersTags) ? character.charactersTags.join('，') : ''
  form.firstAppearanceChapterId =
    character.firstAppearanceChapterId === undefined || character.firstAppearanceChapterId === null
      ? ''
      : String(character.firstAppearanceChapterId)
  form.intro = character.intro || ''
  form.appearance = character.appearance || ''
  form.personality = character.personality || ''
  form.background = character.background || ''
  form.ability = character.ability || ''
  form.motivation = character.motivation || ''
  form.plotDirection = character.plotDirection || ''
}

function parseTags() {
  // 标签输入兼容中英文逗号，用户从中文输入法里直接输入也能拆成标签。
  return form.tagsText
    .split(/[，,]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function normalizeGender(gender = '') {
  return gender === '女' ? '女' : '男'
}

function buildPayload() {
  const payload = {
    name: form.name.trim(),
    gender: normalizeGender(form.gender),
    status: Number(form.status) || 1,
    appearanceImgUrl: form.appearanceImgUrl.trim(),
    charactersTags: parseTags(),
    intro: form.intro.trim(),
    appearance: form.appearance.trim(),
    personality: form.personality.trim(),
    background: form.background.trim(),
    ability: form.ability.trim(),
    motivation: form.motivation.trim(),
    plotDirection: form.plotDirection.trim(),
  }

  // 首次出现章节 ID 是数值字段；空值不传，避免把空字符串交给后端解析。
  const firstChapter = Number(form.firstAppearanceChapterId)
  if (form.firstAppearanceChapterId !== '' && Number.isFinite(firstChapter) && firstChapter > 0) {
    payload.firstAppearanceChapterId = firstChapter
  }

  return payload
}

function payloadSignature() {
  return JSON.stringify(buildPayload())
}

function rememberSnapshot() {
  detailSnapshot.value = payloadSignature()
}

function characterIdOf(character) {
  return character?.id ?? character?.characterId
}

function statusLabel(status) {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label || '未设定'
}

function characterAvatarSrc(character = {}) {
  // 角色真实形象图优先展示；后端没有返回图片时，按性别回退到本地默认角色图。
  // 性别只明确区分“女”，其余值统一使用男性默认图，和现有 normalizeGender 规则保持一致。
  const imageUrl = String(character.appearanceImgUrl || '').trim()
  if (imageUrl) return imageUrl
  return normalizeGender(character.gender) === '女' ? femaleAvatar : maleAvatar
}

function characterAvatarAlt(character = {}) {
  const name = character.name || '未命名'
  return character.appearanceImgUrl ? `${name}形象图` : `${name}默认形象图`
}

function textOrFallback(value, fallback = '暂未记录') {
  return value?.trim() || fallback
}

function beginEditSection(sectionKey) {
  if (detailLoading.value || saving.value) return
  activeEditSection.value = activeEditSection.value === sectionKey ? '' : sectionKey
}

function isSectionEditing(sectionKey) {
  return activeEditSection.value === sectionKey
}

async function fetchCharacters({ append = false } = {}) {
  if (loading.value || loadingMore.value) return
  if (append && !hasMore.value) return

  const targetPage = append ? page.value : 1
  loading.value = !append
  loadingMore.value = append
  loadError.value = ''

  try {
    const res = await listCharacters(props.novelId, {
      page: targetPage,
      pageSize,
    })
    if (res?.code === 0) {
      const nextItems = res.data?.items || []
      items.value = append ? [...items.value, ...nextItems] : nextItems
      total.value = res.data?.total || nextItems.length
      page.value = targetPage + 1
    } else {
      loadError.value = res?.msg || '角色卡加载失败'
    }
  } catch (e) {
    loadError.value = e?.message || '角色卡加载失败'
  } finally {
    loading.value = false
    loadingMore.value = false
    initialLoaded.value = true
  }
}

function refreshCharacters() {
  items.value = []
  page.value = 1
  total.value = 0
  initialLoaded.value = false
  return fetchCharacters()
}

function openCreate() {
  dialogMode.value = 'create'
  activeCharacterId.value = null
  resetForm()
  activeEditSection.value = 'create'
  rememberSnapshot()
  showDialog.value = true
}

async function openDetail(character) {
  const id = characterIdOf(character)
  if (!id) {
    toast.add({
      severity: 'warn',
      summary: '无法打开详情',
      detail: '角色列表缺少 characterId，无法调用详情接口。',
      life: 3000,
    })
    return
  }

  dialogMode.value = 'edit'
  activeCharacterId.value = id
  syncForm(character)
  activeEditSection.value = ''
  rememberSnapshot()
  showDialog.value = true
  detailLoading.value = true

  try {
    const res = await getCharacter(props.novelId, id)
    if (res?.code === 0 && res.data) {
      syncForm(res.data)
      rememberSnapshot()
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

function closeDialog() {
  if (saving.value) return
  activeEditSection.value = ''
  showDialog.value = false
}

async function onSave() {
  if (saving.value || detailLoading.value) return
  const payload = buildPayload()
  if (!payload.name) {
    toast.add({ severity: 'warn', summary: '角色名称不能为空', life: 2500 })
    return
  }

  saving.value = true
  try {
    const res =
      dialogMode.value === 'create'
        ? await createCharacter(props.novelId, payload)
        : await updateCharacter(props.novelId, activeCharacterId.value, payload)

    if (res?.code === 0) {
      const wasCreate = dialogMode.value === 'create'
      toast.add({
        severity: 'success',
        summary: wasCreate ? '角色卡已添加' : '角色卡已保存',
        life: 2000,
      })
      await refreshCharacters()

      if (wasCreate) {
        const createdCharacter = { ...payload, ...(res.data || {}) }
        const createdId = characterIdOf(createdCharacter)
        if (createdId) {
          dialogMode.value = 'edit'
          activeCharacterId.value = createdId
          syncForm(createdCharacter)
          rememberSnapshot()
          activeEditSection.value = ''
          detailLoading.value = true
          try {
            const detailRes = await getCharacter(props.novelId, createdId)
            if (detailRes?.code === 0 && detailRes.data) {
              syncForm(detailRes.data)
              rememberSnapshot()
            }
          } catch (e) {
            toast.add({
              severity: 'warn',
              summary: '详情暂未刷新',
              detail: e?.message || '角色已创建，可稍后重新打开补充资料。',
              life: 3000,
            })
          } finally {
            detailLoading.value = false
          }
        } else {
          showDialog.value = false
        }
      } else {
        rememberSnapshot()
        activeEditSection.value = ''
        showDialog.value = false
      }
    } else {
      toast.add({
        severity: 'error',
        summary: dialogMode.value === 'create' ? '添加失败' : '保存失败',
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

function onDelete(character) {
  const id = characterIdOf(character)
  if (!id || deletingId.value) {
    if (!id) {
      toast.add({
        severity: 'warn',
        summary: '无法删除',
        detail: '角色列表缺少 characterId，无法调用删除接口。',
        life: 3000,
      })
    }
    return
  }

  confirm.require({
    header: '确认删除',
    message: `确定要删除角色「${character.name || '未命名'}」吗？`,
    acceptLabel: '删除',
    rejectLabel: '取消',
    acceptClass: 'p-button-danger',
    accept: async () => {
      deletingId.value = id
      try {
        const res = await deleteCharacter(props.novelId, id)
        if (res?.code === 0) {
          items.value = items.value.filter((item) => characterIdOf(item) !== id)
          total.value = Math.max(0, total.value - 1)
          if (activeCharacterId.value === id) showDialog.value = false
          toast.add({ severity: 'success', summary: '角色卡已删除', life: 2000 })
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

watch(
  () => props.novelId,
  () => refreshCharacters(),
)

onMounted(refreshCharacters)
</script>

<template>
  <section class="character-panel" aria-labelledby="character-title">
    <header class="panel-head">
      <div>
        <p class="eyebrow">{{ novelTitle ? `《${novelTitle}》` : 'Novel Characters' }}</p>
        <h2 id="character-title">角色卡</h2>
      </div>

      <button class="add-button" type="button" @click="openCreate">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        添加角色
      </button>
    </header>

    <div v-if="!initialLoaded" class="state-card" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <span>正在载入角色卡…</span>
    </div>

    <div v-else-if="loadError" class="state-card error">
      <span>{{ loadError }}</span>
      <button class="panel-button" type="button" @click="refreshCharacters">重试</button>
    </div>

    <div v-else-if="items.length === 0" class="empty-card">
      <h3>还没有角色卡</h3>
      <p>添加第一位角色，把人物动机、能力和剧情方向沉淀下来。</p>
      <button class="add-button compact" type="button" @click="openCreate">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        添加角色
      </button>
    </div>

    <template v-else>
      <div class="character-grid" role="list" aria-label="角色卡列表">
        <article
          v-for="character in items"
          :key="characterIdOf(character) || character.name"
          class="character-card"
          role="listitem"
          tabindex="0"
          @click="openDetail(character)"
          @keydown.enter.prevent="openDetail(character)"
          @keydown.space.prevent="openDetail(character)"
        >
          <button
            class="delete-character"
            type="button"
            :aria-label="`删除角色 ${character.name || '未命名'}`"
            :disabled="deletingId === characterIdOf(character)"
            @click.stop="onDelete(character)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>

          <div class="avatar">
            <img :src="characterAvatarSrc(character)" :alt="characterAvatarAlt(character)" />
          </div>

          <div class="card-copy">
            <div class="card-title-row">
              <h3>{{ character.name || '未命名角色' }}</h3>
              <span class="status-pill" :data-status="character.status">
                {{ statusLabel(character.status) }}
              </span>
            </div>
            <p>{{ character.gender || '性别未设定' }}</p>
            <div class="tag-row" aria-label="角色标签">
              <span v-for="tag in character.charactersTags || []" :key="tag">{{ tag }}</span>
              <span v-if="!character.charactersTags?.length" class="muted-tag">暂无标签</span>
            </div>
          </div>
        </article>
      </div>

      <div v-if="hasMore" class="load-more">
        <button
          class="panel-button"
          type="button"
          :disabled="loadingMore"
          @click="fetchCharacters({ append: true })"
        >
          {{ loadingMore ? '加载中...' : '加载更多' }}
        </button>
      </div>
    </template>

    <Dialog
      v-model:visible="showDialog"
      :header="dialogTitle"
      :modal="true"
      :draggable="false"
      :closable="!saving"
      :style="{
        width: dialogMode === 'create' ? '640px' : '860px',
        maxWidth: 'calc(100vw - 32px)',
      }"
      class="character-dialog"
    >
      <form class="character-form" :data-mode="dialogMode" @submit.prevent="onSave">
        <div v-if="detailLoading" class="detail-loading" aria-live="polite">
          <span class="spinner" aria-hidden="true"></span>
          <span>正在读取角色详情…</span>
        </div>

        <template v-if="dialogMode === 'create'">
          <div class="create-layout">
            <div class="portrait-field">
              <span>形象图</span>
              <!-- CoverUploader 可复用图片上传能力；外层使用 div，避免 label 触发双 picker。 -->
              <CoverUploader v-model="form.appearanceImgUrl" />
            </div>

            <div class="create-fields">
              <label class="field">
                <span>角色名称 <em>*</em></span>
                <InputText v-model="form.name" placeholder="请输入角色名称" autofocus />
              </label>

              <div class="choice-field">
                <span>性别</span>
                <div class="choice-row" role="group" aria-label="选择性别">
                  <button
                    v-for="option in GENDER_OPTIONS"
                    :key="option"
                    class="choice-button"
                    type="button"
                    :aria-pressed="form.gender === option"
                    @click="form.gender = option"
                  >
                    {{ option }}
                  </button>
                </div>
              </div>

              <div class="choice-field">
                <span>状态</span>
                <div class="choice-row" role="group" aria-label="选择角色状态">
                  <button
                    v-for="option in STATUS_OPTIONS"
                    :key="option.value"
                    class="choice-button"
                    type="button"
                    :aria-pressed="form.status === option.value"
                    @click="form.status = option.value"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-else>
          <section class="profile-hero" :class="{ editing: isSectionEditing('basic') }">
            <div class="profile-portrait">
              <CoverUploader v-if="isSectionEditing('basic')" v-model="form.appearanceImgUrl" />
              <img v-else :src="characterAvatarSrc(form)" :alt="characterAvatarAlt(form)" />
            </div>

            <div class="profile-summary">
              <template v-if="isSectionEditing('basic')">
                <div class="profile-edit-grid">
                  <label class="field">
                    <span>角色名称 <em>*</em></span>
                    <InputText v-model="form.name" placeholder="请输入角色名称" autofocus />
                  </label>

                  <label class="field">
                    <span>角色标签</span>
                    <InputText v-model="form.tagsText" placeholder="中英文逗号都可分隔" />
                    <div class="editable-tags" aria-label="标签预览">
                      <span v-for="tag in parsedTags" :key="tag">{{ tag }}</span>
                      <span v-if="!parsedTags.length" class="muted-tag">
                        输入后会自动拆成标签
                      </span>
                    </div>
                  </label>

                  <label class="field compact-field">
                    <span>首次出现章节 ID</span>
                    <InputText
                      v-model="form.firstAppearanceChapterId"
                      inputmode="numeric"
                      placeholder="选填，例如 12"
                    />
                  </label>

                  <div class="choice-field">
                    <span>性别</span>
                    <div class="choice-row" role="group" aria-label="选择性别">
                      <button
                        v-for="option in GENDER_OPTIONS"
                        :key="option"
                        class="choice-button"
                        type="button"
                        :aria-pressed="form.gender === option"
                        @click="form.gender = option"
                      >
                        {{ option }}
                      </button>
                    </div>
                  </div>

                  <div class="choice-field">
                    <span>状态</span>
                    <div class="choice-row" role="group" aria-label="选择角色状态">
                      <button
                        v-for="option in STATUS_OPTIONS"
                        :key="option.value"
                        class="choice-button"
                        type="button"
                        :aria-pressed="form.status === option.value"
                        @click="form.status = option.value"
                      >
                        {{ option.label }}
                      </button>
                    </div>
                  </div>
                </div>
              </template>

              <template v-else>
                <div class="profile-title-row">
                  <div>
                    <p class="profile-kicker">Character File</p>
                    <h3>{{ form.name || '未命名角色' }}</h3>
                  </div>
                  <span class="status-pill" :data-status="form.status">
                    {{ statusLabel(form.status) }}
                  </span>
                </div>

                <div class="profile-meta" aria-label="角色基础信息">
                  <span>{{ form.gender }}</span>
                  <span>
                    {{
                      form.firstAppearanceChapterId
                        ? `首次出现：第 ${form.firstAppearanceChapterId} 章`
                        : '首次出现未记录'
                    }}
                  </span>
                </div>

                <div class="profile-tags" aria-label="角色标签">
                  <span v-for="tag in parsedTags" :key="tag">{{ tag }}</span>
                  <span v-if="!parsedTags.length" class="muted-tag">暂无标签</span>
                </div>
              </template>
            </div>

            <button
              class="section-edit-button"
              type="button"
              :aria-pressed="isSectionEditing('basic')"
              @click="beginEditSection('basic')"
            >
              {{ isSectionEditing('basic') ? '收起' : '编辑资料' }}
            </button>
          </section>

          <div class="profile-sections">
            <section
              v-for="section in PROFILE_SECTIONS"
              :key="section.key"
              class="profile-section"
              :class="{ editing: isSectionEditing(section.key) }"
            >
              <header class="section-head">
                <h4>{{ section.title }}</h4>
                <button
                  class="section-edit-button"
                  type="button"
                  :aria-pressed="isSectionEditing(section.key)"
                  @click="beginEditSection(section.key)"
                >
                  {{ isSectionEditing(section.key) ? '收起' : '编辑' }}
                </button>
              </header>

              <div v-if="isSectionEditing(section.key)" class="section-form">
                <label v-for="field in section.fields" :key="field.key" class="field">
                  <span>{{ field.label }}</span>
                  <Textarea
                    v-model="form[field.key]"
                    rows="4"
                    :placeholder="field.placeholder"
                    auto-resize
                  />
                </label>
              </div>

              <div v-else class="section-read">
                <div v-for="field in section.fields" :key="field.key" class="read-block">
                  <span>{{ field.label }}</span>
                  <p>{{ textOrFallback(form[field.key]) }}</p>
                </div>
              </div>
            </section>
          </div>
        </template>
      </form>

      <template #footer>
        <div class="dialog-actions">
          <button class="panel-button" type="button" :disabled="saving" @click="closeDialog">
            取消
          </button>
          <button
            class="panel-button primary"
            type="button"
            :disabled="detailLoading || saving || (dialogMode === 'edit' && !dirty)"
            @click="onSave"
          >
            {{ saving ? '保存中...' : dialogMode === 'create' ? '创建角色' : '保存修改' }}
          </button>
        </div>
      </template>
    </Dialog>
  </section>
</template>

<style scoped>
.character-panel {
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

.add-button {
  min-height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0 18px;
  border: 1px solid oklch(78% 0.08 255);
  border-radius: 9px;
  background: oklch(98% 0.012 255);
  color: oklch(50% 0.18 258);
  font-size: 0.95rem;
  font-weight: 760;
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.add-button svg,
.delete-character svg {
  width: 1.15rem;
  height: 1.15rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.add-button:hover {
  border-color: oklch(60% 0.17 258);
  background: oklch(95% 0.026 255);
  box-shadow: 0 10px 24px oklch(52% 0.08 255 / 0.12);
  transform: translateY(-1px);
}

.add-button.compact {
  min-height: 42px;
}

/* 当前运行环境下 PrimeVue Button 会触发 renderSlot 异常，这里用原生按钮保持弹窗和列表可用。 */
.panel-button {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 15px;
  border: 1px solid oklch(82% 0.024 255);
  border-radius: 9px;
  background: oklch(99.4% 0.003 255);
  color: oklch(38% 0.04 260);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 760;
  cursor: pointer;
}

.panel-button.primary {
  border-color: oklch(58% 0.18 258);
  background: oklch(57% 0.2 258);
  color: oklch(99% 0.004 255);
}

.panel-button:hover {
  border-color: oklch(70% 0.08 255);
  background: oklch(95% 0.02 255);
  color: oklch(48% 0.16 255);
}

.panel-button.primary:hover {
  border-color: oklch(50% 0.2 258);
  background: oklch(51% 0.21 258);
  color: oklch(99% 0.004 255);
}

.panel-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
}

.add-button:focus-visible,
.panel-button:focus-visible,
.character-card:focus-visible,
.delete-character:focus-visible,
.choice-button:focus-visible,
.section-edit-button:focus-visible {
  outline: 3px solid oklch(76% 0.14 250 / 0.55);
  outline-offset: 3px;
}

.state-card,
.empty-card {
  min-height: 260px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 42px 24px;
  color: oklch(52% 0.03 260);
  text-align: center;
}

.state-card.error {
  color: oklch(55% 0.2 25);
}

.empty-card {
  flex-direction: column;
}

.empty-card h3 {
  margin: 0;
  color: oklch(28% 0.04 260);
  font-size: 1.35rem;
}

.empty-card p {
  max-width: 34rem;
  margin: 0 0 8px;
  color: oklch(48% 0.032 260);
  line-height: 1.7;
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

.character-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 18px;
  padding: 28px 34px 18px;
}

.character-card {
  position: relative;
  min-height: 204px;
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  gap: 18px;
  align-items: center;
  padding: 22px 22px 20px;
  border: 1px solid oklch(88% 0.012 255);
  border-radius: 12px;
  background:
    linear-gradient(180deg, oklch(99.5% 0.004 255), oklch(97.5% 0.008 255)), oklch(99% 0.004 255);
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.character-card:hover {
  border-color: oklch(75% 0.06 255);
  box-shadow: 0 14px 32px oklch(42% 0.04 260 / 0.12);
  transform: translateY(-2px);
}

.delete-character {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 50%;
  background: oklch(98% 0.006 255 / 0.88);
  color: oklch(48% 0.04 260);
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease;
}

.delete-character:hover {
  border-color: oklch(84% 0.065 24);
  background: oklch(96% 0.022 24);
  color: oklch(55% 0.22 25);
}

.delete-character:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.avatar {
  width: 86px;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: 10px;
  background: oklch(93% 0.012 255);
  box-shadow:
    0 12px 24px oklch(38% 0.055 260 / 0.14),
    inset 0 0 0 1px oklch(100% 0 0 / 0.72);
}

.avatar img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.card-copy {
  min-width: 0;
  padding-right: 22px;
}

.card-title-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.card-title-row h3 {
  min-width: 0;
  margin: 0;
  color: oklch(25% 0.04 260);
  font-size: 1.2rem;
  line-height: 1.25;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.status-pill {
  flex: 0 0 auto;
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 0 9px;
  border-radius: 999px;
  background: oklch(93% 0.026 150);
  color: oklch(42% 0.13 150);
  font-size: 0.74rem;
  font-weight: 760;
}

.status-pill[data-status='2'] {
  background: oklch(93% 0.016 260);
  color: oklch(46% 0.035 260);
}

.card-copy p {
  margin: 9px 0 0;
  color: oklch(48% 0.032 260);
  font-size: 0.94rem;
}

.tag-row {
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-row span {
  min-height: 26px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border-radius: 8px;
  background: oklch(94% 0.018 255);
  color: oklch(48% 0.15 254);
  font-size: 0.78rem;
  font-weight: 720;
}

.tag-row .muted-tag {
  background: oklch(94% 0.008 255);
  color: oklch(54% 0.026 260);
}

.load-more {
  padding: 0 34px 26px;
  text-align: center;
}

.character-form {
  display: grid;
  gap: 18px;
}

.detail-loading {
  min-height: 46px;
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

.create-layout {
  display: grid;
  grid-template-columns: 196px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

.portrait-field,
.field,
.choice-field {
  display: grid;
  gap: 8px;
}

.portrait-field > span,
.field > span,
.choice-field > span {
  color: oklch(34% 0.035 260);
  font-size: 0.875rem;
  font-weight: 760;
}

.field em {
  color: oklch(55% 0.22 25);
  font-style: normal;
}

.create-fields {
  display: grid;
  gap: 18px;
}

.choice-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.choice-button,
.section-edit-button {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid oklch(84% 0.018 255);
  border-radius: 999px;
  background: oklch(98% 0.006 255);
  color: oklch(42% 0.035 260);
  font: inherit;
  font-size: 0.86rem;
  font-weight: 720;
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
}

.choice-button {
  min-width: 72px;
  padding: 0 14px;
}

.choice-button:hover,
.section-edit-button:hover {
  border-color: oklch(70% 0.08 255);
  background: oklch(95% 0.02 255);
  color: oklch(48% 0.16 255);
}

.choice-button[aria-pressed='true'],
.section-edit-button[aria-pressed='true'] {
  border-color: oklch(62% 0.14 255);
  background: oklch(93.5% 0.038 255);
  color: oklch(45% 0.18 258);
  box-shadow: 0 8px 18px oklch(48% 0.1 255 / 0.12);
}

.profile-hero {
  position: relative;
  display: grid;
  grid-template-columns: 164px minmax(0, 1fr) auto;
  gap: 24px;
  align-items: start;
  padding: 20px;
  border: 1px solid oklch(88% 0.012 255);
  border-radius: 14px;
  background:
    radial-gradient(circle at 16% 10%, oklch(96% 0.026 255) 0, transparent 20rem),
    oklch(98.5% 0.006 255);
}

.profile-hero.editing {
  border-color: oklch(76% 0.07 255);
  background: oklch(98% 0.012 255);
}

.profile-portrait {
  width: 164px;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: 12px;
  background: oklch(93% 0.012 255);
  box-shadow:
    0 14px 28px oklch(38% 0.055 260 / 0.16),
    inset 0 0 0 1px oklch(100% 0 0 / 0.7);
}

.profile-portrait img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.profile-summary {
  min-width: 0;
  padding-top: 2px;
}

.profile-title-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  justify-content: space-between;
}

.profile-kicker {
  margin: 0 0 6px;
  color: oklch(55% 0.04 260);
  font-size: 0.76rem;
  font-weight: 780;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.profile-title-row h3 {
  margin: 0;
  color: oklch(23% 0.04 260);
  font-size: 1.8rem;
  line-height: 1.18;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.profile-meta {
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: oklch(43% 0.032 260);
  font-size: 0.94rem;
}

.profile-meta span {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  padding: 0 11px;
  border-radius: 999px;
  background: oklch(94.5% 0.01 255);
}

.profile-tags {
  margin-top: 18px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.profile-tags span {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border-radius: 8px;
  background: oklch(94% 0.018 255);
  color: oklch(48% 0.15 254);
  font-size: 0.8rem;
  font-weight: 720;
}

.profile-tags .muted-tag {
  background: oklch(94% 0.008 255);
  color: oklch(54% 0.026 260);
}

.editable-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  min-height: 30px;
}

.editable-tags span {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border-radius: 8px;
  background: oklch(94% 0.018 255);
  color: oklch(48% 0.15 254);
  font-size: 0.78rem;
  font-weight: 720;
}

.editable-tags .muted-tag {
  background: oklch(94% 0.008 255);
  color: oklch(54% 0.026 260);
}

.profile-edit-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.compact-field {
  max-width: 220px;
}

.profile-sections {
  display: grid;
  gap: 12px;
}

.profile-section {
  padding: 18px 20px;
  border: 1px solid oklch(89% 0.01 255);
  border-radius: 12px;
  background: oklch(99% 0.004 255);
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease;
}

.profile-section.editing {
  border-color: oklch(76% 0.07 255);
  background: oklch(98% 0.012 255);
  box-shadow: 0 10px 24px oklch(42% 0.04 260 / 0.08);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.section-head h4 {
  margin: 0;
  color: oklch(27% 0.04 260);
  font-size: 1rem;
  font-weight: 780;
}

.section-edit-button {
  min-width: 66px;
  padding: 0 13px;
  border-radius: 8px;
  background: oklch(99% 0.004 255);
}

.section-read {
  margin-top: 14px;
  display: grid;
  gap: 14px;
}

.read-block {
  display: grid;
  gap: 5px;
}

.read-block span {
  color: oklch(52% 0.03 260);
  font-size: 0.78rem;
  font-weight: 760;
}

.read-block p {
  max-width: 72ch;
  margin: 0;
  color: oklch(33% 0.032 260);
  font-size: 0.96rem;
  line-height: 1.75;
  white-space: pre-wrap;
}

.section-form {
  margin-top: 16px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.section-form .field:only-child {
  grid-column: 1 / -1;
}

.field :deep(.p-inputtext),
.field :deep(.p-textarea) {
  width: 100%;
}

:global(.p-dialog-mask:has(.character-dialog)) {
  background: oklch(20% 0.035 260 / 0.28);
  backdrop-filter: blur(3px);
}

:global(.character-dialog.p-dialog) {
  overflow: hidden;
  border: 1px solid oklch(87% 0.014 255);
  border-radius: 16px;
  background: oklch(99.2% 0.004 255);
  color: oklch(26% 0.035 260);
  box-shadow:
    0 24px 70px oklch(34% 0.045 260 / 0.22),
    0 1px 2px oklch(34% 0.045 260 / 0.1);
}

:global(.character-dialog .p-dialog-header) {
  padding: 22px 24px 16px;
  border-bottom: 1px solid oklch(91% 0.01 255);
  background: oklch(99.2% 0.004 255);
  color: oklch(24% 0.035 260);
}

:global(.character-dialog .p-dialog-title) {
  font-size: 1.125rem;
  font-weight: 760;
}

:global(.character-dialog .p-dialog-header-icon) {
  color: oklch(42% 0.035 260);
}

:global(.character-dialog .p-dialog-header-icon:hover) {
  background: oklch(94% 0.014 255);
  color: oklch(48% 0.18 258);
}

:global(.character-dialog .p-dialog-content) {
  padding: 22px 24px 8px;
  background: oklch(99.2% 0.004 255);
  color: oklch(28% 0.035 260);
}

:global(.character-dialog .p-dialog-footer) {
  gap: 10px;
  padding: 16px 24px 22px;
  border-top: 1px solid oklch(91% 0.01 255);
  background: oklch(99.2% 0.004 255);
}

:global(.character-dialog .p-inputtext),
:global(.character-dialog .p-textarea) {
  border-color: oklch(84% 0.018 255);
  background: oklch(99% 0.004 255);
  color: oklch(26% 0.035 260);
}

:global(.character-dialog .p-inputtext::placeholder),
:global(.character-dialog .p-textarea::placeholder) {
  color: oklch(58% 0.028 260);
}

:global(.character-dialog .p-inputtext:hover),
:global(.character-dialog .p-textarea:hover) {
  border-color: oklch(72% 0.08 255);
}

:global(.character-dialog .p-inputtext:enabled:focus),
:global(.character-dialog .p-textarea:enabled:focus) {
  border-color: oklch(56% 0.17 258);
  box-shadow: 0 0 0 3px oklch(78% 0.13 255 / 0.32);
}

:global(.character-dialog .p-button) {
  border-radius: 9px;
}

:global(.character-dialog .p-button-text) {
  color: oklch(42% 0.04 260);
}

:global(.character-dialog .p-button-text:hover) {
  background: oklch(94% 0.014 255);
  color: oklch(48% 0.18 258);
}

:global(.character-dialog .uploader .drop) {
  border-color: oklch(82% 0.026 255);
  background: oklch(97% 0.01 255);
}

:global(.character-dialog .uploader .drop:hover),
:global(.character-dialog .uploader .drop:focus-visible) {
  border-color: oklch(62% 0.15 255);
  background: oklch(95% 0.026 255);
}

:global(.character-dialog .uploader .placeholder) {
  color: oklch(50% 0.03 260);
}

:global(.character-dialog .uploader .placeholder .icon) {
  color: oklch(52% 0.16 258);
}

:global(.character-dialog .uploader .placeholder .primary) {
  color: oklch(34% 0.035 260);
}

:global(.character-dialog .uploader .placeholder .secondary),
:global(.character-dialog .uploader .uploading) {
  color: oklch(55% 0.028 260);
}

:global(.character-dialog .uploader .spinner) {
  border-color: oklch(82% 0.026 255);
  border-top-color: oklch(56% 0.18 258);
}

:global(.character-dialog .uploader .preview) {
  box-shadow:
    0 12px 28px oklch(38% 0.055 260 / 0.18),
    inset 0 0 0 1px oklch(100% 0 0 / 0.72);
}

@media (max-width: 820px) {
  .character-panel {
    border-radius: 14px;
  }

  .panel-head {
    align-items: stretch;
    flex-direction: column;
    padding: 24px 20px 18px;
  }

  .add-button {
    width: 100%;
  }

  .character-grid {
    grid-template-columns: 1fr;
    padding: 20px;
  }

  .character-card {
    grid-template-columns: 74px minmax(0, 1fr);
    min-height: 176px;
    padding: 18px;
  }

  .avatar {
    width: 74px;
  }

  .create-layout,
  .profile-hero,
  .profile-edit-grid,
  .section-form {
    grid-template-columns: 1fr;
  }

  .profile-hero {
    padding: 16px;
  }

  .profile-portrait {
    width: min(100%, 180px);
    justify-self: center;
  }

  .profile-title-row,
  .section-head {
    align-items: flex-start;
  }

  .profile-title-row h3 {
    font-size: 1.45rem;
  }

  .compact-field {
    max-width: none;
  }

  .section-edit-button {
    min-height: 40px;
  }
}
</style>
