<!--
  LoginView.vue —— 大屏登录页
  ----------------------------------------------------------------------------
  视觉：左右双栏布局
    · 左侧 hero：品牌 + Slogan + 卖点（深色渐变 + 流动光斑 + 网格背景）
    · 右侧表单：玻璃质感卡片（backdrop-filter blur）
  交互：单一密码字段，自动切换两种模式
    · INIT  ：首次启动，引导设置初始管理员密码（额外要求确认密码）
    · LOGIN ：日常登录
  状态机：
    1. mounted → checkInitialPassword() 决定首屏模式
    2. 提交时根据 mode 走不同接口，并对业务 code 做兜底纠错：
         · code=1001 设置接口提示「密码已设置」→ 强制切回 LOGIN
         · code=1000 登录接口提示「未初始化」  → 强制切回 INIT
       这一双向兜底保证「前端模式判断」与「后端真实状态」不会因首屏接口偶发失败而错位
-->

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { LoginCode, checkInitialPassword, setInitialPassword } from '@/api/login'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

// 两种 UI 模式：初始化密码 / 正常登录
const MODE = { LOGIN: 'login', INIT: 'init' }

// ───── 响应式状态 ─────
const mode = ref(MODE.LOGIN) // 当前 UI 模式（首屏被 detectMode 覆盖）
const checking = ref(true) // 首屏是否还在请求 initial-password
const submitting = ref(false) // 表单是否正在提交
const errorMsg = ref('') // 表单顶部的错误提示
const showPwd = ref(false) // 密码输入框：明文/密文切换
const showPwd2 = ref(false) // 确认密码输入框：明文/密文切换

// 表单数据（reactive 适合多字段对象）
const form = reactive({
  password: '',
  confirm: '',
})

// ───── 计算属性：随 mode 自适应的文案 ─────
const title = computed(() => (mode.value === MODE.INIT ? '初始化系统密码' : '欢迎回来'))
const subtitle = computed(() =>
  mode.value === MODE.INIT
    ? '首次启动，请为管理员设置一个安全的访问密码'
    : '使用管理员密码进入 AI 小说工作台',
)
const submitText = computed(() => (mode.value === MODE.INIT ? '设置密码并登录' : '登 录'))

// 提交按钮可用条件：
// 1. 没有正在提交
// 2. 密码至少 6 位（基础安全约束）
// 3. 初始化模式下两次密码必须一致
const canSubmit = computed(() => {
  if (submitting.value) return false
  if (!form.password || form.password.length < 6) return false
  if (mode.value === MODE.INIT && form.password !== form.confirm) return false
  return true
})

// ───── 首屏：调用 GET /login/initial-password 判定模式 ─────
async function detectMode() {
  checking.value = true
  errorMsg.value = ''
  try {
    const res = await checkInitialPassword()
    // 后端约定：data.initialized=true 表示已存在密码
    const initialized = res?.data?.initialized
    mode.value = initialized ? MODE.LOGIN : MODE.INIT
  } catch (e) {
    // 接口异常时不强行选择模式，沿用默认 LOGIN 并提示用户
    errorMsg.value = e?.message || '无法连接服务，请稍后重试'
  } finally {
    checking.value = false
  }
}

// ───── 提交：根据当前模式调对应接口，并对业务 code 做兜底 ─────
async function onSubmit() {
  if (!canSubmit.value) return
  errorMsg.value = ''
  submitting.value = true
  try {
    // 1) 初始化模式：先调 POST /login/password
    if (mode.value === MODE.INIT) {
      const initRes = await setInitialPassword(form.password)
      // 业务码 1001：后端告知密码已经设置 → 强制切回登录模式
      if (initRes?.code === LoginCode.PASSWORD_ALREADY_SET) {
        mode.value = MODE.LOGIN
        errorMsg.value = '系统密码已存在，请直接登录'
        return
      }
      if (initRes?.code !== LoginCode.SUCCESS) {
        errorMsg.value = initRes?.msg || '初始化失败，请重试'
        return
      }
      // 初始化成功后继续走登录流程，给用户「一键完成」的体验
    }

    // 2) 登录：POST /login
    const loginRes = await auth.login(form.password)
    // 业务码 1000：后端告知尚未初始化 → 切回初始化模式
    if (loginRes?.code === LoginCode.NO_INITIAL_PASSWORD) {
      mode.value = MODE.INIT
      errorMsg.value = '系统尚未初始化，请先设置初始密码'
      return
    }
    if (loginRes?.code !== LoginCode.SUCCESS) {
      errorMsg.value = loginRes?.msg || '登录失败，请检查密码'
      return
    }

    // 3) 登录成功：回跳 query.redirect 指向的页面，缺省进首页
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    router.replace(redirect)
  } catch (e) {
    // HTTP/网络层异常（已被 http.js 归一化）
    errorMsg.value = e?.message || '请求异常，请稍后再试'
  } finally {
    submitting.value = false
  }
}

