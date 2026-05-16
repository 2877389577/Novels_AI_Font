// ============================================================================
// auth.js —— 全局登录态 Pinia store
// ----------------------------------------------------------------------------
// 鉴权模型（本项目特有）：
//   后端用 Session + Cookie 管理登录态，**前端不持有 token**。
//   本 store 仅维护一个「是否已登录」的标记，用于路由守卫与 UI 显示。
//   真正的鉴权全靠 axios 带上 session cookie 后由后端校验。
//
// 持久化策略：
//   用 sessionStorage 而非 localStorage —— 关闭浏览器时自动清空，与后端
//   session 的寿命一致，避免出现「前端以为登录、后端 session 已失效」的错位。
//   刷新页面（不关浏览器）时仍能恢复登录态，符合直觉。
// ============================================================================

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { login as loginApi } from '@/api/login'

// sessionStorage 中保存登录标记用的 key
const LOGGED_FLAG_KEY = 'novels_ai_logged_in'

export const useAuthStore = defineStore('auth', () => {
  // 登录标记：初始化时从 sessionStorage 恢复，避免刷新页面后误判为未登录
  const loggedFlag = ref(sessionStorage.getItem(LOGGED_FLAG_KEY) === '1')

  // 是否已登录：仅看本地标记；真鉴权由后端 cookie 完成
  const isLoggedIn = computed(() => loggedFlag.value)

  // 统一收口标记的写入/清除，同时同步 sessionStorage
  function setLoggedIn(value) {
    loggedFlag.value = Boolean(value)
    if (value) {
      sessionStorage.setItem(LOGGED_FLAG_KEY, '1')
    } else {
      sessionStorage.removeItem(LOGGED_FLAG_KEY)
    }
  }

  // 执行登录：成功后置位本地标记，后端会通过 Set-Cookie 下发 session
  async function login(password) {
    const res = await loginApi(password)
    if (res?.code === 0) {
      setLoggedIn(true)
    }
    // 把后端原始响应抛回去，让组件根据 code 做更精细的分流（例如 code=1000）
    return res
  }

  // 退出登录：清空本地标记
  // 注：真正的 session 失效应由后端登出接口完成；当前后端尚未提供该接口，
  // 仅清前端标记即可让路由守卫拦截后续访问。
  function logout() {
    setLoggedIn(false)
  }

  return { isLoggedIn, login, logout, setLoggedIn }
})
