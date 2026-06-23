<template>
  <TransitionGroup name="card" tag="div" class="card-list">
    <div
      v-for="card in state.cards"
      :key="card.id"
      class="card"
      :class="{ 'card--highlight': state.llmSegments }"
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

<style>
.card-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card {
  display: inline-block;
  padding: 5px 13px;
  border-radius: var(--radius-pill);
  background: rgba(0, 0, 0, 0.87);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  color: #fff;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.4;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  cursor: pointer;
  user-select: none;
  pointer-events: auto;
}

.card--highlight {
  background: rgba(6, 42, 90, 0.92);
}

/* Enter/leave transitions */
.card-enter-active,
.card-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.card-enter-from,
.card-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
