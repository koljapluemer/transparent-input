# Server-Side NLP Pipeline (removed 2026-06)

This describes the Celery/Redis worker that was removed because it made deployment costly
and complex. The client-side LLM path (OpenAI / Gemini) now handles all processing.

## What it did

Given a subtitle transcript, the worker ran a language-specific NLP pipeline to extract
vocabulary words and translate them into English — no LLM API key required from the user.

Flow:

```
Browser plugin                 Django (web process)          Celery worker
──────────────                 ────────────────────          ─────────────
POST /api/videos/:id/submit/  →  create Video + ProcessingJob
  {language_iso3, transcript}     enqueue process_video(job_id)  ←  pick up task
                              ←  202 Accepted
poll GET /api/videos/:id/     →  return {processing: {status}}
  every 5s                    ←  ...until status === "done"
                              ←  {segments: [...]}  (on Video.segments JSONField)
```

Timeout: 120 poll attempts × 5 s = 10 minutes max wait. On failure the job status
flips to `"failed"` and the plugin shows a retry button.

## Pipelines

Both pipelines share the same output format as the LLM path — a list of timed
segments with a `vocab` dict.

### `ita-spacy-mymemory` (Italian)

1. **spaCy** (`it_core_news_sm`) tokenises and POS-tags each subtitle cue.
2. Lemmas tagged `NOUN | VERB | ADJ`, non-stop, alpha, >2 chars are kept (deduped).
3. All lemmas are batch-translated via **Argos Translate** (`it → en` model).
4. One segment per cue that has ≥1 translated word.

### `vie-underthesea-mymemory` (Vietnamese)

1. **underthesea** `pos_tag` tags each cue (Vietnamese-specific NLP library).
2. Tokens tagged `N | V | A`, alpha (including spaces in multi-syllable words), >1 char.
3. Same Argos Translate batch translation (`vi → en`).

### Translation helper (`translation.py`)

Words are joined with `\n` and sent as one Argos Translate call. The response is
split back on `\n` to pair source ↔ translation. Line-count mismatches (neural model
artifact) are tolerated: extra lines are dropped, missing lines are skipped.

## Tech stack

| Layer | Tech |
|-------|------|
| Task queue | **Celery 5** with **Redis** broker + result backend |
| NLP — Italian | **spaCy** `it_core_news_sm` (small, CPU-only) |
| NLP — Vietnamese | **underthesea** (Vietnamese-specific, includes its own models) |
| Translation | **Argos Translate** (offline neural MT, CTranslate2 under the hood) |
| Model install | `python manage.py install_argos_models` — fetches packages from the Argos index |

Celery queue name: `vps` (one queue, two workers, `-c 2`). The `queue` field on each
pipeline class was a hook for a future `local` queue to run heavier models on a
developer machine.

## Infrastructure

Two extra services on top of the Django web process:

- **Redis** — broker + result backend for Celery
- **Celery worker** — runs `install_argos_models` at boot then starts Celery

The worker's startup command downloaded ~500 MB of Argos model files on every cold
boot, which was the main cost/complexity driver for removal.

## Django models

- **`ProcessingJob`** — one row per server-side processing run. Fields: `video`,
  `pipeline`, `status` (`pending → running → done/failed`), `raw_transcript` (JSON),
  `started_at`, `finished_at`, `error`.
- **`Video.segments`** — JSONField on the Video model that stored the pipeline's
  output. Superseded by `VideoTranslation` (which is keyed by native language and
  pipeline and is still in use).

## What to rebuild

To bring this back you need:

1. Restore the models and migration (`ProcessingJob`, `Video.segments`).
2. Restore `vocab/pipelines/`, `vocab/tasks.py`, `vocab/management/commands/install_argos_models.py`.
3. Restore `backend/celery.py` and the `backend/__init__.py` import.
4. Re-add `CELERY_*` settings and the argostranslate/stanza/ctranslate2 logger
   suppressions to `settings.py`.
5. Re-add the `submit` action on `VideoViewSet` and its serializers.
6. Re-add `pyproject.toml` deps: `celery[redis]`, `argostranslate`, `spacy`, `underthesea`.
7. Re-add Redis and a Celery worker service to the deployment config.
8. In the plugin: restore `PHASE.SUBMITTING`, `PHASE.POLLING`, `submitForProcessing`,
   `startPolling`/`stopPolling`, the polling state fields on `State`, and the toolbar
   render branches for those phases.
