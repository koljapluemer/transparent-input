import type { UserSettings } from './types';

export async function loadUserSettings(): Promise<UserSettings> {
  const local = await browser.storage.local.get([
    'primaryNativeLanguage', 'nativeFallbacks', 'provider', 'apiKey', 'rememberKey', 'accountToken',
  ]);
  let apiKey = (local.apiKey as string) || '';
  if (!apiKey) {
    try {
      const session = await browser.storage.session.get('apiKey');
      apiKey = (session.apiKey as string) || '';
    } catch {
      // browser.storage.session unavailable
    }
  }
  return {
    primaryNativeLanguage: (local.primaryNativeLanguage as string) || 'en',
    nativeFallbacks: Array.isArray(local.nativeFallbacks) ? (local.nativeFallbacks as string[]) : [],
    provider: ((local.provider as string) === 'gemini') ? 'gemini' : 'openai',
    apiKey,
    accountToken: (local.accountToken as string) || '',
  };
}
