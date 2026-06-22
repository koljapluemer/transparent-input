from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from dotenv import load_dotenv
from langcodes import Language
from openai import OpenAI
from tqdm import tqdm


PROJECT_ROOT = Path(__file__).resolve().parents[3]
VV_ROOT = PROJECT_ROOT / "exports" / "vv-data"
DESIRED_DIR = VV_ROOT / "0_desired"
ANALYZED_PATH = VV_ROOT / "1_analyzed" / "videos.json"
EXPORT_ROOT = VV_ROOT / "2_export"
VOCAB_ERROR_LOG = VV_ROOT / "1_analyzed" / "vocab_errors.log"
FRONTIER_MODEL = "gpt-4.1"
TOPICS_MODEL = "qwen3.5:4b"
MIN_META_SEGMENT_WORDS = 8
IDEAL_META_SEGMENT_MIN_WORDS = 12
IDEAL_META_SEGMENT_MAX_WORDS = 25
MIN_EXPORT_SEGMENTS = 3
MAX_META_SEGMENT_WORDS = 50
DETAILED_LOGGING = False
EXTRACT_LEVELED_VOCAB = False
TOPICS_SCHEMA = {
    "type": "object",
    "properties": {
        "topics": {
            "type": "array",
            "items": {"type": "string"},
        }
    },
    "required": ["topics"],
}


@dataclass(frozen=True)
class VideoRequest:
    iso3: str
    subtitle_language: str
    human_readable: str
    video_id: str


@dataclass(frozen=True)
class AtomicSegment:
    start: float
    end: float
    text: str
    word_count: int


@dataclass(frozen=True)
class MetaSegment:
    start: float
    end: float
    text: str
    word_count: int
    long: bool


TranscriptFetcher = Callable[[str, str], Any]


class PermanentVideoError(Exception):
    pass


class LackOfSegmentsError(Exception):
    pass


_ARGOS_AVAILABLE: set[tuple[str, str]] | None = None
_ARGOS_INSTALL_ATTEMPTED: set[tuple[str, str]] = set()


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=4)
        fh.write("\n")


def save_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def log_vocab_error(
    log_path: Path,
    *,
    iso3: str,
    video_id: str,
    segment: MetaSegment,
    failed_variant: str | None,
    raw_response: str | None,
) -> None:
    from datetime import datetime, timezone

    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "iso3": iso3,
        "videoId": video_id,
        "startTimestamp": format_timestamp(segment.start),
        "endTimestamp": format_timestamp(segment.end),
        "wordCount": segment.word_count,
        "text": segment.text,
        "failedVariant": failed_variant,
        "rawResponse": raw_response,
    }
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


def collapse_whitespace(text: str) -> str:
    return " ".join(text.split())


def count_words(text: str) -> int:
    cleaned = collapse_whitespace(text)
    if not cleaned:
        return 0
    return len(cleaned.split(" "))


def format_timestamp(seconds: float) -> str:
    total_milliseconds = int(round(seconds * 1000))
    hours, remainder = divmod(total_milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, milliseconds = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d}.{milliseconds:03d}"


def progress_write(message: str) -> None:
    tqdm.write(message, file=sys.stderr)


def detail_log(message: str) -> None:
    if DETAILED_LOGGING:
        progress_write(f"DEBUG: {message}")


def debug_preview(text: str, limit: int = 250) -> str:
    collapsed = collapse_whitespace(text)
    if len(collapsed) <= limit:
        return collapsed
    return f"{collapsed[:limit]}..."


def chunk_segments_for_translation(
    segments: list[AtomicSegment],
    *,
    max_chars: int = 400,
    max_words: int = 80,
) -> list[str]:
    chunks: list[str] = []
    current_parts: list[str] = []
    current_chars = 0
    current_words = 0

    for segment in segments:
        text = collapse_whitespace(segment.text)
        if not text:
            continue

        segment_chars = len(text)
        segment_words = segment.word_count
        would_exceed = (
            current_parts
            and (
                current_chars + 1 + segment_chars > max_chars
                or current_words + segment_words > max_words
            )
        )
        if would_exceed:
            chunks.append(collapse_whitespace(" ".join(current_parts)))
            current_parts = [text]
            current_chars = segment_chars
            current_words = segment_words
            continue

        current_parts.append(text)
        current_chars = current_chars + (1 if current_chars else 0) + segment_chars
        current_words += segment_words

    if current_parts:
        chunks.append(collapse_whitespace(" ".join(current_parts)))

    return chunks


def base_language_code(language_code: str) -> str:
    try:
        normalized = Language.get(language_code).language
    except Exception:
        normalized = ""
    if normalized:
        return normalized
    return language_code.split("-", 1)[0].split("_", 1)[0].lower()


