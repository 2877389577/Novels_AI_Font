// ============================================================================
// chapter.js —— 小说章节相关接口封装
// ----------------------------------------------------------------------------
// 接口契约（来自 Apifox / OpenAPI 真实拉取）：
//   GET    /novels/{id}/chapters
//          分页查询某本小说的章节列表（列表项不含 content，只返回摘要字段）
//          query: page, pageSize（默认 1 / 10，pageSize 上限 100）
//          data:  { items: ChapterListItem[], page, pageSize, total }
//
//   GET    /novels/{id}/chapters/next-no
//          查询下一章建议编号（max(chapterNo)+1，仅用于新增页顶部显示）
//          data:  { chapterNo: integer }
//
//   GET    /novels/{id}/chapters/{chapterId}
//          查询单章详情（含 content 大文本）
//          data:  { id, novelId, chapterNo, title, content, wordCount, createdAt, updatedAt }
//
//   POST   /novels/{id}/chapters
//          新增章节
//          body 四字段全部必填: { chapterNo, title, content, wordCount }
//          409: 章节编号已存在
//
//   PUT    /novels/{id}/chapters/{chapterId}
//          局部更新章节，字段全可选
//          body: { chapterNo?, title?, content?, wordCount? }
//          409: 章节编号已存在
//
//   DELETE /novels/{id}/chapters/{chapterId}
//          软删除章节，并同步扣减小说总字数
//
// 与 updateNovel 的差异：本组接口的 id / chapterId 全部走 path，参数语义
// 与 OAS 文档一一对应，**不存在 updateNovel 那种 path-vs-body 矛盾**。
// 所有接口依赖登录态（401 未登录），由后端 session cookie + 路由守卫保护。
// ============================================================================

import http from './http'

// 分页查询某本小说的章节列表（列表项不含 content）
// @param {number} novelId
// @param {{ page?: number, pageSize?: number }} params
export function listChapters(novelId, params = {}) {
  return http.get(`/novels/${novelId}/chapters`, { params })
}

// 查询下一章建议编号（仅用于新增页顶部显示）
export function getNextChapterNo(novelId) {
  return http.get(`/novels/${novelId}/chapters/next-no`)
}

// 查询单个章节详情（含 content）
export function getChapter(novelId, chapterId) {
  return http.get(`/novels/${novelId}/chapters/${chapterId}`)
}

// 新建章节：chapterNo / title / content / wordCount 四字段全部必填
export function createChapter(novelId, payload) {
  return http.post(`/novels/${novelId}/chapters`, payload)
}

// 更新章节（局部更新：传啥改啥）
export function updateChapter(novelId, chapterId, payload) {
  return http.put(`/novels/${novelId}/chapters/${chapterId}`, payload)
}

// 删除章节（软删，扣减小说总字数）
export function deleteChapter(novelId, chapterId) {
  return http.delete(`/novels/${novelId}/chapters/${chapterId}`)
}
