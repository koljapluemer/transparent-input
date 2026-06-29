import json
import urllib.error
import urllib.request

OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_MODEL = "gpt-4.1"
GEMINI_MODEL = "gemini-2.0-flash"
GEMINI_API_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
)

PIPELINE_NAMES = {
    "openai": f"openai-{OPENAI_MODEL}",
    "gemini": f"gemini-{GEMINI_MODEL}",
}


def build_vocab_prompt(segment_text: str, target_lang_human: str, native_lang_human: str, level: str) -> str:
    level_instruction = ""
    if level == "BEGINNER":
        level_instruction = (
            "Focus only on simple, extremely common, visually clear vocabulary — "
            "concrete nouns, action verbs, and basic adjectives. "
            "Skip abstract, complex, or rare words.\n"
        )
    elif level == "EXPERT":
        level_instruction = (
            "Focus only on advanced, topic-specific, or otherwise uncommon vocabulary "
            "that a non-expert is unlikely to know. Skip simple, common words.\n"
        )

    return (
        f"You are helping a {native_lang_human} speaker understand a {target_lang_human} subtitle segment.\n"
        "Extract only the core words, short expressions, or constructions needed to understand the segment. "
        "Do not include full sentences.\n"
        + level_instruction
        + f"Translate each item into {native_lang_human}.\n"
        'Return JSON: {"vocab": {"source expression": "translation"}}\n\n'
        f"Subtitle segment:\n{segment_text}"
    )


def call_llm(
    segment_text: str,
    target_lang_human: str,
    native_lang_human: str,
    level: str,
    provider: str,
    api_key: str,
) -> dict:
    prompt = build_vocab_prompt(segment_text, target_lang_human, native_lang_human, level)
    try:
        if provider == "gemini":
            raw = _call_gemini(api_key, prompt)
        else:
            raw = _call_openai(api_key, prompt)
        return _parse_vocab_response(raw) or {}
    except Exception:
        return {}


def _call_openai(api_key: str, prompt: str) -> str:
    payload = json.dumps(
        {
            "model": OPENAI_MODEL,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": "Return ONLY valid JSON. No markdown, prose, or commentary."},
                {"role": "user", "content": prompt},
            ],
        }
    ).encode()
    req = urllib.request.Request(
        OPENAI_API_URL,
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"]


def _call_gemini(api_key: str, prompt: str) -> str:
    payload = json.dumps(
        {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
        }
    ).encode()
    req = urllib.request.Request(
        f"{GEMINI_API_URL}?key={api_key}",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    return data["candidates"][0]["content"]["parts"][0]["text"]


def _parse_vocab_response(raw: str) -> dict | None:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if len(lines) >= 3 and lines[-1].strip() == "```":
            text = "\n".join(lines[1:-1]).strip()
    try:
        payload = json.loads(text or "{}")
        if not isinstance(payload, dict) or not isinstance(payload.get("vocab"), dict):
            return None
        cleaned = {
            k.strip(): v.strip()
            for k, v in payload["vocab"].items()
            if isinstance(k, str) and isinstance(v, str) and k.strip() and v.strip()
        }
        return cleaned if cleaned else None
    except (json.JSONDecodeError, AttributeError):
        return None
