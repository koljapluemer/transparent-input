import type { UserSettings } from './types';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4.1';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export { OPENAI_MODEL, GEMINI_MODEL };

export function buildVocabPrompt(segmentText: string, targetLangHuman: string, nativeLangHuman: string): string {
  return (
    `You are helping a ${nativeLangHuman} speaker understand a ${targetLangHuman} subtitle segment.\n` +
    `Extract only the core words, short expressions, or constructions needed to understand the segment. Do not include full sentences.\n` +
    `Translate each item into ${nativeLangHuman}.\n` +
    `Return JSON: {"vocab": {"source expression": "translation"}}\n\n` +
    `Subtitle segment:\n${segmentText}`
  );
}

export function parseVocabResponse(raw: string): Record<string, string> | null {
  let text = raw.trim();
  if (text.startsWith('```')) {
    const lines = text.split('\n');
    if (lines.length >= 3 && lines[lines.length - 1].trim() === '```') {
      text = lines.slice(1, -1).join('\n').trim();
    }
  }
  try {
    const payload = JSON.parse(text || '{}');
    if (typeof payload !== 'object' || !payload.vocab || typeof payload.vocab !== 'object') return null;
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(payload.vocab)) {
      if (typeof k === 'string' && typeof v === 'string' && k.trim() && v.trim()) {
        cleaned[k.trim()] = (v as string).trim();
      }
    }
    return Object.keys(cleaned).length > 0 ? cleaned : null;
  } catch {
    return null;
  }
}

async function callOpenAI(apiKey: string, prompt: string): Promise<string> {
  const resp = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return ONLY valid JSON. No markdown, prose, or commentary.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI HTTP ${resp.status}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const resp = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  });
  if (!resp.ok) throw new Error(`Gemini HTTP ${resp.status}`);
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

export async function callLLM(settings: UserSettings, prompt: string): Promise<Record<string, string> | null> {
  const raw = settings.provider === 'gemini'
    ? await callGemini(settings.apiKey, prompt)
    : await callOpenAI(settings.apiKey, prompt);
  return parseVocabResponse(raw);
}
