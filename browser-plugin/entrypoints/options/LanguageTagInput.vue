<template>
  <div class="tag-input" ref="root">
    <div class="tag-input__box" @click="inputEl?.focus()">
      <span v-for="code in modelValue" :key="code" class="tag">
        {{ labelFor(code) }}
        <button type="button" class="tag__remove" @click.stop="remove(code)">×</button>
      </span>
      <input
        ref="inputEl"
        type="text"
        class="tag-input__field"
        :placeholder="modelValue.length === 0 ? placeholder : ''"
        v-model="query"
        @focus="open = true"
        @keydown="onKeydown"
      />
    </div>
    <ul v-if="open && filtered.length" class="dropdown">
      <li
        v-for="(lang, i) in filtered"
        :key="lang.value"
        class="dropdown__item"
        :class="{ 'dropdown__item--active': i === activeIdx }"
        @mousedown.prevent="add(lang)"
        @mouseover="activeIdx = i"
      >{{ lang.text }}</li>
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

<style scoped>
.tag-input { position: relative; }

.tag-input__box {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-height: 40px;
  padding: 5px 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: text;
  transition: border-color var(--transition);
}
.tag-input__box:focus-within { border-color: var(--border-focus); }

.tag-input__field {
  flex: 1;
  min-width: 120px;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-size: var(--font-base);
  font-family: var(--font-sans);
  padding: 2px 4px;
}
.tag-input__field::placeholder { color: var(--text-muted); }

.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: rgba(58, 191, 248, 0.15);
  color: var(--primary);
  border-radius: var(--radius-pill);
  font-size: var(--font-sm);
  font-weight: 500;
  white-space: nowrap;
}

.tag__remove {
  background: none;
  border: none;
  color: inherit;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
  opacity: 0.6;
  font-family: inherit;
}
.tag__remove:hover { opacity: 1; }
</style>
