// The daily record of the live feeds, drawn in the recent span between an archive's last year and Now
// (plans/digital-twin/2-accumulated-state.md). Month files are fetched only when the timeline first enters that span.
// Rules: a provisional day never joins the official record (the span starts after the archive ends, so a year the
// archive publishes drops out of view by itself); a missed day is a gap, never a zero; hotspots are not fires.
import { AirHistory, FiresHistory, HistoryFeed, HistoryIndex, RiversHistory, WaterHistory, loadHistory, loadHistoryIndex } from './data';

const SK = 6 * 36e5;
const YEAR_MS = 365.25 * 864e5;
/** Timeline time of the start of a Saskatchewan day ('YYYY-MM-DD'), on the calendar `NOW_T` and `isoDate` use. */
export function dayT(day: string) {
  const ms = Date.parse(`${day}T06:00:00Z`);
  const y = new Date(ms).getUTCFullYear();
  return y + (ms - Date.UTC(y, 0, 1)) / YEAR_MS;
}
/** The Saskatchewan day a timeline time falls in. */
export function tDay(t: number) {
  const y = Math.floor(t);
  // +1 s: a day's own start time (dayT) can come back a millisecond short of midnight in floating point
  return new Date(Date.UTC(y, 0, 1) + (t - y) * YEAR_MS - SK + 1000).toISOString().slice(0, 10);
}
export const DAY_T = 1 / 365.25;
export const dayText = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

type FeedFiles = { index: NonNullable<HistoryIndex['feeds'][HistoryFeed]>; files: unknown[] };
const loading = new Map<HistoryFeed, Promise<FeedFiles | null>>();
const loaded = new Map<HistoryFeed, FeedFiles | null>();
const listeners = new Set<() => void>();
/** Called whenever a feed finishes loading (main redraws the sparkline). */
export const onHistory = (fn: () => void) => listeners.add(fn);

/** Loads a feed's month files from `fromT`'s month on, once. Resolves to null when this copy has no such history. */
export function ensureFeed(feed: HistoryFeed, fromT: number): Promise<FeedFiles | null> {
  if (!loading.has(feed)) {
    loading.set(feed, (async () => {
      const ix = (await loadHistoryIndex())?.feeds[feed];
      if (!ix) return null;
      const from = tDay(fromT).slice(0, 7);
      const files = (await Promise.all(ix.months.filter((m) => m >= from).map((m) => loadHistory(feed, m)))).filter(Boolean);
      return { index: ix, files };
    })().then((r) => { loaded.set(feed, r); listeners.forEach((fn) => fn()); return r; }));
  }
  return loading.get(feed)!;
}
const files = <T>(feed: HistoryFeed) => (loaded.get(feed)?.files ?? null) as T[] | null;
export const feedIndex = (feed: HistoryFeed) => loaded.get(feed)?.index ?? null;
const day = (month: string, dd: number | string) => `${month}-${String(dd).padStart(2, '0')}`;
/** The Saskatchewan hours a run was counted on each day (fires, alerts, water); backfilled days count as fully covered. */
function runDays(fs: { month: string; runs: Record<string, number[]>; backfilled: string[] }[]) {
  const out = new Map<string, number>();
  for (const f of fs) {
    for (const [dd, hs] of Object.entries(f.runs)) out.set(day(f.month, dd), hs.length);
    for (const dd of f.backfilled) out.set(day(f.month, dd), 24);
  }
  return out;
}

// ---- per-feed views, built once after their files load

export type RiverDay = { id: string; min: number; max: number; mean: number; n: number; flag: string | null };
let riversView: { days: Map<string, RiverDay[]>; sorted: string[] } | null = null;
export function riversHistory() {
  if (riversView) return riversView;
  const fs = files<RiversHistory>('rivers');
  if (!fs) return null;
  const days = new Map<string, RiverDay[]>();
  for (const f of fs) for (const [id, rows] of Object.entries(f.stations))
    for (const [dd, min, max, mean, n, flag] of rows) {
      const k = day(f.month, dd);
      (days.get(k) ?? days.set(k, []).get(k)!).push({ id, min, max, mean, n, flag });
    }
  riversView = { days, sorted: [...days.keys()].sort() };
  return riversView;
}

export type AirDay = { id: string; name: string; lon: number; lat: number; out?: true; max: number; hours: number };
let airView: { days: Map<string, AirDay[]>; sorted: string[] } | null = null;
export function airHistory() {
  if (airView) return airView;
  const fs = files<AirHistory>('air');
  if (!fs) return null;
  const days = new Map<string, AirDay[]>();
  for (const f of fs) for (const [id, rows] of Object.entries(f.days)) {
    const c = f.communities[id];
    if (!c) continue;
    for (const [dd, max, hours] of rows) { const k = day(f.month, dd); (days.get(k) ?? days.set(k, []).get(k)!).push({ id, ...c, max, hours }); }
  }
  airView = { days, sorted: [...days.keys()].sort() };
  return airView;
}

/** lon, lat, time (timeline), fire radiative power */
export type HistHotspot = [number, number, number, number | null];
let firesView: { points: HistHotspot[]; perDay: Map<string, number>; covered: Map<string, number>; sorted: string[] } | null = null;
export function firesHistory() {
  if (firesView) return firesView;
  const fs = files<FiresHistory>('fires');
  if (!fs) return null;
  const points: HistHotspot[] = [];
  const perDay = new Map<string, number>();
  for (const f of fs) for (const [dd, rows] of Object.entries(f.days)) {
    const k = day(f.month, dd), t0 = dayT(k);
    perDay.set(k, rows.length);
    for (const [lon, lat, frp, min] of rows) points.push([lon, lat, t0 + (min / 1440) * DAY_T, frp]);
  }
  points.sort((a, b) => a[2] - b[2]);
  const covered = runDays(fs);
  firesView = { points, perDay, covered, sorted: [...covered.keys()].sort() };
  return firesView;
}

export type WaterRow = WaterHistory['advisories'][number];
let waterView: { rows: WaterRow[]; covered: Map<string, number>; sorted: string[] } | null = null;
export function waterHistory() {
  if (waterView) return waterView;
  const fs = files<WaterHistory>('water');
  if (!fs) return null;
  // an advisory seen in several months has a row in each: join them by key
  const byKey = new Map<string, WaterRow>();
  for (const f of fs) for (const a of f.advisories) {
    const prev = byKey.get(a.key);
    if (!prev) byKey.set(a.key, { ...a });
    else { if (a.first < prev.first) prev.first = a.first; if (a.last > prev.last) prev.last = a.last; }
  }
  const covered = runDays(fs);
  waterView = { rows: [...byKey.values()], covered, sorted: [...covered.keys()].sort() };
  return waterView;
}
