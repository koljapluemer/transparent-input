const API_BASE = 'http://localhost:8000/api';
const POLL_INTERVAL_MS = 300;
const CARD_DISPLAY_MS = 4000;
const MAX_VISIBLE_CARDS = 3;
const MIN_CARD_INTERVAL_S = 1;
const MAX_CARD_INTERVAL_S = 3;
const PROCESSING_POLL_MS = 5000;
const PROCESSING_POLL_MAX = 120; // 10 minutes — guard against a stuck backend job
const TOOLBAR_HEIGHT = 40; // px — must match height in ensureToolbar CSS

// All possible toolbar states. renderToolbar() is driven exclusively by state.phase.
const PHASE = {
  NO_VIDEO:   'no-video',   // not on a watch page — toolbar hidden
  CHECKING:   'checking',   // GETting /api/videos/:id/ to check backend state
  LOADING:    'loading',    // fetching caption tracks + supported languages
  READY:      'ready',      // language selector shown, waiting for user to click Translate
  SUBMITTING: 'submitting', // fetching subtitles + POSTing to backend
  POLLING:    'polling',    // waiting for Celery job to finish
  DONE:       'done',       // segments loaded, vocab overlay active
  ERROR:      'error',      // terminal failure, Retry available
};

let state = {
  videoId: null,
  phase: PHASE.NO_VIDEO,
  phaseData: {},            // phase-specific payload: {message?, error?, count?}
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
  availableLangs: [],       // [{languageCode, trackName, iso3, baseUrl}]
  selectedLang: null,
};

// ── Phase management ──────────────────────────────────────────────────────────

// Every async callback must call setPhase instead of mutating state directly.
// The videoId guard ensures that callbacks which outlived their video are silently
// dropped — this is the core fix for the "processing → language-selector" revert bug.
function setPhase(videoId, phase, data = {}) {
  if (videoId !== state.videoId) return;
  state.phase = phase;
  state.phaseData = data;
  renderToolbar();
}

// ── Timestamp / formatting ────────────────────────────────────────────────────

function parseTimestamp(ts) {
  const [timePart, msPart] = ts.split('.');
  const [h, m, s] = timePart.split(':').map(Number);
  const ms = msPart ? Number(msPart.padEnd(3, '0').slice(0, 3)) : 0;
  return h * 3600 + m * 60 + s + ms / 1000;
}

function randInterval() {
  return (MIN_CARD_INTERVAL_S + Math.random() * (MAX_CARD_INTERVAL_S - MIN_CARD_INTERVAL_S)) * 1000;
}

// ── Processing poll ───────────────────────────────────────────────────────────

function stopPolling() {
  if (state.pollTimerId) {
    clearTimeout(state.pollTimerId);
    state.pollTimerId = null;
  }
  state.pollAttempts = 0;
}

function startPolling(videoId) {
  stopPolling();

  async function poll() {
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
        // Transient backend error — keep polling rather than silently dying.
        state.pollTimerId = setTimeout(poll, PROCESSING_POLL_MS);
        return;
      }

      const data = await resp.json();

      if (data.segments && data.segments.length > 0) {
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

function parseJson3(json3) {
  const cues = [];
  for (const event of json3.events ?? []) {
    if (!event.segs) continue;
    const text = event.segs.map(s => s.utf8 ?? '').join('').trim();
    if (!text) continue;
    const start = (event.tStartMs ?? 0) / 1000;
    const end = start + (event.dDurationMs ?? 0) / 1000;
    cues.push({ start, end, text });
  }
  return cues;
}

async function fetchSupportedLanguages() {
  const resp = await fetch(`${API_BASE}/languages/`);
  if (!resp.ok) return [];
  return resp.json();
}

// Use YouTube's Innertube API with an ANDROID client context.
// ANDROID client responses return caption URLs that don't require the PoToken
// that the web player adds to timedtext requests.
async function getCaptionTracks(videoId) {
  const resp = await fetch(
    'https://www.youtube.com/youtubei/v1/player',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
            androidSdkVersion: 30,
            hl: 'en',
          },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    },
  );
  if (!resp.ok) return [];
  const data = await resp.json();
  return data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
}

