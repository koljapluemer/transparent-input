const API_BASE = 'http://localhost:8000/api';
const POLL_INTERVAL_MS = 300;
const CARD_DISPLAY_MS = 4000;
const MAX_VISIBLE_CARDS = 3;
const MIN_CARD_INTERVAL_S = 1;
const MAX_CARD_INTERVAL_S = 3;
const PROCESSING_POLL_MS = 5000;
const PROCESSING_POLL_MAX = 120;
const TOOLBAR_HEIGHT = 40;

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4.1';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const MIN_META_SEGMENT_WORDS = 8;
const IDEAL_META_SEGMENT_MIN_WORDS = 12;
const IDEAL_META_SEGMENT_MAX_WORDS = 25;
const MAX_META_SEGMENT_WORDS = 50;
const MIN_EXPORT_SEGMENTS = 3;

const PHASE = {
  NO_VIDEO:      'no-video',
  CHECKING:      'checking',
  LOADING:       'loading',
  READY:         'ready',
  SUBMITTING:    'submitting',
  AI_PROCESSING: 'ai-processing',
  POLLING:       'polling',
  DONE:          'done',
  ERROR:         'error',
} as const;

type Phase = typeof PHASE[keyof typeof PHASE];

interface LangEntry {
  languageCode: string;
  trackName: string;
  iso3: string;
  humanReadable: string;
  baseUrl: string;
}

interface SegmentDisplay {
  startSeconds: number;
  endSeconds: number;
  vocab: [string, string][];
}

interface Card {
  id: number;
  word: string;
  element: HTMLElement;
  timerId: ReturnType<typeof setTimeout>;
}

interface UserSettings {
  primaryNativeLanguage: string;
  nativeFallbacks: string[];
  provider: 'openai' | 'gemini';
  apiKey: string;
}

interface MetaSegment {
  start: number;
  end: number;
  text: string;
  wordCount: number;
}

interface PhaseData {
  message?: string;
  error?: string;
  count?: number;
  max?: number;
  done?: number;
  total?: number;
  servedNativeLanguage?: string | null;
  primaryNativeLanguage?: string | null;
}

interface AvailableTranslation {
  pipeline: string;
  native_language: string;
  created_at: string;
}

interface State {
  videoId: string | null;
  phase: Phase;
  phaseData: PhaseData;
  segments: SegmentDisplay[];
  overlay: HTMLElement | null;
  toolbar: HTMLElement | null;
  intervalId: ReturnType<typeof setInterval> | null;
  cards: Card[];
  cardCounter: number;
  currentSegmentIndex: number;
  nextCardAt: number | null;
  activeVocabKeys: Set<string>;
  pollTimerId: ReturnType<typeof setTimeout> | null;
  pollAttempts: number;
  availableLangs: LangEntry[];
  selectedLang: string | null;
  userSettings: UserSettings | null;
  llmSegments: boolean;
}

const state: State = {
  videoId: null,
  phase: PHASE.NO_VIDEO,
  phaseData: {},
  segments: [],
  overlay: null,
  toolbar: null,
  intervalId: null,
  cards: [],
  cardCounter: 0,
  currentSegmentIndex: -1,
  nextCardAt: null,
  activeVocabKeys: new Set(),
  pollTimerId: null,
  pollAttempts: 0,
  availableLangs: [],
  selectedLang: null,
  userSettings: null,
  llmSegments: false,
};

// ── Phase management ──────────────────────────────────────────────────────────