def export_path_for_video(export_root: Path, iso3: str, video_id: str) -> Path:
    return export_root / iso3 / f"{video_id}.json"


def rebuild_language_index(export_root: Path, iso3: str) -> None:
    language_dir = export_root / iso3
    index_path = language_dir / "_index.txt"
    if not language_dir.exists():
        save_text(index_path, "")
        return

    video_ids = sorted(
        path.stem
        for path in language_dir.glob("*.json")
        if path.is_file() and not path.stem.startswith("_")
    )
    content = "\n".join(video_ids)
    if content:
        content += "\n"
    save_text(index_path, content)


def rebuild_all_language_indexes(export_root: Path) -> None:
    if not export_root.exists():
        return

    for language_dir in sorted(path for path in export_root.iterdir() if path.is_dir()):
        rebuild_language_index(export_root, language_dir.name)


def rebuild_language_topics(export_root: Path, iso3: str) -> None:
    language_dir = export_root / iso3
    if not language_dir.exists():
        return

    counts: dict[str, int] = {}
    for path in sorted(language_dir.glob("*.json")):
        if not path.is_file() or path.stem.startswith("_"):
            continue
        payload = load_json(path)
        if not isinstance(payload, dict):
            continue
        topics = normalize_topics(payload.get("topics"))
        if topics is None:
            continue
        for topic in topics:
            counts[topic] = counts.get(topic, 0) + 1

    ordered_counts = {topic: counts[topic] for topic in sorted(counts)}
    save_json(language_dir / "_topics.json", ordered_counts)

    topic_lines = sorted(topic for topic, count in counts.items() if count >= 3)
    content = "\n".join(topic_lines)
    if content:
        content += "\n"
    save_text(language_dir / "_topics.txt", content)


def rebuild_all_language_topics(export_root: Path) -> None:
    if not export_root.exists():
        return

    for language_dir in sorted(path for path in export_root.iterdir() if path.is_dir()):
        rebuild_language_topics(export_root, language_dir.name)


def load_language_labels(desired_dir: Path) -> dict[str, str]:
    labels: dict[str, str] = {}
    for path in sorted(desired_dir.glob("*.json")):
        payload = load_json(path)
        if not isinstance(payload, dict):
            raise SystemExit(f"{path} must contain a JSON object.")
        human_readable = payload.get("humanReadable")
        if not isinstance(human_readable, str) or not human_readable.strip():
            raise SystemExit(f"{path} is missing a valid 'humanReadable' string.")
        labels[path.stem] = human_readable.strip()
    return labels


def rebuild_available_languages(export_root: Path, desired_dir: Path) -> None:
    labels = load_language_labels(desired_dir)
    available: dict[str, str] = {}

    if export_root.exists():
        for language_dir in sorted(path for path in export_root.iterdir() if path.is_dir()):
            has_exports = any(
                path.is_file() and not path.stem.startswith("_")
                for path in language_dir.glob("*.json")
            )
            if not has_exports:
                continue
            available[language_dir.name] = labels.get(language_dir.name, language_dir.name)

    save_json(export_root / "available_languages.json", available)


def load_analyzed_statuses(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}

    data = load_json(path)
    if not isinstance(data, dict):
        raise SystemExit(f"{path} must contain a JSON object.")

    analyzed: dict[str, str] = {}
    for key, value in data.items():
        if not isinstance(key, str) or not key.strip():
            raise SystemExit(f"{path} contains an invalid video ID key: {key!r}")
        if not isinstance(value, str) or not value.strip():
            raise SystemExit(f"{path} contains an invalid status for {key!r}")
        analyzed[key.strip()] = value.strip()
    return analyzed


def load_video_requests(desired_dir: Path) -> list[VideoRequest]:
    requests: list[VideoRequest] = []
    for path in sorted(desired_dir.glob("*.json")):
        payload = load_json(path)
        if not isinstance(payload, dict):
            raise SystemExit(f"{path} must contain a JSON object.")

        subtitle_language = payload.get("subtitleLanguage")
        human_readable = payload.get("humanReadable")
        videos = payload.get("videos")

        if not isinstance(subtitle_language, str) or not subtitle_language.strip():
            raise SystemExit(f"{path} is missing a valid 'subtitleLanguage' string.")
        if not isinstance(human_readable, str) or not human_readable.strip():
            raise SystemExit(f"{path} is missing a valid 'humanReadable' string.")
        if not isinstance(videos, list):
            raise SystemExit(f"{path} is missing a valid 'videos' list.")

        for video_id in videos:
            if not isinstance(video_id, str) or not video_id.strip():
                raise SystemExit(f"{path} contains an invalid video ID: {video_id!r}")
            requests.append(
                VideoRequest(
                    iso3=path.stem,
                    subtitle_language=subtitle_language.strip(),
                    human_readable=human_readable.strip(),
                    video_id=video_id.strip(),
                )
            )
    return requests


