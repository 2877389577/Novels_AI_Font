// ============================================================================
// aiTaskConfig.js —— AI 自动任务配置接口封装
// ----------------------------------------------------------------------------
// 接口契约（来自后端约定）：
//   GET  /ai-task-configs
//        查询系统中所有会“主动触发”的 AI 后台任务及其开关状态。
//        data: { items: [{ id, taskCode, taskName, description,
//                          isEnabled, createdAt, updatedAt }] }
//        注意：该列表为全量返回，没有 page / pageSize / total 等分页字段，
//             因此配置页不需要分页器，直接渲染 items 即可。
//   PUT  /ai-task-configs/{taskCode}
//        按任务编码更新单个任务的启用状态；后端只接受修改 isEnabled，
//        taskCode / taskName / description 均不可改。
//        body: { isEnabled: boolean }
//
// 与项目其它 API（novel / aiProvider 等）保持一致：
//   本层只负责“路径 + HTTP 方法”，不在这里处理业务码 code，
//   由调用方按 res.code === 0 自行分流提示，避免错误处理风格割裂。
// ============================================================================

import http from './http'

// 查询全部 AI 自动任务配置；后端一次性返回 items，无需传分页参数。
export function listAITaskConfigs() {
  return http.get('/ai-task-configs')
}

// 按任务编码更新启用状态：taskCode 作为路径参数，请求体仅包含 isEnabled。
// @param {string}  taskCode  任务编码（如 chapter_plot_analysis）
// @param {boolean} isEnabled 目标开关状态
export function updateAITaskConfig(taskCode, isEnabled) {
  return http.put(`/ai-task-configs/${taskCode}`, { isEnabled })
}