function setPhase(videoId: string, phase: Phase, data: PhaseData = {}): void {
  if (videoId !== state.videoId) return;
  state.phase = phase;
  state.phaseData = data;
  renderToolbar();
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadUserSettings(): Promise<UserSettings> {
  const local = await browser.storage.local.get([
    'primaryNativeLanguage', 'nativeFallbacks', 'provider', 'apiKey', 'rememberKey',
  ]);
  let apiKey = (local.apiKey as string) || '';
  if (!apiKey) {
    try {
      const session = await browser.storage.session.get('apiKey');
      apiKey = (session.apiKey as string) || '';
    } catch {
      // browser.storage.session unavailable
    }
  }
  return {
    primaryNativeLanguage: (local.primaryNativeLanguage as string) || 'en',
    nativeFallbacks: Array.isArray(local.nativeFallbacks) ? (local.nativeFallbacks as string[]) : [],
    provider: ((local.provider as string) === 'gemini') ? 'gemini' : 'openai',
    apiKey,
  };
}

// ── Timestamp / formatting ────────────────────────────────────────────────────

function parseTimestamp(ts: string): number {
  const [timePart, msPart] = ts.split('.');
  const [h, m, s] = timePart.split(':').map(Number);
  const ms = msPart ? Number(msPart.padEnd(3, '0').slice(0, 3)) : 0;
  return h * 3600 + m * 60 + s + ms / 1000;
}

function fmtTimestamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const msRem = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(msRem).padStart(3, '0')}`;
}

function randInterval(): number {
  return (MIN_CARD_INTERVAL_S + Math.random() * (MAX_CARD_INTERVAL_S - MIN_CARD_INTERVAL_S)) * 1000;
}

// ── Processing poll ───────────────────────────────────────────────────────────

function stopPolling(): void {
  if (state.pollTimerId) {
    clearTimeout(state.pollTimerId);
    state.pollTimerId = null;
  }
  state.pollAttempts = 0;
}

function startPolling(videoId: string): void {
  stopPolling();

  async function poll(): Promise<void> {
    if (state.videoId !== videoId) return;

    if (state.pollAttempts >= PROCESSING_POLL_MAX) {
      stopPolling();
      setPhase(videoId, PHASE.ERROR, { error: 'Processing timed out — try again' });
      return;
    }

    state.pollAttempts++;
    setPhase(videoId, PHASE.POLLING, { count: state.pollAttempts, max: PROCESSING_POLL_MAX });

    try {
      const resp = await fetch(`${API_BASE}/videos/${videoId}/`);
      if (!resp.ok) {
        state.pollTimerId = setTimeout(poll, PROCESSING_POLL_MS);
        return;
      }
      const data = await resp.json();

      if (data.segments?.length > 0) {
        stopPolling();
        loadSegments(data, videoId);
        return;
      }

      const jobStatus = data.processing?.status;
      if (jobStatus === 'failed') {
        stopPolling();
        setPhase(videoId, PHASE.ERROR, { error: data.processing.error || 'Processing failed' });
        return;
      }
      if (jobStatus === 'done') {
        stopPolling();
        setPhase(videoId, PHASE.ERROR, { error: 'Processing complete — no vocabulary found in this video' });
        return;
      }
    } catch {
      // Network error — keep polling.
    }

    state.pollTimerId = setTimeout(poll, PROCESSING_POLL_MS);
  }

  state.pollTimerId = setTimeout(poll, PROCESSING_POLL_MS);
}

// ── Subtitle / caption helpers ────────────────────────────────────────────────

interface RawCue { start: number; end: number; text: string; }

function parseJson3(json3: Record<string, unknown>): RawCue[] {
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

async function fetchSupportedLanguages(): Promise<{ iso3: string; subtitle_language: string; human_readable: string }[]> {
  const resp = await fetch(`${API_BASE}/languages/`);
  if (!resp.ok) return [];
  return resp.json();
}

async function getCaptionTracks(videoId: string): Promise<{ languageCode: string; name?: { simpleText?: string }; baseUrl: string }[]> {
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

async function fetchSubtitleCues(lang: LangEntry): Promise<RawCue[]> {
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

// ── Language loading ──────────────────────────────────────────────────────────

async function loadAvailableLanguages(videoId: string): Promise<void> {
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

// ── Meta-segmentation (DP, ported from LEGACY_INSPIRATION_SCRIPT.py) ─────────

function countWords(text: string): number {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  return cleaned ? cleaned.split(' ').length : 0;
}

function metaSegmentWordCost(wordCount: number): number {
  if (wordCount >= IDEAL_META_SEGMENT_MIN_WORDS && wordCount <= IDEAL_META_SEGMENT_MAX_WORDS) return 0;
  const distance = wordCount < IDEAL_META_SEGMENT_MIN_WORDS
    ? IDEAL_META_SEGMENT_MIN_WORDS - wordCount
    : wordCount - IDEAL_META_SEGMENT_MAX_WORDS;
  return (distance * distance) / 4;
}

function splitBoundaryCost(left: RawCue, right: RawCue): number {
  const overlap = Math.max(0, left.end - right.start);
  return overlap <= 0 ? 0 : 5 + overlap * 40;
}

function buildMetaSegments(cues: RawCue[]): MetaSegment[] {
  if (cues.length === 0) return [];

  const wordCounts = cues.map(c => countWords(c.text));
  const prefixWords = [0];
  for (const wc of wordCounts) prefixWords.push(prefixWords[prefixWords.length - 1] + wc);

  const n = cues.length;
  const bestCosts = new Array<number>(n + 1).fill(Infinity);
  const nextIdx = new Array<number | null>(n + 1).fill(null);
  bestCosts[n] = 0;

  for (let start = n - 1; start >= 0; start--) {
    for (let end = start; end < n; end++) {
      const wc = prefixWords[end + 1] - prefixWords[start];
      if (wc > MAX_META_SEGMENT_WORDS) break;
      if (wc < MIN_META_SEGMENT_WORDS) continue;

      let cost = metaSegmentWordCost(wc);
      if (end + 1 < n) cost += splitBoundaryCost(cues[end], cues[end + 1]);
      cost += bestCosts[end + 1];

      if (cost < bestCosts[start]) {
        bestCosts[start] = cost;
        nextIdx[start] = end + 1;
      }
    }
  }

  if (nextIdx[0] === null) {
    // Fallback: merge everything
    const text = cues.map(c => c.text).join(' ').replace(/\s+/g, ' ');
    return [{ start: cues[0].start, end: cues[cues.length - 1].end, text, wordCount: countWords(text) }];
  }

  const segments: MetaSegment[] = [];
  let i = 0;
  while (i < n) {
    const j = nextIdx[i];
    if (j === null) break;
    const slice = cues.slice(i, j);
    const text = slice.map(c => c.text).join(' ').replace(/\s+/g, ' ');
    segments.push({ start: slice[0].start, end: slice[slice.length - 1].end, text, wordCount: countWords(text) });
    i = j;
  }
  return segments;
}

// ── LLM API calls ─────────────────────────────────────────────────────────────

function buildVocabPrompt(segmentText: string, targetLangHuman: string, nativeLangHuman: string): string {
  return (
    `You are helping a ${nativeLangHuman} speaker understand a ${targetLangHuman} subtitle segment.\n` +
    `Extract only the core words, short expressions, or constructions needed to understand the segment. Do not include full sentences.\n` +
    `Translate each item into ${nativeLangHuman}.\n` +
    `Return JSON: {"vocab": {"source expression": "translation"}}\n\n` +
    `Subtitle segment:\n${segmentText}`
  );
}

function parseVocabResponse(raw: string): Record<string, string> | null {
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

async function callLLM(settings: UserSettings, prompt: string): Promise<Record<string, string> | null> {
  const raw = settings.provider === 'gemini'
    ? await callGemini(settings.apiKey, prompt)
    : await callOpenAI(settings.apiKey, prompt);
  return parseVocabResponse(raw);
}

// ── Submit — server-side pipeline ─────────────────────────────────────────────

async function submitForProcessing(): Promise<void> {
  const videoId = state.videoId;
  const lang = state.availableLangs.find(l => l.languageCode === state.selectedLang);
  if (!lang || !videoId) return;

  setPhase(videoId, PHASE.SUBMITTING, { message: 'Fetching subtitles…' });
  try {
    const cues = await fetchSubtitleCues(lang);
    setPhase(videoId, PHASE.SUBMITTING, { message: 'Submitting to backend…' });
    const submitResp = await fetch(`${API_BASE}/videos/${videoId}/submit/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language_iso3: lang.iso3, transcript: cues }),
    });
    if (submitResp.ok || submitResp.status === 202) {
      startPolling(videoId);
    } else {
      setPhase(videoId, PHASE.ERROR, { error: `Submit failed (HTTP ${submitResp.status})` });
    }
  } catch (e) {
    setPhase(videoId, PHASE.ERROR, { error: (e as Error).message || 'Submit failed' });
  }
}

