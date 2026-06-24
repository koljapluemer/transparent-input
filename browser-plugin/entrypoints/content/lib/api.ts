import type { State, LangEntry, AvailableTranslation, Phase, PhaseData } from './types';
import { PHASE } from './types';
import { fetchSupportedLanguages, getCaptionTracks, fetchSubtitleCues } from './subtitles';
import { buildMetaSegments } from './segmentation';
import { buildVocabPrompt, callLLM, OPENAI_MODEL, GEMINI_MODEL } from './llm';
import { parseTimestamp, fmtTimestamp, nativeLangDisplayName } from './utils';

export { OPENAI_MODEL, GEMINI_MODEL };

const API_BASE = import.meta.env.VITE_API_BASE;
const MIN_EXPORT_SEGMENTS = 3;

export type SetPhase = (videoId: string, phase: Phase, data?: PhaseData) => void;

type LoadSegmentsFn = (
  state: State,
  data: { segments: { startTimestamp: string; endTimestamp: string; vocab?: Record<string, string> }[] },
  videoId: string,
  setPhase: SetPhase,
  opts?: { servedNativeLanguage?: string | null; fromLLM?: boolean; onDone?: () => void },
) => void;

export const loadSegments: LoadSegmentsFn = (state, data, videoId, setPhase, opts = {}) => {
  if (state.videoId !== videoId) return;
  const { servedNativeLanguage = null, fromLLM = false, onDone } = opts;

  state.segments = data.segments
    .map(seg => ({
      startSeconds: parseTimestamp(seg.startTimestamp),
      endSeconds: parseTimestamp(seg.endTimestamp),
      vocab: Object.entries(seg.vocab ?? {}) as [string, string][],
    }))
    .filter(seg => seg.endSeconds > seg.startSeconds && seg.vocab.length > 0);

  state.llmSegments = fromLLM;

  if (state.segments.length > 0) {
    const primaryNativeLanguage = state.userSettings?.primaryNativeLanguage ?? 'en';
    const isFallback = servedNativeLanguage !== null && servedNativeLanguage !== primaryNativeLanguage;
    setPhase(videoId, PHASE.DONE, {
      count: state.segments.length,
      servedNativeLanguage: isFallback ? servedNativeLanguage : null,
      primaryNativeLanguage: isFallback ? primaryNativeLanguage : null,
    });
    onDone?.();
  } else {
    loadAvailableLanguages(state, videoId, setPhase, onDone);
  }
};

export async function loadAvailableLanguages(
  state: State,
  videoId: string,
  setPhase: SetPhase,
  onDone?: () => void,
): Promise<void> {
  setPhase(videoId, PHASE.LOADING);
  try {
    const [tracks, supportedLangs] = await Promise.all([
      getCaptionTracks(videoId),
      fetchSupportedLanguages(),
    ]);

    if (state.videoId !== videoId) return;

    const subtitleLangToSupported = Object.fromEntries(
      supportedLangs.map(l => [l.subtitle_language, l]),
    );

    state.availableLangs = tracks
      .filter(t => subtitleLangToSupported[t.languageCode])
      .map(t => ({
        languageCode: t.languageCode,
        trackName: t.name?.simpleText || t.languageCode,
        iso3: subtitleLangToSupported[t.languageCode].iso3,
        humanReadable: subtitleLangToSupported[t.languageCode].human_readable,
        baseUrl: t.baseUrl,
      }));

    if (state.availableLangs.length > 0) state.selectedLang = state.availableLangs[0].languageCode;

    setPhase(videoId, PHASE.READY);
  } catch {
    setPhase(videoId, PHASE.ERROR, { error: 'Failed to load subtitle tracks' });
  }
}

