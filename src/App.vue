<!--
  App.vue —— 根组件
  ----------------------------------------------------------------------------
  整个应用的根组件保持极简：只承担「路由出口 + 全局浮层」的角色。
  登录页与工作台的布局差异很大（登录页全屏 hero、书架有 topbar），
  与其在这里塞公共布局，不如让每个 View 自带 layout，App.vue 只放 RouterView。

  全局浮层：
    · <Toast />          —— 配合 useToast() 在任意组件弹消息
    · <ConfirmDialog />  —— 配合 useConfirm() 弹危险操作二次确认
  二者只需在根组件挂载一次，PrimeVue 会通过服务桥接所有调用。
-->

<script setup>
import { RouterView } from 'vue-router'
import Toast from 'primevue/toast'
import ConfirmDialog from 'primevue/confirmdialog'
</script>

<template>
  <RouterView />
  <Toast position="bottom-right" />
  <ConfirmDialog />
</template>
