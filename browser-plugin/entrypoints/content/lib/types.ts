export const PHASE = {
  NO_VIDEO:      'no-video',
  CHECKING:      'checking',
  LOADING:       'loading',
  READY:         'ready',
  SUBMITTING:    'submitting',
  AI_PROCESSING: 'ai-processing',
  DONE:          'done',
  ERROR:         'error',
} as const;

export type Phase = typeof PHASE[keyof typeof PHASE];

export interface LangEntry {
  languageCode: string;
  displayName: string;
  baseUrl: string;
}

export interface SegmentDisplay {
  startSeconds: number;
  endSeconds: number;
  vocab: [string, string][];
}

export interface Card {
  id: number;
  word: string;
  translation: string;
  timerId: ReturnType<typeof setTimeout>;
}

export interface UserSettings {
  primaryNativeLanguage: string;
  nativeFallbacks: string[];
  provider: 'openai' | 'gemini';
  apiKey: string;
}

export interface MetaSegment {
  start: number;
  end: number;
  text: string;
  wordCount: number;
}

export interface PhaseData {
  message?: string;
  error?: string;
  count?: number;
  done?: number;
  total?: number;
  servedNativeLanguage?: string | null;
  primaryNativeLanguage?: string | null;
}

export interface AvailableTranslation {
  pipeline: string;
  native_language: string;
  created_at: string;
}

export interface RawCue {
  start: number;
  end: number;
  text: string;
}

export interface State {
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
  availableLangs: LangEntry[];
  selectedLang: string | null;
  userSettings: UserSettings | null;
  llmSegments: boolean;
}