def strip_code_fences(content: str) -> str:
    text = content.strip()
    if not text.startswith("```"):
        return text

    lines = text.splitlines()
    if len(lines) >= 3 and lines[-1].strip() == "```":
        return "\n".join(lines[1:-1]).strip()
    return text


def parse_vocab_response(content: str) -> dict[str, str] | None:
    text = strip_code_fences(content)
    try:
        payload = json.loads(text or "{}")
    except json.JSONDecodeError:
        return None

    if not isinstance(payload, dict):
        return None

    vocab = payload.get("vocab")
    if not isinstance(vocab, dict):
        return None

    cleaned_vocab: dict[str, str] = {}
    for source, translation in vocab.items():
        if not isinstance(source, str) or not isinstance(translation, str):
            return None
        source_clean = collapse_whitespace(source)
        translation_clean = collapse_whitespace(translation)
        if not source_clean or not translation_clean:
            return None
        cleaned_vocab[source_clean] = translation_clean
    return cleaned_vocab or None


def normalize_transcript_entries(raw_entries: Any) -> list[AtomicSegment]:
    snippets = getattr(raw_entries, "snippets", raw_entries)
    normalized: list[AtomicSegment] = []

    for snippet in snippets:
        if isinstance(snippet, dict):
            text = snippet.get("text")
            start = snippet.get("start")
            duration = snippet.get("duration")
            end = snippet.get("end")
        else:
            text = getattr(snippet, "text", None)
            start = getattr(snippet, "start", None)
            duration = getattr(snippet, "duration", None)
            end = getattr(snippet, "end", None)

        if not isinstance(text, str):
            raise PermanentVideoError("Transcript snippet is missing text.")
        if start is None:
            raise PermanentVideoError("Transcript snippet is missing start.")
        if end is None and duration is None:
            raise PermanentVideoError("Transcript snippet is missing both end and duration.")

        try:
            start_seconds = float(start)
            end_seconds = (
                float(end)
                if end is not None
                else start_seconds + float(duration)
            )
        except (TypeError, ValueError) as exc:
            raise PermanentVideoError("Transcript snippet contains non-numeric timing.") from exc

        if end_seconds < start_seconds:
            raise PermanentVideoError("Transcript snippet end precedes start.")

        cleaned_text = collapse_whitespace(text)
        if not cleaned_text:
            continue

        normalized.append(
            AtomicSegment(
                start=start_seconds,
                end=end_seconds,
                text=cleaned_text,
                word_count=count_words(cleaned_text),
            )
        )

    if not normalized:
        raise PermanentVideoError("Transcript produced no usable subtitle segments.")

    normalized.sort(key=lambda segment: (segment.start, segment.end))
    return normalized


def transcript_text_from_segments(segments: list[AtomicSegment]) -> str:
    return collapse_whitespace(" ".join(segment.text for segment in segments))


def merge_atomic_segments(segments: list[AtomicSegment]) -> AtomicSegment:
    text = collapse_whitespace(" ".join(segment.text for segment in segments))
    return AtomicSegment(
        start=segments[0].start,
        end=max(segment.end for segment in segments),
        text=text,
        word_count=count_words(text),
    )


def make_meta_segment(segments: list[AtomicSegment]) -> MetaSegment:
    merged = merge_atomic_segments(segments)
    return MetaSegment(
        start=merged.start,
        end=merged.end,
        text=merged.text,
        word_count=merged.word_count,
        long=merged.word_count > MAX_META_SEGMENT_WORDS,
    )


def meta_segment_word_cost(word_count: int) -> float:
    if IDEAL_META_SEGMENT_MIN_WORDS <= word_count <= IDEAL_META_SEGMENT_MAX_WORDS:
        return 0.0

    if word_count < IDEAL_META_SEGMENT_MIN_WORDS:
        distance = IDEAL_META_SEGMENT_MIN_WORDS - word_count
    else:
        distance = word_count - IDEAL_META_SEGMENT_MAX_WORDS
    return (distance * distance) / 4.0


def split_boundary_cost(left: AtomicSegment, right: AtomicSegment) -> float:
    overlap_seconds = max(0.0, left.end - right.start)
    if overlap_seconds <= 0.0:
        return 0.0
    return 5.0 + (overlap_seconds * 40.0)


