# Technical Findings

Hard-won discoveries from building this. Read before touching the YouTube integration or adding a new language pipeline.

## YouTube Subtitle Extraction

### `ytInitialPlayerResponse` is stale on SPA navigation

YouTube is a single-page app. The global `window.ytInitialPlayerResponse` is only set on the initial page load and is **not updated** when the user navigates to a different video. Reading it on `yt-navigate-finish` always returns data for the first video loaded in the tab.

**Solution:** Use YouTube's Innertube API instead (see below). Do not go back to reading `ytInitialPlayerResponse` from the page or from fetched HTML — it caused multiple debugging cycles.

### The Innertube ANDROID client bypasses PoToken

YouTube's web player timedtext API (`/api/timedtext?...`) started requiring a Proof-of-Origin Token (`&pot=`) sometime in 2025. Without it, the endpoint returns HTTP 200 with an empty body — no error, no explanation. This affects:
- Fetches from extension content scripts
- Fetches from the page's own JavaScript context
- Server-side requests (yt-dlp, youtube-transcript-api, etc.)

**Solution:** POST to YouTube's internal Innertube API (`/youtubei/v1/player`) with an ANDROID client context. The ANDROID client returns caption track `baseUrl` values that don't require PoToken:

```javascript
fetch('https://www.youtube.com/youtubei/v1/player', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30 } },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  }),
})
```

This is the same workaround used by yt-dlp and the youtube-transcript-api ecosystem. It may break if YouTube closes the ANDROID client loophole — check those projects for updated client contexts if it stops working.

### ANDROID client URLs already contain a `fmt` parameter

The `baseUrl` values returned by the ANDROID Innertube response include `&fmt=srv3` (YouTube's XML-based format). Naively appending `&fmt=json3` results in both parameters being present and the server honoring the first one, returning XML instead of JSON.

**Solution:** Strip any existing `fmt` parameter before appending:
```javascript
const subtitleUrl = track.baseUrl.replace(/[&?]fmt=[^&]*/g, '') + '&fmt=json3';
```

### Caption track language codes are BCP-47, not ISO 639-3

YouTube's caption tracks use BCP-47 codes (`languageCode: "it"`, `"fr-FR"`, `"de-DE"`). The backend's `Language` model stores iso3 codes (`"ita"`, `"fra"`, `"deu"`). The `Language` model has a separate `subtitle_language` field for the BCP-47 code used to match against YouTube tracks. Both fields must be populated when adding a new language.

## Processing Pipeline

### Per-word translation is unusably slow

An initial implementation translated each unique word with a separate HTTP request to MyMemory. A typical Italian video subtitle track has 200–500 unique candidate words — at ~0.5–1s per request, the Celery task would take 2–8 minutes and appear hung.

**Solution:** Collect all unique words across the entire transcript first, then batch-translate by joining with `\n` and sending chunks of ≤490 characters (MyMemory's limit). This reduces API calls from O(words) to O(words/~30), bringing processing time to ~15–30 seconds for a typical video.

The batch approach relies on MyMemory preserving newlines in translated output, which it does for single-word inputs. For multi-word phrases this may break — keep vocab inputs to single lemmas.

## Adding a New Language

### What needs to happen

1. **Add a `Language` row to the DB:**
   ```python
   Language.objects.create(name="French", iso3="fra", subtitle_language="fr-FR")
   ```
   Note: YouTube uses multiple BCP-47 codes for the same language (e.g. `"fr"` and `"fr-FR"`). Check what code the ANDROID Innertube response actually returns for your target language before setting `subtitle_language`.

2. **Write a pipeline class** in `vocab/pipelines/` implementing `name`, `queue`, and `process(transcript)`.

3. **Register it** in `vocab/pipelines/__init__.py`:
   ```python
   _REGISTRY = {
       "ita-spacy-mymemory": ItalianPipeline(),
       "fra-spacy-mymemory": FrenchPipeline(),
   }
   _LANGUAGE_MAP = {
       "ita": "ita-spacy-mymemory",
       "fra": "fra-spacy-mymemory",
   }
   ```

### Considerations by language type

**Languages with good spaCy support** (French, German, Spanish, Portuguese, Dutch, ...): straightforward — swap the model name and source locale in MyMemoryTranslator. spaCy's `it_core_news_sm` → `fr_core_news_sm` etc. POS tags and the `KEEP_POS = {"NOUN", "VERB", "ADJ"}` filter are universal across spaCy models.

**Languages with large spaCy models** (Chinese, Japanese, Korean): the `_sm` (small) models may give poor POS results; `_md` or `_lg` models are much better but can be 500MB+. These should use `queue = "local"` and run on a machine with adequate RAM, not the VPS. The queue routing in Celery handles this transparently — just set the right `queue` on the pipeline class.

**Languages without spaCy support**: alternatives include [Stanza](https://stanfordnlp.github.io/stanza/) (broad language support, similar POS API) or falling back to frequency-based word selection (pick the N least-common words in the subtitle segment using a word frequency list). The pipeline interface is just `process(transcript) → segments` so the internals are fully swappable.

**Languages without free translation**: MyMemory's free tier covers most European languages well. For less-resourced languages, [LibreTranslate](https://libretranslate.com/) (self-hostable) or [Argos Translate](https://github.com/argosopentech/argos-translate) (fully offline) are drop-in alternatives with similar APIs. The translation logic is isolated to `_translate_batch()` in each pipeline class.

**Right-to-left languages** (Arabic, Hebrew): the vocab card display in `content.js` is plain text in a `div` with no explicit text direction. Cards would need `dir="rtl"` or a CSS `direction: rtl` property to render correctly.

### The two-queue model

- `"vps"` — lightweight models, low RAM. Currently Italian (spaCy `it_core_news_sm` is ~13MB).
- `"local"` — reserved for pipelines that need more resources than a $5 VPS can provide.

Start workers for each queue independently: `just worker` (vps) and `just worker-local` (local). Both connect to the same Redis instance. A pipeline's `queue` attribute determines which worker picks it up.