// 组件挂载后立即检测系统状态
onMounted(detectMode)
</script>

<template>
  <!-- v-pointer-glow 写入 --gx/--gy 等变量到根元素，
       供下面的 .cursor-spot / .card 等子层用 radial-gradient 消费。
       页面级反馈：整屏跟随的柔和光斑（cursor-spot）。 -->
  <main v-pointer-glow class="login-page">
    <!-- 背景装饰层：三个高斯模糊光斑 + 网格叠加，纯 CSS 实现，不影响交互 -->
    <div class="bg-decor">
      <span class="blob blob-a"></span>
      <span class="blob blob-b"></span>
      <span class="blob blob-c"></span>
      <div class="grid-overlay"></div>
      <!-- 跟随鼠标的全屏柔光：消费 .login-page 上 --gx/--gy（相对页面） -->
      <div class="cursor-spot" aria-hidden="true"></div>
    </div>

    <!-- 左侧 hero：品牌、Slogan、卖点 -->
    <section class="hero">
      <header class="brand">
        <!-- 品牌 logo：内联 SVG（一本展开的书+下划线），无外部资源依赖 -->
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="28" height="28">
            <path
              d="M6 4h14a6 6 0 0 1 6 6v18l-6-4-7 4-7-4z"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linejoin="round"
            />
            <path
              d="M11 11h10M11 16h10M11 21h6"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </span>
        <span class="brand-name">Novels<span>·</span>AI</span>
      </header>

      <div class="hero-copy">
        <h1>
          让灵感<span class="accent">无限延展</span><br />
          让故事<span class="accent">自然生长</span>
        </h1>
        <p>为创作者打造的 AI 小说工作台，沉浸式写作 · 智能续写 · 角色与世界观协同。</p>

        <!-- 卖点列表：作为信任背书，避免左侧空旷 -->
        <ul class="feature-list">
          <li><i></i>多模型协同：剧情、人设、对白分轨生成</li>
          <li><i></i>世界观沙盒：角色与设定可被精准引用</li>
          <li><i></i>一键润色：风格化重写与版本对照</li>
        </ul>
      </div>

      <footer class="hero-foot">© {{ new Date().getFullYear() }} Novels · AI Studio</footer>
    </section>

    <!-- 右侧表单卡片
         单独再挂一个 v-pointer-glow.tilt，让卡片读自己内部坐标，
         实现「微倾斜 + 卡内高光」的局部反馈，不依赖外层。 -->
    <section class="panel">
      <!-- is-init 类只在初始化模式生效，可用于细微的视觉反馈 -->
      <div
        v-pointer-glow.tilt="{ maxTilt: 5 }"
        class="card"
        :class="{ 'is-init': mode === MODE.INIT }"
      >
        <div class="card-head">
          <p class="eyebrow">{{ mode === MODE.INIT ? 'FIRST RUN' : 'SIGN IN' }}</p>
          <h2>{{ title }}</h2>
          <p class="sub">{{ subtitle }}</p>
        </div>

        <form class="card-form" @submit.prevent="onSubmit">
          <!-- 密码字段 -->
          <label class="field">
            <span class="field-label">{{ mode === MODE.INIT ? '设置密码' : '管理员密码' }}</span>
            <div class="field-control">
              <input
                v-model="form.password"
                :type="showPwd ? 'text' : 'password'"
                :placeholder="mode === MODE.INIT ? '至少 6 位，建议包含字母与数字' : '请输入密码'"
                autocomplete="current-password"
                :disabled="checking || submitting"
              />
              <!-- 明文/密文切换按钮，按钮 type=button 防止触发 form submit -->
              <button
                type="button"
                class="eye"
                :aria-label="showPwd ? '隐藏密码' : '显示密码'"
                @click="showPwd = !showPwd"
              >
                {{ showPwd ? '隐藏' : '显示' }}
              </button>
            </div>
          </label>

          <!-- 确认密码：仅初始化模式出现 -->
          <label v-if="mode === MODE.INIT" class="field">
            <span class="field-label">确认密码</span>
            <div class="field-control">
              <input
                v-model="form.confirm"
                :type="showPwd2 ? 'text' : 'password'"
                placeholder="再次输入以确认"
                autocomplete="new-password"
                :disabled="submitting"
              />
              <button
                type="button"
                class="eye"
                :aria-label="showPwd2 ? '隐藏密码' : '显示密码'"
                @click="showPwd2 = !showPwd2"
              >
                {{ showPwd2 ? '隐藏' : '显示' }}
              </button>
            </div>
            <!-- 实时校验：两次输入不一致时立刻提示，不必等点提交 -->
            <span v-if="form.confirm && form.confirm !== form.password" class="field-hint error"
              >两次输入的密码不一致</span
            >
          </label>

          <!-- 顶部错误条（含网络异常 + 业务错误） -->
          <p v-if="errorMsg" class="form-error" role="alert">{{ errorMsg }}</p>

          <!-- 提交按钮：禁用条件由 canSubmit 决定 -->
          <button class="submit" type="submit" :disabled="!canSubmit">
            <span v-if="submitting" class="loader" aria-hidden="true"></span>
            <span>{{ submitting ? '处理中…' : submitText }}</span>
          </button>

          <!-- 底部辅助文案：随状态变化 -->
          <p v-if="checking" class="checking-tip">正在检测系统状态…</p>
          <p v-else-if="mode === MODE.INIT" class="footer-tip">
            初始化完成后将自动登录，请妥善保管密码——它无法找回。
          </p>
          <p v-else class="footer-tip">忘记密码？请联系系统管理员重置数据库凭据。</p>
        </form>
      </div>
    </section>
  </main>