def build_meta_segments(segments: list[AtomicSegment]) -> list[MetaSegment]:
    if not segments:
        return []

    prefix_words = [0]
    for segment in segments:
        prefix_words.append(prefix_words[-1] + segment.word_count)

    best_costs = [float("inf")] * (len(segments) + 1)
    next_indices: list[int | None] = [None] * (len(segments) + 1)
    best_costs[len(segments)] = 0.0

    for start_index in range(len(segments) - 1, -1, -1):
        for end_index in range(start_index, len(segments)):
            word_count = prefix_words[end_index + 1] - prefix_words[start_index]
            if word_count > MAX_META_SEGMENT_WORDS:
                break
            if word_count < MIN_META_SEGMENT_WORDS:
                continue

            candidate_cost = meta_segment_word_cost(word_count)
            if end_index + 1 < len(segments):
                candidate_cost += split_boundary_cost(
                    segments[end_index],
                    segments[end_index + 1],
                )
            candidate_cost += best_costs[end_index + 1]

            if candidate_cost < best_costs[start_index]:
                best_costs[start_index] = candidate_cost
                next_indices[start_index] = end_index + 1

    if next_indices[0] is None:
        raise LackOfSegmentsError(
            "unable to create meta segments that satisfy the 8-50 word constraints"
        )

    meta_segments: list[MetaSegment] = []
    index = 0
    while index < len(segments):
        next_index = next_indices[index]
        if next_index is None:
            raise LackOfSegmentsError(
                "unable to create meta segments that satisfy the 8-50 word constraints"
            )
        meta_segments.append(make_meta_segment(segments[index:next_index]))
        index = next_index

    return meta_segments


def build_segments_payload(
    meta_segments: list[MetaSegment],
    vocab_items: list[dict[str, dict[str, str]]],
) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for index, (segment, vocab) in enumerate(zip(meta_segments, vocab_items), start=1):
        payload.append(
            {
                "index": index,
                "startTimestamp": format_timestamp(segment.start),
                "endTimestamp": format_timestamp(segment.end),
                "vocab": vocab["vocab"],
                "beginnerVocab": vocab["beginnerVocab"],
                "advancedVocab": vocab["advancedVocab"],
            }
        )
    return payload


def default_transcript_fetcher(video_id: str, subtitle_language: str) -> Any:
    return fetch_transcript_with_language_preferences(video_id, [subtitle_language])


def fetch_transcript_with_language_preferences(
    video_id: str,
    language_preferences: list[str],
) -> Any:
    from youtube_transcript_api import YouTubeTranscriptApi

    api = YouTubeTranscriptApi()
    detail_log(
        f"{video_id}: fetching transcript with language preferences "
        f"{language_preferences}"
    )
    return api.fetch(
        video_id,
        languages=language_preferences,
        preserve_formatting=False,
    )


def fetch_english_transcript_from_youtube(video_id: str) -> tuple[Any | None, str | None]:
    language_preferences = ["en", "en-US", "en-GB", "en-CA", "en-AU"]
    try:
        transcript = fetch_transcript_with_language_preferences(
            video_id,
            language_preferences,
        )
        detail_log(
            f"{video_id}: English transcript fetch succeeded via standard fetch pattern"
        )
        return transcript, None
    except Exception as exc:
        detail_log(f"{video_id}: English transcript fetch failed: {exc}")
        return None, f"english transcript fetch failed: {exc}"


def get_argos_available() -> set[tuple[str, str]]:
    global _ARGOS_AVAILABLE
    if _ARGOS_AVAILABLE is None:
        try:
            from argostranslate import package

            installed_packages = package.get_installed_packages()
            _ARGOS_AVAILABLE = {
                (installed_package.from_code, installed_package.to_code)
                for installed_package in installed_packages
                if getattr(installed_package, "type", None) == "translate"
            }
        except Exception:
            _ARGOS_AVAILABLE = set()
    return _ARGOS_AVAILABLE


def ensure_argos_packages(language_pairs: list[tuple[str, str]]) -> None:
    try:
        from argostranslate import package
    except ImportError:
        return

    installed = get_argos_available()
    detail_log(f"Argos installed language pairs before ensure: {sorted(installed)}")
    missing = [
        pair
        for pair in language_pairs
        if pair not in installed and pair not in _ARGOS_INSTALL_ATTEMPTED
    ]
    if not missing:
        return

    _ARGOS_INSTALL_ATTEMPTED.update(missing)
    progress_write(
        f"Fetching argostranslate index for {len(missing)} missing pair(s)..."
    )
    try:
        package.update_package_index()
    except Exception as exc:
        progress_write(f"WARNING: could not update argostranslate package index: {exc}")
        return

    available_packages = {
        (pkg.from_code, pkg.to_code): pkg
        for pkg in package.get_available_packages()
    }
    detail_log(
        f"Argos package index contains {len(available_packages)} language pairs"
    )
    installed_any = False
    for from_code, to_code in missing:
        pkg = available_packages.get((from_code, to_code))
        if pkg is None:
            progress_write(
                f"WARNING: argostranslate package {from_code}->{to_code} is not available."
            )
            continue
        progress_write(f"Installing argostranslate package {from_code}->{to_code}...")
        try:
            package.install_from_path(pkg.download())
            installed_any = True
        except Exception as exc:
            progress_write(
                f"WARNING: failed to install argostranslate package "
                f"{from_code}->{to_code}: {exc}"
            )

    if installed_any:
        global _ARGOS_AVAILABLE
        _ARGOS_AVAILABLE = None
        get_argos_available()
        detail_log(f"Argos installed language pairs after ensure: {sorted(get_argos_available())}")


