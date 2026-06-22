<template>
  <div
    class="ti-toolbar flex items-center gap-2.5 px-4 bg-neutral border-b border-neutral-content/10 text-sm font-sans"
    :style="{ height: TOOLBAR_HEIGHT + 'px' }"
  >
    <span class="font-semibold text-neutral-content/50 whitespace-nowrap mr-1">Transparent Input</span>
    <span class="text-neutral-content/20">|</span>

    <!-- CHECKING -->
    <span v-if="state.phase === 'checking'" class="text-neutral-content/50">Checking…</span>

    <!-- LOADING -->
    <span v-else-if="state.phase === 'loading'" class="text-neutral-content/50">Loading subtitle tracks…</span>

    <!-- READY -->
    <template v-else-if="state.phase === 'ready'">
      <span v-if="state.availableLangs.length === 0" class="text-neutral-content/50">
        No supported subtitle tracks found for this video
      </span>
      <template v-else>
        <select
          class="select select-bordered select-xs"
          :value="state.selectedLang ?? ''"
          @change="(e) => { state.selectedLang = (e.target as HTMLSelectElement).value; }"
        >
          <option v-for="lang in state.availableLangs" :key="lang.languageCode" :value="lang.languageCode">
            {{ lang.trackName }}
          </option>
        </select>

        <template v-if="hasKey">
          <button class="btn btn-primary btn-xs" @click="onSubmitLLM">Translate (AI)</button>
          <span class="text-neutral-content/50">via {{ providerLabel }}</span>
        </template>

        <button
          class="btn btn-xs"
          :class="hasKey ? 'btn-ghost border border-neutral-content/20 text-neutral-content/50' : 'btn-primary'"
          @click="onSubmitServer"
        >{{ hasKey ? 'Translate (server)' : 'Translate' }}</button>

        <button v-if="!hasKey" class="btn btn-link btn-xs text-neutral-content/50 underline" @click="openSettings">
          AI: Needs Setup. →
        </button>
      </template>
    </template>

    <!-- SUBMITTING -->
    <span v-else-if="state.phase === 'submitting'" class="text-neutral-content/50">
      {{ state.phaseData.message || 'Submitting…' }}
    </span>

    <!-- AI_PROCESSING -->
    <template v-else-if="state.phase === 'ai-processing'">
      <Loader2 :size="13" class="animate-spin text-warning shrink-0" />
      <span class="text-warning">Processing with AI… ({{ state.phaseData.done }}/{{ state.phaseData.total }} segments)</span>
    </template>

    <!-- POLLING -->
    <template v-else-if="state.phase === 'polling'">
      <Loader2 :size="13" class="animate-spin text-warning shrink-0" />
      <span class="text-warning">Processing… ({{ state.phaseData.count }}/{{ state.phaseData.max }})</span>
    </template>

    <!-- DONE -->
    <template v-else-if="state.phase === 'done'">
      <CheckCircle2 :size="13" class="text-success shrink-0" />
      <span class="text-success">Ready</span>
      <span class="text-neutral-content/50">{{ state.phaseData.count }} segments</span>
      <template v-if="state.phaseData.servedNativeLanguage">
        <span class="text-neutral-content/50">· Shown in {{ langName(state.phaseData.servedNativeLanguage) }}</span>
        <button v-if="hasKey" class="btn btn-link btn-xs text-primary p-0" @click="onRetry">
          Process in {{ langName(state.phaseData.primaryNativeLanguage ?? 'en') }} →
        </button>
        <button v-else class="btn btn-link btn-xs text-neutral-content/50 underline p-0" @click="openSettings">
          Set up key to process in {{ langName(state.phaseData.primaryNativeLanguage ?? 'en') }} →
        </button>
      </template>
    </template>

    <!-- ERROR -->
    <template v-else-if="state.phase === 'error'">
      <AlertCircle :size="13" class="text-error shrink-0" />
      <span class="text-error">{{ state.phaseData.error || 'Error' }}</span>
      <button class="btn btn-ghost btn-xs border border-neutral-content/20" @click="onRetry">
        <RefreshCw :size="11" /> Retry
      </button>
    </template>

    <span class="flex-1" />

    <button class="btn btn-ghost btn-xs px-1.5 text-neutral-content/40 hover:text-neutral-content" @click="openSettings">
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
