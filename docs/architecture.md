# Architecture

## Overview

Transparent Input is a Firefox browser extension that overlays vocabulary cards on YouTube videos. When a user watches a video in a supported language, the extension either (a) submits the subtitles to a backend for server-side NLP processing, or (b) processes them directly in the browser using a user-provided LLM API key. Either way the result is a list of timed vocab segments stored on the backend and served back to the extension, which displays word = translation cards as the video plays.

```
Firefox Extension                Django Backend              Celery Worker
────────────────                 ───────────────             ─────────────
yt-navigate-finish    →          GET /api/videos/:id/
                      ←          404 (unknown video)
GET Innertube API
(ANDROID client)
→ caption track URL
fetch subtitle JSON

── Server-side path ──────────────────────────────────────────────────────
POST /api/videos/     →          create Video stub
  :id/submit/                    create ProcessingJob
                                 enqueue task             ←  process_video()
                      ←          202 Accepted
poll every 5s         →          GET /api/videos/:id/
                      ←          200 {processing: {status: "running"}}
                      →          GET /api/videos/:id/
                      ←          200 {segments: [...]}   (task done)

── Client-side LLM path ──────────────────────────────────────────────────
(user has API key set in extension options)
fetch subtitle JSON
build meta-segments (DP)
call OpenAI / Gemini
  per meta-segment
POST /api/videos/     →          store VideoTranslation
  :id/translations/
                      ←          201 {status: "stored"}
load segments locally
start vocab overlay
```

## Glossary