def translate_text_to_english_chunks(
    chunks: list[str],
    subtitle_language: str,
) -> str | None:
    source_code = base_language_code(subtitle_language)
    source_text = collapse_whitespace(" ".join(chunks))
    source_word_count = count_words(source_text)
    detail_log(
        f"Argos fallback requested for source language {subtitle_language!r} "
        f"normalized to {source_code!r}"
    )
    detail_log(
        f"Argos input stats for {source_code}->en: chars={len(source_text)} "
        f"words={source_word_count}"
    )
    detail_log(
        f"Argos input preview for {source_code}->en: {debug_preview(source_text)!r}"
    )
    if source_code == "en":
        return source_text

    try:
        from argostranslate import translate
    except ImportError:
        return None

    ensure_argos_packages([(source_code, "en")])
    available = get_argos_available()
    if (source_code, "en") not in available:
        detail_log(
            f"Argos pair {source_code}->en unavailable; installed pairs are "
            f"{sorted(available)}"
        )
        return None

    try:
        translated_chunks: list[str] = []
        detail_log(
            f"Argos translating {len(chunks)} chunk(s) for {source_code}->en"
        )
        for index, chunk in enumerate(chunks, start=1):
            detail_log(
                f"Argos chunk {index}/{len(chunks)} input stats: chars={len(chunk)} "
                f"words={count_words(chunk)}"
            )
            detail_log(
                f"Argos chunk {index}/{len(chunks)} input preview: "
                f"{debug_preview(chunk)!r}"
            )
            translated_chunk = collapse_whitespace(
                translate.translate(chunk, source_code, "en")
            )
            if not translated_chunk:
                detail_log(
                    f"Argos chunk {index}/{len(chunks)} returned empty output"
                )
                continue
            detail_log(
                f"Argos chunk {index}/{len(chunks)} output stats: "
                f"chars={len(translated_chunk)} words={count_words(translated_chunk)}"
            )
            detail_log(
                f"Argos chunk {index}/{len(chunks)} output preview: "
                f"{debug_preview(translated_chunk)!r}"
            )
            translated_chunks.append(translated_chunk)
    except Exception as exc:
        progress_write(f"WARNING: argostranslate failed for {source_code}->en: {exc}")
        return None

    cleaned = collapse_whitespace(" ".join(translated_chunks))
    if cleaned:
        detail_log(
            f"Argos output stats for {source_code}->en: chars={len(cleaned)} "
            f"words={count_words(cleaned)}"
        )
        detail_log(
            f"Argos output preview for {source_code}->en: "
            f"{debug_preview(cleaned)!r}"
        )
    return cleaned or None


def get_english_transcript_text(
    request: VideoRequest,
    original_segments: list[AtomicSegment],
    transcript_fetcher: TranscriptFetcher,
) -> tuple[str | None, str | None]:
    original_text = transcript_text_from_segments(original_segments)
    if base_language_code(request.subtitle_language) == "en":
        detail_log(f"{request.video_id}: source subtitles already English")
        return original_text, None

    english_transcript, youtube_reason = fetch_english_transcript_from_youtube(
        request.video_id
    )
    if english_transcript is None:
        detail_log(
            f"{request.video_id}: standard English transcript fetch failed: "
            f"{youtube_reason}"
        )
        try:
            english_transcript = transcript_fetcher(request.video_id, "en")
            detail_log(
                f"{request.video_id}: fallback direct transcript_fetcher('en') succeeded"
            )
        except Exception:
            english_transcript = None
            detail_log(
                f"{request.video_id}: fallback direct transcript_fetcher('en') failed"
            )

    if english_transcript is not None:
        try:
            english_segments = normalize_transcript_entries(english_transcript)
        except PermanentVideoError:
            english_segments = []
            detail_log(
                f"{request.video_id}: English transcript fetched but normalization failed"
            )
        english_text = transcript_text_from_segments(english_segments)
        if english_text:
            detail_log(
                f"{request.video_id}: using English transcript from YouTube/direct fetch "
                f"with {len(english_text)} chars"
            )
            return english_text, None

    translation_chunks = chunk_segments_for_translation(original_segments)
    detail_log(
        f"{request.video_id}: prepared {len(translation_chunks)} chunk(s) for "
        "Argos fallback"
    )
    translated_text = translate_text_to_english_chunks(
        translation_chunks,
        request.subtitle_language,
    )
    if translated_text:
        detail_log(
            f"{request.video_id}: using English transcript from Argos fallback"
        )
        return translated_text, None
    if youtube_reason:
        return None, f"{youtube_reason}; argostranslate failed"
    return None, "no english transcript; direct fetch and argostranslate failed"


