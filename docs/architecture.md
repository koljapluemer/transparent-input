# Architecture

## Overview

Transparent Input is a Firefox browser extension that overlays vocabulary cards on YouTube videos. When a user watches a video in a supported language, the extension extracts the subtitles, sends them to a backend for NLP processing, and then displays word = translation cards at the moments in the video those words are spoken.

```
Firefox Extension          Django Backend           Celery Worker
──────────────────         ───────────────          ─────────────
yt-navigate-finish    →    GET /api/videos/:id/
                      ←    404 (unknown video)
GET Innertube API
(ANDROID client)
→ caption track URL
fetch subtitle JSON
POST /api/videos/     →    create Video stub
  :id/submit/              create ProcessingJob
                           enqueue task
                      ←    202 Accepted
poll every 5s         →    GET /api/videos/:id/
                      ←    200 {processing: {status: "running"}}
                      →    GET /api/videos/:id/
                      ←    200 {segments: [...]}   (task done)
start vocab overlay
```

## Components

### Browser Extension (`browser-plugin/`)

Two content scripts injected into every `youtube.com` page:

- **`page-world.js`** — runs in the page's MAIN JavaScript world. Exists to make fetches that carry YouTube's full session context when needed (kept for future use; currently subtitle fetches go direct).
- **`content.js`** — runs in the extension's isolated world. Handles all logic: navigation detection, subtitle extraction, backend communication, overlay rendering.

Navigation is tracked via YouTube's `yt-navigate-finish` custom event, which fires on every SPA navigation. The initial page load is handled by an IIFE.

### Django Backend (`django-backend/`)

Standard Django REST Framework app. Key models:

- **`Language`** — supported languages, with both ISO 639-3 (`iso3`) and BCP-47 (`subtitle_language`) codes. The BCP-47 code is what YouTube uses in caption track metadata; the iso3 is used to look up the processing pipeline.
- **`Video`** — identified by YouTube video ID. Stores the processed `segments` as a JSONField. Created as a stub on first submit, segments filled in after processing.
- **`ProcessingJob`** — tracks one processing run: status (`pending → running → done/failed`), which pipeline ran, the raw transcript, and timestamps. Multiple jobs per video are possible (e.g. re-processing with a different pipeline).

The `submit` endpoint deduplicates: if a `pending` or `running` job already exists for a video + pipeline combination, it returns the existing job rather than enqueuing a duplicate.

### Celery Worker (`vocab/tasks.py`, `vocab/pipelines/`)

Async task processing using Celery + Redis. The `process_video` task atomically claims a job (CAS on `pending → running`), runs the pipeline, and writes results back to the `Video.segments` field.

Pipelines live in `vocab/pipelines/` and are registered in `vocab/pipelines/__init__.py`. Each pipeline declares:
- `name` — identifier stored on the job, e.g. `"ita-spacy-mymemory"`
- `queue` — which Celery queue to use (`"vps"` or `"local"`)
- `process(transcript)` — takes `[{start, end, text}]`, returns segments

Currently one pipeline: `ItalianPipeline` (`vocab/pipelines/italian.py`).

## Data Flow: Segments Format

The pipeline output and the format stored in `Video.segments`:

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

The extension reads this and, while the video plays, shows cards for words in the currently active segment.

## Dev Setup

```
just dev        # starts Redis + Django + Celery worker + Firefox Dev Edition
just backend    # Django only
just worker     # Celery worker (vps queue)
just plugin     # Firefox with extension loaded + auto-reload
```

One-time setup: `just setup` (installs deps, downloads spaCy model, runs migrations).
