from __future__ import annotations
import logging

logger = logging.getLogger(__name__)


def translate_words(words: list[str], from_code: str, to_code: str = "en") -> dict[str, str]:
    """Translate a list of words using the installed Argos Translate model.

    Words are sent as a single newline-joined batch. If the model shifts line
    count (rare but possible with neural output), missing entries are skipped
    and a warning is logged rather than crashing.

    Raises RuntimeError if the requested language model is not installed.
    Run `python manage.py install_argos_models` to install models.
    """
    if not words:
        return {}

    from argostranslate import translate

    installed = translate.get_installed_languages()
    from_lang = next((l for l in installed if l.code == from_code), None)
    if from_lang is None:
        raise RuntimeError(
            f"Argos model not installed for source language '{from_code}'. "
            "Run: python manage.py install_argos_models"
        )
    to_lang = next((l for l in installed if l.code == to_code), None)
    if to_lang is None:
        raise RuntimeError(
            f"Argos model not installed for target language '{to_code}'. "
            "Run: python manage.py install_argos_models"
        )

    translation = from_lang.get_translation(to_lang)
    if translation is None:
        raise RuntimeError(
            f"No Argos translation path found for {from_code}→{to_code}. "
            "Run: python manage.py install_argos_models"
        )

    translated = translation.translate("\n".join(words))
    parts = translated.split("\n")

    if len(parts) != len(words):
        logger.warning(
            f"argos line count mismatch: sent {len(words)} words, "
            f"got {len(parts)} lines ({from_code}→{to_code})"
        )

    result = {}
    for i, word in enumerate(words):
        if i >= len(parts):
            break
        t = parts[i].strip()
        if t and t.lower() != word.lower():
            result[word] = t

    return result
