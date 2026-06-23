import '../../assets/content.css';
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
  syncWatchTime,
} from './lib/api';
import Toolbar from './ui/Toolbar.vue';
import CardOverlay from './ui/CardOverlay.vue';

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 300;
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
  watchAccumulatorSec: 0,
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
  tickWatchTime(video);

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

function tickWatchTime(video: HTMLVideoElement): void {
  if (state.phase === PHASE.DONE && !video.paused) {
    state.watchAccumulatorSec += POLL_INTERVAL_MS / 1000;
  }
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
    // WXT resets :host with all:initial !important — override it here (same layer, later = wins).
    // Position is controlled via --ti-top custom property so JS can update it without fighting
    // !important across the shadow boundary (custom properties pierce shadow DOM cleanly).
    css: `
      :host {
        display: block !important;
        position: fixed !important;
        top: var(--ti-top, 56px) !important;
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
  applyFullscreenLayout();
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
        top: var(--ti-ov-top, 12px) !important;
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

  // Watch for YouTube's own fullscreen class on #movie_player
  fullscreenObserver?.disconnect();
  fullscreenObserver = new MutationObserver(applyFullscreenLayout);
  fullscreenObserver.observe(player, { attributes: true, attributeFilter: ['class'] });

  applyFullscreenLayout();
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

// ── Fullscreen handling ───────────────────────────────────────────────────────
//
// CSS custom properties set on the shadow host propagate into the shadow root
// via var(), avoiding the !important cascade conflict between inner shadow
// styles and outer document styles.

let fullscreenObserver: MutationObserver | null = null;

function isFullscreen(): boolean {
  // YouTube sets .ytp-fullscreen on #movie_player — more reliable than
  // document.fullscreenElement which can be null in some browser/version combos.
  return !!document.fullscreenElement ||
    !!document.querySelector('#movie_player.ytp-fullscreen');
}

function applyFullscreenLayout(): void {
  const fs = isFullscreen();
  if (toolbarUi) {
    toolbarUi.shadowHost.style.setProperty('--ti-top', fs ? '0px' : '56px');
  }
  if (overlayUi) {
    overlayUi.shadowHost.style.setProperty('--ti-ov-top', fs ? `${TOOLBAR_HEIGHT + 8}px` : '12px');
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────

async function cleanup(): Promise<void> {
  // Flush accumulated watch time before resetting state
  if (state.videoId && state.watchAccumulatorSec > 0) {
    const videoId = state.videoId;
    const seconds = Math.round(state.watchAccumulatorSec);
    const today = new Date().toISOString().slice(0, 10);
    try {
      const result = await browser.storage.local.get('pendingWatchTime');
      const stored = (result['pendingWatchTime'] as Record<string, Record<string, number>>) ?? {};
      stored[today] ??= {};
      stored[today][videoId] = (stored[today][videoId] ?? 0) + seconds;
      await browser.storage.local.set({ pendingWatchTime: stored });
    } catch { /* storage unavailable — drop the data rather than block cleanup */ }
  }

  fullscreenObserver?.disconnect();
  fullscreenObserver = null;
  stopPolling(state);
  if (state.intervalId) { clearInterval(state.intervalId); state.intervalId = null; }
  for (const card of state.cards) clearTimeout(card.timerId);
  if (overlayUi) { overlayUi.remove(); overlayUi = null; }
  state.overlay = null;
  state.cards = [];
  state.activeVocabKeys = new Set();
  state.segments = [];
  state.watchAccumulatorSec = 0;
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
  await cleanup();

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
    () => {
      if (!state.videoId) return;
      const title = document.title.replace(/ - YouTube$/, '').trim() || undefined;
      submitForProcessing(state, state.videoId, setPhase, onDone, title);
    },
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

  async main(ctx) {
    const initialSettings = await loadUserSettings();
    if (initialSettings.accountToken) {
      syncWatchTime(initialSettings.accountToken).catch(() => {});
    }

    document.addEventListener('fullscreenchange', applyFullscreenLayout);
    document.addEventListener('yt-navigate-finish', () => {
      const id = getVideoId();
      if (id !== state.videoId) onVideoChange(id, ctx);
    });
    const id = getVideoId();
    if (id) onVideoChange(id, ctx);
  },
});
