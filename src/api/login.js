// ============================================================================
// login.js —— 登录相关接口封装
// ----------------------------------------------------------------------------
// 接口契约（来自 Apifox / OpenAPI）：
//   GET  /login/initial-password   检查初始密码是否已设置
//                                  返回 data.initialized: boolean
//   POST /login/password           设置初始密码（仅管理员密码为空时允许）
//                                  请求体：{ password: string }
//                                  code=0 成功；code=1001 密码已设置
//   POST /login                    使用密码登录
//                                  请求体：{ password: string }
//                                  code=0 成功；code=1000 无初始密码
// ============================================================================

import http from './http'

// 把魔法数字业务码集中成常量，方便 IDE 跳转 + 避免分散到处的 if (code === 1000)
export const LoginCode = {
  SUCCESS: 0,
  NO_INITIAL_PASSWORD: 1000, // 登录时遇到：系统尚未初始化
  PASSWORD_ALREADY_SET: 1001, // 初始化时遇到：密码已经被设置过
}

// 查询系统是否已初始化管理员密码
// 用于登录页首屏判定显示「初始化密码」表单还是「正常登录」表单
export function checkInitialPassword() {
  return http.get('/login/initial-password')
}

// 设置初始密码（仅在首次启动、管理员密码为空时可成功）
export function setInitialPassword(password) {
  return http.post('/login/password', { password })
}

// 使用密码登录
export function login(password) {
  return http.post('/login', { password })
}
