<template>
  <div class="settings">
    <h1 class="settings__title">Transparent Input</h1>

    <section class="section">
      <h2 class="section__heading">Your native language</h2>
      <div class="field-group">
        <label class="label">I primarily speak</label>
        <LanguagePicker v-model="primaryNativeLanguage" :options="allLanguageOptions" placeholder="Search for a language…" />

        <label class="label" style="margin-top: 12px;">I also speak <span class="text-muted text-sm">(fallbacks — served if a video is already translated)</span></label>
        <LanguageTagInput v-model="nativeFallbacks" :options="allLanguageOptions" placeholder="Add languages you also speak…" />
      </div>
    </section>

    <hr class="divider" />

    <section class="section">
      <h2 class="section__heading">AI provider</h2>
      <div class="radio-group">
        <label class="radio-label">
          <input type="radio" name="provider" value="openai" v-model="provider" />
          OpenAI
        </label>
        <label class="radio-label">
          <input type="radio" name="provider" value="gemini" v-model="provider" />
          Gemini
        </label>
      </div>
    </section>

    <section class="section">
      <h2 class="section__heading">API key</h2>
      <div class="input-row">
        <input
          class="input"
          :class="{ 'input--mono': true }"
          :type="showKey ? 'text' : 'password'"
          v-model="apiKey"
          placeholder="Paste your API key here"
          autocomplete="off"
        />
        <button class="btn btn--ghost" @click="showKey = !showKey">
          <component :is="showKey ? EyeOff : Eye" :size="16" />
        </button>
      </div>
      <label class="checkbox-label">
        <input type="checkbox" v-model="rememberKey" />
        Remember key across browser restarts
      </label>
    </section>

    <hr class="divider" />

    <div class="action-row">
      <button class="btn btn--primary" @click="save">Save settings</button>
      <button class="btn btn--danger btn--sm" @click="removeKey">Remove key</button>
      <span v-if="statusMsg" class="text-sm" :class="statusOk ? 'text-success' : 'text-error'">{{ statusMsg }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Eye, EyeOff } from 'lucide-vue-next';
import ISO6391 from 'iso-639-1';
import LanguagePicker from './LanguagePicker.vue';
import LanguageTagInput from './LanguageTagInput.vue';

const display = new Intl.DisplayNames(['en'], { type: 'language' });

const allLanguageOptions = ISO6391.getAllCodes()
  .map(code => ({ value: code, text: display.of(code) ?? ISO6391.getName(code) }))
  .sort((a, b) => a.text.localeCompare(b.text));

const primaryNativeLanguage = ref('en');
const nativeFallbacks = ref<string[]>([]);
const provider = ref<'openai' | 'gemini'>('openai');
const apiKey = ref('');
const rememberKey = ref(true);
const showKey = ref(false);
const statusMsg = ref('');
const statusOk = ref(true);

function showStatus(msg: string, ok = true) {
  statusMsg.value = msg;
  statusOk.value = ok;
  setTimeout(() => { statusMsg.value = ''; }, 3000);
}

onMounted(async () => {
  const local = await browser.storage.local.get([
    'primaryNativeLanguage', 'nativeFallbacks', 'provider', 'apiKey', 'rememberKey',
  ]);

  if (local.primaryNativeLanguage) primaryNativeLanguage.value = local.primaryNativeLanguage as string;
  if (Array.isArray(local.nativeFallbacks)) nativeFallbacks.value = local.nativeFallbacks as string[];
  if (local.provider === 'gemini') provider.value = 'gemini';
  if (local.rememberKey === false) rememberKey.value = false;

  let key = (local.apiKey as string) || '';
  if (!key) {
    try {
      const session = await browser.storage.session.get('apiKey');
      key = (session.apiKey as string) || '';
    } catch { /* storage.session may not be available */ }
  }
  apiKey.value = key;
});

async function save() {
  await browser.storage.local.set({
    primaryNativeLanguage: primaryNativeLanguage.value,
    nativeFallbacks: nativeFallbacks.value.filter(c => c !== primaryNativeLanguage.value),
    provider: provider.value,
    rememberKey: rememberKey.value,
  });

  const key = apiKey.value.trim();
  if (key) {
    if (rememberKey.value) {
      await browser.storage.local.set({ apiKey: key });
      try { await browser.storage.session.remove('apiKey'); } catch { /* ok */ }
    } else {
      await browser.storage.local.remove('apiKey');
      try { await browser.storage.session.set({ apiKey: key }); } catch { /* ok */ }
    }
  }

  showStatus('Settings saved.');
}

async function removeKey() {
  await browser.storage.local.remove('apiKey');
  try { await browser.storage.session.remove('apiKey'); } catch { /* ok */ }
  apiKey.value = '';
  showStatus('Key removed.');
}

</script>

<style scoped>
.settings {
  padding: 32px;
  max-width: 480px;
}

.settings__title {
  font-size: var(--font-lg);
  font-weight: 600;
  margin: 0 0 32px;
}

.section { margin-bottom: 24px; }

.section__heading {
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  margin: 0 0 12px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label {
  font-size: var(--font-base);
  color: var(--text-muted);
}

.radio-group {
  display: flex;
  gap: 24px;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.input-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: var(--font-base);
  color: var(--text-muted);
  cursor: pointer;
}

.action-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

</style>
