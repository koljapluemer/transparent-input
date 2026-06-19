const API_BASE = 'http://localhost:8000/api';
const POLL_INTERVAL_MS = 300;
const CARD_DISPLAY_MS = 4000;
const MAX_VISIBLE_CARDS = 3;
const MIN_CARD_INTERVAL_S = 1;
const MAX_CARD_INTERVAL_S = 3;
const PROCESSING_POLL_MS = 5000;
const PROCESSING_POLL_MAX = 40; // 2 minutes

let state = {
  videoId: null,
  segments: [],
  overlay: null,
  intervalId: null,
  cards: [],
  cardCounter: 0,
  currentSegmentIndex: -1,
  nextCardAt: null,
  activeVocabKeys: new Set(),
  pollTimerId: null,
  pollAttempts: 0,
};

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
      return;
    }
    state.pollAttempts++;

    try {
      const resp = await fetch(`${API_BASE}/videos/${videoId}/`);
      if (!resp.ok) return;
      const data = await resp.json();

      if (data.segments && data.segments.length > 0) {
        stopPolling();
        onVideoChange(videoId);
        return;
      }
    } catch {
      // backend unreachable, keep polling
    }

    state.pollTimerId = setTimeout(poll, PROCESSING_POLL_MS);
  }

  state.pollTimerId = setTimeout(poll, PROCESSING_POLL_MS);
}

// ── Subtitle extraction from YouTube page ─────────────────────────────────────

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

async function submitForProcessing(videoId) {
  try {
    const tracks = await getCaptionTracks(videoId);
    console.log('[ti] caption tracks found:', tracks.map(t => t.languageCode));

    if (tracks.length === 0) {
      console.log('[ti] no caption tracks available, skipping');
      return;
    }

    const supportedLangs = await fetchSupportedLanguages();
    const subtitleLangToIso3 = Object.fromEntries(
      supportedLangs.map(l => [l.subtitle_language, l.iso3])
    );

    const match = tracks.find(t => subtitleLangToIso3[t.languageCode]);
    if (!match) {
      console.log('[ti] no supported language match found');
      return;
    }
    console.log('[ti] matched track:', match.languageCode, '->', subtitleLangToIso3[match.languageCode]);

    const iso3 = subtitleLangToIso3[match.languageCode];
    const subtitleUrl = match.baseUrl.replace(/[&?]fmt=[^&]*/g, '') + '&fmt=json3';
    const subtitleResp = await fetch(subtitleUrl);
    if (!subtitleResp.ok) return;

    const subtitleText = await subtitleResp.text();
    let json3;
    try {
      json3 = JSON.parse(subtitleText);
    } catch {
      console.error('[ti] subtitle JSON parse failed');
      return;
    }
    const transcript = parseJson3(json3);
    if (transcript.length === 0) return;

    const submitResp = await fetch(`${API_BASE}/videos/${videoId}/submit/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language_iso3: iso3, transcript }),
    });

    if (submitResp.ok || submitResp.status === 202) {
      startPolling(videoId);
    }
  } catch (e) {
    console.error('[ti] submitForProcessing error:', e);
  }
}

// ── Core video change handler ─────────────────────────────────────────────────

async function onVideoChange(videoId) {
  cleanup();
  if (!videoId) return;

  state.videoId = videoId;

  let data;
  try {
    const resp = await fetch(`${API_BASE}/videos/${videoId}/`);

    if (resp.status === 404) {
      submitForProcessing(videoId);
      return;
    }

    if (!resp.ok) return;
    data = await resp.json();
  } catch {
    return;
  }

  if (!data.segments || data.segments.length === 0) {
    if (data.processing) startPolling(videoId);
    return;
  }

  state.segments = data.segments
    .map(seg => ({
      startSeconds: parseTimestamp(seg.startTimestamp),
      endSeconds: parseTimestamp(seg.endTimestamp),
      vocab: Object.entries(seg.vocab || {}),
    }))
    .filter(seg => seg.endSeconds > seg.startSeconds && seg.vocab.length > 0);

  if (state.segments.length === 0) return;

  injectOverlay();
  state.intervalId = setInterval(tick, POLL_INTERVAL_MS);
}

// ── Overlay ───────────────────────────────────────────────────────────────────

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
  state.currentSegmentIndex = -1;
  state.nextCardAt = null;
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