def extract_vocab_variant(
    client: OpenAI,
    segment_text: str,
    *,
    human_readable: str,
    subtitle_language: str,
    variant: str,
) -> tuple[dict[str, str] | None, str]:
    if variant == "vocab":
        task_description = (
            "Extract only the core words, short expressions, particles, or constructions needed "
            "to understand the segment. Do not include full sentences or long copied chunks."
        )
    elif variant == "beginnerVocab":
        task_description = (
            "Extract only beginner-friendly words or short expressions that are useful and likely "
            "understandable for beginner learners. Prefer common words, basic words, action verbs, "
            "concrete nouns, and simple adjectives that are likely visible or easy to infer from the video. "
            "Avoid abstract, rare, idiomatic, or advanced items unless they are extremely central. "
            "Do not include full sentences or long copied chunks."
        )
    elif variant == "advancedVocab":
        task_description = (
            "Extract only words or short expressions that even advanced learners may not know, may "
            "misunderstand, or may confuse in this segment. Prefer idioms, unusual constructions, slang, "
            "specialized vocabulary, discourse markers, particles, nuanced wording, or culturally specific "
            "expressions. Do not include easy obvious basics unless they are genuinely tricky here. "
            "Do not include full sentences or long copied chunks."
        )
    else:
        raise ValueError(f"Unsupported vocab variant: {variant}")

    prompt = (
        f"You are helping an English-speaking learner understand a {human_readable} subtitle segment.\n\n"
        f"{task_description}\n"
        "Translate each item into concise English.\n"
        "If an item has multiple English translations, separate them with ';'.\n"
        "Put translation notes in parentheses.\n\n"
        f"Language code: {subtitle_language}\n"
        f"Subtitle segment:\n{segment_text}\n\n"
        'Return JSON with exactly this shape: {"vocab": {"source expression": "english translation"}}'
    )

    response = client.chat.completions.create(
        model=FRONTIER_MODEL,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": "Return ONLY valid JSON. No markdown, prose, commentary, or alternatives.",
            },
            {"role": "user", "content": prompt},
        ],
    )
    content = response.choices[0].message.content or ""
    return parse_vocab_response(content), content


def extract_vocab_variant_with_retry(
    client: OpenAI,
    segment_text: str,
    *,
    human_readable: str,
    subtitle_language: str,
    variant: str,
) -> tuple[dict[str, str] | None, str | None]:
    last_raw: str | None = None

    for _attempt in range(2):
        try:
            vocab, raw = extract_vocab_variant(
                client,
                segment_text,
                human_readable=human_readable,
                subtitle_language=subtitle_language,
                variant=variant,
            )
            last_raw = raw
        except Exception:
            continue

        if vocab is not None:
            return vocab, None

    return None, last_raw


def extract_all_vocab_with_retry(
    client: OpenAI,
    segment_text: str,
    *,
    human_readable: str,
    subtitle_language: str,
) -> tuple[dict[str, dict[str, str]] | None, str | None, str | None]:
    vocab, raw = extract_vocab_variant_with_retry(
        client,
        segment_text,
        human_readable=human_readable,
        subtitle_language=subtitle_language,
        variant="vocab",
    )
    if vocab is None:
        return None, "vocab", raw

    if not EXTRACT_LEVELED_VOCAB:
        return {"vocab": vocab, "beginnerVocab": {}, "advancedVocab": {}}, None, None

    beginner_vocab, raw = extract_vocab_variant_with_retry(
        client,
        segment_text,
        human_readable=human_readable,
        subtitle_language=subtitle_language,
        variant="beginnerVocab",
    )
    if beginner_vocab is None:
        return None, "beginnerVocab", raw

    advanced_vocab, raw = extract_vocab_variant_with_retry(
        client,
        segment_text,
        human_readable=human_readable,
        subtitle_language=subtitle_language,
        variant="advancedVocab",
    )
    if advanced_vocab is None:
        return None, "advancedVocab", raw

    return {
        "vocab": vocab,
        "beginnerVocab": beginner_vocab,
        "advancedVocab": advanced_vocab,
    }, None, None