- **Target language** — the language the user is *learning* (the video's language, e.g. Italian).
- **Native language** — a language the user *already speaks* (what vocabulary is translated *into*, e.g. English or French).

## Components

### Browser Extension (`browser-plugin/`)

Built with **WXT** (wraps Vite) and TypeScript, targeting Firefox MV2. Three entrypoints:

- **`entrypoints/content.ts`** — runs in the extension's isolated world. All logic: navigation detection, subtitle extraction, server-side submit/poll cycle, client-side LLM processing, overlay rendering, settings reads from `browser.storage`.
- **`entrypoints/page-world.ts`** — runs in the page's MAIN JavaScript world. Provides a `postMessage`-based fetch proxy; currently unused (the ANDROID Innertube trick bypasses the need for credentialed fetches).
- **`entrypoints/options/`** — settings page (`open_in_tab: true`). Uses `iso-639-1` for the full language list and `tom-select` for searchable language selectors. Stores settings in `browser.storage.local` (key optionally in `browser.storage.session` for session-only mode).

Navigation is tracked via YouTube's `yt-navigate-finish` custom event. The initial page load is handled by an inline call in `main()`.

**User settings** (stored in `browser.storage.local`):
```json
{
  "primaryNativeLanguage": "en",
  "nativeFallbacks": ["fr"],
  "provider": "openai",
  "apiKey": "sk-...",
  "rememberKey": true
}
```

**Toolbar phases** (state machine in `content.ts`):
| Phase | Meaning |
|-------|---------|
| `no-video` | Not on a watch page — toolbar hidden |
| `checking` | GETting `/api/videos/:id/` |
| `loading` | Fetching caption tracks + supported languages |
| `ready` | Language selector shown, waiting for user to click Translate |
| `submitting` | Fetching subtitles + POSTing to backend |
| `ai-processing` | Client-side LLM calls running, segment count shown |
| `polling` | Waiting for Celery job |
| `done` | Segments loaded, vocab overlay active |
| `error` | Terminal failure, Retry available |

### Django Backend (`django-backend/`)

Standard Django REST Framework app. Key models:

- **`Language`** — supported *target* languages (videos the extension can process), with both ISO 639-3 (`iso3`) and BCP-47 (`subtitle_language`) codes.
- **`Video`** — identified by YouTube video ID. `segments` JSONField stores server-side pipeline output (legacy; kept for backward compatibility).
- **`VideoTranslation`** — stores one set of processed segments keyed by `(video, pipeline, native_language)`. This is the primary storage for client-side LLM results and will eventually replace `Video.segments` for all paths.
- **`ProcessingJob`** — tracks one server-side processing run: status (`pending → running → done/failed`), which pipeline ran, the raw transcript, and timestamps.

### Celery Worker (`vocab/tasks.py`, `vocab/pipelines/`)

Async task processing using Celery + Redis. The `process_video` task atomically claims a job (CAS on `pending → running`), runs the pipeline, and writes results back to `Video.segments`.

Pipelines live in `vocab/pipelines/` and are registered in `vocab/pipelines/__init__.py`. Each pipeline declares:
- `name` — identifier stored on the job, e.g. `"ita-spacy-mymemory"`
- `queue` — which Celery queue to use (`"vps"` or `"local"`)
- `process(transcript)` — takes `[{start, end, text}]`, returns segments

Current pipelines: `ItalianPipeline` (`ita-spacy-mymemory`), `VietnamesePipeline` (`vie-underthesea-mymemory`). Both use Argos Translate for offline translation.

## API Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `GET` | `/api/languages/` | List supported target languages |
| `GET` | `/api/videos/:id/` | Video detail + available translations list |
| `POST` | `/api/videos/:id/submit/` | Submit for server-side processing |
| `POST` | `/api/videos/:id/translations/` | Store client-side LLM result |
| `GET` | `/api/videos/:id/translations/:native_language/` | Fetch segments for a specific native language |

### GET `/api/videos/:id/` response shape

```json
{
  "youtube_id": "dQw4w9WgXcQ",
  "language": { "iso3": "ita", "subtitle_language": "it", "human_readable": "Italian" },
  "segments": [...],
  "topics": null,
  "processing": { "id": 42, "pipeline": "ita-spacy-mymemory", "status": "done", "created_at": "..." },
  "available_translations": [
    { "pipeline": "openai-gpt-4.1", "native_language": "en", "created_at": "..." },
    { "pipeline": "gemini-flash",   "native_language": "fr", "created_at": "..." }
  ]
}
```

`segments` holds server-side pipeline output (always present if that path has run). `available_translations` lists all `VideoTranslation` rows for this video (client-side LLM results). The extension walks `available_translations` in the user's preference order before falling back to `segments`.

## Data Flow: Segments Format

All pipelines and the client-side LLM produce the same segment shape:

```json
[
  {
    "index": 1,
    "startTimestamp": "00:00:33.480",
    "endTimestamp": "00:00:34.680",
    "vocab": {
      "venire": "to come",
      "prima": "first"
    }
  }
]
```

`VideoTranslation.segments` stores this list for a specific `(pipeline, native_language)` combination. `Video.segments` stores it without a native language dimension (always the server pipeline's default, typically English).

## Client-Side LLM Pipeline

When the user has an API key configured, the extension runs the full pipeline locally:

1. **Subtitle fetch** — same Innertube ANDROID client path as the server-side flow.
2. **Meta-segmentation** — a dynamic-programming algorithm (`buildMetaSegments` in `content.ts`) groups raw subtitle cues into segments of 8–50 words, targeting an ideal range of 12–25 words. Penalises splits at overlapping timestamps. Ported from `docs/LEGACY_INSPIRATION_SCRIPT.py`.
3. **LLM vocab extraction** — one request per meta-segment. Prompt instructs the model to extract core vocabulary and translate into the user's native language. Supports OpenAI (`gpt-4.1`) and Gemini (`gemini-2.0-flash`). Single retry on failure; failed segments are skipped (not fatal).
4. **Store** — result POSTed to `POST /api/videos/:id/translations/` with `{pipeline, native_language, segments}`.
5. **Serve** — segments loaded immediately from memory without waiting for the backend round-trip to complete.

Pipeline name strings: `"openai-gpt-4.1"` or `"gemini-flash"`.

## Native Language Preference Chain

On video load, the extension resolves which translation to serve:

1. Walk `[primaryNativeLanguage, ...nativeFallbacks]` against `available_translations`.
2. First match: fetch `GET /api/videos/:id/translations/<native_language>/` and load.
3. No match: fall back to `Video.segments` (server-side, language-unaware).
4. Nothing: offer to process (READY phase).

When serving a fallback language, the toolbar shows "Shown in French · Process in English →" with a button to trigger LLM processing in the primary native language.

## Dev Setup

```
just plugin           # WXT dev server — Firefox Dev Edition with HMR
just backend          # Django only
just worker           # Celery worker (vps queue)
just dev              # Redis + Django + Celery + plugin all at once
```

One-time setup: `just setup` (installs backend deps, downloads spaCy model, runs migrations).

Plugin setup: `cd browser-plugin && npm install` (installs WXT, iso-639-1, tom-select).
