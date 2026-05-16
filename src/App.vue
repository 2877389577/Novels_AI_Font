<!--
  App.vue —— 根组件
  ----------------------------------------------------------------------------
  整个应用的根组件保持极简：只承担「路由出口」的角色。
  登录页与工作台的布局差异很大（登录页全屏 hero、工作台有 topbar），
  与其在这里塞公共布局，不如让每个 View 自带 layout，App.vue 只放 RouterView。
-->

<script setup>
import { RouterView } from 'vue-router'
</script>

<template>
  <RouterView />
</template>
