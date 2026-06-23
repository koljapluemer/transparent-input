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

    <section class="section">
      <h2 class="section__heading">Account</h2>
      <p class="text-muted text-sm" style="margin: 0 0 12px;">
        Get a token at <code class="code">localhost:8000/profile/</code>
      </p>
      <div class="input-row">
        <input
          class="input input--mono"
          :type="showToken ? 'text' : 'password'"
          v-model="accountToken"
          placeholder="Paste your account token here"
          autocomplete="off"
        />
        <button class="btn btn--ghost" @click="showToken = !showToken">
          <component :is="showToken ? EyeOff : Eye" :size="16" />
        </button>
      </div>
      <div class="sync-row">
        <button class="btn btn--outline btn--sm" @click="syncNow" :disabled="syncing || !accountToken">
          {{ syncing ? 'Syncing…' : 'Sync now' }}
        </button>
        <span v-if="pendingMinutes > 0" class="text-muted text-sm">{{ pendingMinutes }} min pending</span>
        <span v-if="syncMsg" class="text-sm" :class="syncOk ? 'text-success' : 'text-error'">{{ syncMsg }}</span>
      </div>
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
import { ref, computed, onMounted } from 'vue';
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
const accountToken = ref('');
const showToken = ref(false);
const statusMsg = ref('');
const statusOk = ref(true);
const syncMsg = ref('');
const syncOk = ref(true);
const syncing = ref(false);
const pendingWatchData = ref<Record<string, Record<string, number>>>({});

const pendingMinutes = computed(() => {
  const totalSeconds = Object.values(pendingWatchData.value)
    .flatMap(videos => Object.values(videos))
    .reduce((sum, s) => sum + s, 0);
  return Math.round(totalSeconds / 60);
});

function showStatus(msg: string, ok = true) {
  statusMsg.value = msg;
  statusOk.value = ok;
  setTimeout(() => { statusMsg.value = ''; }, 3000);
}

function showSyncStatus(msg: string, ok = true) {
  syncMsg.value = msg;
  syncOk.value = ok;
  setTimeout(() => { syncMsg.value = ''; }, 4000);
}

async function loadPendingWatchData() {
  const result = await browser.storage.local.get('pendingWatchTime');
  pendingWatchData.value = (result['pendingWatchTime'] as Record<string, Record<string, number>>) ?? {};
}

onMounted(async () => {
  const local = await browser.storage.local.get([
    'primaryNativeLanguage', 'nativeFallbacks', 'provider', 'apiKey', 'rememberKey', 'accountToken',
  ]);

  if (local.primaryNativeLanguage) primaryNativeLanguage.value = local.primaryNativeLanguage as string;
  if (Array.isArray(local.nativeFallbacks)) nativeFallbacks.value = local.nativeFallbacks as string[];
  if (local.provider === 'gemini') provider.value = 'gemini';
  if (local.rememberKey === false) rememberKey.value = false;
  if (local.accountToken) accountToken.value = local.accountToken as string;

  let key = (local.apiKey as string) || '';
  if (!key) {
    try {
      const session = await browser.storage.session.get('apiKey');
      key = (session.apiKey as string) || '';
    } catch { /* storage.session may not be available */ }
  }
  apiKey.value = key;

  await loadPendingWatchData();
});

async function save() {
  await browser.storage.local.set({
    primaryNativeLanguage: primaryNativeLanguage.value,
    nativeFallbacks: nativeFallbacks.value.filter(c => c !== primaryNativeLanguage.value),
    provider: provider.value,
    rememberKey: rememberKey.value,
    accountToken: accountToken.value.trim(),
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

async function syncNow() {
  const token = accountToken.value.trim();
  if (!token) return;
  syncing.value = true;
  try {
    const result = await browser.storage.local.get('pendingWatchTime');
    const stored = (result['pendingWatchTime'] as Record<string, Record<string, number>>) ?? {};
    const sessions = Object.entries(stored).flatMap(([date, videos]) =>
      Object.entries(videos).map(([video_id, seconds]) => ({ video_id, seconds, date }))
    );
    if (sessions.length === 0) {
      showSyncStatus('Nothing to sync.');
      return;
    }
    const res = await fetch('http://localhost:8000/api/watch/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
      body: JSON.stringify({ sessions }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await browser.storage.local.remove('pendingWatchTime');
    pendingWatchData.value = {};
    showSyncStatus(`Synced ${sessions.length} session${sessions.length !== 1 ? 's' : ''}.`);
  } catch (e) {
    showSyncStatus(`Sync failed: ${(e as Error).message}`, false);
  } finally {
    syncing.value = false;
  }
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

.sync-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
}

.action-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.code {
  font-family: var(--font-mono);
  font-size: var(--font-sm);
  background: var(--bg-raised);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
}
</style>