export async function submitWithLLM(state: State, videoId: string, setPhase: SetPhase, onDone?: () => void): Promise<void> {
  const lang = state.availableLangs.find(l => l.languageCode === state.selectedLang);
  const settings = state.userSettings;
  if (!lang || !videoId || !settings?.apiKey) return;

  setPhase(videoId, PHASE.SUBMITTING, { message: 'Fetching subtitles…' });
  let cues;
  try {
    cues = await fetchSubtitleCues(lang);
  } catch (e) {
    setPhase(videoId, PHASE.ERROR, { error: (e as Error).message || 'Subtitle fetch failed' });
    return;
  }

  if (state.videoId !== videoId) return;

  const metaSegments = buildMetaSegments(cues);
  const nativeLang = settings.primaryNativeLanguage;
  const nativeLangHuman = nativeLangDisplayName(nativeLang);
  const targetLangHuman = lang.humanReadable || lang.trackName;
  const pipeline = settings.provider === 'gemini' ? 'gemini-flash' : `openai-${OPENAI_MODEL}`;

  setPhase(videoId, PHASE.AI_PROCESSING, { done: 0, total: metaSegments.length });

  const resultSegments: { index: number; startTimestamp: string; endTimestamp: string; vocab: Record<string, string> }[] = [];

  for (let i = 0; i < metaSegments.length; i++) {
    if (state.videoId !== videoId) return;

    const seg = metaSegments[i];
    const prompt = buildVocabPrompt(seg.text, targetLangHuman, nativeLangHuman);

    let vocab: Record<string, string> | null = null;
    for (let attempt = 0; attempt < 2 && vocab === null; attempt++) {
      try {
        vocab = await callLLM(settings, prompt);
      } catch (e) {
        console.warn(`[TI] LLM call failed (attempt ${attempt + 1}):`, (e as Error).message);
      }
    }

    if (vocab && Object.keys(vocab).length > 0) {
      resultSegments.push({
        index: resultSegments.length + 1,
        startTimestamp: fmtTimestamp(seg.start),
        endTimestamp: fmtTimestamp(seg.end),
        vocab,
      });
    }

    setPhase(videoId, PHASE.AI_PROCESSING, { done: i + 1, total: metaSegments.length });
  }

  if (state.videoId !== videoId) return;

  if (resultSegments.length < MIN_EXPORT_SEGMENTS) {
    setPhase(videoId, PHASE.ERROR, { error: 'Not enough vocabulary found in this video' });
    return;
  }

  const title = document.title.replace(/ - YouTube$/, '').trim() || null;
  try {
    await fetch(`${API_BASE}/videos/${videoId}/translations/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pipeline,
        native_language: nativeLang,
        segments: resultSegments,
        language_iso3: lang.iso3,
        title,
      }),
    });
  } catch (e) {
    console.warn('[TI] Failed to store translation on backend:', (e as Error).message);
  }

  if (state.videoId !== videoId) return;
  loadSegments(state, { segments: resultSegments }, videoId, setPhase, { servedNativeLanguage: nativeLang, fromLLM: true, onDone });
}

export async function checkAndLoadVideo(
  state: State,
  videoId: string,
  setPhase: SetPhase,
  onDone: () => void,
): Promise<void> {
  setPhase(videoId, PHASE.CHECKING);

  try {
    const resp = await fetch(`${API_BASE}/videos/${videoId}/`);

    if (resp.status === 404 || !resp.ok) {
      loadAvailableLanguages(state, videoId, setPhase, onDone);
      return;
    }

    const data = await resp.json();
    const settings = state.userSettings!;
    const availableTranslations: AvailableTranslation[] = data.available_translations ?? [];

    if (availableTranslations.length > 0) {
      const preferenceChain = [settings.primaryNativeLanguage, ...settings.nativeFallbacks];
      for (const nativeLang of preferenceChain) {
        const match = availableTranslations.find(t => t.native_language === nativeLang);
        if (match) {
          try {
            const tResp = await fetch(`${API_BASE}/videos/${videoId}/translations/${nativeLang}/`);
            if (tResp.ok && state.videoId === videoId) {
              const tData = await tResp.json();
              loadSegments(state, tData, videoId, setPhase, { servedNativeLanguage: nativeLang, onDone });
              return;
            }
          } catch { /* fall through */ }
          break;
        }
      }
    }

    loadAvailableLanguages(state, videoId, setPhase, onDone);
  } catch {
    loadAvailableLanguages(state, videoId, setPhase, onDone);
  }
}
