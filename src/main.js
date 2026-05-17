// 应用入口：注册 Pinia 状态管理、Vue Router、引入全局样式
import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import './assets/base.css' // 全局基础样式（盒模型/字体/默认背景）

import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
// 注册 PrimeVue 的两个全局服务，使组件可通过 useToast / useConfirm 触发
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'

// 全局指针跟随指令：v-pointer-glow / v-pointer-glow.tilt
import pointerGlow from './directives/pointerGlow'

const app = createApp(App)

app.use(createPinia()) // 必须先于 router.beforeEach 中调用 useAuthStore
app.use(router)
app.use(PrimeVue, {
  theme: {
    preset: Aura,
  },
})
// 全局服务：和挂载到 App.vue 里的 <Toast />、<ConfirmDialog /> 配合使用
app.use(ToastService)
app.use(ConfirmationService)

// 注册全局指令：所有页面可直接 v-pointer-glow 使用，无需 import
app.directive('pointer-glow', pointerGlow)

app.mount('#app')
