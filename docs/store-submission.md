# Store Submission Checklist

## Done (technical — already applied)

- [x] `localhost` removed from `host_permissions` in production builds (dev-only via `mode === 'development'`)
- [x] `browser_specific_settings` / gecko ID added to Firefox manifest (`transparent-input@transparent-input.app` — change if needed)
- [x] Chrome build scripts added: `just plugin-build-chrome`, `just plugin-zip-chrome`

---

## Firefox Add-ons (AMO)

- [ ] **Icons** — create `browser-plugin/public/icon/{16,32,48,96,128}.png`; WXT picks them up automatically
- [ ] **Replace gecko ID** if you change the extension domain (`wxt.config.ts` → `browser_specific_settings.gecko.id`)
- [ ] **Source zip** — AMO requires submitting the source when the build is bundled; run `wxt zip --source` and upload the generated source zip alongside the extension zip
- [ ] **Reproducible build note** — AMO reviewers will try to build from source; add a `browser-plugin/.nvmrc` (pin Node version) and note the exact build command in the submission notes (`npm install && npm run zip`)
- [ ] **OpenAI / Gemini permissions** — be ready to explain in the submission notes why `api.openai.com` and `generativelanguage.googleapis.com` are in `host_permissions` (user-provided API key, data not stored by extension beyond the API call)
- [ ] **Store listing copy** — AMO requires a summary (≤ 250 chars) and description
- [ ] **Screenshots** — at least one screenshot of the overlay in action on a YouTube video

## Chrome Web Store

- [ ] **Icons** — same `public/icon/` set as Firefox (shared)
- [ ] **Privacy policy** — a publicly hosted URL is required; even a minimal one-pager suffices
- [ ] **Store listing copy** — short description (132 chars max) + detailed description
- [ ] **Screenshots** — 1–5 screenshots at 1280×800 or 640×400
- [ ] **Promo tile** — 440×280 small promo image (shown in search results)
- [ ] **Justify sensitive permissions** — Chrome console will ask you to justify `https://api.openai.com/*` and `https://generativelanguage.googleapis.com/*`; prepare a written justification
- [ ] **Single-purpose policy** — confirm the store description clearly states the extension's single purpose (vocab overlay for YouTube)
- [ ] **Developer account** — one-time $5 registration fee if not already registered

## Both stores

- [ ] Test production build end-to-end: run `just plugin-zip` / `just plugin-zip-chrome`, install from the zip, and verify overlay works on a real YouTube video (no localhost backend — use client-side LLM path)
- [ ] Bump `version` in `wxt.config.ts` before first submission
