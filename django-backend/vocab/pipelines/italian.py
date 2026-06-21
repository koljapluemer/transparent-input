from __future__ import annotations
import time


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
        # First pass: run NLP on every cue to get candidate words
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

        # Deduplicate across all cues and batch-translate in one go
        all_words = list(dict.fromkeys(w for words in cue_words for w in words))
        translations = self._translate_batch(all_words)

        # Second pass: build output segments
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

    def _translate_batch(self, words: list[str]) -> dict[str, str]:
        from deep_translator import MyMemoryTranslator

        if not words:
            return {}

        # MyMemory limit is 500 chars per request; use '\n' as separator.
        # Batch words until we'd exceed 490 chars, then flush.
        chunks: list[list[str]] = []
        current: list[str] = []
        current_len = 0
        for word in words:
            added = len(word) + (1 if current else 0)  # +1 for '\n'
            if current_len + added > 490 and current:
                chunks.append(current)
                current = [word]
                current_len = len(word)
            else:
                current.append(word)
                current_len += added
        if current:
            chunks.append(current)

        translator = MyMemoryTranslator(source="it-IT", target="en-US")
        result: dict[str, str] = {}
        last_error: Exception | None = None
        for i, chunk in enumerate(chunks):
            if i > 0:
                time.sleep(0.25)  # stay under MyMemory's 5 req/s free-tier limit
            try:
                translated = translator.translate('\n'.join(chunk))
                if not translated:
                    continue
                parts = translated.split('\n')
                for i, word in enumerate(chunk):
                    if i < len(parts):
                        t = parts[i].strip()
                        if t:
                            result[word] = t
            except Exception as e:
                last_error = e

        if not result and last_error is not None:
            raise RuntimeError(f"Translation failed: {last_error}") from last_error

        return result
