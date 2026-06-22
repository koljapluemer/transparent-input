import '../../assets/main.css';
import { reactive, createApp } from 'vue';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { State, PhaseData } from './lib/types';
import { PHASE } from './lib/types';
import { loadUserSettings } from './lib/settings';
import { randInterval } from './lib/utils';
import {
  stopPolling,
  loadAvailableLanguages,
  submitForProcessing,
  submitWithLLM,
  checkAndLoadVideo,
} from './lib/api';
import Toolbar from './ui/Toolbar.vue';
import CardOverlay from './ui/CardOverlay.vue';

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 400;
const CARD_DISPLAY_MS = 4000;
const MAX_VISIBLE_CARDS = 3;
const MIN_CARD_INTERVAL_S = 1;
const MAX_CARD_INTERVAL_S = 3;
export const TOOLBAR_HEIGHT = 40;

// ── State ─────────────────────────────────────────────────────────────────────

const state = reactive<State>({
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
});

// ── Phase management ──────────────────────────────────────────────────────────

function setPhase(videoId: string, phase: typeof PHASE[keyof typeof PHASE], data: PhaseData = {}): void {
  if (videoId !== state.videoId) return;
  state.phase = phase;
  state.phaseData = data;
}

// ── Card management ───────────────────────────────────────────────────────────

function addCard(word: string, translation: string): void {
  const id = ++state.cardCounter;
  const timerId = setTimeout(() => dismissCard(id), CARD_DISPLAY_MS);
  state.cards.push({ id, word, translation, timerId });
  state.activeVocabKeys.add(word);
}

function dismissCard(id: number): void {
  const idx = state.cards.findIndex(c => c.id === id);
  if (idx === -1) return;
  const card = state.cards[idx];
  clearTimeout(card.timerId);
  state.activeVocabKeys.delete(card.word);
  state.cards.splice(idx, 1);
}

// ── Tick loop ─────────────────────────────────────────────────────────────────

