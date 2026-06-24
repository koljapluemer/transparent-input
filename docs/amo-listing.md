# AMO Store Listing Copy

## Summary (≤ 250 chars)

```
Overlays vocabulary cards on YouTube videos as you watch. Set your target language and AI API key; the extension highlights new words with translations — comprehensible input, hands-free.
```

## Description

```
Transparent Input helps you learn languages by watching YouTube using the comprehensible input method.

HOW IT WORKS

Navigate to any YouTube video in your target language. The extension fetches the subtitles and sends them to OpenAI or Gemini (using your own API key) to extract vocabulary. Timed vocabulary cards appear on screen — word in the target language, translation into your native language — exactly when that segment plays.

SETUP

1. Open the extension's Options page (click the toolbar icon → Options).
2. Choose your native language (and any additional fallback languages).
3. Select OpenAI or Gemini as your AI provider and paste your API key.
4. Navigate to a YouTube video in a language you are learning.
5. The extension detects the video, processes subtitles, and starts the overlay automatically.

PRIVACY

• Your API key is stored in your browser's local storage only — it never leaves your device except to call OpenAI/Gemini directly.
• Subtitle text is sent to the AI provider you choose, under your account and their privacy policy. No subtitle or user data is stored by this extension beyond the duration of the API call.
• No analytics, tracking, or third-party services are used.

REQUIREMENTS

• An OpenAI or Google Gemini API key (free tiers are sufficient for casual use).
• YouTube videos must have subtitles/captions available.
```

## Permission justification (for AMO submission notes)

> **`https://api.openai.com/*` and `https://generativelanguage.googleapis.com/*`**
>
> These hosts are called directly from the extension using an API key the user pastes into the Options page. The key is stored in `browser.storage.local` and never transmitted anywhere except to the chosen provider. The extension does not operate any backend that touches these APIs — the call is user-initiated, using the user's own account.