def normalize_topics(raw_topics: Any) -> list[str] | None:
    if not isinstance(raw_topics, list):
        return None

    cleaned_topics: list[str] = []
    seen: set[str] = set()
    for topic in raw_topics:
        if not isinstance(topic, str):
            return None
        cleaned = collapse_whitespace(topic).strip(" \t\r\n-–—,.;:").lower()
        if not cleaned:
            continue
        if cleaned in seen:
            continue
        seen.add(cleaned)
        cleaned_topics.append(cleaned)

    return cleaned_topics or None


def extract_topics(transcript_text: str) -> tuple[list[str] | None, str | None]:
    import ollama

    prompt = (
        'Return only JSON matching this schema: {"topics": ["topic one", "topic two"]}.\n'
        "You are tagging a video transcript for discovery.\n"
        "Return 5-12 concise interest topics describing what kinds of viewers may be "
        "interested in this video.\n"
        "Use short lowercase noun phrases, not sentences.\n"
        f"Transcript:\n{transcript_text}"
    )

    try:
        response = ollama.chat(
            model=TOPICS_MODEL,
            messages=[{"role": "user", "content": prompt}],
            format=TOPICS_SCHEMA,
            think=False,
            options={"temperature": 0},
        )
    except Exception as exc:
        detail_log(f"Ollama topic extraction request failed: {exc}")
        return None, f"ollama request failed: {exc}"

    raw_content = response.message.content or ""
    detail_log(
        f"Ollama topic extraction raw response ({len(raw_content)} chars): "
        f"{raw_content[:500]!r}"
    )
    try:
        payload = json.loads(raw_content or "{}")
    except json.JSONDecodeError:
        return None, "invalid ollama JSON"

    normalized_topics = normalize_topics(payload.get("topics"))
    if normalized_topics is None:
        if isinstance(payload.get("topics"), list):
            return None, "empty topics"
        return None, "invalid topics payload"
    return normalized_topics, None


def extract_topics_with_retry(transcript_text: str) -> tuple[list[str] | None, str | None]:
    last_reason = "topic extraction failed"
    for attempt in range(2):
        detail_log(
            f"Running topic extraction attempt {attempt + 1}/2 "
            f"for transcript with {len(transcript_text)} chars"
        )
        topics, reason = extract_topics(transcript_text)
        if topics is not None:
            detail_log(
                f"Topic extraction succeeded on attempt {attempt + 1}: {topics}"
            )
            return topics, None
        if reason:
            last_reason = reason
            detail_log(
                f"Topic extraction attempt {attempt + 1} failed: {reason}"
            )
    return None, f"{last_reason} after 2 attempts"


def build_video_export(
    request: VideoRequest,
    *,
    openai_client: OpenAI,
    transcript_fetcher: TranscriptFetcher,
) -> dict[str, Any]:
    try:
        raw_transcript = transcript_fetcher(request.video_id, request.subtitle_language)
    except PermanentVideoError:
        raise
    except Exception as exc:
        raise PermanentVideoError(f"subtitle fetch failed: {exc}") from exc

    atomic_segments = normalize_transcript_entries(raw_transcript)
    meta_segments = build_meta_segments(atomic_segments)
    english_transcript_text, english_transcript_reason = get_english_transcript_text(
        request,
        atomic_segments,
        transcript_fetcher,
    )

    kept_segments: list[MetaSegment] = []
    vocab_items: list[dict[str, dict[str, str]]] = []
    with tqdm(
        total=len(meta_segments),
        desc=f"{request.iso3}:{request.video_id}",
        unit="segment",
        position=1,
        leave=False,
        dynamic_ncols=True,
        file=sys.stderr,
    ) as segment_progress:
        for segment in meta_segments:
            if segment.long:
                progress_write(
                    f"{request.iso3}/{request.video_id}: skipped long segment "
                    f"{format_timestamp(segment.start)}-{format_timestamp(segment.end)}."
                )
                segment_progress.update(1)
                continue

            vocab, failed_variant, raw_response = extract_all_vocab_with_retry(
                openai_client,
                segment.text,
                human_readable=request.human_readable,
                subtitle_language=request.subtitle_language,
            )
            if vocab is None:
                log_vocab_error(
                    VOCAB_ERROR_LOG,
                    iso3=request.iso3,
                    video_id=request.video_id,
                    segment=segment,
                    failed_variant=failed_variant,
                    raw_response=raw_response,
                )
                progress_write(
                    f"{request.iso3}/{request.video_id}: skipped segment "
                    f"{format_timestamp(segment.start)}-{format_timestamp(segment.end)} "
                    "after failed/invalid OpenAI vocab extraction."
                )
                segment_progress.update(1)
                continue

            kept_segments.append(segment)
            vocab_items.append(vocab)
            segment_progress.update(1)

    if len(kept_segments) < MIN_EXPORT_SEGMENTS:
        raise LackOfSegmentsError(
            f"only {len(kept_segments)} exportable segment(s) remained after filtering"
        )

    export_payload = {
        "videoId": request.video_id,
        "language": {
            "iso3": request.iso3,
            "subtitleLanguage": request.subtitle_language,
            "humanReadable": request.human_readable,
        },
        "segments": build_segments_payload(kept_segments, vocab_items),
    }

    topics, topics_reason = (
        extract_topics_with_retry(english_transcript_text)
        if english_transcript_text
        else (None, english_transcript_reason)
    )
    if topics is not None:
        export_payload["topics"] = topics
    else:
        print(
            f"WARNING: {request.iso3}/{request.video_id}: topics unavailable "
            f"({topics_reason or 'unknown reason'})."
        )

    return export_payload


