// ============================================================================
// image.js —— AI 图片生成接口封装
// ----------------------------------------------------------------------------
// 接口契约（来自 Apifox / OpenAPI）：
//   POST /images/generate
//        使用当前已启用的专用生图 AI 提供商生成图片，并上传到对象存储。
//        body: { prompt*: string, modelName?: string }
//        未传 modelName 时，后端使用已启用生图提供商的 defaultModel。
//
// API 层只负责路径与 HTTP 方法，不处理业务码 code；调用方按 code 分流。
// ============================================================================

import http from './http'

// 根据提示词生成图片。AI 生图通常耗时较长，因此只给本请求单独放宽超时时间。
export function generateImage(payload) {
  return http.post('/images/generate', payload, {
    timeout: 180000,
  })
}
