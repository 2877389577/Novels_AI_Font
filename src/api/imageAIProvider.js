// ============================================================================
// imageAIProvider.js —— 生图 AI 提供商相关接口封装
// ----------------------------------------------------------------------------
// 接口契约（来自 Apifox / OpenAPI）：
//   GET    /image-ai-providers       分页查询生图 AI 提供商列表
//                                      query: page, pageSize
//   POST   /image-ai-providers       新增生图 AI 提供商
//                                      body: { name*, providerType*, baseUrl*, apiKey*,
//                                              defaultModel*, models, isEnabled, configJson }
//   POST   /image-ai-providers/enable 一键启用指定生图 AI 提供商
//                                      body: { id* }
//   GET    /image-ai-providers/{id}  查询详情，详情响应会返回解密后的 apiKey
//   PUT    /image-ai-providers/{id}  全量更新生图 AI 提供商
//   DELETE /image-ai-providers/{id}  按 ID 删除生图 AI 提供商
//
// API 层只负责路径与 HTTP 方法，不处理业务码 code。
// ============================================================================

import http from './http'

// 分页查询生图 AI 提供商列表。
export function listImageAIProviders(params = {}) {
  return http.get('/image-ai-providers', { params })
}

// 查询单个生图 AI 提供商详情；该接口会返回解密后的 apiKey，页面必须默认遮罩展示。
export function getImageAIProvider(id) {
  return http.get(`/image-ai-providers/${id}`)
}

// 新增生图 AI 提供商；defaultModel 必须来自 models 列表。
export function createImageAIProvider(payload) {
  return http.post('/image-ai-providers', payload)
}

// 一键启用指定生图 AI 提供商；后端会关闭其它已启用的生图提供商。
export function enableImageAIProvider(id) {
  return http.post('/image-ai-providers/enable', { id })
}

// 更新生图 AI 提供商；后端按全量字段校验。
export function updateImageAIProvider(id, payload) {
  return http.put(`/image-ai-providers/${id}`, payload)
}

// 删除生图 AI 提供商。
export function deleteImageAIProvider(id) {
  return http.delete(`/image-ai-providers/${id}`)
}
