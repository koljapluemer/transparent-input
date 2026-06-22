export function parseTimestamp(ts: string): number {
  const [timePart, msPart] = ts.split('.');
  const [h, m, s] = timePart.split(':').map(Number);
  const ms = msPart ? Number(msPart.padEnd(3, '0').slice(0, 3)) : 0;
  return h * 3600 + m * 60 + s + ms / 1000;
}

export function fmtTimestamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const msRem = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(msRem).padStart(3, '0')}`;
}

export function nativeLangDisplayName(code: string): string {
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'language' });
    return dn.of(code) ?? code;
  } catch {
    return code;
  }
}

export function randInterval(minS: number, maxS: number): number {
  return (minS + Math.random() * (maxS - minS)) * 1000;
}
