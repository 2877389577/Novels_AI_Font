// ============================================================================
// mindMap.js —— 小说思维导图接口封装
// ----------------------------------------------------------------------------
// 接口契约（来自 Apifox / OpenAPI）：
//   GET    /novels/{id}/mind-map
//          查询小说的 SimpleMindMap 完整 JSON 数据；首次查询时后端会初始化默认根节点。
//          data: { id, novelId, mindMapData, createdAt, updatedAt }
//
//   PUT    /novels/{id}/mind-map
//          保存完整思维导图；body: { mindMapData }。
//          当前前端以 SimpleMindMap.getData(true) 作为权威持久化结构。
//
//   POST   /novels/{id}/mind-map/nodes
//          新增节点；body: { parentUid*, node*, index? }。
//
//   GET    /novels/{id}/mind-map/nodes/{nodeUid}
//          查询单个 SimpleMindMap 节点 JSON。
//
//   PUT    /novels/{id}/mind-map/nodes/{nodeUid}
//          更新指定节点的 data 字段；body: { data }。
//
//   DELETE /novels/{id}/mind-map/nodes/{nodeUid}
//          删除指定节点及其后代节点。
//
// 说明：
//   v1 编辑器采用“显式保存整图”为主流程，节点接口先完整封装，便于后续扩展为
//   单节点刷新、即时保存或冲突恢复。业务码仍由调用方按 res.code === 0 判断。
// ============================================================================

import http from './http'

// 查询小说思维导图；带时间戳避免浏览器或代理返回保存前的旧 GET 缓存。
export function getMindMap(novelId) {
  return http.get(`/novels/${novelId}/mind-map`, {
    params: { _t: Date.now() },
  })
}

// 保存完整思维导图；mindMapData 应优先传 SimpleMindMap.getData(true) 的结果。
export function saveMindMap(novelId, mindMapData) {
  return http.put(`/novels/${novelId}/mind-map`, { mindMapData })
}

// 新增思维导图节点；payload: { parentUid, node, index? }。
export function createMindMapNode(novelId, payload) {
  return http.post(`/novels/${novelId}/mind-map/nodes`, payload)
}

// 查询单个思维导图节点；nodeUid 对应 SimpleMindMap 节点 data.uid。
export function getMindMapNode(novelId, nodeUid) {
  return http.get(`/novels/${novelId}/mind-map/nodes/${encodeURIComponent(nodeUid)}`)
}

// 更新指定节点的 data 字段；data 不包含 children，避免误覆盖子树。
export function updateMindMapNode(novelId, nodeUid, data) {
  return http.put(`/novels/${novelId}/mind-map/nodes/${encodeURIComponent(nodeUid)}`, { data })
}

// 删除指定节点及其所有后代。
export function deleteMindMapNode(novelId, nodeUid) {
  return http.delete(`/novels/${novelId}/mind-map/nodes/${encodeURIComponent(nodeUid)}`)
}
