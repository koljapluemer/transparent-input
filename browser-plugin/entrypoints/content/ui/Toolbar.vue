<template>
  <div class="toolbar">
    <span class="toolbar__brand">Transparent Input</span>
    <span class="toolbar__sep">|</span>

    <!-- CHECKING / LOADING / SUBMITTING -->
    <span v-if="state.phase === 'checking'" class="toolbar__status">Checking…</span>
    <span v-else-if="state.phase === 'loading'" class="toolbar__status">Loading subtitle tracks…</span>
    <span v-else-if="state.phase === 'submitting'" class="toolbar__status">
      {{ state.phaseData.message || 'Submitting…' }}
    </span>

    <!-- READY -->
    <template v-else-if="state.phase === 'ready'">
      <span v-if="state.availableLangs.length === 0" class="toolbar__status">
        No supported subtitle tracks found for this video
      </span>
      <template v-else>
        <select
          class="toolbar__select"
          :value="state.selectedLang ?? ''"
          @change="(e) => { state.selectedLang = (e.target as HTMLSelectElement).value; }"
        >
          <option v-for="lang in state.availableLangs" :key="lang.languageCode" :value="lang.languageCode">
            {{ lang.trackName }}
          </option>
        </select>

        <template v-if="hasKey">
          <button class="btn btn--primary btn--sm" @click="onSubmitLLM">Translate (AI)</button>
          <span class="toolbar__status">via {{ providerLabel }}</span>
        </template>

        <button
          class="btn btn--sm"
          :class="hasKey ? 'btn--outline' : 'btn--primary'"
          @click="onSubmitServer"
        >{{ hasKey ? 'Translate (server)' : 'Translate' }}</button>

        <button v-if="!hasKey" class="btn btn--link btn--sm" @click="openSettings">
          AI: Needs Setup →
        </button>
      </template>
    </template>

    <!-- AI_PROCESSING / POLLING -->
    <template v-else-if="state.phase === 'ai-processing'">
      <Loader2 :size="13" class="toolbar__spinner" />
      <span class="toolbar__status toolbar__status--warning">
        Processing with AI… ({{ state.phaseData.done }}/{{ state.phaseData.total }} segments)
      </span>
    </template>

    <template v-else-if="state.phase === 'polling'">
      <Loader2 :size="13" class="toolbar__spinner" />
      <span class="toolbar__status toolbar__status--warning">
        Processing… ({{ state.phaseData.count }}/{{ state.phaseData.max }})
      </span>
    </template>

    <!-- DONE -->
    <template v-else-if="state.phase === 'done'">
      <CheckCircle2 :size="13" class="toolbar__icon toolbar__icon--success" />
      <span class="toolbar__status toolbar__status--success">Ready</span>
      <span class="toolbar__status">{{ state.phaseData.count }} segments</span>
      <template v-if="state.phaseData.servedNativeLanguage">
        <span class="toolbar__status">· Shown in {{ langName(state.phaseData.servedNativeLanguage) }}</span>
        <button v-if="hasKey" class="btn btn--link btn--sm btn--link-primary" @click="onRetry">
          Process in {{ langName(state.phaseData.primaryNativeLanguage ?? 'en') }} →
        </button>
        <button v-else class="btn btn--link btn--sm" @click="openSettings">
          Set up key to process in {{ langName(state.phaseData.primaryNativeLanguage ?? 'en') }} →
        </button>
      </template>
    </template>

    <!-- ERROR -->
    <template v-else-if="state.phase === 'error'">
      <AlertCircle :size="13" class="toolbar__icon toolbar__icon--error" />
      <span class="toolbar__status toolbar__status--error">{{ state.phaseData.error || 'Error' }}</span>
      <button class="btn btn--outline btn--sm" @click="onRetry">
        <RefreshCw :size="11" /> Retry
      </button>
    </template>

    <span class="toolbar__spacer" />

    <button class="btn btn--ghost btn--sm toolbar__settings" @click="openSettings" title="Settings">
      <Settings :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Settings, Loader2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-vue-next';
import type { State } from '../lib/types';
import { nativeLangDisplayName } from '../lib/utils';

const props = defineProps<{
  state: State;
  TOOLBAR_HEIGHT: number;
  onSubmitLLM: () => void;
  onSubmitServer: () => void;
  onRetry: () => void;
  openSettings: () => void;
}>();

const { state } = props;

const hasKey = computed(() => !!state.userSettings?.apiKey);
const providerLabel = computed(() => state.userSettings?.provider === 'gemini' ? 'Gemini' : 'OpenAI');

function langName(code: string | null | undefined): string {
  if (!code) return '';
  return nativeLangDisplayName(code);
}
</script>

<style>
/* Toolbar layout */
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  height: 100%;
  background: #111318;
  border-bottom: 1px solid var(--border);
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
}

.toolbar__brand {
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
.toolbar__sep    { color: var(--text-faint); flex-shrink: 0; }
.toolbar__spacer { flex: 1 1 0; }

/* Status text */
.toolbar__status { color: var(--text-muted); white-space: nowrap; }
.toolbar__status--warning { color: var(--warning); }
.toolbar__status--success { color: var(--success); }
.toolbar__status--error   { color: var(--error); }

/* Inline icons */
.toolbar__icon { flex-shrink: 0; }
.toolbar__icon--success { color: var(--success); }
.toolbar__icon--error   { color: var(--error); }

/* Spinner */
.toolbar__spinner {
  flex-shrink: 0;
  color: var(--warning);
  animation: toolbar-spin 1s linear infinite;
}
@keyframes toolbar-spin { to { transform: rotate(360deg); } }

/* Language select */
.toolbar__select {
  height: 26px;
  padding: 0 22px 0 8px;
  background-color: var(--bg-subtle);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='rgba(197%2C202%2C216%2C0.5)' d='M0 0l5 6 5-6z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 7px center;
  appearance: none;
  -webkit-appearance: none;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  outline: none;
  max-width: 200px;
  flex-shrink: 0;
}
.toolbar__select:focus { border-color: var(--border-focus); }
.toolbar__select option { background-color: #1a1f2e; color: var(--text); }

/* Buttons (scoped variants for toolbar — px sizes, no rem) */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  line-height: 1;
  transition: background var(--transition), border-color var(--transition), opacity var(--transition);
  flex-shrink: 0;
  background: transparent;
  color: var(--text);
  text-decoration: none;
}
.btn:disabled { opacity: 0.45; cursor: not-allowed; }

.btn--sm { padding: 0 10px; height: 26px; }

.btn--primary {
  background: var(--primary);
  color: var(--primary-fg);
  border-color: transparent;
}
.btn--primary:hover:not(:disabled) { background: var(--primary-dark); }

.btn--outline {
  background: transparent;
  color: var(--text-muted);
  border-color: var(--border);
}
.btn--outline:hover:not(:disabled) { background: var(--bg-subtle); }

.btn--link {
  background: transparent;
  border-color: transparent;
  color: var(--text-muted);
  text-decoration: underline;
  padding: 0;
  height: auto;
  font-weight: 400;
}
.btn--link-primary { color: var(--primary); }
.btn--link:hover:not(:disabled) { opacity: 0.7; }

.btn--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--text-faint);
}
.btn--ghost:hover:not(:disabled) { color: var(--text); }

.toolbar__settings { padding: 0 6px; }
</style>
