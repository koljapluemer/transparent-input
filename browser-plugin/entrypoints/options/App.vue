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

    <div class="flex gap-3 items-center">
      <button class="btn btn-primary" @click="save">Save settings</button>
      <button class="btn btn-outline btn-error btn-sm" @click="removeKey">Remove key</button>
      <span v-if="statusMsg" :class="statusOk ? 'text-success' : 'text-error'" class="text-sm">{{ statusMsg }}</span>
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