// ── Submit — client-side LLM ──────────────────────────────────────────────────

async function submitWithLLM(): Promise<void> {
  const videoId = state.videoId;
  const lang = state.availableLangs.find(l => l.languageCode === state.selectedLang);
  const settings = state.userSettings;
  if (!lang || !videoId || !settings?.apiKey) return;

  setPhase(videoId, PHASE.SUBMITTING, { message: 'Fetching subtitles…' });
  let cues: RawCue[];
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

  try {
    await fetch(`${API_BASE}/videos/${videoId}/translations/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipeline, native_language: nativeLang, segments: resultSegments }),
    });
  } catch (e) {
    console.warn('[TI] Failed to store translation on backend:', (e as Error).message);
  }

  if (state.videoId !== videoId) return;
  loadSegments({ segments: resultSegments }, videoId, { servedNativeLanguage: nativeLang, fromLLM: true });
}

// ── Segment loading ───────────────────────────────────────────────────────────

function loadSegments(
  data: { segments: { startTimestamp: string; endTimestamp: string; vocab?: Record<string, string> }[] },
  videoId: string,
  { servedNativeLanguage = null, fromLLM = false }: { servedNativeLanguage?: string | null; fromLLM?: boolean } = {},
): void {
  if (state.videoId !== videoId) return;

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
    injectOverlay();
    state.intervalId = setInterval(tick, POLL_INTERVAL_MS);
  } else {
    loadAvailableLanguages(videoId);
  }
}

// ── Core video change handler ─────────────────────────────────────────────────

async function onVideoChange(videoId: string | null): Promise<void> {
  cleanup();

  if (!videoId) {
    if (state.toolbar) state.toolbar.style.display = 'none';
    removeToolbarSpacing();
    return;
  }

  state.videoId = videoId;
  state.userSettings = await loadUserSettings();
  ensureToolbar();
  setPhase(videoId, PHASE.CHECKING);

  try {
    const resp = await fetch(`${API_BASE}/videos/${videoId}/`);

    if (resp.status === 404 || !resp.ok) {
      loadAvailableLanguages(videoId);
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
              loadSegments(tData, videoId, { servedNativeLanguage: nativeLang });
              return;
            }
          } catch { /* fall through */ }
          break;
        }
      }
    }

    if (data.segments?.length > 0) {
      loadSegments(data, videoId);
      return;
    }

    const jobStatus = data.processing?.status;
    if (jobStatus === 'pending' || jobStatus === 'running') {
      startPolling(videoId);
      return;
    }

    loadAvailableLanguages(videoId);
  } catch {
    loadAvailableLanguages(videoId);
  }
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function applyToolbarSpacing(): void {
  if (document.getElementById('ti-spacing')) return;
  const style = document.createElement('style');
  style.id = 'ti-spacing';
  style.textContent =
    `#page-manager{margin-top:calc(var(--ytd-masthead-height,56px) + ${TOOLBAR_HEIGHT}px)!important}`;
  document.head.appendChild(style);
}

function removeToolbarSpacing(): void {
  document.getElementById('ti-spacing')?.remove();
}

function ensureToolbar(): void {
  applyToolbarSpacing();
  if (state.toolbar) {
    state.toolbar.style.display = 'flex';
    renderToolbar();
    return;
  }
  const bar = document.createElement('div');
  bar.id = 'ti-toolbar';
  bar.style.cssText = [
    'position:fixed', 'top:56px', 'left:0', 'right:0', 'z-index:9998',
    'background:#0f0f0f', 'border-bottom:1px solid #272727', 'color:#fff',
    'font-family:Roboto,Arial,sans-serif', 'font-size:13px', 'display:flex',
    'align-items:center', 'gap:10px', 'padding:5px 16px', 'box-sizing:border-box',
    `height:${TOOLBAR_HEIGHT}px`,
  ].join(';');
  document.body.appendChild(bar);
  state.toolbar = bar;
  renderToolbar();
}

function renderToolbar(): void {
  const bar = state.toolbar;
  if (!bar) return;
  bar.innerHTML = '';

  const label = el('span', 'font-weight:600;color:#909090;white-space:nowrap;margin-right:4px;', 'Transparent Input');
  const sep = el('span', 'color:#3f3f3f;', '|');
  bar.appendChild(label);
  bar.appendChild(sep);

  const { phase, phaseData } = state;
  const settings = state.userSettings;
  const hasKey = !!settings?.apiKey;
  const providerLabel = settings?.provider === 'gemini' ? 'Gemini' : 'OpenAI';

  switch (phase) {
    case PHASE.CHECKING:
      bar.appendChild(muted('Checking…'));
      break;

    case PHASE.LOADING:
      bar.appendChild(muted('Loading subtitle tracks…'));
      break;

    case PHASE.READY:
      if (state.availableLangs.length === 0) {
        bar.appendChild(muted('No supported subtitle tracks found for this video'));
      } else {
        const select = document.createElement('select');
        select.style.cssText = 'background:#272727;color:#fff;border:1px solid #3f3f3f;border-radius:4px;padding:2px 6px;font-size:13px;cursor:pointer;outline:none;';
        for (const lang of state.availableLangs) {
          const opt = document.createElement('option');
          opt.value = lang.languageCode;
          opt.textContent = lang.trackName;
          if (lang.languageCode === state.selectedLang) opt.selected = true;
          select.appendChild(opt);
        }
        select.addEventListener('change', () => { state.selectedLang = select.value; });
        bar.appendChild(select);

        if (hasKey) {
          const aiBtn = btn('Translate (AI)', '#065fd4', submitWithLLM);
          bar.appendChild(aiBtn);
          bar.appendChild(muted(`via ${providerLabel}`));
        }

        const serverBtn = btn(
          hasKey ? 'Translate (server)' : 'Translate',
          hasKey ? '#1e1e1e' : '#065fd4',
          submitForProcessing,
        );
        if (hasKey) serverBtn.style.cssText += ';border:1px solid #3f3f3f;color:#909090;';
        bar.appendChild(serverBtn);

        if (!hasKey) bar.appendChild(settingsLink('AI: Needs Setup. →'));
      }
      break;

    case PHASE.SUBMITTING:
      bar.appendChild(muted(phaseData.message || 'Submitting…'));
      break;

    case PHASE.AI_PROCESSING:
      bar.appendChild(orangeDot());
      bar.appendChild(colored('#f90', `Processing with AI… (${phaseData.done}/${phaseData.total} segments)`));
      break;

    case PHASE.POLLING:
      bar.appendChild(orangeDot());
      bar.appendChild(colored('#f90', `Processing… (${phaseData.count}/${phaseData.max})`));
      break;

    case PHASE.DONE: {
      bar.appendChild(dot('#2ba640'));
      bar.appendChild(colored('#2ba640', 'Ready'));
      bar.appendChild(muted(`${phaseData.count} segments`));

      if (phaseData.servedNativeLanguage) {
        const servedName = nativeLangDisplayName(phaseData.servedNativeLanguage);
        const primaryName = nativeLangDisplayName(phaseData.primaryNativeLanguage ?? 'en');
        bar.appendChild(muted(`· Shown in ${servedName}`));
        if (hasKey) {
          const processBtn = el('button',
            'background:none;border:none;color:#065fd4;font-size:13px;cursor:pointer;font-family:inherit;padding:0;',
            `Process in ${primaryName} →`,
          );
          processBtn.addEventListener('click', () => state.videoId && loadAvailableLanguages(state.videoId));
          bar.appendChild(processBtn);
        } else {
          bar.appendChild(settingsLink(`Set up key to process in ${primaryName} →`));
        }
      }
      break;
    }

    case PHASE.ERROR:
      bar.appendChild(colored('#f44336', phaseData.error || 'Error'));
      const retryBtn = btn('Retry', '#272727', () => state.videoId && loadAvailableLanguages(state.videoId));
      retryBtn.style.cssText += ';border:1px solid #3f3f3f;font-size:12px;padding:2px 10px;';
      bar.appendChild(retryBtn);
      break;
  }

  const spacer = document.createElement('span');
  spacer.style.flex = '1';
  bar.appendChild(spacer);

  const gearBtn = el('button', 'background:none;border:none;color:#656565;font-size:16px;cursor:pointer;padding:0 2px;line-height:1;', '⚙');
  gearBtn.title = 'Settings';
  gearBtn.addEventListener('mouseenter', () => { gearBtn.style.color = '#fff'; });
  gearBtn.addEventListener('mouseleave', () => { gearBtn.style.color = '#656565'; });
  gearBtn.addEventListener('click', () => browser.runtime.sendMessage('openOptionsPage'));
  bar.appendChild(gearBtn);
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function el(tag: string, css: string, text: string): HTMLElement {
  const e = document.createElement(tag);
  e.style.cssText = css;
  e.textContent = text;
  return e;
}

function muted(text: string): HTMLElement {
  return el('span', 'color:#909090;', text);
}

function colored(color: string, text: string): HTMLElement {
  return el('span', `color:${color};`, text);
}

function dot(color: string): HTMLElement {
  return el('span', `display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;`, '');
}

function orangeDot(): HTMLElement {
  return dot('#f90');
}

function btn(text: string, bg: string, onClick: () => void): HTMLElement {
  const b = el('button',
    `background:${bg};color:#fff;border:none;border-radius:4px;padding:4px 14px;font-size:13px;cursor:pointer;white-space:nowrap;font-family:inherit;`,
    text,
  );
  b.addEventListener('click', onClick);
  return b;
}

function settingsLink(text: string): HTMLElement {
  const b = el('button',
    'background:none;border:none;color:#909090;font-size:12px;cursor:pointer;font-family:inherit;padding:0;text-decoration:underline;',
    text,
  );
  b.addEventListener('click', () => browser.runtime.sendMessage('openOptionsPage'));
  return b;
}

// ── Language name helper (uses Intl.DisplayNames, no library needed here) ─────

function nativeLangDisplayName(code: string): string {
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'language' });
    return dn.of(code) ?? code;
  } catch {
    return code;
  }
}

