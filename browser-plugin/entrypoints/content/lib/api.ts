import type { State, LangEntry, AvailableTranslation, Phase, PhaseData } from './types';
import { PHASE, LEVEL } from './types';
import { getCaptionTracks, captionTracksToLangEntries, fetchSubtitleCues } from './subtitles';
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
  opts?: {
    servedNativeLanguage?: string | null;
    level?: string;
    fromLLM?: boolean;
    onDone?: () => void;
  },
) => void;

export const loadSegments: LoadSegmentsFn = (state, data, videoId, setPhase, opts = {}) => {
  if (state.videoId !== videoId) return;
  const { servedNativeLanguage = null, level, fromLLM = false, onDone } = opts;

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
    const resolvedNativeLang = servedNativeLanguage ?? primaryNativeLanguage;
    state.currentNativeLanguage = resolvedNativeLang;
    if (level) state.currentTranslationLevel = level;

    setPhase(videoId, PHASE.DONE, { count: state.segments.length });
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
    const tracks = await getCaptionTracks(videoId);

    if (state.videoId !== videoId) return;

    state.availableLangs = captionTracksToLangEntries(tracks);
    if (state.availableLangs.length > 0) state.selectedLang = state.availableLangs[0].languageCode;

    setPhase(videoId, PHASE.READY);
  } catch {
    setPhase(videoId, PHASE.ERROR, { error: 'Failed to load subtitle tracks' });
  }
}

export async function switchTranslation(
  state: State,
  videoId: string,
  nativeLang: string,
  level: string,
  setPhase: SetPhase,
): Promise<void> {
  try {
    const resp = await fetch(`${API_BASE}/videos/${videoId}/translations/${nativeLang}/?level=${level}`);
    if (!resp.ok || state.videoId !== videoId) return;
    const data = await resp.json();
    loadSegments(state, data, videoId, setPhase, { servedNativeLanguage: nativeLang, level });
  } catch {
    // stay on current translation
  }
}

export async function submitWithLLM(
  state: State,
  videoId: string,
  nativeLang: string,
  level: string,
  setPhase: SetPhase,
  onDone?: () => void,
): Promise<void> {
  const lang = state.availableLangs.find(l => l.languageCode === state.selectedLang);
  const settings = state.userSettings;
  if (!lang || !videoId || !settings?.apiKey) return;

  state.requestingNew = false;

  const abortController = new AbortController();
  state.abortController = abortController;

  setPhase(videoId, PHASE.SUBMITTING, { message: 'Fetching subtitles…' });
  let cues;
  try {
    cues = await fetchSubtitleCues(lang);
  } catch (e) {
    state.abortController = null;
    setPhase(videoId, PHASE.ERROR, { error: (e as Error).message || 'Subtitle fetch failed' });
    return;
  }

  if (state.videoId !== videoId) { state.abortController = null; return; }

  const metaSegments = buildMetaSegments(cues);
  const nativeLangHuman = nativeLangDisplayName(nativeLang);
  const targetLangHuman = lang.displayName;
  const pipeline = settings.provider === 'gemini' ? 'gemini-flash' : `openai-${OPENAI_MODEL}`;

  setPhase(videoId, PHASE.AI_PROCESSING, { done: 0, total: metaSegments.length });

  const resultSegments: { index: number; startTimestamp: string; endTimestamp: string; vocab: Record<string, string> }[] = [];

  try {
    for (let i = 0; i < metaSegments.length; i++) {
      if (state.videoId !== videoId) { state.abortController = null; return; }

      const seg = metaSegments[i];
      const prompt = buildVocabPrompt(seg.text, targetLangHuman, nativeLangHuman, level);

      let vocab: Record<string, string> | null = null;
      for (let attempt = 0; attempt < 2 && vocab === null; attempt++) {
        try {
          vocab = await callLLM(settings, prompt, abortController.signal);
        } catch (e) {
          if ((e as Error).name === 'AbortError') throw e;
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
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      state.abortController = null;
      return;
    }
    throw e;
  }

  state.abortController = null;

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
        level,
        segments: resultSegments,
        language: lang.languageCode,
        title,
      }),
    });
  } catch (e) {
    console.warn('[TI] Failed to store translation on backend:', (e as Error).message);
  }

  const newTranslation: AvailableTranslation = {
    pipeline,
    native_language: nativeLang,
    level,
    created_at: new Date().toISOString(),
  };
  state.availableTranslations = [
    newTranslation,
    ...state.availableTranslations.filter(
      t => !(t.native_language === nativeLang && t.level === level && t.pipeline === pipeline),
    ),
  ];

  if (state.videoId !== videoId) return;
  loadSegments(state, { segments: resultSegments }, videoId, setPhase, {
    servedNativeLanguage: nativeLang,
    level,
    fromLLM: true,
    onDone,
  });
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

    state.availableTranslations = availableTranslations;

    if (availableTranslations.length > 0) {
      const preferenceChain = [settings.primaryNativeLanguage, ...settings.nativeFallbacks];
      for (const nativeLang of preferenceChain) {
        const match = availableTranslations.find(t => t.native_language === nativeLang);
        if (match) {
          const level = match.level || LEVEL.INTERMEDIATE;
          try {
            const tResp = await fetch(
              `${API_BASE}/videos/${videoId}/translations/${nativeLang}/?level=${level}`,
            );
            if (tResp.ok && state.videoId === videoId) {
              const tData = await tResp.json();
              loadSegments(state, tData, videoId, setPhase, {
                servedNativeLanguage: nativeLang,
                level,
                onDone,
              });
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
