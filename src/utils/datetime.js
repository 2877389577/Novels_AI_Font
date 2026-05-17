// ============================================================================
// datetime.js —— 时间格式化工具
// ----------------------------------------------------------------------------
// 项目未安装 dayjs / date-fns，统一通过这里手写拼接保持一致：
// · 后端返回的时间形如 "2026-05-17T14:30:45.123+08:00"，new Date 主流浏览器都能解析
// · 输出格式 "YYYY-MM-DD HH:mm"，与 NovelDetailView 现有的 createdAtText 视觉一致
// · 非法 / 空输入返回占位符 "—"，避免渲染出 "Invalid Date"
// ============================================================================

// 数字补零小工具，避免每个分支重复 String(n).padStart(2,'0')
function pad(n) {
  return String(n).padStart(2, '0')
}

// 把 ISO 字符串或 Date 对象格式化为 "YYYY-MM-DD HH:mm"
// 注：本地时区展示，与浏览器一致；后端如果返回带时区的 ISO 也会被 new Date 自动转换
export function formatDateTime(input) {
  if (!input) return '—'
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
