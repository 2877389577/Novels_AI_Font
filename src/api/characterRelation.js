// ============================================================================
// characterRelation.js —— 小说角色关系图相关接口封装
// ----------------------------------------------------------------------------
// 接口契约（来自 Apifox / OpenAPI）：
//   GET    /novels/{id}/character-relation-graph
//          查询某本小说的角色关系图，返回 Vue Flow 可直接消费的 nodes / edges。
//
//   PUT    /novels/{id}/character-relation-graph/nodes/layout
//          批量保存角色节点在画布中的位置、尺寸、隐藏状态和样式扩展。
//
//   POST   /novels/{id}/character-relations
//          新增一条角色关系，source / target 分别对应 Vue Flow 的连线两端。
//
//   DELETE /novels/{id}/character-relations/{relationId}
//          删除指定角色关系，删除后关系图 edges 不再展示该连线。
//
// 与项目既有 API 层约定保持一致：这里只封装路径和 HTTP 方法，
// 后端业务码 code 继续由页面组件根据交互场景展示 toast 或状态。
// ============================================================================

import http from './http'

// 查询角色关系图。后端返回的 data.nodes / data.edges 已按 Vue Flow 结构组织。
export function getCharacterRelationGraph(novelId) {
  return http.get(`/novels/${novelId}/character-relation-graph`)
}

// 保存节点布局。nodes 至少包含 characterId、positionX、positionY。
export function saveCharacterRelationNodeLayouts(novelId, nodes) {
  return http.put(`/novels/${novelId}/character-relation-graph/nodes/layout`, { nodes })
}

// 新增角色关系。relationLabel 用于画布连线标签，relationType 用于后端分类去重。
export function createCharacterRelation(novelId, payload) {
  return http.post(`/novels/${novelId}/character-relations`, payload)
}

// 删除角色关系。后端执行软删除，前端成功后从当前画布移除对应边。
export function deleteCharacterRelation(novelId, relationId) {
  return http.delete(`/novels/${novelId}/character-relations/${relationId}`)
}
