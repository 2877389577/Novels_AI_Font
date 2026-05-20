// ============================================================================
// character.js —— 小说角色卡相关接口封装
// ----------------------------------------------------------------------------
// 接口契约（来自 Apifox / OpenAPI；列表项 id 已由用户确认是文档遗漏）：
//   GET    /novels/{id}/characters
//          分页查询某本小说的角色列表（列表项只含摘要字段）
//          query: page, pageSize（默认 1 / 10，pageSize 上限 100）
//          data:  { items: CharacterListItem[], page, pageSize, total }
//
//   POST   /novels/{id}/characters
//          新增角色，name 必填，其余字段选填
//          body: { name*, gender, status, appearanceImgUrl, charactersTags,
//                  intro, appearance, personality, background, ability,
//                  motivation, plotDirection, firstAppearanceChapterId }
//
//   GET    /novels/{id}/characters/{characterId}
//          查询角色完整资料（详情页 / 编辑前回填使用）
//
//   PUT    /novels/{id}/characters/{characterId}
//          局部更新角色资料，body 字段均可选
//
//   DELETE /novels/{id}/characters/{characterId}
//          软删除指定角色
//
// 与现有 chapter.js 保持一致：API 层只负责路径与 HTTP 方法，业务码 code
// 仍交给页面组件按场景分流，避免在拦截器里吞掉后端业务语义。
// ============================================================================

import http from './http'

// 分页查询某本小说的角色列表（列表项含 id/name/gender/status/tags/image 等摘要字段）
// @param {number} novelId
// @param {{ page?: number, pageSize?: number }} params
export function listCharacters(novelId, params = {}) {
  return http.get(`/novels/${novelId}/characters`, { params })
}

// 查询单个角色完整资料，用于右侧详情面板与编辑表单回填
export function getCharacter(novelId, characterId) {
  return http.get(`/novels/${novelId}/characters/${characterId}`)
}

// 新增角色卡，name 必填，其余字段按页面表单结果传入
export function createCharacter(novelId, payload) {
  return http.post(`/novels/${novelId}/characters`, payload)
}

// 更新角色卡，后端支持局部更新；页面会按当前表单构造 payload
export function updateCharacter(novelId, characterId, payload) {
  return http.put(`/novels/${novelId}/characters/${characterId}`, payload)
}

// 删除角色卡（软删），删除成功后由页面刷新列表或本地移除
export function deleteCharacter(novelId, characterId) {
  return http.delete(`/novels/${novelId}/characters/${characterId}`)
}