</template>

<style scoped>
/* ─── 整体布局：左右双栏；左侧权重稍大留给品牌，右侧固定卡片宽度 ─── */
.login-page {
  position: relative;
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(440px, 0.9fr);
  /* 主色调：左上紫蓝 → 中间深蓝 → 右下近黑，形成自然光感 */
  background: radial-gradient(120% 80% at 0% 0%, #1b1f4a 0%, #0b0f24 55%, #06070f 100%);
  color: #e7e9f5;
  overflow: hidden;
  font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}

/* ─── 背景装饰：模糊光斑 + 细网格，制造科幻/灵感氛围 ─── */
.bg-decor {
  position: absolute;
  inset: 0;
  pointer-events: none; /* 装饰层不能拦截鼠标 */
}
.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px); /* 90px 模糊形成柔和光斑 */
  opacity: 0.55;
  mix-blend-mode: screen; /* screen 混合模式让光斑相互叠加更亮 */
  animation: float 18s ease-in-out infinite; /* 缓慢漂浮，避免抢戏 */
}
.blob-a {
  width: 520px;
  height: 520px;
  left: -120px;
  top: -120px;
  background: radial-gradient(circle, #6c5cff 0%, transparent 60%);
}
.blob-b {
  width: 460px;
  height: 460px;
  right: -80px;
  top: 18%;
  background: radial-gradient(circle, #00d4ff 0%, transparent 60%);
  animation-delay: -6s; /* 错峰运动，避免三个光斑同步 */
}
.blob-c {
  width: 580px;
  height: 580px;
  left: 30%;
  bottom: -200px;
  background: radial-gradient(circle, #ff6dd6 0%, transparent 60%);
  animation-delay: -12s;
}
/* 半透明网格：用 mask 让中心实、边缘虚，形成「视觉聚焦」 */
.grid-overlay {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(ellipse at 50% 50%, #000 30%, transparent 80%);
}
@keyframes float {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(40px, -30px, 0) scale(1.08);
  }
}

/* ─── 指针跟随的全屏柔光 ───
   .login-page 由 v-pointer-glow 注入 --gx/--gy（相对该元素，即整页）。
   这里用一个铺满 bg-decor 的 div，radial-gradient 圆心绑定 (var(--gx), var(--gy))，
   形成「鼠标走到哪儿，那块就微微发亮」的全息感。
   · 600px 大半径 + 低透明度，确保不抢主视觉
   · screen 混合让光斑能与下方紫蓝渐变叠加更亮，而非简单覆盖 */
.cursor-spot {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    600px circle at var(--gx, 50%) var(--gy, 50%),
    rgba(123, 108, 255, 0.18) 0%,
    rgba(0, 212, 255, 0.08) 35%,
    transparent 65%
  );
  mix-blend-mode: screen;
  /* 用 opacity 缓动可以让光斑出现 / 消失更顺滑（mouseleave 时 --gxr 回中心，
     但若整页不希望「永远有光」，可在此切到 0；当前页面期望常驻效果，保留 1） */
  opacity: 1;
  transition: opacity 0.4s ease;
}

/* ─── 左侧 hero 区 ─── */
.hero {
  position: relative;
  padding: 56px 80px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
/* 品牌 logo 容器：渐变色填充 + 阴影，营造发光质感 */
.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: linear-gradient(135deg, #7b6cff, #00d4ff);
  color: #0b0f24;
  box-shadow: 0 12px 30px rgba(123, 108, 255, 0.4);
}
.brand-name {
  font-size: 20px;
}
.brand-name span {
  opacity: 0.5;
  margin: 0 4px;
}

/* 主标题：clamp 让字号随视口自适应，避免极大屏过小或小屏溢出 */
.hero-copy h1 {
  font-size: clamp(40px, 4.4vw, 64px);
  line-height: 1.15;
  margin: 0 0 24px;
  font-weight: 700;
  letter-spacing: 0.01em;
}
/* accent：渐变文字，用 background-clip:text 实现 */
.accent {
  background: linear-gradient(120deg, #00e6ff, #b78bff 60%, #ff8fd1);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero-copy p {
  max-width: 520px;
  line-height: 1.75;
  color: rgba(231, 233, 245, 0.72);
  font-size: 16px;
}
.feature-list {
  margin: 40px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.feature-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgba(231, 233, 245, 0.82);
  font-size: 15px;
}
/* 小圆点用渐变 + 阴影模拟发光效果，比纯色更精致 */
.feature-list i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: linear-gradient(135deg, #7b6cff, #00d4ff);
  box-shadow: 0 0 12px rgba(123, 108, 255, 0.7);
}

.hero-foot {
  font-size: 12px;
  letter-spacing: 0.08em;
  color: rgba(231, 233, 245, 0.4);
}

/* ─── 右侧表单面板 ─── */
.panel {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 64px;
  /* 给卡片一个 3D 透视舞台：值越大透视越「平」，1000px 是较自然的选择 */
  perspective: 1000px;
}
/* 玻璃质感卡片：半透明背景 + backdrop-filter 模糊 */
.card {
  position: relative;
  width: 100%;
  max-width: 440px;
  padding: 44px 40px 36px;
  border-radius: 24px;
  background: rgba(15, 19, 44, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(22px) saturate(160%);
  -webkit-backdrop-filter: blur(22px) saturate(160%); /* Safari 兼容 */
  box-shadow:
    0 30px 80px rgba(2, 4, 18, 0.55),
    /* 大投影制造悬浮感 */ inset 0 1px 0 rgba(255, 255, 255, 0.08); /* 顶部高光线 */
  /* 微倾斜由 v-pointer-glow.tilt 写入 --tilt-x/--tilt-y；
     默认 0deg，鼠标进入卡片范围才会响应。
     translateZ(0) 提升到独立合成层，避免每帧重绘父级。 */
  transform: rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg)) translateZ(0);
  transform-style: preserve-3d;
  transition:
    transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1),
    box-shadow 0.3s ease;
}
/* 鼠标悬浮时给卡片更深的投影 + 上抬，让"立体感"更明显 */
.card:hover {
  box-shadow:
    0 40px 100px rgba(2, 4, 18, 0.65),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
/* 卡片渐变边框：用伪元素铺渐变 + mask 挖空内部，实现单层 1px 渐变描边 */
.card::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 25px;
  padding: 1px;
  background: linear-gradient(
    135deg,
    rgba(123, 108, 255, 0.6),
    transparent 40%,
    rgba(0, 212, 255, 0.45)
  );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}
.card.is-init {
  transform: rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg)) translateY(-2px); /* 初始化模式微抬，暗示「特殊状态」 */
}

