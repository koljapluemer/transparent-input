from __future__ import annotations

from underthesea import pos_tag

from .italian import _fmt


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
        translations = self._translate_batch(all_words)

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

        chunks: list[list[str]] = []
        current: list[str] = []
        current_len = 0
        for word in words:
            added = len(word) + (1 if current else 0)
            if current_len + added > 490 and current:
                chunks.append(current)
                current = [word]
                current_len = len(word)
            else:
                current.append(word)
                current_len += added
        if current:
            chunks.append(current)

        translator = MyMemoryTranslator(source="vi-VN", target="en-US")
        result: dict[str, str] = {}
        for chunk in chunks:
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
            except Exception:
                pass
        return result
