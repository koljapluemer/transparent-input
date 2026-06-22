<template>
  <TransitionGroup name="card" tag="div" class="flex flex-col gap-1.5">
    <div
      v-for="card in state.cards"
      :key="card.id"
      class="rounded-[20px] px-3 py-1.5 text-sm text-white leading-snug shadow-lg cursor-pointer select-none whitespace-nowrap"
      :style="{ background: state.llmSegments ? 'rgba(6,42,90,0.92)' : 'rgba(0,0,0,0.87)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', pointerEvents: 'auto' }"
      @click="onDismiss(card.id)"
    >
      {{ card.word }} = {{ card.translation }}
    </div>
  </TransitionGroup>
</template>

<script setup lang="ts">
import type { State } from '../lib/types';

defineProps<{
  state: State;
  onDismiss: (id: number) => void;
}>();
</script>

<style scoped>
.card-enter-active,
.card-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.card-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.card-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