// ── Overlay ───────────────────────────────────────────────────────────────────

function cleanup(): void {
  stopPolling();
  if (state.intervalId) { clearInterval(state.intervalId); state.intervalId = null; }
  for (const card of state.cards) clearTimeout(card.timerId);
  if (state.overlay?.parentNode) state.overlay.parentNode.removeChild(state.overlay);
  state.overlay = null;
  state.cards = [];
  state.activeVocabKeys = new Set();
  state.segments = [];
  state.videoId = null;
  state.phase = PHASE.NO_VIDEO;
  state.phaseData = {};
  state.currentSegmentIndex = -1;
  state.nextCardAt = null;
  state.availableLangs = [];
  state.selectedLang = null;
  state.llmSegments = false;
}

function injectOverlay(attempt = 0): void {
  const player = document.querySelector('#movie_player');
  if (!player) {
    if (attempt < 20) setTimeout(() => injectOverlay(attempt + 1), 250);
    return;
  }
  if (window.getComputedStyle(player as HTMLElement).position === 'static') {
    (player as HTMLElement).style.position = 'relative';
  }
  const overlay = document.createElement('div');
  overlay.id = 'ti-vocab-overlay';
  overlay.style.cssText =
    'position:absolute;top:12px;left:12px;z-index:9999;' +
    'display:flex;flex-direction:column;gap:6px;pointer-events:none;max-width:320px;';
  player.appendChild(overlay);
  state.overlay = overlay;
}

