<template>
  <div class="lang-list">
    <LanguagePicker
      :modelValue="''"
      :options="addableOptions"
      placeholder="Add a language…"
      @update:modelValue="addLanguage"
    />

    <ul v-if="allCodes.length > 0" class="lang-list__items">
      <li v-for="code in allCodes" :key="code" class="lang-list__item">
        <button
          class="lang-list__star"
          :class="{ 'lang-list__star--active': code === primary }"
          :title="code === primary ? 'Main language' : 'Set as main language'"
          @click="setMain(code)"
          type="button"
        >★</button>
        <span class="lang-list__name">{{ display.of(code) ?? code }}</span>
        <button
          class="lang-list__remove"
          title="Remove"
          @click="remove(code)"
          type="button"
        >×</button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import LanguagePicker from './LanguagePicker.vue';

interface LangOption { value: string; text: string; }

const props = defineProps<{
  primary: string;
  fallbacks: string[];
  options: LangOption[];
}>();

const emit = defineEmits<{
  'update:primary': [value: string];
  'update:fallbacks': [value: string[]];
}>();

const display = new Intl.DisplayNames(['en'], { type: 'language' });

const allCodes = computed(() => [props.primary, ...props.fallbacks].filter(Boolean));

const addableOptions = computed(() =>
  props.options.filter(o => !allCodes.value.includes(o.value)),
);

function addLanguage(code: string) {
  if (!code || allCodes.value.includes(code)) return;
  emit('update:fallbacks', [...props.fallbacks, code]);
}

function setMain(code: string) {
  if (code === props.primary) return;
  const newFallbacks = [props.primary, ...props.fallbacks.filter(c => c !== code)].filter(Boolean);
  emit('update:primary', code);
  emit('update:fallbacks', newFallbacks);
}

function remove(code: string) {
  if (code === props.primary) {
    const [newPrimary, ...rest] = props.fallbacks;
    emit('update:primary', newPrimary ?? '');
    emit('update:fallbacks', rest);
  } else {
    emit('update:fallbacks', props.fallbacks.filter(c => c !== code));
  }
}
</script>

<style scoped>
.lang-list__items {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lang-list__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.lang-list__star {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
  color: var(--text-faint);
  transition: color 0.15s;
}
.lang-list__star--active { color: var(--warning, #f59e0b); }
.lang-list__star:not(.lang-list__star--active):hover { color: var(--text-muted); }

.lang-list__name {
  flex: 1;
  font-size: var(--font-base);
}

.lang-list__remove {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 0 2px;
  color: var(--text-faint);
  transition: color 0.15s;
}
.lang-list__remove:hover { color: var(--error); }
</style>
