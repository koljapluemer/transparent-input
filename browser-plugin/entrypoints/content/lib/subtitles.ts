import type { RawCue, LangEntry } from './types';

export function parseJson3(json3: Record<string, unknown>): RawCue[] {
  const cues: RawCue[] = [];
  const events = (json3.events as Record<string, unknown>[]) ?? [];
  for (const event of events) {
    if (!event.segs) continue;
    const text = (event.segs as { utf8?: string }[]).map(s => s.utf8 ?? '').join('').trim();
    if (!text) continue;
    const start = ((event.tStartMs as number) ?? 0) / 1000;
    const end = start + ((event.dDurationMs as number) ?? 0) / 1000;
    cues.push({ start, end, text });
  }
  return cues;
}

export async function fetchSupportedLanguages(): Promise<{ iso3: string; subtitle_language: string; human_readable: string }[]> {
  const resp = await fetch(`${import.meta.env.VITE_API_BASE ?? 'http://localhost:8000/api'}/languages/`);
  if (!resp.ok) return [];
  return resp.json();
}

export async function getCaptionTracks(videoId: string): Promise<{ languageCode: string; name?: { simpleText?: string }; baseUrl: string }[]> {
  const resp = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'en' } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  return data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
}

export async function fetchSubtitleCues(lang: LangEntry): Promise<RawCue[]> {
  const subtitleUrl = lang.baseUrl.replace(/[&?]fmt=[^&]*/g, '') + '&fmt=json3';
  const resp = await fetch(subtitleUrl);
  if (!resp.ok) throw new Error('subtitle fetch failed');
  let json3: Record<string, unknown>;
  try {
    json3 = JSON.parse(await resp.text());
  } catch {
    throw new Error('subtitle parse failed');
  }
  const cues = parseJson3(json3);
  if (cues.length === 0) throw new Error('empty transcript');
  return cues;
}
