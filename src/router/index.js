// ============================================================================
// router/index.js —— 路由表 + 登录守卫
// ----------------------------------------------------------------------------
// - 使用 HTML5 history 模式
// - 路由组件懒加载（动态 import），按需拆 chunk，首屏更轻
// - meta.public:true 表示无需登录即可访问（目前只有登录页）
// - 守卫里调用 useAuthStore 必须放在 beforeEach 函数体内部，
//   否则在 app.use(pinia) 之前执行会报「getActivePinia called with no active pinia」
// ============================================================================

import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      // 登录页：未登录用户的唯一入口
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true, title: '登录 · AI 小说系统' },
    },
    {
      // 根路径 → 重定向到书架，让登录后默认看到的就是核心业务页
      path: '/',
      redirect: { name: 'shelf' },
    },
    {
      // 书架：业务主入口，登录后默认落地
      path: '/shelf',
      name: 'shelf',
      component: () => import('@/views/ShelfView.vue'),
      meta: { title: '书架 · AI 小说系统' },
    },
    {
      // AI 设置：管理后端可用的 AI 提供商，入口放在书架右上角账号菜单内。
      path: '/ai-providers',
      name: 'ai-providers',
      component: () => import('@/views/AIProviderView.vue'),
      meta: { title: 'AI 设置 · AI 小说系统' },
    },
    {
      // 小说详情页：编辑/删除单本小说
      path: '/novel/:id(\\d+)',
      name: 'novel-detail',
      component: () => import('@/views/NovelDetailView.vue'),
      meta: { title: '小说详情 · AI 小说系统' },
      // 把 :id 作为 props.id 注入组件，避免组件里再读 useRoute
      props: (route) => ({ id: Number(route.params.id) }),
    },
    {
      // 角色卡备用路由页：主入口在小说详情页 Tab，这里仅兼容直接访问。
      // 新增、查看、修改、删除能力由 CharacterCardsPanel 统一承载。
      path: '/novel/:id(\\d+)/characters',
      name: 'character-cards',
      component: () => import('@/views/CharacterCardsView.vue'),
      meta: { title: '角色卡 · AI 小说系统' },
      // 路由层统一把小说 id 转成 number，页面不再重复解析 route.params。
      props: (route) => ({ novelId: Number(route.params.id) }),
    },
    {
      // 章节编辑页：新建 / 查看 / 编辑 / 删除 四态合一
      //   /novel/:id/chapter/new         → 新建模式（从 /chapters/next-no 拿建议章节号）
      //   /novel/:id/chapter/:chapterId  → 查看/编辑模式（从 /chapters/:chapterId 拉详情）
      // 正则 \d+|new 让一条路由同时兼容数字与字面量 'new'，避免拆两条
      path: '/novel/:id(\\d+)/chapter/:chapterId(\\d+|new)',
      name: 'chapter-edit',
      component: () => import('@/views/ChapterEditView.vue'),
      meta: { title: '章节编辑 · AI 小说系统' },
      // chapterId='new' 时统一注入 null，组件用 `chapterId === null` 一处判断三态
      props: (route) => ({
        novelId: Number(route.params.id),
        chapterId: route.params.chapterId === 'new' ? null : Number(route.params.chapterId),
      }),
    },
    {
      // 章节剧情推理页：展示后端已经持久化的 AI 剧情总结，入口来自小说详情页章节列表。
      path: '/novel/:novelId(\\d+)/chapter/:chapterId(\\d+)/plot-analysis',
      name: 'chapter-plot-analysis',
      component: () => import('@/views/ChapterPlotAnalysisView.vue'),
      meta: { title: '剧情推理 · AI 小说系统' },
      props: (route) => ({
        novelId: Number(route.params.novelId),
        chapterId: Number(route.params.chapterId),
      }),
    },
    {
      // 兜底路由：任意未知路径回到书架（书架本身受守卫保护）
      path: '/:pathMatch(.*)*',
      redirect: '/shelf',
    },
  ],
})

// 全局前置守卫：
// 1. 同步页面 title
// 2. 未登录访问受保护页面 → 跳登录页，并把目标路径放到 query.redirect 以便回跳
// 3. 已登录用户再访问登录页 → 直接跳书架，避免来回切换
router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta?.title) {
    document.title = to.meta.title
  }
  if (!to.meta?.public && !auth.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && auth.isLoggedIn) {
    return { name: 'shelf' }
  }
  return true
})

export default router
