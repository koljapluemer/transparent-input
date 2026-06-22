import ISO6391 from 'iso-639-1';
import TomSelect from 'tom-select';
import 'tom-select/dist/css/tom-select.default.css';
import './style.css';

// ── Language data ─────────────────────────────────────────────────────────────
// iso-639-1 covers 184 ISO 639-1 languages. For display names we use
// Intl.DisplayNames so the browser's locale data handles the text.

const display = new Intl.DisplayNames(['en'], { type: 'language' });

const allLanguageOptions = ISO6391.getAllCodes().map(code => ({
  value: code,
  text: display.of(code) ?? ISO6391.getName(code),
})).sort((a, b) => a.text.localeCompare(b.text));

// ── TomSelect instances ───────────────────────────────────────────────────────

const primarySelect = new TomSelect('#primary-native-language', {
  options: allLanguageOptions,
  valueField: 'value',
  labelField: 'text',
  searchField: ['text'],
  maxItems: 1,
  create: false,
  plugins: ['clear_button'],
  placeholder: 'Search for a language…',
});

const fallbacksSelect = new TomSelect('#native-fallbacks', {
  options: allLanguageOptions,
  valueField: 'value',
  labelField: 'text',
  searchField: ['text'],
  plugins: { 'drag_drop': {}, 'remove_button': { title: 'Remove' } },
  maxItems: null,
  placeholder: 'Add languages you also speak…',
});

// ── DOM refs ──────────────────────────────────────────────────────────────────

const apiKeyInput   = document.getElementById('api-key') as HTMLInputElement;
const showKeyBtn    = document.getElementById('show-key-btn') as HTMLButtonElement;
const rememberCheck = document.getElementById('remember-key') as HTMLInputElement;
const saveBtn       = document.getElementById('save-btn') as HTMLButtonElement;
const removeKeyBtn  = document.getElementById('remove-key-btn') as HTMLButtonElement;
const statusMsg     = document.getElementById('status-msg') as HTMLSpanElement;

// ── Key show/hide ─────────────────────────────────────────────────────────────

showKeyBtn.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  showKeyBtn.textContent = isPassword ? 'Hide' : 'Show';
});

// ── Status helper ─────────────────────────────────────────────────────────────

function showStatus(msg: string, isError = false): void {
  statusMsg.textContent = msg;
  statusMsg.className = isError ? 'status-err' : 'status-ok';
  setTimeout(() => { statusMsg.textContent = ''; statusMsg.className = ''; }, 3000);
}

// ── Load settings ─────────────────────────────────────────────────────────────

async function loadSettings(): Promise<void> {
  const local = await browser.storage.local.get([
    'primaryNativeLanguage', 'nativeFallbacks', 'provider', 'apiKey', 'rememberKey',
  ]);

  const primaryCode = (local.primaryNativeLanguage as string) || 'en';
  primarySelect.setValue(primaryCode, true);

  const fallbacks = Array.isArray(local.nativeFallbacks) ? (local.nativeFallbacks as string[]) : [];
  fallbacksSelect.setValue(fallbacks, true);

  if (local.provider) {
    const radio = document.querySelector<HTMLInputElement>(`input[name="provider"][value="${local.provider}"]`);
    if (radio) radio.checked = true;
  }

  rememberCheck.checked = (local.rememberKey as boolean) !== false;

  let apiKey = (local.apiKey as string) || '';
  if (!apiKey) {
    try {
      const session = await browser.storage.session.get('apiKey');
      apiKey = (session.apiKey as string) || '';
    } catch { /* storage.session may not be available */ }
  }
  apiKeyInput.value = apiKey;
}

// ── Save settings ─────────────────────────────────────────────────────────────

saveBtn.addEventListener('click', async () => {
  const primaryNativeLanguage = primarySelect.getValue() as string;
  const nativeFallbacks = (fallbacksSelect.getValue() as string[]).filter(c => c !== primaryNativeLanguage);
  const provider = document.querySelector<HTMLInputElement>('input[name="provider"]:checked')?.value ?? 'openai';
  const apiKey = apiKeyInput.value.trim();
  const rememberKey = rememberCheck.checked;

  await browser.storage.local.set({ primaryNativeLanguage, nativeFallbacks, provider, rememberKey });

  if (apiKey) {
    if (rememberKey) {
      await browser.storage.local.set({ apiKey });
      await browser.storage.session.remove('apiKey');
    } else {
      await browser.storage.local.remove('apiKey');
      await browser.storage.session.set({ apiKey });
    }
  }

  showStatus('Settings saved.');
});

// ── Remove key ────────────────────────────────────────────────────────────────

removeKeyBtn.addEventListener('click', async () => {
  await browser.storage.local.remove('apiKey');
  try { await browser.storage.session.remove('apiKey'); } catch { /* ok */ }
  apiKeyInput.value = '';
  showStatus('Key removed.');
});

// ── Init ──────────────────────────────────────────────────────────────────────

loadSettings();
