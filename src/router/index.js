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
      // 工作台首页：登录后跳转目标
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
      meta: { title: '工作台 · AI 小说系统' },
    },
    {
      // 兜底路由：任意未知路径回到首页（首页本身受守卫保护）
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

// 全局前置守卫：
// 1. 同步页面 title
// 2. 未登录访问受保护页面 → 跳登录页，并把目标路径放到 query.redirect 以便回跳
// 3. 已登录用户再访问登录页 → 直接跳工作台，避免来回切换
router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta?.title) {
    document.title = to.meta.title
  }
  if (!to.meta?.public && !auth.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && auth.isLoggedIn) {
    return { name: 'home' }
  }
  return true
})

export default router
