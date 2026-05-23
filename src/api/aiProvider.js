// ============================================================================
// aiProvider.js —— AI 提供商相关接口封装
// ----------------------------------------------------------------------------
// 接口契约（来自 Apifox / OpenAPI）：
//   GET    /ai-providers       分页查询 AI 提供商列表
//                              query: page, pageSize（默认 1 / 10，pageSize 上限 100）
//                              data: { items, page, pageSize, total }
//   POST   /ai-providers       新增 AI 提供商
//                              body: { name*, providerType*, baseUrl*, apiKey*,
//                                      configJson, isEnabled, models,
//                                      maxContextLength, maxInputTokens, maxOutputTokens }
//   POST   /ai-providers/models/query
//                              查询当前连接信息可用的模型列表
//                              body: { baseUrl*, apiKey* }
//   GET    /ai-providers/{id}  查询单个 AI 提供商详情，详情响应会返回解密后的 apiKey
//   PUT    /ai-providers/{id}  更新 AI 提供商；当前后端要求 apiKey/baseUrl/name/providerType，
//                              因此编辑弹窗需要先读详情并回填明文 apiKey。
//   DELETE /ai-providers/{id}  按 ID 删除 AI 提供商
//
// API 层只负责路径与 HTTP 方法，不在这里处理业务码 code。
// 调用方按页面场景决定 code !== 0 时如何提示用户，保持和现有 novel/character API 一致。
// ============================================================================

import http from './http'

// 分页查询 AI 提供商列表。
// @param {{ page?: number, pageSize?: number }} params
export function listAIProviders(params = {}) {
  return http.get('/ai-providers', { params })
}

// 查询单个 AI 提供商详情；该接口会返回解密后的 apiKey，页面必须默认遮罩展示。
export function getAIProvider(id) {
  return http.get(`/ai-providers/${id}`)
}

// 新增 AI 提供商；name/providerType/baseUrl/apiKey 为后端必填字段。
export function createAIProvider(payload) {
  return http.post('/ai-providers', payload)
}

// 查询 AI 提供商支持的模型列表；只使用当前表单里的连接信息，不会写入数据库。
export function queryAIProviderModels(payload) {
  return http.post('/ai-providers/models/query', payload)
}

// 更新 AI 提供商；后端支持局部更新，apiKey 仅在用户显式填写新值时传入。
export function updateAIProvider(id, payload) {
  return http.put(`/ai-providers/${id}`, payload)
}

// 删除 AI 提供商。
export function deleteAIProvider(id) {
  return http.delete(`/ai-providers/${id}`)
}
