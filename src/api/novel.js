// ============================================================================
// novel.js —— 小说（书架）相关接口封装
// ----------------------------------------------------------------------------
// 接口契约（来自 Apifox / OpenAPI）：
//   GET    /novels          分页查询小说列表
//                           query: page, pageSize（默认 1 / 10，pageSize 上限 100）
//                           data: { items, page, pageSize, total }
//   POST   /novels          新增小说
//                           body: { title*, authorName, coverUrl, intro, metadata }
//                           data: 完整 novel 对象
//   GET    /novels/{id}     查询单本详情
//                           data: 完整 novel 对象
//   PUT    /novels/update   局部更新小说
//                           body: 暂按「id + 待更新字段」放在 body 内传递
//                           ⚠️ 文档矛盾点：OpenAPI 中 path 为 /novels/update（无占位符），
//                                            但 parameters 又把 id 标为 in:path；
//                                            updateNovelRequest 也是空 schema。
//                                            这里以 path 字面实现：id 与字段一起在 body，
//                                            若后端实际是 /novels/update/{id}，仅需改本文件一行。
//   DELETE /novels/{id}     按 ID 软删除
//   POST   /novels/{id}/content/optimize
//                           AI 润色用户选中的正文片段；query: modelName
//                           body: { selectedContent*, optimizeDirection? }
//                           data: { approved, optimizedContent, rejectReason }
//
// 所有接口均依赖登录态（401 未登录），由后端 session cookie + 前端路由守卫共同保护。
// ============================================================================

import http from './http'

// 分页查询小说列表
// @param {{ page?: number, pageSize?: number }} params
export function listNovels(params = {}) {
  return http.get('/novels', { params })
}

// 查询单本小说详情
export function getNovel(id) {
  return http.get(`/novels/${id}`)
}

// 新增小说（仅 title 必填）
export function createNovel(payload) {
  return http.post('/novels', payload)
}

// 更新小说（局部更新；payload 需要带上小说 id）
export function updateNovel(payload) {
  return http.put('/novels/update', payload)
}

// 删除小说（软删）
export function deleteNovel(id) {
  return http.delete(`/novels/${id}`)
}

// AI 润色用户选中的小说正文片段；后端只返回优化结果，不会直接修改章节正文。
// @param {number} novelId 小说 ID
// @param {string} modelName 当前启用 AI 提供商下选择的大模型名称
// @param {{ selectedContent: string, optimizeDirection?: string }} payload 选中文本与可选优化方向
export function optimizeNovelContent(novelId, modelName, payload) {
  return http.post(`/novels/${novelId}/content/optimize`, payload, {
    params: { modelName },
    // AI 润色需要等待上游模型返回，耗时明显高于普通 CRUD；只给本请求放宽到 180 秒。
    timeout: 180000,
  })
}
