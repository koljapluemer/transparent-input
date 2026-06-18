# django-backend

Django REST API serving per-video vocab/snippet data for the transparent-input project.

## Stack

- Python 3.13, Django 6, Django REST Framework
- SQLite (dev)
- uv for dependency management

## Setup

```bash
uv sync
uv run python manage.py migrate
```

## Importing data

Point the import command at the `2_export` directory from the `video-vocab` repo:

```bash
uv run python manage.py import_vocab /path/to/vv-data/2_export
```

Re-running is safe — existing records are updated, not duplicated.

## Running

```bash
uv run python manage.py runserver
```

## Data model

**`Language`** — one row per target language.

| Field | Type | Notes |
|---|---|---|
| `iso3` | CharField (PK) | ISO 639-3 code, e.g. `deu` |
| `subtitle_language` | CharField | BCP-47 code used for subtitle lookup, e.g. `de` |
| `human_readable` | CharField | Display name, e.g. `German` |

**`Video`** — one row per YouTube video × language pair.

| Field | Type | Notes |
|---|---|---|
| `youtube_id` | CharField (unique) | YouTube video ID |
| `language` | FK → Language | |
| `segments` | JSONField | Array of timed vocab segments (see below) |
| `topics` | JSONField (nullable) | Optional array of topic strings |

Each element of `segments`:
```json
{
  "index": 1,
  "startTimestamp": "00:00:00.313",
  "endTimestamp": "00:00:14.181",
  "vocab": {
    "das Bundeskanzleramt": "the Federal Chancellery"
  },
  "beginnerVocab": { ... },
  "advancedVocab": { ... }
}
```

`beginnerVocab` and `advancedVocab` are optional and appear in some languages only.

## API

Base URL: `http://localhost:8000/api/`

### `GET /api/languages/`

List all available languages.

```json
[
  { "iso3": "deu", "subtitle_language": "de", "human_readable": "German" },
  ...
]
```

### `GET /api/videos/`

List all videos (without segment data).

Query params:
- `?language=<iso3>` — filter by language, e.g. `?language=ita`

```json
[
  {
    "youtube_id": "1l5caXiiO8w",
    "language": { "iso3": "deu", "subtitle_language": "de", "human_readable": "German" }
  },
  ...
]
```

### `GET /api/videos/<youtube_id>/`

Full video data including all segments and vocab.

```json
{
  "youtube_id": "1l5caXiiO8w",
  "language": { "iso3": "deu", "subtitle_language": "de", "human_readable": "German" },
  "segments": [ ... ],
  "topics": null
}
```
