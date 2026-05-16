// ============================================================================
// auth.js —— 全局登录态 Pinia store
// ----------------------------------------------------------------------------
// 使用 Pinia 的 setup-style 写法（与 Vue 3 Composition API 风格一致）：
//   - state  → ref()
//   - getter → computed()
//   - action → 普通函数
// 持久化策略：token 同步写入 localStorage，刷新页面后仍能保持登录态。
// ============================================================================

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { login as loginApi } from '@/api/login'

// localStorage 中保存 token 用的 key，单独提为常量避免拼写错误
const TOKEN_KEY = 'novels_ai_token'

export const useAuthStore = defineStore('auth', () => {
  // token：初始化时从 localStorage 恢复，避免刷新后丢登录态
  const token = ref(localStorage.getItem(TOKEN_KEY) || '')

  // 是否已登录：只看 token 是否存在
  const isLoggedIn = computed(() => Boolean(token.value))

  // 统一收口 token 的写入/清除，同时同步 localStorage
  function setToken(value) {
    token.value = value || ''
    if (value) {
      localStorage.setItem(TOKEN_KEY, value)
    } else {
      localStorage.removeItem(TOKEN_KEY)
    }
  }

  // 执行登录：成功后写入 token；token 字段名后端如尚未约定，先用占位
  // 后端正式返回 token 后只改这里这一行，组件层完全无感
  async function login(password) {
    const res = await loginApi(password)
    if (res?.code === 0) {
      const next = res.data?.token || `session-${Date.now()}`
      setToken(next)
    }
    // 把后端原始响应抛回去，让组件根据 code 做更精细的分流（例如 code=1000）
    return res
  }

  // 退出登录：清空 token + localStorage
  function logout() {
    setToken('')
  }

  return { token, isLoggedIn, login, logout, setToken }
})
