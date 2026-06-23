<template>
  <div class="picker" ref="root">
    <input
      type="text"
      class="input"
      :placeholder="placeholder"
      :value="inputDisplay"
      @focus="open = true"
      @input="onInput"
      @keydown="onKeydown"
    />
    <ul v-if="open && filtered.length" class="dropdown">
      <li
        v-for="(lang, i) in filtered"
        :key="lang.value"
        class="dropdown__item"
        :class="{ 'dropdown__item--active': i === activeIdx }"
        @mousedown.prevent="select(lang)"
        @mouseover="activeIdx = i"
      >{{ lang.text }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

interface LangOption { value: string; text: string; }

const props = defineProps<{
  modelValue: string;
  options: LangOption[];
  placeholder?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const open = ref(false);
const query = ref('');
const activeIdx = ref(0);
const root = ref<HTMLElement | null>(null);

const selectedLabel = computed(() => props.options.find(o => o.value === props.modelValue)?.text ?? '');
const inputDisplay = computed(() => open.value ? query.value : selectedLabel.value);

const filtered = computed(() => {
  const q = query.value.toLowerCase();
  if (!q) return props.options.slice(0, 50);
  return props.options.filter(o => o.text.toLowerCase().includes(q)).slice(0, 50);
});

watch(open, (val) => {
  if (val) { query.value = ''; activeIdx.value = 0; }
});

function onInput(e: Event) {
  query.value = (e.target as HTMLInputElement).value;
  activeIdx.value = 0;
  open.value = true;
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) { open.value = true; return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx.value = Math.min(activeIdx.value + 1, filtered.value.length - 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx.value = Math.max(activeIdx.value - 1, 0); }
  else if (e.key === 'Enter') { e.preventDefault(); if (filtered.value[activeIdx.value]) select(filtered.value[activeIdx.value]); }
  else if (e.key === 'Escape') { open.value = false; }
}

function select(lang: LangOption) {
  emit('update:modelValue', lang.value);
  open.value = false;
  query.value = '';
}

function onClickOutside(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}

onMounted(() => document.addEventListener('mousedown', onClickOutside));
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside));
</script>

<style scoped>
.picker { position: relative; }
</style>
