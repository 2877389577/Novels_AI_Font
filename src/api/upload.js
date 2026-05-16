// ============================================================================
// upload.js —— 文件上传接口封装
// ----------------------------------------------------------------------------
// 接口契约：
//   POST /upload
//     Content-Type: multipart/form-data
//     formData: file (必填，二进制文件)
//   响应 data: { key, url }
//     · key —— 文件在对象存储桶里的对象路径（后端内部用）
//     · url —— 前端可直接访问的公开地址（用于 <img src>、coverUrl 等）
//
// 注意：
// 1. http.js 默认 Content-Type: application/json，需要在请求级别覆盖为
//    multipart/form-data，让 axios 自动注入 boundary。
// 2. 不要对 FormData 做 JSON.stringify 等转换，直接交给 axios。
// 3. 上传可能耗时较长，组件层最好用 onProgress 显示进度。
// ============================================================================

import http from './http'

/**
 * 上传单个文件
 * @param {File} file 浏览器原生 File 对象
 * @param {(e: ProgressEvent) => void} [onProgress] 上传进度回调（可选）
 * @returns common.Response，成功时 data = { key, url }
 */
export function uploadFile(file, onProgress) {
  const fd = new FormData()
  fd.append('file', file)
  return http.post('/upload', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress,
    // 文件可能较大，给一个更宽松的超时（30s）
    timeout: 30000,
  })
}
