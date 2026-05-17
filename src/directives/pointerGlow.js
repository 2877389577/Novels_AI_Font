// ============================================================================
// v-pointer-glow —— 指针跟随光斑 / 倾斜指令
// ----------------------------------------------------------------------------
// 设计意图：
//   把鼠标在元素内的相对位置写成 CSS 变量，让 CSS 层用 radial-gradient
//   或 transform 消费这些变量，营造「界面感知到指针」的科幻反馈。
//   JS 只负责采样坐标，渲染完全交给 CSS（GPU 合成），保证顺滑。
//
// 暴露的 CSS 变量（写在被指令绑定的元素上）：
//   --gx, --gy        鼠标在元素内的 px 坐标（左上角为 0,0）
//   --gxr, --gyr      0~1 的归一化坐标（hover 离开时缓动回 0.5,0.5）
//   --tilt-x, --tilt-y  3D 旋转角度（仅 `.tilt` 修饰符启用时写入）
//
// 用法示例：
//   <div v-pointer-glow>           只写坐标，配合 radial-gradient 做光斑
//   <div v-pointer-glow.tilt>      同时输出倾斜角度，配合 transform 做 3D
//   <div v-pointer-glow="{ maxTilt: 12, radius: 320 }">
//                                  自定义最大倾斜角；radius 仅作为 CSS 后备值
//
// 性能要点：
//   1. 用 requestAnimationFrame 合并连续 mousemove，每帧最多写一次变量；
//   2. 写 CSS 变量本身极便宜，但叠加的样式必须用 transform / opacity / filter
//      这类 GPU 友好属性，否则会回退到合成主线程；
//   3. 元素卸载时清掉 listener 与 rAF，避免内存泄漏。
// ============================================================================

// 用 WeakMap 把 listener 与 rAF id 绑到 DOM 节点上，便于 unmounted 时回收
const HANDLERS = new WeakMap()

function bind(el, binding) {
  const opts = binding.value || {}
  const useTilt = Boolean(binding.modifiers?.tilt)
  // 最大倾斜角（度）；过大会显得卡通，6~10 是较自然的范围
  const maxTilt = opts.maxTilt ?? 6

  // 当前帧的待写值（rAF 节流，避免一次 mousemove 写多次样式）
  let frame = 0
  let nx = 0.5,
    ny = 0.5,
    px = 0,
    py = 0

  // 将采样到的坐标统一写入 CSS 变量；只在 rAF 回调里调用
  function apply() {
    frame = 0
    el.style.setProperty('--gx', `${px}px`)
    el.style.setProperty('--gy', `${py}px`)
    el.style.setProperty('--gxr', nx.toFixed(4))
    el.style.setProperty('--gyr', ny.toFixed(4))
    if (useTilt) {
      // 让封面像被指针「拉过来」：鼠标在右上 → 元素向右上倾
      // tilt-x 由 y 决定（上下倾），tilt-y 由 x 决定（左右倾）
      const tx = (0.5 - ny) * maxTilt * 2
      const ty = (nx - 0.5) * maxTilt * 2
      el.style.setProperty('--tilt-x', `${tx.toFixed(2)}deg`)
      el.style.setProperty('--tilt-y', `${ty.toFixed(2)}deg`)
    }
  }

  function onMove(e) {
    // getBoundingClientRect 每次都会触发布局读取，但只在 mousemove 时
    // 调用一次，配合 rAF 后实际频率受限，不会成为瓶颈
    const rect = el.getBoundingClientRect()
    px = e.clientX - rect.left
    py = e.clientY - rect.top
    nx = rect.width ? px / rect.width : 0.5
    ny = rect.height ? py / rect.height : 0.5
    if (!frame) frame = requestAnimationFrame(apply)
  }

  function onLeave() {
    // 指针离开 → 缓动回中心位置，避免下次 hover 时光斑突兀地从角落跳出
    if (frame) cancelAnimationFrame(frame)
    nx = 0.5
    ny = 0.5
    // 用 offsetWidth/Height 拿到元素自身尺寸（不含 transform）
    px = el.offsetWidth / 2
    py = el.offsetHeight / 2
    frame = requestAnimationFrame(apply)
  }

  el.addEventListener('mousemove', onMove)
  el.addEventListener('mouseleave', onLeave)
  // 首次渲染就给一组中心值，避免变量缺省时 radial-gradient 出现在 (0,0)
  onLeave()

  HANDLERS.set(el, { onMove, onLeave, getFrame: () => frame })
}

function unbind(el) {
  const h = HANDLERS.get(el)
  if (!h) return
  el.removeEventListener('mousemove', h.onMove)
  el.removeEventListener('mouseleave', h.onLeave)
  const f = h.getFrame()
  if (f) cancelAnimationFrame(f)
  HANDLERS.delete(el)
}

// Vue 3 指令对象：只用 mounted / beforeUnmount，不需要 updated
// （binding.value 变化不影响 listener 行为，options 在 bind 时一次性读取）
export default {
  mounted(el, binding) {
    bind(el, binding)
  },
  beforeUnmount(el) {
    unbind(el)
  },
}