/* 指针跟随高光：卡片内部 radial-gradient 圆心绑定 --gx/--gy。
   hover 时 opacity 0→1 缓动，离开后回落，避免「贴纸」感。
   z-index 必须小于内容（content 默认 z=auto，相邻同层后写者居上，
   这里用 inherit 让 ::after 进入 stacking context 但显式拉到 0，
   再给 .card 的子元素 position:relative + z>0 即可压住）。 */
.card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(
    320px circle at var(--gx, 50%) var(--gy, 50%),
    rgba(0, 230, 255, 0.16) 0%,
    rgba(123, 108, 255, 0.08) 35%,
    transparent 70%
  );
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.35s ease;
  z-index: 0;
}
.card:hover::after {
  opacity: 1;
}
/* 让卡片内的所有直接子元素都在 ::after 之上，避免高光把字盖掉 */
.card > * {
  position: relative;
  z-index: 1;
}

.eyebrow {
  margin: 0 0 8px;
  font-size: 12px;
  letter-spacing: 0.32em;
  color: rgba(0, 230, 255, 0.7);
}
.card-head h2 {
  margin: 0 0 6px;
  font-size: 26px;
  font-weight: 600;
}
.card-head .sub {
  margin: 0 0 28px;
  font-size: 14px;
  color: rgba(231, 233, 245, 0.6);
  line-height: 1.6;
}

