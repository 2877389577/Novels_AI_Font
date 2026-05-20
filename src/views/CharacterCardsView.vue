<!--
  CharacterCardsView.vue：角色卡备用路由页
  ----------------------------------------------------------------------------
  主入口已经放进 NovelDetailView 的 Tab 内。
  保留这个路由页是为了兼容已有 /novel/:id/characters 地址，页面本身复用同一个
  CharacterCardsPanel，因此新增、查看、修改、删除能力和详情页 Tab 保持一致。
-->

<script setup>
import CharacterCardsPanel from '@/components/CharacterCardsPanel.vue'

defineProps({
  // 路由层已把 :id 转成 number，这里直接传给查询面板。
  novelId: { type: Number, required: true },
})
</script>

<template>
  <main class="character-page">
    <CharacterCardsPanel :novel-id="novelId" />
  </main>
</template>

<style scoped>
.character-page {
  min-height: 100vh;
  padding: 36px 68px 40px;
  background:
    radial-gradient(circle at 18% 8%, oklch(96% 0.018 250) 0, transparent 34rem),
    linear-gradient(180deg, oklch(99% 0.006 255), oklch(96.5% 0.008 255));
  font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}

.character-page :deep(.character-panel) {
  max-width: 1780px;
  margin: 0 auto;
}

@media (max-width: 820px) {
  .character-page {
    padding: 24px 18px 32px;
  }
}
</style>
