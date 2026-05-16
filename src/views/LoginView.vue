<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import {
  LoginCode,
  checkInitialPassword,
  setInitialPassword,
} from '@/api/login'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const MODE = { LOGIN: 'login', INIT: 'init' }

const mode = ref(MODE.LOGIN)
const checking = ref(true)
const submitting = ref(false)
const errorMsg = ref('')
const showPwd = ref(false)
const showPwd2 = ref(false)

const form = reactive({
  password: '',
  confirm: '',
})

const title = computed(() =>
  mode.value === MODE.INIT ? '初始化系统密码' : '欢迎回来',
)
const subtitle = computed(() =>
  mode.value === MODE.INIT
    ? '首次启动，请为管理员设置一个安全的访问密码'
    : '使用管理员密码进入 AI 小说工作台',
)
const submitText = computed(() =>
  mode.value === MODE.INIT ? '设置密码并登录' : '登 录',
)

const canSubmit = computed(() => {
  if (submitting.value) return false
  if (!form.password || form.password.length < 6) return false
  if (mode.value === MODE.INIT && form.password !== form.confirm) return false
  return true
})

async function detectMode() {
  checking.value = true
  errorMsg.value = ''
  try {
    const res = await checkInitialPassword()
    const initialized = res?.data?.initialized
    mode.value = initialized ? MODE.LOGIN : MODE.INIT
  } catch (e) {
    errorMsg.value = e?.message || '无法连接服务，请稍后重试'
  } finally {
    checking.value = false
  }
}

async function onSubmit() {
  if (!canSubmit.value) return
  errorMsg.value = ''
  submitting.value = true
  try {
    if (mode.value === MODE.INIT) {
      const initRes = await setInitialPassword(form.password)
      if (initRes?.code === LoginCode.PASSWORD_ALREADY_SET) {
        mode.value = MODE.LOGIN
        errorMsg.value = '系统密码已存在，请直接登录'
        return
      }
      if (initRes?.code !== LoginCode.SUCCESS) {
        errorMsg.value = initRes?.msg || '初始化失败，请重试'
        return
      }
    }

    const loginRes = await auth.login(form.password)
    if (loginRes?.code === LoginCode.NO_INITIAL_PASSWORD) {
      mode.value = MODE.INIT
      errorMsg.value = '系统尚未初始化，请先设置初始密码'
      return
    }
    if (loginRes?.code !== LoginCode.SUCCESS) {
      errorMsg.value = loginRes?.msg || '登录失败，请检查密码'
      return
    }

    const redirect =
      typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    router.replace(redirect)
  } catch (e) {
    errorMsg.value = e?.message || '请求异常，请稍后再试'
  } finally {
    submitting.value = false
  }
}

onMounted(detectMode)
</script>

<template>
  <main class="login-page">
    <div class="bg-decor">
      <span class="blob blob-a"></span>
      <span class="blob blob-b"></span>
      <span class="blob blob-c"></span>
      <div class="grid-overlay"></div>
    </div>

    <section class="hero">
      <header class="brand">
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
        <p>
          为创作者打造的 AI 小说工作台，沉浸式写作 · 智能续写 · 角色与世界观协同。
        </p>

        <ul class="feature-list">
          <li><i></i>多模型协同：剧情、人设、对白分轨生成</li>
          <li><i></i>世界观沙盒：角色与设定可被精准引用</li>
          <li><i></i>一键润色：风格化重写与版本对照</li>
        </ul>
      </div>

      <footer class="hero-foot">© {{ new Date().getFullYear() }} Novels · AI Studio</footer>
    </section>

    <section class="panel">
      <div class="card" :class="{ 'is-init': mode === MODE.INIT }">
        <div class="card-head">
          <p class="eyebrow">{{ mode === MODE.INIT ? 'FIRST RUN' : 'SIGN IN' }}</p>
          <h2>{{ title }}</h2>
          <p class="sub">{{ subtitle }}</p>
        </div>

        <form class="card-form" @submit.prevent="onSubmit">
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
            <span
              v-if="form.confirm && form.confirm !== form.password"
              class="field-hint error"
            >两次输入的密码不一致</span>
          </label>

          <p v-if="errorMsg" class="form-error" role="alert">{{ errorMsg }}</p>

          <button class="submit" type="submit" :disabled="!canSubmit">
            <span v-if="submitting" class="loader" aria-hidden="true"></span>
            <span>{{ submitting ? '处理中…' : submitText }}</span>
          </button>

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
.login-page {
  position: relative;
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(440px, 0.9fr);
  background: radial-gradient(120% 80% at 0% 0%, #1b1f4a 0%, #0b0f24 55%, #06070f 100%);
  color: #e7e9f5;
  overflow: hidden;
  font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}

.bg-decor {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  opacity: 0.55;
  mix-blend-mode: screen;
  animation: float 18s ease-in-out infinite;
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
  animation-delay: -6s;
}
.blob-c {
  width: 580px;
  height: 580px;
  left: 30%;
  bottom: -200px;
  background: radial-gradient(circle, #ff6dd6 0%, transparent 60%);
  animation-delay: -12s;
}
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

/* hero */
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

.hero-copy h1 {
  font-size: clamp(40px, 4.4vw, 64px);
  line-height: 1.15;
  margin: 0 0 24px;
  font-weight: 700;
  letter-spacing: 0.01em;
}
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

/* panel */
.panel {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 64px;
}
.card {
  position: relative;
  width: 100%;
  max-width: 440px;
  padding: 44px 40px 36px;
  border-radius: 24px;
  background: rgba(15, 19, 44, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(22px) saturate(160%);
  -webkit-backdrop-filter: blur(22px) saturate(160%);
  box-shadow:
    0 30px 80px rgba(2, 4, 18, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  transition: transform 0.4s ease;
}
.card::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 25px;
  padding: 1px;
  background: linear-gradient(135deg, rgba(123, 108, 255, 0.6), transparent 40%, rgba(0, 212, 255, 0.45));
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}
.card.is-init {
  transform: translateY(-2px);
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
  box-shadow: 0 0 0 4px rgba(0, 212, 255, 0.12);
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

.form-error {
  margin: 0;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 80, 120, 0.12);
  border: 1px solid rgba(255, 80, 120, 0.3);
  color: #ffb3c4;
  font-size: 13px;
}

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