.card-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.field-label {
  font-size: 13px;
  letter-spacing: 0.04em;
  color: rgba(231, 233, 245, 0.7);
}
/* 输入框外壳：聚焦时显示青色光环 */
.field-control {
  position: relative;
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background 0.2s ease;
}
.field-control:focus-within {
  border-color: rgba(0, 212, 255, 0.7);
  background: rgba(0, 212, 255, 0.06);
  box-shadow: 0 0 0 4px rgba(0, 212, 255, 0.12); /* 外发光环 */
}
.field-control input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  padding: 14px 16px;
  font-size: 15px;
  color: #fff;
  letter-spacing: 0.02em;
}
.field-control input::placeholder {
  color: rgba(231, 233, 245, 0.35);
}
.eye {
  background: transparent;
  border: none;
  color: rgba(231, 233, 245, 0.55);
  cursor: pointer;
  padding: 0 14px;
  font-size: 13px;
  transition: color 0.2s ease;
}
.eye:hover {
  color: #fff;
}
.field-hint {
  font-size: 12px;
  color: rgba(231, 233, 245, 0.5);
}
.field-hint.error {
  color: #ff7aa2;
}

/* 错误条：低饱和度红，避免视觉过于刺眼 */
.form-error {
  margin: 0;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 80, 120, 0.12);
  border: 1px solid rgba(255, 80, 120, 0.3);
  color: #ffb3c4;
  font-size: 13px;
}

/* 主按钮：渐变背景 + 阴影，hover 时上浮 1px 模拟实体感 */
.submit {
  margin-top: 6px;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px 16px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(120deg, #7b6cff, #00d4ff);
  color: #06070f;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.08em;
  cursor: pointer;
  box-shadow:
    0 18px 40px rgba(123, 108, 255, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    opacity 0.2s ease;
}
.submit:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    0 24px 50px rgba(123, 108, 255, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
}
.submit:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  box-shadow: none;
}
/* 提交按钮内的转圈 loader */
.loader {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(6, 7, 15, 0.4);
  border-top-color: #06070f;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.checking-tip,
.footer-tip {
  margin: 4px 0 0;
  font-size: 12px;
  color: rgba(231, 233, 245, 0.45);
  text-align: center;
  letter-spacing: 0.02em;
}

/* 窄屏（侧屏、半屏、平板横屏）兼容：双栏退化为单栏 */
@media (max-width: 1024px) {
  .login-page {
    grid-template-columns: 1fr;
  }
  .hero {
    padding: 40px 32px 0;
  }
  .panel {
    padding: 32px 24px 48px;
  }
}
</style>
