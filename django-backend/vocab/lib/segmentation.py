TARGET_WORDS = 20
MIN_TRAILING_WORDS = 5


def build_segments(cues: list[dict]) -> list[dict]:
    segments = []
    current: list[dict] = []
    word_count = 0

    for cue in cues:
        current.append(cue)
        word_count += len(cue["text"].split())
        if word_count >= TARGET_WORDS:
            segments.append(_make_segment(current))
            current = []
            word_count = 0

    if current:
        trailing_words = sum(len(c["text"].split()) for c in current)
        if trailing_words >= MIN_TRAILING_WORDS:
            segments.append(_make_segment(current))
        elif segments:
            last = segments[-1]
            merged_text = last["text"] + " " + " ".join(c["text"] for c in current)
            segments[-1] = {
                "startTimestamp": last["startTimestamp"],
                "endTimestamp": _fmt(current[-1]["end"]),
                "text": merged_text,
            }

    return segments


def _make_segment(cues: list[dict]) -> dict:
    return {
        "startTimestamp": _fmt(cues[0]["start"]),
        "endTimestamp": _fmt(cues[-1]["end"]),
        "text": " ".join(c["text"] for c in cues),
    }


def _fmt(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"