// ── Language loading ──────────────────────────────────────────────────────────

async function loadAvailableLanguages(videoId) {
  setPhase(videoId, PHASE.LOADING);
  try {
    const [tracks, supportedLangs] = await Promise.all([
      getCaptionTracks(videoId),
      fetchSupportedLanguages(),
    ]);

    // Guard: another navigation may have happened while we were fetching.
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
        baseUrl: t.baseUrl,
      }));

    if (state.availableLangs.length > 0) {
      state.selectedLang = state.availableLangs[0].languageCode;
    }

    setPhase(videoId, PHASE.READY);
  } catch {
    setPhase(videoId, PHASE.ERROR, { error: 'Failed to load subtitle tracks' });
  }
}

// ── Submit for processing ─────────────────────────────────────────────────────

async function submitForProcessing() {
  const videoId = state.videoId;
  const lang = state.availableLangs.find(l => l.languageCode === state.selectedLang);
  if (!lang || !videoId) return;

  setPhase(videoId, PHASE.SUBMITTING, { message: 'Fetching subtitles…' });

  try {
    const subtitleUrl = lang.baseUrl.replace(/[&?]fmt=[^&]*/g, '') + '&fmt=json3';
    const subtitleResp = await fetch(subtitleUrl);
    if (!subtitleResp.ok) throw new Error('subtitle fetch failed');

    let json3;
    try {
      json3 = JSON.parse(await subtitleResp.text());
    } catch {
      throw new Error('subtitle parse failed');
    }

    const transcript = parseJson3(json3);
    if (transcript.length === 0) throw new Error('empty transcript');

    setPhase(videoId, PHASE.SUBMITTING, { message: 'Submitting to backend…' });

    const submitResp = await fetch(`${API_BASE}/videos/${videoId}/submit/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language_iso3: lang.iso3, transcript }),
    });

    if (submitResp.ok || submitResp.status === 202) {
      startPolling(videoId);
    } else {
      setPhase(videoId, PHASE.ERROR, { error: `Submit failed (HTTP ${submitResp.status})` });
    }
  } catch (e) {
    setPhase(videoId, PHASE.ERROR, { error: e.message || 'Submit failed' });
  }
}

// ── Segment loading ───────────────────────────────────────────────────────────

function loadSegments(data, videoId) {
  if (state.videoId !== videoId) return;

  state.segments = data.segments
    .map(seg => ({
      startSeconds: parseTimestamp(seg.startTimestamp),
      endSeconds: parseTimestamp(seg.endTimestamp),
      vocab: Object.entries(seg.vocab || {}),
    }))
    .filter(seg => seg.endSeconds > seg.startSeconds && seg.vocab.length > 0);

  if (state.segments.length > 0) {
    setPhase(videoId, PHASE.DONE, { count: state.segments.length });
    injectOverlay();
    state.intervalId = setInterval(tick, POLL_INTERVAL_MS);
  } else {
    // Segments field was present but empty after filtering — offer retry.
    loadAvailableLanguages(videoId);
  }
}

// ── Core video change handler ─────────────────────────────────────────────────

async function onVideoChange(videoId) {
  cleanup();

  if (!videoId) {
    if (state.toolbar) state.toolbar.style.display = 'none';
    removeToolbarSpacing();
    return;
  }

  state.videoId = videoId;
  ensureToolbar();
  setPhase(videoId, PHASE.CHECKING);

  try {
    const resp = await fetch(`${API_BASE}/videos/${videoId}/`);

    if (resp.status === 404) {
      loadAvailableLanguages(videoId);
      return;
    }

    if (!resp.ok) {
      loadAvailableLanguages(videoId);
      return;
    }

    const data = await resp.json();

    if (data.segments && data.segments.length > 0) {
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

function applyToolbarSpacing() {
  if (document.getElementById('ti-spacing')) return;
  const style = document.createElement('style');
  style.id = 'ti-spacing';
  // Stack our height on top of YouTube's own masthead height variable.
  style.textContent =
    '#page-manager{margin-top:calc(var(--ytd-masthead-height,56px) + ' + TOOLBAR_HEIGHT + 'px)!important}';
  document.head.appendChild(style);
}

function removeToolbarSpacing() {
  document.getElementById('ti-spacing')?.remove();
}

function ensureToolbar() {
  applyToolbarSpacing();

  if (state.toolbar) {
    state.toolbar.style.display = 'flex';
    renderToolbar();
    return;
  }

  const bar = document.createElement('div');
  bar.id = 'ti-toolbar';
  bar.style.cssText = [
    'position:fixed',
    'top:56px',
    'left:0',
    'right:0',
    'z-index:9998',
    'background:#0f0f0f',
    'border-bottom:1px solid #272727',
    'color:#fff',
    'font-family:Roboto,Arial,sans-serif',
    'font-size:13px',
    'display:flex',
    'align-items:center',
    'gap:10px',
    'padding:5px 16px',
    'box-sizing:border-box',
    'height:' + TOOLBAR_HEIGHT + 'px',
  ].join(';');

  document.body.appendChild(bar);
  state.toolbar = bar;
  renderToolbar();
}

// Renders toolbar chrome based solely on state.phase + state.phaseData.
// No other state fields should affect the toolbar layout.
function renderToolbar() {
  const bar = state.toolbar;
  if (!bar) return;
  bar.innerHTML = '';

  const label = document.createElement('span');
  label.style.cssText = 'font-weight:600;color:#909090;white-space:nowrap;margin-right:4px;';
  label.textContent = 'Transparent Input';
  bar.appendChild(label);

  const sep = document.createElement('span');
  sep.style.cssText = 'color:#3f3f3f;';
  sep.textContent = '|';
  bar.appendChild(sep);

  const { phase, phaseData } = state;

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
        select.style.cssText = [
          'background:#272727',
          'color:#fff',
          'border:1px solid #3f3f3f',
          'border-radius:4px',
          'padding:2px 6px',
          'font-size:13px',
          'cursor:pointer',
          'outline:none',
        ].join(';');
        for (const lang of state.availableLangs) {
          const opt = document.createElement('option');
          opt.value = lang.languageCode;
          opt.textContent = lang.trackName;
          if (lang.languageCode === state.selectedLang) opt.selected = true;
          select.appendChild(opt);
        }
        select.addEventListener('change', () => { state.selectedLang = select.value; });
        bar.appendChild(select);

        const btn = document.createElement('button');
        btn.style.cssText = [
          'background:#065fd4',
          'color:#fff',
          'border:none',
          'border-radius:4px',
          'padding:4px 14px',
          'font-size:13px',
          'cursor:pointer',
          'white-space:nowrap',
          'font-family:inherit',
        ].join(';');
        btn.textContent = 'Translate';
        btn.addEventListener('click', submitForProcessing);
        bar.appendChild(btn);
      }
      break;

    case PHASE.SUBMITTING:
      bar.appendChild(muted(phaseData.message || 'Submitting…'));
      break;

    case PHASE.POLLING: {
      const dot = document.createElement('span');
      dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:#f90;flex-shrink:0;';
      bar.appendChild(dot);
      bar.appendChild(colored('#f90', `Processing… (${phaseData.count}/${phaseData.max})`));
      break;
    }

    case PHASE.DONE: {
      const dot = document.createElement('span');
      dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:#2ba640;flex-shrink:0;';
      bar.appendChild(dot);
      bar.appendChild(colored('#2ba640', 'Ready'));
      bar.appendChild(muted(`${phaseData.count} segments`));
      break;
    }

    case PHASE.ERROR: {
      bar.appendChild(colored('#f44336', phaseData.error || 'Error'));
      const retry = document.createElement('button');
      retry.style.cssText = [
        'background:#272727',
        'color:#fff',
        'border:1px solid #3f3f3f',
        'border-radius:4px',
        'padding:2px 10px',
        'font-size:12px',
        'cursor:pointer',
        'font-family:inherit',
      ].join(';');
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => loadAvailableLanguages(state.videoId));
      bar.appendChild(retry);
      break;
    }
  }
}

function muted(text) {
  const el = document.createElement('span');
  el.style.color = '#909090';
  el.textContent = text;
  return el;
}

function colored(color, text) {
  const el = document.createElement('span');
  el.style.color = color;
  el.textContent = text;
  return el;
}

// ── Overlay (vocab cards over video) ─────────────────────────────────────────

function cleanup() {
  stopPolling();

  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  for (const card of state.cards) {
    clearTimeout(card.timerId);
  }
  if (state.overlay && state.overlay.parentNode) {
    state.overlay.parentNode.removeChild(state.overlay);
  }
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
}

function injectOverlay(attempt = 0) {
  const player = document.querySelector('#movie_player');
  if (!player) {
    if (attempt < 20) setTimeout(() => injectOverlay(attempt + 1), 250);
    return;
  }

  if (window.getComputedStyle(player).position === 'static') {
    player.style.position = 'relative';
  }

  const overlay = document.createElement('div');
  overlay.id = 'ti-vocab-overlay';
  overlay.style.cssText =
    'position:absolute;top:12px;left:12px;z-index:9999;' +
    'display:flex;flex-direction:column;gap:6px;pointer-events:none;max-width:320px;';

  player.appendChild(overlay);
  state.overlay = overlay;
}

function tick() {
  const video = document.querySelector('video');
  if (!video || !state.overlay) return;

  const current = video.currentTime;
  const now = performance.now();

  const segIndex = state.segments.findIndex(
    seg => current >= seg.startSeconds && current < seg.endSeconds,
  );

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
    const oldest = state.cards.shift();
    clearTimeout(oldest.timerId);
    state.activeVocabKeys.delete(oldest.word);
    if (oldest.element.parentNode) oldest.element.parentNode.removeChild(oldest.element);
  }

  addCard(word, translation);
  state.nextCardAt = now + randInterval();
}

function addCard(word, translation) {
  const id = ++state.cardCounter;

  const el = document.createElement('div');
  el.style.cssText =
    'background:rgba(0,0,0,0.87);color:#fff;padding:6px 12px;border-radius:20px;' +
    'font-size:14px;font-family:system-ui,sans-serif;line-height:1.4;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.4);backdrop-filter:blur(4px);' +
    '-webkit-backdrop-filter:blur(4px);cursor:pointer;pointer-events:auto;' +
    'user-select:none;white-space:nowrap;';
  el.textContent = `${word} = ${translation}`;
  el.addEventListener('click', () => dismissCard(id));

  const timerId = setTimeout(() => dismissCard(id), CARD_DISPLAY_MS);
  state.cards.push({ id, word, element: el, timerId });
  state.activeVocabKeys.add(word);
  state.overlay.appendChild(el);
}

function dismissCard(id) {
  const idx = state.cards.findIndex(c => c.id === id);
  if (idx === -1) return;

  const card = state.cards[idx];
  clearTimeout(card.timerId);
  state.activeVocabKeys.delete(card.word);
  state.cards.splice(idx, 1);
  if (card.element.parentNode) card.element.parentNode.removeChild(card.element);
}

// ── Navigation ────────────────────────────────────────────────────────────────

function getVideoId() {
  return new URLSearchParams(window.location.search).get('v');
}

document.addEventListener('yt-navigate-finish', () => {
  const id = getVideoId();
  if (id !== state.videoId) onVideoChange(id);
});

(function init() {
  const id = getVideoId();
  if (id) onVideoChange(id);
})();