function tick(): void {
  const video = document.querySelector('video');
  if (!video || !state.overlay) return;

  const current = video.currentTime;
  const now = performance.now();
  const segIndex = state.segments.findIndex(seg => current >= seg.startSeconds && current < seg.endSeconds);

  if (segIndex !== state.currentSegmentIndex) {
    state.currentSegmentIndex = segIndex;
    state.nextCardAt = segIndex === -1 ? null : now + randInterval(MIN_CARD_INTERVAL_S, MAX_CARD_INTERVAL_S);
  }
  if (segIndex === -1 || state.nextCardAt === null || now < state.nextCardAt) return;

  const seg = state.segments[segIndex];
  const available = seg.vocab.filter(([word]) => !state.activeVocabKeys.has(word));
  if (available.length === 0) return;

  if (state.cards.length >= MAX_VISIBLE_CARDS) {
    const oldest = state.cards.shift()!;
    clearTimeout(oldest.timerId);
    state.activeVocabKeys.delete(oldest.word);
  }

  const [word, translation] = available[Math.floor(Math.random() * available.length)];
  addCard(word, translation);
  state.nextCardAt = now + randInterval(MIN_CARD_INTERVAL_S, MAX_CARD_INTERVAL_S);
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

let toolbarUi: Awaited<ReturnType<typeof createShadowRootUi>> | null = null;

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

async function ensureToolbar(ctx: ContentScriptContext, onSubmitLLM: () => void, onSubmitServer: () => void): Promise<void> {
  applyToolbarSpacing();

  if (toolbarUi) {
    // Show if previously hidden (no-video state)
    toolbarUi.shadowHost.style.setProperty('display', 'block', 'important');
    return;
  }

  toolbarUi = await createShadowRootUi(ctx, {
    name: 'ti-toolbar',
    position: 'inline',
    anchor: 'body',
    append: 'first',
    // WXT resets :host with all:initial !important — override it here (same layer, later = wins)
    css: `
      :host {
        display: block !important;
        position: fixed !important;
        top: 56px !important;
        left: 0 !important;
        right: 0 !important;
        height: ${TOOLBAR_HEIGHT}px !important;
        z-index: 9998 !important;
      }
    `,
    onMount(uiContainer) {
      uiContainer.dataset.theme = 'dark';
      const app = createApp(Toolbar, {
        state,
        TOOLBAR_HEIGHT,
        onSubmitLLM,
        onSubmitServer,
        onRetry: () => state.videoId && loadAvailableLanguages(state, state.videoId, setPhase),
        openSettings: () => browser.runtime.sendMessage('openOptionsPage'),
      });
      app.mount(uiContainer);
      return app;
    },
    onRemove(app) { app?.unmount(); },
  });

  toolbarUi.mount();
  state.toolbar = toolbarUi.shadowHost;
}

// ── Overlay ───────────────────────────────────────────────────────────────────

let overlayUi: Awaited<ReturnType<typeof createShadowRootUi>> | null = null;

async function injectOverlayAndStart(ctx: ContentScriptContext): Promise<void> {
  // Remove previous overlay if it exists
  if (overlayUi) {
    overlayUi.remove();
    overlayUi = null;
    state.overlay = null;
  }

  // Wait for #movie_player (up to 5s)
  const player = await waitForElement('#movie_player', 5000);
  if (!player || !state.videoId) return;

  if (window.getComputedStyle(player).position === 'static') {
    (player as HTMLElement).style.position = 'relative';
  }

  overlayUi = await createShadowRootUi(ctx, {
    name: 'ti-vocab-overlay',
    position: 'inline',
    anchor: '#movie_player',
    append: 'last',
    css: `
      :host {
        display: block !important;
        position: absolute !important;
        top: 12px !important;
        left: 12px !important;
        max-width: 320px !important;
        pointer-events: none !important;
        z-index: 9999 !important;
      }
    `,
    onMount(uiContainer) {
      uiContainer.dataset.theme = 'dark';
      const app = createApp(CardOverlay, { state, onDismiss: dismissCard });
      app.mount(uiContainer);
      return app;
    },
    onRemove(app) { app?.unmount(); },
  });

  overlayUi.mount();
  state.overlay = overlayUi.shadowHost;
  state.intervalId = setInterval(tick, POLL_INTERVAL_MS);
}

function waitForElement(selector: string, timeoutMs: number): Promise<Element | null> {
  return new Promise(resolve => {
    const el = document.querySelector(selector);
    if (el) { resolve(el); return; }
    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) { observer.disconnect(); resolve(found); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, timeoutMs);
  });
}

// ── Navigation ────────────────────────────────────────────────────────────────

function cleanup(): void {
  stopPolling(state);
  if (state.intervalId) { clearInterval(state.intervalId); state.intervalId = null; }
  for (const card of state.cards) clearTimeout(card.timerId);
  if (overlayUi) { overlayUi.remove(); overlayUi = null; }
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

async function onVideoChange(videoId: string | null, ctx: ContentScriptContext): Promise<void> {
  cleanup();

  if (!videoId) {
    if (toolbarUi) toolbarUi.shadowHost.style.setProperty('display', 'none', 'important');
    removeToolbarSpacing();
    return;
  }

  state.videoId = videoId;
  state.userSettings = await loadUserSettings();

  const onDone = () => injectOverlayAndStart(ctx);
  await ensureToolbar(
    ctx,
    () => state.videoId && submitWithLLM(state, state.videoId, setPhase, onDone),
    () => state.videoId && submitForProcessing(state, state.videoId, setPhase, onDone),
  );

  checkAndLoadVideo(state, videoId, setPhase, onDone);
}

function getVideoId(): string | null {
  return new URLSearchParams(window.location.search).get('v');
}

// ── Entry point ───────────────────────────────────────────────────────────────

export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',

  main(ctx) {
    document.addEventListener('yt-navigate-finish', () => {
      const id = getVideoId();
      if (id !== state.videoId) onVideoChange(id, ctx);
    });
    const id = getVideoId();
    if (id) onVideoChange(id, ctx);
  },
});