function tick(): void {
  const video = document.querySelector('video');
  if (!video || !state.overlay) return;

  const current = video.currentTime;
  const now = performance.now();
  const segIndex = state.segments.findIndex(seg => current >= seg.startSeconds && current < seg.endSeconds);

  if (segIndex !== state.currentSegmentIndex) {
    state.currentSegmentIndex = segIndex;
    state.nextCardAt = segIndex === -1 ? null : now + randInterval();
  }
  if (segIndex === -1 || state.nextCardAt === null || now < state.nextCardAt) return;

  const seg = state.segments[segIndex];
  const available = seg.vocab.filter(([word]) => !state.activeVocabKeys.has(word));
  if (available.length === 0) return;

  const [word, translation] = available[Math.floor(Math.random() * available.length)];
  if (state.cards.length >= MAX_VISIBLE_CARDS) {
    const oldest = state.cards.shift()!;
    clearTimeout(oldest.timerId);
    state.activeVocabKeys.delete(oldest.word);
    oldest.element.parentNode?.removeChild(oldest.element);
  }

  addCard(word, translation);
  state.nextCardAt = now + randInterval();
}

function addCard(word: string, translation: string): void {
  const id = ++state.cardCounter;
  // LLM-sourced segments: dark blue pill. Server-side: dark grey.
  const bg = state.llmSegments ? 'rgba(6,42,90,0.92)' : 'rgba(0,0,0,0.87)';

  const cardEl = document.createElement('div');
  cardEl.style.cssText =
    `background:${bg};color:#fff;padding:6px 12px;border-radius:20px;` +
    'font-size:14px;font-family:system-ui,sans-serif;line-height:1.4;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.4);backdrop-filter:blur(4px);' +
    '-webkit-backdrop-filter:blur(4px);cursor:pointer;pointer-events:auto;' +
    'user-select:none;white-space:nowrap;';
  cardEl.textContent = `${word} = ${translation}`;
  cardEl.addEventListener('click', () => dismissCard(id));

  const timerId = setTimeout(() => dismissCard(id), CARD_DISPLAY_MS);
  state.cards.push({ id, word, element: cardEl, timerId });
  state.activeVocabKeys.add(word);
  state.overlay!.appendChild(cardEl);
}

function dismissCard(id: number): void {
  const idx = state.cards.findIndex(c => c.id === id);
  if (idx === -1) return;
  const card = state.cards[idx];
  clearTimeout(card.timerId);
  state.activeVocabKeys.delete(card.word);
  state.cards.splice(idx, 1);
  card.element.parentNode?.removeChild(card.element);
}

// ── Navigation ────────────────────────────────────────────────────────────────

function getVideoId(): string | null {
  return new URLSearchParams(window.location.search).get('v');
}

export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    document.addEventListener('yt-navigate-finish', () => {
      const id = getVideoId();
      if (id !== state.videoId) onVideoChange(id);
    });
    const id = getVideoId();
    if (id) onVideoChange(id);
  },
});
