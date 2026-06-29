import json
import urllib.request
import urllib.error

import yt_dlp


def fetch_subtitle_cues(youtube_id: str, language_code: str) -> list[dict]:
    url = f"https://www.youtube.com/watch?v={youtube_id}"
    ydl_opts = {"quiet": True, "skip_download": True, "no_warnings": True}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

    if not info:
        raise ValueError("Could not fetch video info from YouTube")

    for key in ("subtitles", "automatic_captions"):
        tracks = info.get(key, {}).get(language_code, [])
        sub_url = next((fmt["url"] for fmt in tracks if fmt.get("ext") == "json3"), None)
        if not sub_url:
            # Some tracks only have srv1/vtt; fall back to first available and re-request json3
            sub_url = next(
                (fmt["url"] for fmt in tracks if fmt.get("url")),
                None,
            )
            if sub_url:
                # Strip existing fmt and request json3
                import re
                sub_url = re.sub(r"[&?]fmt=[^&]*", "", sub_url) + "&fmt=json3"
        if not sub_url:
            continue
        try:
            with urllib.request.urlopen(sub_url, timeout=15) as resp:
                data = json.loads(resp.read())
            cues = _parse_json3(data)
            if cues:
                return cues
        except Exception:
            continue

    raise ValueError(f"No subtitles found for language '{language_code}'")


def _parse_json3(data: dict) -> list[dict]:
    cues = []
    for event in data.get("events", []):
        if not event.get("segs"):
            continue
        text = "".join(s.get("utf8", "") for s in event["segs"]).strip()
        if not text:
            continue
        start = event.get("tStartMs", 0) / 1000
        end = start + event.get("dDurationMs", 0) / 1000
        cues.append({"start": start, "end": end, "text": text})
    return cues
