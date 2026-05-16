// ============================================================================
// http.js —— 全局 axios 实例
// ----------------------------------------------------------------------------
// 设计要点：
// 1. baseURL 默认走相对路径 /api/v1，配合 vite.config.js 的 proxy 转发到后端
//    localhost:8080，避免在前端代码中写死后端地址，方便环境切换。
// 2. 响应拦截器只直接返回 response.data（即后端 common.Response 结构体），
//    让调用方写 const { code, data, msg } = await xxx() 更简洁。
// 3. 业务码（code != 0）不在拦截器内当作错误处理，交给调用方根据业务码分流，
//    例如登录失败 code=1000 / 初始密码已设置 code=1001 等都属于业务流转。
// ============================================================================

import axios from 'axios'

// 创建 axios 实例：所有请求共享 baseURL、超时、默认 JSON 头
const http = axios.create({
  // 优先读环境变量，便于线上使用 .env 注入；缺省走 vite proxy
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器：若本地已存在 token，则自动附加 Authorization 头
http.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('novels_ai_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error),
)

// 响应拦截器：
// - 成功：剥掉 axios 外壳，直接返回后端 body（common.Response）
// - 失败：将 HTTP/网络层错误归一化为 { status, message, raw }，
//   让上层 UI 可统一展示，避免到处写 error.response?.data?.msg。
http.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const status = error.response?.status
    const message =
      error.response?.data?.msg ||
      error.message ||
      (status >= 500 ? '服务异常，请稍后再试' : '网络异常，请检查连接')
    return Promise.reject({ status, message, raw: error.response?.data })
  },
)

export default http
