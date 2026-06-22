import type { RawCue, MetaSegment } from './types';

const MIN_META_SEGMENT_WORDS = 8;
const IDEAL_META_SEGMENT_MIN_WORDS = 12;
const IDEAL_META_SEGMENT_MAX_WORDS = 25;
const MAX_META_SEGMENT_WORDS = 50;

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

export function buildMetaSegments(cues: RawCue[]): MetaSegment[] {
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
