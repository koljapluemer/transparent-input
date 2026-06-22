<template>
  <div class="min-h-screen bg-base-100 p-8 max-w-lg">
    <h1 class="text-lg font-semibold mb-8">Transparent Input</h1>

    <section class="mb-7">
      <h2 class="text-xs font-semibold text-base-content/50 uppercase tracking-widest mb-3">Your native language</h2>
      <div class="form-control gap-3">
        <label class="label pb-0"><span class="label-text">I primarily speak</span></label>
        <LanguagePicker v-model="primaryNativeLanguage" :options="allLanguageOptions" placeholder="Search for a language…" />

        <label class="label pb-0 pt-3"><span class="label-text">I also speak (fallbacks — served if a video is already translated)</span></label>
        <LanguageTagInput v-model="nativeFallbacks" :options="allLanguageOptions" placeholder="Add languages you also speak…" />
      </div>
    </section>

    <div class="divider" />

    <section class="mb-7">
      <h2 class="text-xs font-semibold text-base-content/50 uppercase tracking-widest mb-3">AI provider</h2>
      <div class="flex gap-6">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="radio" class="radio radio-primary radio-sm" name="provider" value="openai" v-model="provider" />
          <span>OpenAI</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="radio" class="radio radio-primary radio-sm" name="provider" value="gemini" v-model="provider" />
          <span>Gemini</span>
        </label>
      </div>
    </section>

    <section class="mb-7">
      <h2 class="text-xs font-semibold text-base-content/50 uppercase tracking-widest mb-3">API key</h2>
      <div class="flex gap-2 items-center">
        <input
          class="input input-bordered flex-1"
          :type="showKey ? 'text' : 'password'"
          v-model="apiKey"
          placeholder="Paste your API key here"
          autocomplete="off"
        />
        <button class="btn btn-ghost btn-sm" @click="showKey = !showKey">
          <component :is="showKey ? EyeOff : Eye" :size="16" />
        </button>
      </div>
      <label class="flex items-center gap-2 mt-3 cursor-pointer">
        <input type="checkbox" class="checkbox checkbox-primary checkbox-sm" v-model="rememberKey" />
        <span class="text-sm text-base-content/70">Remember key across browser restarts</span>
      </label>
    </section>

    <div class="divider" />

    <section class="mb-7">
      <h2 class="text-xs font-semibold text-base-content/50 uppercase tracking-widest mb-3">Account</h2>
      <p class="text-sm text-base-content/60 mb-3">
        Get a token at <span class="font-mono text-xs bg-base-200 px-1 py-0.5 rounded">localhost:8000/profile/</span>
      </p>
      <div class="flex gap-2 items-center">
        <input
          class="input input-bordered flex-1 font-mono text-sm"
          :type="showToken ? 'text' : 'password'"
          v-model="accountToken"
          placeholder="Paste your account token here"
          autocomplete="off"
        />
        <button class="btn btn-ghost btn-sm" @click="showToken = !showToken">
          <component :is="showToken ? EyeOff : Eye" :size="16" />
        </button>
      </div>
      <div class="flex items-center gap-3 mt-3">
        <button class="btn btn-outline btn-sm" @click="syncNow" :disabled="syncing || !accountToken">
          {{ syncing ? 'Syncing…' : 'Sync now' }}
        </button>
        <span v-if="pendingMinutes > 0" class="text-sm text-base-content/60">
          {{ pendingMinutes }} min pending
        </span>
        <span v-if="syncMsg" :class="syncOk ? 'text-success' : 'text-error'" class="text-sm">{{ syncMsg }}</span>
      </div>
    </section>

    <div class="divider" />

    <div class="flex gap-3 items-center">
      <button class="btn btn-primary" @click="save">Save settings</button>
      <button class="btn btn-outline btn-error btn-sm" @click="removeKey">Remove key</button>
      <span v-if="statusMsg" :class="statusOk ? 'text-success' : 'text-error'" class="text-sm">{{ statusMsg }}</span>
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
