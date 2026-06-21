from __future__ import annotations
import logging

from underthesea import pos_tag

from .italian import _fmt
from .translation import translate_words

logger = logging.getLogger(__name__)


class VietnamesePipeline:
    name = "vie-underthesea-mymemory"
    queue = "vps"
    KEEP_POS = {"N", "V", "A"}

    def process(self, transcript: list[dict]) -> list[dict]:
        cue_words: list[list[str]] = []
        for cue in transcript:
            text = cue.get("text", "").strip()
            if not text:
                cue_words.append([])
                continue
            tagged = pos_tag(text)
            words = list(dict.fromkeys(
                word for word, tag in tagged
                if tag in self.KEEP_POS
                and word.replace(" ", "").isalpha()
                and len(word) > 1
            ))
            cue_words.append(words)

        all_words = list(dict.fromkeys(w for words in cue_words for w in words))
        logger.info(f"nlp_words={len(all_words)} cues={len(transcript)}")
        translations = translate_words(all_words, "vi")
        logger.info(f"translated={len(translations)}/{len(all_words)}")

        segments = []
        for i, (cue, words) in enumerate(zip(transcript, cue_words)):
            if not words:
                continue
            vocab = {w: translations[w] for w in words if translations.get(w)}
            if not vocab:
                continue
            segments.append({
                "index": i + 1,
                "startTimestamp": _fmt(cue["start"]),
                "endTimestamp": _fmt(cue["end"]),
                "vocab": vocab,
            })
        return segments
