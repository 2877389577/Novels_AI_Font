<!--
  HomeView.vue —— 登录后的工作台占位页
  ----------------------------------------------------------------------------
  当前仅承担「登录成功后能跳到一个合法页面」的职责，
  后续会被替换/拆分为：项目列表、章节大纲、AI 续写等真正业务模块。
  顶栏暴露「退出登录」入口，方便联调时反复验证登录/初始化流程。
-->

<script setup>
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

// 退出登录：清掉 token，再用 replace 回登录页
// 用 replace 而不是 push，避免历史栈里留下「已注销的工作台」可被后退回去
function onLogout() {
  auth.logout()
  router.replace('/login')
}
</script>

<template>
  <main class="home">
    <!-- 顶部品牌栏 + 退出按钮 -->
    <header class="topbar">
      <span class="logo">Novels · AI</span>
      <button class="logout" @click="onLogout">退出登录</button>
    </header>
    <!-- 欢迎区：后续在此区域注入工作台真正模块 -->
    <section class="welcome">
      <h1>欢迎进入 AI 小说工作台</h1>
      <p>这里将陆续接入：项目管理、章节大纲、角色卡、AI 续写、版本对照等模块。</p>
    </section>
  </main>
</template>

<style scoped>
/* 整体沿用登录页的深色渐变，保持品牌视觉一致 */
.home {
  min-height: 100vh;
  background: radial-gradient(120% 80% at 100% 0%, #1b1f4a 0%, #0b0f24 55%, #06070f 100%);
  color: #e7e9f5;
  font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 40px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.logo {
  font-weight: 600;
  letter-spacing: 0.08em;
}
.logout {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: rgba(231, 233, 245, 0.8);
  padding: 8px 16px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
  transition:
    border-color 0.2s ease,
    color 0.2s ease;
}
.logout:hover {
  border-color: rgba(0, 212, 255, 0.6);
  color: #fff;
}
.welcome {
  padding: 80px 40px;
  max-width: 800px;
}
.welcome h1 {
  font-size: 36px;
  margin: 0 0 16px;
}
.welcome p {
  color: rgba(231, 233, 245, 0.65);
  line-height: 1.75;
}
</style>