def run_pipeline(
    *,
    openai_client: OpenAI,
    desired_dir: Path = DESIRED_DIR,
    analyzed_path: Path = ANALYZED_PATH,
    export_root: Path = EXPORT_ROOT,
    transcript_fetcher: TranscriptFetcher = default_transcript_fetcher,
    success_limit: int | None = None,
) -> tuple[int, int]:
    rebuild_all_language_indexes(export_root)
    rebuild_all_language_topics(export_root)
    rebuild_available_languages(export_root, desired_dir)

    analyzed = load_analyzed_statuses(analyzed_path)
    all_requests = load_video_requests(desired_dir)
    pending = [request for request in all_requests if request.video_id not in analyzed]

    if not pending:
        print("No videos to process.")
        return 0, 0

    success_count = 0
    error_count = 0

    with tqdm(
        pending,
        desc="vv",
        unit="video",
        position=0,
        dynamic_ncols=True,
        file=sys.stderr,
    ) as progress:
        for request in progress:
            if success_limit is not None and success_count >= success_limit:
                break
            progress.set_postfix_str(f"{request.iso3}:{request.video_id}", refresh=False)
            export_path = export_path_for_video(export_root, request.iso3, request.video_id)
            try:
                export_payload = build_video_export(
                    request,
                    openai_client=openai_client,
                    transcript_fetcher=transcript_fetcher,
                )
                save_json(export_path, export_payload)
                rebuild_language_index(export_root, request.iso3)
                rebuild_language_topics(export_root, request.iso3)
                rebuild_available_languages(export_root, desired_dir)
                analyzed[request.video_id] = "SUCCESS"
                success_count += 1
            except LackOfSegmentsError as exc:
                if export_path.exists():
                    export_path.unlink()
                rebuild_language_index(export_root, request.iso3)
                rebuild_language_topics(export_root, request.iso3)
                rebuild_available_languages(export_root, desired_dir)
                analyzed[request.video_id] = "LACK_OF_SEGMENTS"
                progress_write(f"{request.iso3}/{request.video_id}: {exc}")
            except PermanentVideoError as exc:
                if export_path.exists():
                    export_path.unlink()
                rebuild_language_index(export_root, request.iso3)
                rebuild_language_topics(export_root, request.iso3)
                rebuild_available_languages(export_root, desired_dir)
                analyzed[request.video_id] = "ERROR"
                error_count += 1
                progress_write(f"{request.iso3}/{request.video_id}: {exc}")
            save_json(analyzed_path, analyzed)

    rebuild_all_language_indexes(export_root)
    rebuild_all_language_topics(export_root)
    rebuild_available_languages(export_root, desired_dir)
    return success_count, error_count


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--limit-successes",
        type=int,
        default=None,
        help="Stop after this many newly successful video exports.",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable detailed debug logging for subtitle/topic fallback paths.",
    )
    args = parser.parse_args()
    if args.limit_successes is not None and args.limit_successes < 1:
        parser.error("--limit-successes must be at least 1.")
    return args


def main() -> None:
    args = parse_args()
    global DETAILED_LOGGING
    DETAILED_LOGGING = args.debug
    load_dotenv()

    api_key = os.getenv("OPENAI_API_KEY") or ""
    if not api_key:
        raise SystemExit("OPENAI_API_KEY must be set in the environment.")

    client = OpenAI(api_key=api_key)
    success_count, error_count = run_pipeline(
        openai_client=client,
        success_limit=args.limit_successes,
    )
    print(f"Done. {success_count} succeeded, {error_count} permanent errors.")


if __name__ == "__main__":
    main()
