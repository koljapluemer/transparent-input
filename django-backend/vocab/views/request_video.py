import re
import urllib.error

import langcodes
from django.shortcuts import redirect, render
from django.views import View

from ..lib.llm import PIPELINE_NAMES, call_llm
from ..lib.segmentation import build_segments
from ..lib.subtitles import fetch_subtitle_cues
from ..models import Video, VideoTranslation

MIN_VOCAB_SEGMENTS = 3
YOUTUBE_ID_RE = re.compile(
    r"(?:youtube\.com/watch\?.*v=|youtu\.be/|^)([a-zA-Z0-9_-]{11})(?:[&?\s]|$)"
)


def _extract_youtube_id(raw: str) -> str | None:
    m = YOUTUBE_ID_RE.search(raw.strip())
    return m.group(1) if m else None


def _fetch_title(youtube_id: str) -> str | None:
    import yt_dlp
    ydl_opts = {"quiet": True, "skip_download": True, "no_warnings": True}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={youtube_id}", download=False)
    return (info or {}).get("title")


class RequestVideoView(View):
    template = "vocab/request_video.html"

    def _context(self, language_code: str, **extra):
        return {
            "language": {
                "code": language_code,
                "human_readable": langcodes.get(language_code).display_name("en"),
            },
            **extra,
        }

    def get(self, request, language):
        return render(request, self.template, self._context(language))

    def post(self, request, language):
        url_input = request.POST.get("youtube_url", "").strip()
        native_lang = request.POST.get("native_language", "en").strip() or "en"
        level = request.POST.get("level", VideoTranslation.Level.INTERMEDIATE)
        provider = request.POST.get("provider", "openai")
        api_key = request.POST.get("api_key", "").strip()

        def fail(msg):
            return render(request, self.template, self._context(
                language,
                error=msg,
                form={
                    "youtube_url": url_input,
                    "native_language": native_lang,
                    "level": level,
                    "provider": provider,
                },
            ))

        youtube_id = _extract_youtube_id(url_input)
        if not youtube_id:
            return fail("Could not find a YouTube video ID in the URL you entered.")

        if level not in VideoTranslation.Level.values:
            level = VideoTranslation.Level.INTERMEDIATE

        if provider not in ("openai", "gemini"):
            provider = "openai"

        if not api_key:
            return fail("An API key is required.")

        try:
            cues = fetch_subtitle_cues(youtube_id, language)
        except ValueError as e:
            return fail(str(e))
        except Exception as e:
            return fail(f"Failed to fetch subtitles: {e}")

        segments = build_segments(cues)
        if not segments:
            return fail("No subtitle segments could be built from this video.")

        target_lang_human = langcodes.get(language).display_name("en")
        native_lang_human = langcodes.get(native_lang).display_name("en")

        result_segments = []
        for seg in segments:
            vocab = call_llm(
                seg["text"],
                target_lang_human,
                native_lang_human,
                level,
                provider,
                api_key,
            )
            if vocab:
                result_segments.append({
                    "startTimestamp": seg["startTimestamp"],
                    "endTimestamp": seg["endTimestamp"],
                    "vocab": vocab,
                })

        if len(result_segments) < MIN_VOCAB_SEGMENTS:
            return fail(
                f"Only {len(result_segments)} segment(s) produced vocabulary — "
                f"at least {MIN_VOCAB_SEGMENTS} are needed. "
                "Check your API key or try a different video."
            )

        try:
            title = _fetch_title(youtube_id)
        except Exception:
            title = None

        pipeline = PIPELINE_NAMES.get(provider, provider)

        video, _ = Video.objects.get_or_create(
            youtube_id=youtube_id,
            defaults={"language": language, "title": title},
        )
        if title and not video.title:
            video.title = title
            video.save(update_fields=["title"])

        VideoTranslation.objects.update_or_create(
            video=video,
            pipeline=pipeline,
            native_language=native_lang,
            level=level,
            defaults={"segments": result_segments},
        )

        return redirect("video-player", language=language, youtube_id=youtube_id)
