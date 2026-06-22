<template>
  <div class="relative" ref="root">
    <div
      class="input input-bordered w-full h-auto min-h-[2.5rem] flex flex-wrap gap-1 p-1.5 cursor-text"
      @click="inputEl?.focus()"
    >
      <span
        v-for="code in modelValue"
        :key="code"
        class="badge badge-primary gap-1"
      >
        {{ labelFor(code) }}
        <button type="button" class="ml-0.5 hover:opacity-70" @click.stop="remove(code)">×</button>
      </span>
      <input
        ref="inputEl"
        type="text"
        class="flex-1 min-w-[120px] bg-transparent outline-none text-sm"
        :placeholder="modelValue.length === 0 ? placeholder : ''"
        v-model="query"
        @focus="open = true"
        @keydown="onKeydown"
      />
    </div>
    <ul
      v-if="open && filtered.length"
      class="absolute z-10 w-full mt-1 max-h-48 overflow-y-auto menu bg-base-200 rounded-box border border-base-content/10 shadow-lg p-1"
    >
      <li
        v-for="(lang, i) in filtered"
        :key="lang.value"
        :class="{ 'bg-base-300 rounded-lg': i === activeIdx }"
      >
        <a @mousedown.prevent="add(lang)" @mouseover="activeIdx = i">{{ lang.text }}</a>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

interface LangOption { value: string; text: string; }

const props = defineProps<{
  modelValue: string[];
  options: LangOption[];
  placeholder?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();

const open = ref(false);
const query = ref('');
const activeIdx = ref(0);
const root = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);

const filtered = computed(() => {
  const q = query.value.toLowerCase();
  const selected = new Set(props.modelValue);
  const base = props.options.filter(o => !selected.has(o.value));
  if (!q) return base.slice(0, 50);
  return base.filter(o => o.text.toLowerCase().includes(q)).slice(0, 50);
});

function labelFor(code: string): string {
  return props.options.find(o => o.value === code)?.text ?? code;
}

function add(lang: LangOption) {
  emit('update:modelValue', [...props.modelValue, lang.value]);
  query.value = '';
  activeIdx.value = 0;
  inputEl.value?.focus();
}

function remove(code: string) {
  emit('update:modelValue', props.modelValue.filter(c => c !== code));
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx.value = Math.min(activeIdx.value + 1, filtered.value.length - 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx.value = Math.max(activeIdx.value - 1, 0); }
  else if (e.key === 'Enter') { e.preventDefault(); if (filtered.value[activeIdx.value]) add(filtered.value[activeIdx.value]); }
  else if (e.key === 'Escape') { open.value = false; }
  else if (e.key === 'Backspace' && query.value === '' && props.modelValue.length > 0) {
    remove(props.modelValue[props.modelValue.length - 1]);
  }
}

function onClickOutside(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}

onMounted(() => document.addEventListener('mousedown', onClickOutside));
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside));
</script>
