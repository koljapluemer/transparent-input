from __future__ import annotations
import logging

from .translation import translate_words

logger = logging.getLogger(__name__)


def _fmt(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


class ItalianPipeline:
    name = "ita-spacy-mymemory"
    queue = "vps"
    KEEP_POS = {"NOUN", "VERB", "ADJ"}

    def __init__(self):
        self._nlp = None

    @property
    def nlp(self):
        if self._nlp is None:
            import spacy
            self._nlp = spacy.load("it_core_news_sm")
        return self._nlp

    def process(self, transcript: list[dict]) -> list[dict]:
        cue_words: list[list[str]] = []
        for cue in transcript:
            text = cue.get("text", "").strip()
            if not text:
                cue_words.append([])
                continue
            doc = self.nlp(text)
            words = list(dict.fromkeys(
                t.lemma_.lower() for t in doc
                if t.pos_ in self.KEEP_POS
                and not t.is_stop
                and t.is_alpha
                and len(t.text) > 2
            ))
            cue_words.append(words)

        all_words = list(dict.fromkeys(w for words in cue_words for w in words))
        logger.info(f"nlp_words={len(all_words)} cues={len(transcript)}")
        translations = translate_words(all_words, "it")
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
