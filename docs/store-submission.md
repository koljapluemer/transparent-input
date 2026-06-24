# Store Submission Checklist

## Done (technical — already applied)

- [x] `localhost` removed from `host_permissions` in production builds (dev-only via `mode === 'development'`)
- [x] `browser_specific_settings` / gecko ID added to Firefox manifest (`transparent-input@transparent-input.app` — change if needed)
- [x] Chrome build scripts added: `just plugin-build-chrome`, `just plugin-zip-chrome`

---

## Firefox Add-ons (AMO)

- [x] **Icons** — `browser-plugin/public/icon/{16,32,48,96,128}.png` generated from `assets/icon/base.png`
- [x] **Replace gecko ID** — current ID is `transparent-input@transparent-input.app`; update in `wxt.config.ts` only if you change the extension domain
- [ ] **Source zip** — AMO requires submitting the source when the build is bundled; run `wxt zip --sources` and upload the generated source zip alongside the extension zip
- [x] **Reproducible build note** — `browser-plugin/.nvmrc` created (Node 25.4.0); build command for submission notes: `npm install && npm run zip`
- [x] **OpenAI / Gemini permissions** — justification text written in `docs/amo-listing.md`
- [x] **Store listing copy** — summary and description written in `docs/amo-listing.md`
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
