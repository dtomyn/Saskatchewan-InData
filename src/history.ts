// The daily record of the live feeds, drawn in the recent span between an archive's last year and Now
// (plans/digital-twin/2-accumulated-state.md). Month files are fetched only when the timeline first enters that span.
// Rules: a provisional day never joins the official record (the span starts after the archive ends, so a year the
// archive publishes drops out of view by itself); a missed day is a gap, never a zero; hotspots are not fires.
import { AirHistory, FiresHistory, HistoryFeed, HistoryIndex, RiversHistory, WaterHistory, loadHistory, loadHistoryIndex } from './data';

const SK = 6 * 36e5;
/** Milliseconds in UTC year `y` (366 days in a leap year): the calendar the pipeline's `fracYear` writes. */
const yearMs = (y: number) => Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1);
/** Timeline time of an instant, on the calendar `NOW_T`, `isoDate` and the pipeline's `fracYear` use. */
export function msT(ms: number) {
  const y = new Date(ms).getUTCFullYear();
  return y + (ms - Date.UTC(y, 0, 1)) / yearMs(y);
}
/** Timeline time of the start of a Saskatchewan day ('YYYY-MM-DD'). */
export const dayT = (day: string) => msT(Date.parse(`${day}T06:00:00Z`));
/** The Saskatchewan day a timeline time falls in. */
export function tDay(t: number) {
  const y = Math.floor(t);
  // +1 s: a day's own start time (dayT) can come back a millisecond short of midnight in floating point
  return new Date(Date.UTC(y, 0, 1) + (t - y) * yearMs(y) - SK + 1000).toISOString().slice(0, 10);
}
/** The day `n` days after (or before) a 'YYYY-MM-DD' day. */
export const shiftDay = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** About a day on the timeline (a day is 1/365 or 1/366 of its year): for widths and paces, not for finding a day. */
export const DAY_T = 1 / 365.25;
export const dayText = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

type FeedFiles = { index: NonNullable<HistoryIndex['feeds'][HistoryFeed]>; files: unknown[] };
const loading = new Map<HistoryFeed, Promise<FeedFiles | null>>();
const loaded = new Map<HistoryFeed, FeedFiles | null>();
const listeners = new Set<() => void>();
/** Called whenever a feed finishes loading (main redraws the sparkline). */
export const onHistory = (fn: () => void) => listeners.add(fn);

/** How long before a feed with a month that failed to load is asked for again. */
const RETRY_MS = 30000;
/** Loads a feed's month files from `fromT`'s month on, once. Resolves to null when this copy has no such history.
 *  When a month fails to load, the feed is asked for again after RETRY_MS (months already read are kept by data.ts). */
export function ensureFeed(feed: HistoryFeed, fromT: number): Promise<FeedFiles | null> {
  if (!loading.has(feed)) {
    let whole = true;
    loading.set(feed, (async () => {
      const ix = (await loadHistoryIndex())?.feeds[feed];
      // no index (none here, or it failed): ask again later; a 404 stays cached in data.ts, so that costs no request
      if (!ix) { whole = false; return null; }
      const from = tDay(fromT).slice(0, 7);
      const months = ix.months.filter((m) => m >= from);
      const files = (await Promise.all(months.map((m) => loadHistory(feed, m)))).filter(Boolean);
      whole = files.length === months.length;
      return { index: ix, files };
    })().then((r) => {
      loaded.set(feed, r);
      resetViews();
      if (!whole) setTimeout(() => loading.delete(feed), RETRY_MS);
      listeners.forEach((fn) => fn());
      return r;
    }));
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

// ---- per-feed views, built once after their files load (and again when a feed loads more)
function resetViews() { riversView = null; airView = null; firesView = null; waterView = null; }

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
    const k = day(f.month, dd), m0 = Date.parse(`${k}T06:00:00Z`);
    perDay.set(k, rows.length);
    for (const [lon, lat, frp, min] of rows) points.push([lon, lat, msT(m0 + min * 6e4), frp]);
  }
  points.sort((a, b) => a[2] - b[2]);
  const covered = runDays(fs);
  firesView = { points, perDay, covered, sorted: [...covered.keys()].sort() };
  return firesView;
}

/**
 * One fire season of the daily record, for the Wildfires replay (plans/wow/3): 1 April to 31 October, or to the last
 * day on record while the season is still running. Loaded on its own, apart from the recent span, so a season can be
 * replayed after the archive has published its year; it is still hotspots (heat, not fires) and still provisional.
 * `days` lists every calendar day: `n` is null on a day no run covered (a gap, never a zero).
 */
export type FireSeason = { year: number; a: number; b: number; points: HistHotspot[]; days: { day: string; t: number; n: number | null }[]; total: number; covered: number };
const SEASON = ['04', '10'];
const seasonMemo = new Map<number, FireSeason>();
/** The years with a fire season month on record. `force` reads the record for the film too. */
export async function fireSeasonYears(force = false): Promise<number[]> {
  const ix = (await loadHistoryIndex(force))?.feeds.fires;
  return [...new Set((ix?.months ?? []).filter((m) => m.slice(5) >= SEASON[0] && m.slice(5) <= SEASON[1]).map((m) => +m.slice(0, 4)))].sort();
}
export async function fireSeason(year: number, force = false): Promise<FireSeason | null> {
  if (seasonMemo.has(year)) return seasonMemo.get(year)!;
  const ix = (await loadHistoryIndex(force))?.feeds.fires;
  const months = (ix?.months ?? []).filter((m) => m >= `${year}-${SEASON[0]}` && m <= `${year}-${SEASON[1]}`);
  const fs = (await Promise.all(months.map((m) => loadHistory<FiresHistory>('fires', m, force)))).filter(Boolean) as FiresHistory[];
  const ran = runDays(fs);
  const points: HistHotspot[] = [];
  const perDay = new Map<string, number>();
  for (const f of fs) for (const [dd, rows] of Object.entries(f.days)) {
    const k = day(f.month, dd), m0 = Date.parse(`${k}T06:00:00Z`);
    if (!ran.has(k)) continue;
    perDay.set(k, rows.length);
    for (const [lon, lat, frp, min] of rows) points.push([lon, lat, msT(m0 + min * 6e4), frp]);
  }
  const last = [...ran.keys()].sort().at(-1);
  if (!last) return null;
  points.sort((a, b) => a[2] - b[2]);
  const days: FireSeason['days'] = [];
  for (let ms = Date.parse(`${year}-${SEASON[0]}-01T12:00:00Z`); ; ms += 864e5) {
    const k = new Date(ms).toISOString().slice(0, 10);
    if (k > last) break;
    days.push({ day: k, t: dayT(k), n: ran.has(k) ? perDay.get(k) ?? 0 : null });
  }
  const s: FireSeason = { year, a: days[0].t, b: dayT(shiftDay(days.at(-1)!.day, 1)), points, days, total: points.length, covered: days.filter((d) => d.n != null).length };
  // a month that failed to load is asked for again next time, not remembered as missing
  if (fs.length === months.length) seasonMemo.set(year, s);
  return s;
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
