// Hail: the Northern Hail Project's (Western University) radar hail swaths over Saskatchewan for 2022–2024, and the
// hailstorms its research database records, most investigated on the ground. Each storm flares as a burst of ice when
// the timeline reaches it, then stays as a dot sized and coloured by its largest hail, with the swath's centre line
// behind it. Swath sizes are the radar's MESH (Maximum Expected Size of Hail), an estimate, not a measured stone.
// The Under the storm chip lays each swath's corridor over that year's Annual Crop Inventory, and the `hailcrop` stage
// (hail-exposure.json, loaded when the layer is first drawn) counts what grew under it: exposure, never damage.
import * as d3 from 'd3';
import { BitmapLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { HailRow, fmt, lowerBound, MONTHS } from './data';
import { barChart } from './charts';
import { esc, safeUrl } from './html';
import { ADDITIVE, AtlasEvent, AtlasLayer, NO_DEPTH, RGBA, TimedEvent, deferChart, filterExt, glowWindow, heroStats, isoDate, kicker, mk, nearestTown, rgb, sourceLine } from './layer-kit';
import { CROP_CLASSES } from './crops';
import type { Data } from './data';

/**
 * What grew under each radar swath (the `hailcrop` stage): per swath its corridor in Saskatchewan (km²: a band as wide as
 * the swath at its widest along its centre line) and the km² of each crop-inventory class in it (CROP_CLASSES order; the
 * rest of the corridor was not mapped); per season the ground under any corridor, each piece once.
 */
type HailExposure = {
  source: string; sourceUrl: string; classes: string[]; corridor: string; sample: { px: number; groundM: number };
  years: Record<string, { swaths: number; corridor: number; noWidth: number; inventory: boolean; area: number; km2: number[] }>;
  rows: [number, number, number, number, number[]][];
};
type Exposure = { corridor: number; km2: number[]; mapped: number; crop: number; canola: number | null };
let EXP: HailExposure | null = null;
let expByKey = new Map<string, Exposure>();
let expLoad: Promise<void> | null = null;
let expMissing = false;
const swathKey = (t: number, lon: number, lat: number) => `${t}|${lon}|${lat}`;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const cropOf = (km2: number[]) => km2[0] + km2[1] + km2[2] + km2[3];
const exposureOf = (corridor: number, km2: number[]): Exposure => {
  const crop = cropOf(km2);
  return { corridor, km2, mapped: sum(km2), crop, canola: crop > 0 ? (km2[1] / crop) * 100 : null };
};
/** Loads hail-exposure.json once (a missing file leaves the chip saying so). */
function ensureExposure() {
  expLoad ??= fetch(`${import.meta.env.BASE_URL}data/hail-exposure.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: HailExposure | null) => {
      if (!j?.rows?.length) { expMissing = true; return; }
      EXP = j;
      expByKey = new Map(j.rows.map(([t, lon, lat, corridor, km2]) => [swathKey(t, lon, lat), exposureOf(corridor, km2)]));
    })
    .catch(() => { expMissing = true; });
  return expLoad;
}
const expOf = (r: HailRow) => expByKey.get(swathKey(r[2], r[0], r[1])) ?? null;
const km2Text = (v: number) => `~${fmt.int(v >= 100 ? Math.round(v / 10) * 10 : Math.round(v))} km²`;
/** The Under the storm chip: on or off, kept while the app is open. */
let underOn = false;

/** hail size bands (mm, at least): pea to quarter, to golf ball, to tennis ball, to softball, softball and up */
const BANDS = [
  { from: 0, label: 'under 25 mm', c: '#cfe3ff' },
  { from: 25, label: '25–44 mm (to golf ball)', c: '#a99bff' },
  { from: 45, label: '45–64 mm (to tennis ball)', c: '#d77cff' },
  { from: 65, label: '65–99 mm (to softball)', c: '#ff5fa2' },
  { from: 100, label: '100 mm and up', c: '#ff3b3b' },
];
const NO_SIZE = '#8a96ad';
const sizeColor = (mm: number | null) => (mm == null ? NO_SIZE : [...BANDS].reverse().find((b) => mm >= b.from)!.c);
const isSwath = (r: HailRow) => r[4] === 0;
/** the everyday object a stone of this size is usually compared with */
const likeA = (mm: number) => (mm >= 100 ? 'softball' : mm >= 70 ? 'baseball' : mm >= 64 ? 'tennis ball' : mm >= 43 ? 'golf ball' : mm >= 40 ? 'ping-pong ball' : mm >= 24 ? 'quarter' : mm >= 19 ? 'penny' : 'pea');
const sizeText = (r: HailRow) => (r[3] == null ? 'size not given' : `${r[3]} mm${r[9] ? ` (${r[9]})` : ''}`);
export const HAIL_REACH_KM = 50;
const SRC = [
  { label: 'Northern Hail Project: MESH hail swaths', url: 'https://www.uwo.ca/nhp/', by: 'the Northern Hail Project from radar' },
  { label: 'Northern Hail Project: research database', url: 'https://www.uwo.ca/nhp/', by: 'the Northern Hail Project' },
];

/** Distance (km) from a point to a hail record: to the nearest point of its swath's centre line, or to its point. */
function hailKm(r: HailRow, lon: number, lat: number) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
  const pts = r[6] ?? [[r[0], r[1]]];
  if (pts.length === 1) return Math.hypot((pts[0][0] - lon) * kx, (pts[0][1] - lat) * ky);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = (pts[i - 1][0] - lon) * kx, ay = (pts[i - 1][1] - lat) * ky, bx = (pts[i][0] - lon) * kx, by = (pts[i][1] - lat) * ky;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const u = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(ax + u * dx, ay + u * dy));
  }
  return best;
}

/** Distance (km) from a point to a swath's centre line with square ends (Infinity past either end): its corridor. */
function corridorKm(pts: [number, number][], lon: number, lat: number) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = (pts[i - 1][0] - lon) * kx, ay = (pts[i - 1][1] - lat) * ky, bx = (pts[i][0] - lon) * kx, by = (pts[i][1] - lat) * ky;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const u = L ? -(ax * dx + ay * dy) / L : 0;
    if ((i === 1 && u < 0) || (i === pts.length - 1 && u > 1)) continue;
    const v = Math.max(0, Math.min(1, u));
    best = Math.min(best, Math.hypot(ax + v * dx, ay + v * dy));
  }
  return best;
}

const CORRIDOR_NOTE = 'The corridor is the atlas’s own reading of a swath: a band as wide as the swath at its widest, all along its centre line and cut square at the ends. Real swaths taper and narrow along the way, so it is an upper bound. Inside it the Annual Crop Inventory of the same year is sampled every ~120 m (each sample one 30 m pixel of the map), in Saskatchewan only; cloud and land past the inventory’s northern edge are not mapped. This is exposure, what grew under the swath that season, not damage: no open data says which fields were hit or what was lost, and much of a swath’s hail can be small or fall before crops are up.';

/** A swath's crops by class as a stacked bar and its largest classes (km² of the mapped corridor). */
function classBar(km2: number[]) {
  const tot = sum(km2);
  if (!(tot > 0)) return '';
  const top = km2.map((v, i) => ({ v, i })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  return `<div class="crop-bar">${top.map(({ v, i }) => `<i style="width:${((v / tot) * 100).toFixed(1)}%;background:${CROP_CLASSES[i].c}" title="${CROP_CLASSES[i].name}: ${km2Text(v)}"></i>`).join('')}</div>
    <div class="legend" style="margin-top:4px">${top.slice(0, 6).map(({ v, i }) => `<span><i class="sw" style="background:${CROP_CLASSES[i].c}"></i>${CROP_CLASSES[i].name} ${Math.round((v / tot) * 100)}%</span>`).join('')}</div>`;
}

/** "it crossed ~X km² of cropland, Y % of it canola", or why a swath has no figure; '' for a research storm. */
function exposureLine(r: HailRow) {
  if (!isSwath(r)) return '';
  if (!(r[8]! > 0)) return 'This swath comes without a width, so the atlas draws no corridor for it and counts no crops under it.';
  const e = expOf(r);
  if (!e) return EXP ? 'No crop inventory covers this swath, so no crops are counted under it.' : '';
  if (!(e.corridor > 0)) return 'Its corridor lies outside Saskatchewan, so no crops are counted under it.';
  const part = e.mapped < e.corridor / 2 ? ` The crop inventory mapped only ${Math.round((e.mapped / e.corridor) * 100)}% of the corridor (it stops around 55–56° N), so the cropland is a floor.` : '';
  return `Under the storm: it crossed ${km2Text(e.crop)} of cropland${e.canola != null && e.crop > 0 ? `, ${Math.round(e.canola)} % of it canola` : ''}, in a corridor of ${km2Text(e.corridor)} in Saskatchewan (${Math.floor(r[2])} crop inventory). That is exposure, the crops under the swath, not damage.${part}`;
}

/**
 * From space (the `hailsat` stage, hail-sat.json): for a few big swaths, Sentinel-2's vegetation index (NDVI) on the
 * clearest days before and after, as three pictures (before, after, change) over the corridor and 10 km around it.
 */
type SatSwath = {
  t: number; lon: number; lat: number; name: string; day: string; why: string; bounds: [number, number, number, number]; w: number; h: number; px: number;
  before: { from: string; to: string; scenes: number; cover: number }; after: { from: string; to: string; scenes: number; cover: number };
  change: { inside: number | null; around: number | null }; files: { before: string; after: string; change: string };
};
type HailSat = { source: string; sourceUrl: string; licence: string; licenceUrl: string; credit: string; swaths: SatSwath[] };
let SAT: HailSat | null = null;
let satLoad: Promise<void> | null = null;
function ensureSat() {
  satLoad ??= fetch(`${import.meta.env.BASE_URL}data/hail-sat.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: HailSat | null) => { if (j?.swaths?.length) SAT = { ...j, swaths: j.swaths.filter((s) => Object.values(s.files).every((f) => /^hail-sat\/[a-z0-9-]+\.png$/.test(f))) }; })
    .catch(() => {});
  return satLoad;
}
const satOf = (r: HailRow) => SAT?.swaths.find((s) => s.t === r[2] && s.lon === r[0] && s.lat === r[1]) ?? null;
/** what the map shows from space: one swath's pictures, the slider's mix (0 before → 1 after) or the change picture; dropped once its panel closes */
let satView: { s: SatSwath; mix: number; change: boolean; el: HTMLElement } | null = null;
const satUrl = (f: string) => `${import.meta.env.BASE_URL}data/${f}`;
const NDVI_RAMP = 'linear-gradient(90deg,#78604a,#8c6d46 25%,#d9c27a 45%,#8fc46a 65%,#1e7832)';
const CHANGE_RAMP = 'linear-gradient(90deg,#b23222,#e08c5a 35%,#e1e1d7 50%,#8cc87a 65%,#1e7832)';
/** export for the Data & sources view: the scenes behind From space, once read */
export const hailSatInfo = () => SAT && { n: SAT.swaths.length, years: [...new Set(SAT.swaths.map((s) => Math.floor(s.t)))], credit: SAT.credit };

function satSection(box: HTMLElement, s: SatSwath) {
  const d = (a: { from: string; to: string }) => (a.from === a.to ? a.from : `${a.from} to ${a.to}`);
  const ch = (v: number | null) => (v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`);
  const wrap = box.appendChild(mk('div', 'hx-sat'));
  wrap.innerHTML = `<h3>From space: vegetation before and after</h3>
    <p>${esc(s.why)} Sentinel-2 saw it clear on ${esc(d(s.before))} (before) and ${esc(d(s.after))} (after).</p>
    <div class="chips" style="margin:4px 0 6px"><button class="chip on" type="button" data-sat="show" style="--c:#8fc46a">On the map</button><button class="chip" type="button" data-sat="change" style="--c:#e08c5a">Change</button></div>
    <input type="range" min="0" max="100" value="0" data-sat="mix" aria-label="Before to after" style="width:100%">
    <div class="ramp-labels"><span>before · ${esc(s.before.to)}</span><span>after · ${esc(s.after.from)}</span></div>
    <div class="ramp" data-sat="ramp" style="background:${NDVI_RAMP}"></div>
    <div class="ramp-labels" data-sat="ramp-l"><span>bare (NDVI 0)</span><span>green (0.9)</span></div>
    <div class="metric-grid" style="margin-top:8px"><div class="stat"><div class="v">${ch(s.change.inside)}</div><div class="l">mean NDVI change inside the corridor</div></div><div class="stat"><div class="v">${ch(s.change.around)}</div><div class="l">in the 10 km around it</div></div></div>
    <p class="note"><b>Vegetation change, not damage</b>: clouds, harvest, haying and crops growing or ripening also change it, which is why the land around the corridor is shown too. NDVI compares red and near-infrared light (green, growing plants score high); pixels the scene classification marks as cloud, shadow, water or snow are left out and filled from the next clear day, at Sentinel-2’s 160 m overview, so straight seams are where pictures from different days meet. ${esc(SAT?.credit ?? 'Contains modified Copernicus Sentinel data')}.</p>`;
  satView = { s, mix: 0, change: false, el: wrap };
  const show = wrap.querySelector<HTMLButtonElement>('[data-sat="show"]')!, change = wrap.querySelector<HTMLButtonElement>('[data-sat="change"]')!;
  const mix = wrap.querySelector<HTMLInputElement>('[data-sat="mix"]')!;
  const sync = () => {
    const v = satView?.el === wrap ? satView : null;
    show.classList.toggle('on', !!v);
    change.classList.toggle('on', !!v?.change);
    mix.disabled = !v || v.change;
    wrap.querySelector<HTMLElement>('[data-sat="ramp"]')!.style.background = v?.change ? CHANGE_RAMP : NDVI_RAMP;
    wrap.querySelector<HTMLElement>('[data-sat="ramp-l"]')!.innerHTML = v?.change ? '<span>NDVI fell 0.5</span><span>no change</span><span>rose 0.5</span>' : '<span>bare (NDVI 0)</span><span>green (0.9)</span>';
  };
  show.addEventListener('click', () => { satView = satView?.el === wrap ? null : { s, mix: +mix.value / 100, change: false, el: wrap }; sync(); });
  change.addEventListener('click', () => { if (satView?.el !== wrap) satView = { s, mix: +mix.value / 100, change: false, el: wrap }; satView.change = !satView.change; sync(); });
  mix.addEventListener('input', () => { if (satView?.el === wrap) satView.mix = +mix.value / 100; });
  sync();
}

/** The event panel's Under the storm section for a swath (filled once the files are in, so a late load still shows). */
const exposureDetail = (r: HailRow) => (el: HTMLElement) => {
  const box = el.appendChild(mk('div'));
  Promise.all([ensureExposure(), ensureSat()]).then(() => {
    const line = exposureLine(r), e = expOf(r), s = satOf(r);
    if (!line) return;
    box.innerHTML = `<h3>Under the storm</h3><p>${esc(line)}</p>${e && e.mapped > 0 ? `${classBar(e.km2)}<p class="note">${CORRIDOR_NOTE}</p>` : ''}`;
    if (s) satSection(box, s);
  });
};

/**
 * A research-database storm that a radar swath already holds (within 2 days, its point within 25 km of the swath's
 * centre line) is the same storm: counted once, as the swath (its measured stone still counts for the largest hail).
 */
const SAME_DAYS = 2 / 365.25, SAME_KM = 25;
const sameCache = new WeakMap<HailRow[], Map<HailRow, HailRow[]>>();
/** Each research storm a swath holds, with the swaths that hold it. */
function sameStorms(rows: HailRow[]) {
  let s = sameCache.get(rows);
  if (!s) {
    const sw = rows.filter(isSwath);
    s = new Map();
    for (const r of rows) {
      if (isSwath(r)) continue;
      const m = sw.filter((w) => Math.abs(w[2] - r[2]) <= SAME_DAYS && hailKm(w, r[0], r[1]) <= SAME_KM);
      if (m.length) s.set(r, m);
    }
    sameCache.set(rows, s);
  }
  return s;
}

/** Hail on record near a place: storms whose swath or point passes within 50 km, and the largest hail among them. */
export type PlaceHail = { n: number; from: number; to: number; max: { mm: number; t: number; name: string | null; radar: boolean } | null };
export function placeHail(data: Data, m: { lon: number; lat: number }): PlaceHail | null {
  const rows = data.hail?.rows;
  if (!rows?.length) return null;
  let n = 0;
  let max: PlaceHail['max'] = null;
  const same = sameStorms(rows);
  for (const r of rows) {
    if (hailKm(r, m.lon, m.lat) > HAIL_REACH_KM) continue;
    // a research storm counts unless a swath holding it is also within reach of this place (then that swath counts)
    if (!same.get(r)?.some((w) => hailKm(w, m.lon, m.lat) <= HAIL_REACH_KM)) n++;
    if (r[3] != null && (!max || r[3] > max.mm)) max = { mm: r[3], t: r[2], name: r[5], radar: isSwath(r) };
  }
  return { n, from: Math.floor(rows[0][2]), to: Math.floor(rows.at(-1)![2]), max };
}

export function hailLayer(data: Data): AtlasLayer {
  const color = '#c3b5ff';
  const H = data.hail;
  // the two small files of the Under the storm chip, read once at start (the Data & sources view counts them too)
  if (H?.rows?.length) { ensureExposure(); ensureSat(); }
  const rows: HailRow[] = H?.rows ?? [];
  const swaths = rows.filter(isSwath);
  const field = rows.filter((r) => !isSwath(r));
  const radarSpan = H?.sources?.[0] ?? { from: 2022, to: 2024 };
  const byYear: Record<number, number> = {};
  const bigByYear: Record<number, number> = {};
  const maxByYear: Record<number, number> = {};
  const byMonth = new Array(12).fill(0);
  for (const r of swaths) {
    const y = Math.floor(r[2]);
    byYear[y] = (byYear[y] ?? 0) + 1;
    if ((r[3] ?? 0) >= 50) bigByYear[y] = (bigByYear[y] ?? 0) + 1;
    if (r[3] != null) maxByYear[y] = Math.max(maxByYear[y] ?? 0, r[3]);
    byMonth[+isoDate(r[2]).slice(5, 7) - 1]++; // the calendar month (times are fractions of the real year, not twelfths)
  }
  const y0 = Math.floor(rows[0]?.[2] ?? 2022), y1 = Math.floor(rows.at(-1)?.[2] ?? 2024);
  const radar = (y: number) => y >= radarSpan.from && y <= radarSpan.to;
  const sized = swaths.filter((r) => r[3] != null);
  const sizeless = swaths.length - sized.length;
  const sizeless0 = swaths.filter((r) => r[3] == null && Math.floor(r[2]) === radarSpan.from).length;
  const radius = (r: HailRow) => 1800 + (r[3] ?? 20) * 55;
  // research storms a radar swath already holds: not counted twice, from when both are on the timeline
  const sameTimes = [...sameStorms(rows)].map(([r, ws]) => Math.max(r[2], Math.min(...ws.map((w) => w[2])))).sort((a, b) => a - b);
  const where = (r: HailRow) => {
    if (r[5]) return `near ${r[5]}`;
    const { town, km } = nearestTown(data.munis, r[0], r[1]);
    if (!town) return 'location as recorded'; // no places loaded (a failed municipalities file)
    return `${Math.round(km)} km from ${town.name}`;
  };

  // ---- Under the storm: the corridors over that year's crop-inventory cells (crops.json's 3 km grid)
  const C = data.crops, g = C?.grid;
  const withWidth = swaths.filter((r) => r[8]! > 0);
  const grids = new Map<number, Uint8Array>();
  const gridOf = (y: number) => {
    const i = C ? C.years.indexOf(y) : -1;
    if (!C || !g || i < 0) return null;
    let a = grids.get(y);
    if (!a) {
      a = new Uint8Array(g.w * g.h);
      let k = 0;
      for (const [, n, ch] of C.maps[i].matchAll(/(\d*)([a-z])/g)) a.fill(ch.charCodeAt(0) - 97, k, (k += n ? +n : 1)); // 0 not mapped, 1… classes
      grids.set(y, a);
    }
    return a;
  };
  const MR = 6378137;
  const cells = new Map<HailRow, number[]>();
  /** the 3 km cells a corridor crosses: centre within half its width plus half a cell (on the ground) of its line */
  const cellsOf = (r: HailRow) => {
    let out = cells.get(r);
    if (out || !g) return out ?? [];
    out = [];
    const pts = r[6]!, reach = r[8]! / 2;
    const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    const pad = (reach + 2) / 70;
    const mxOf = (lon: number) => (MR * lon * Math.PI) / 180, myOf = (lat: number) => MR * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const c0 = Math.max(0, Math.floor((mxOf(Math.min(...lons) - pad) - g.x0) / g.px)), c1 = Math.min(g.w - 1, Math.floor((mxOf(Math.max(...lons) + pad) - g.x0) / g.px));
    const r0 = Math.max(0, Math.floor((g.y1 - myOf(Math.max(...lats) + pad)) / g.px)), r1 = Math.min(g.h - 1, Math.floor((g.y1 - myOf(Math.min(...lats) - pad)) / g.px));
    for (let row = r0; row <= r1; row++) {
      const lat = (2 * Math.atan(Math.exp((g.y1 - (row + 0.5) * g.px) / MR)) - Math.PI / 2) * (180 / Math.PI);
      const half = (g.px * Math.cos((lat * Math.PI) / 180)) / 2000; // half a cell, km on the ground
      for (let col = c0; col <= c1; col++) {
        const lon = ((g.x0 + (col + 0.5) * g.px) / MR) * (180 / Math.PI);
        if (corridorKm(pts, lon, lat) <= reach + half) out.push(row * g.w + col);
      }
    }
    cells.set(r, out);
    return out;
  };
  let pic: { key: string; cv: HTMLCanvasElement } | null = null;
  /** the season so far: its corridors' cells in the crop colours (grey where the inventory did not map) */
  const underPic = (y: number, list: HailRow[]) => {
    const key = `${y}:${list.length}`;
    if (pic?.key === key) return pic.cv;
    const a = gridOf(y);
    if (!a || !g) return null;
    const cv = document.createElement('canvas');
    cv.width = g.w;
    cv.height = g.h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(g.w, g.h);
    const COL = [[150, 150, 160, 90], ...CROP_CLASSES.map((c) => rgb(c.c, 240))];
    for (const r of list) for (const k of cellsOf(r)) img.data.set(COL[a[k]], k * 4);
    ctx.putImageData(img, 0, 0);
    pic = { key, cv };
    return cv;
  };
  // the season so far, kept while the count is the same (so deck.gl is handed the same array frame to frame)
  let season: { key: string; list: HailRow[] } = { key: '', list: [] };
  const seasonList = (time: number) => {
    const y = Math.floor(time);
    const a = lowerBound(withWidth, y, (r) => r[2]), b = lowerBound(withWidth, Math.min(time, y + 1), (r) => r[2]);
    if (season.key !== `${a}:${b}`) season = { key: `${a}:${b}`, list: withWidth.slice(a, b) };
    return season.list;
  };
  /** a season's swaths by cropland under them, largest first */
  const topOf = (y: number) => withWidth.filter((r) => Math.floor(r[2]) === y).map((r) => ({ r, e: expOf(r) })).filter((x) => x.e && x.e.crop > 0).sort((a, b) => b.e!.crop - a.e!.crop) as { r: HailRow; e: Exposure }[];

  /** a hail record as the event panel shows it (a click on the map, or a row of the Under the storm list) */
  const recordEvent = (r: HailRow): AtlasEvent => {
    const e = isSwath(r) ? expOf(r) : null;
    return {
      t: r[2], layer: 'hail', kind: isSwath(r) ? 'Hail swath' : 'Hailstorm', lon: r[0], lat: r[1], zoom: 8.5,
      title: r[3] != null ? `${likeA(r[3])}-sized hail ${where(r)}` : `Hail ${where(r)}`,
      body: isSwath(r)
        ? `A hail swath traced by ${SRC[0].by} on ${isoDate(r[2])}${r[7] ? `, about ${Math.round(r[7])} km long` : ''}${r[8] ? ` and up to ${r[8]} km wide` : ''}. ${r[3] != null ? `The radar estimated hail up to ${r[3]} mm (MESH), about ${likeA(r[3])} size; that is an estimate, not a measured stone.` : 'This year’s swaths come without a hail size.'} The dot marks where the swath began.`
        : `A hailstorm in ${SRC[1].by}’s research database, ${isoDate(r[2])}${r[10] ? ', confirmed with an expert' : ''}. Largest hail: ${sizeText(r)}.`,
      stats: [
        { v: r[3] != null ? `${r[3]} mm` : '–', l: isSwath(r) ? 'largest hail (radar estimate)' : 'largest hail' },
        ...(r[7] ? [{ v: `${Math.round(r[7])} km`, l: 'swath length' }] : []),
        ...(r[8] ? [{ v: `${r[8]} km`, l: 'widest' }] : []),
        ...(e && e.mapped > 0 ? [{ v: km2Text(e.crop), l: 'cropland under it (exposure)' }, ...(e.canola != null ? [{ v: `${Math.round(e.canola)}%`, l: 'of that cropland canola' }] : [])] : []),
      ],
      sources: [{ label: SRC[r[4]].label, url: SRC[r[4]].url }, ...(e ? [{ label: 'AAFC Annual Crop Inventory (open.canada.ca)', url: safeUrl(EXP?.sourceUrl) ?? 'https://open.canada.ca/data/en/dataset/ba2645d5-4458-414d-b196-6303ac06c1c9' }] : [])],
      ...(isSwath(r) ? { detail: exposureDetail(r) } : {}),
    };
  };

  const l: AtlasLayer = {
    id: 'hail',
    name: 'Hail',
    icon: '🧊',
    color,
    range: [y0, y1 + 0.99],
    monthly: true,
    available: rows.length > 0,
    unavailable: 'The hail records could not be downloaded when this copy of the data was built. Run <code>npm run data hail</code>, then reload.',
    build({ time, speed }) {
      ensureExposure();
      if (satView && !satView.el.isConnected) satView = null; // its panel closed
      const sat: Layer[] = [];
      if (satView) {
        const { s, mix, change } = satView;
        const pic = (id: string, f: string, opacity: number) => new BitmapLayer({ id, image: satUrl(f), bounds: s.bounds, textureParameters: { minFilter: 'linear', magFilter: 'nearest' }, opacity, parameters: NO_DEPTH } as any);
        if (change) sat.push(pic('hail-sat-change', s.files.change, 1));
        else sat.push(pic('hail-sat-before', s.files.before, 1), ...(mix > 0 ? [pic('hail-sat-after', s.files.after, mix)] : []));
      }
      const W = glowWindow(speed, 0.25);
      const lo = lowerBound(rows, time - W, (r) => r[2]);
      const hi = lowerBound(rows, time, (r) => r[2]);
      const live = rows.slice(lo, hi);
      const out: Layer[] = [];
      if (underOn && g) {
        // the season so far: each corridor as a faint band, and the crop cells it crossed in that year's colours
        const list = seasonList(time);
        const img = list.length ? underPic(Math.floor(time), list) : null;
        if (img)
          out.push(
            new PathLayer<HailRow>({
              id: 'hail-corridor',
              data: list,
              getPath: (r) => r[6]!,
              getWidth: (r) => r[8]! * 1000,
              widthUnits: 'meters',
              getColor: [255, 255, 255, 26],
              parameters: NO_DEPTH,
              updateTriggers: { getPath: list.length },
            } as any),
            new BitmapLayer({
              id: 'hail-under',
              image: img,
              bounds: g.bounds as [number, number, number, number],
              textureParameters: { minFilter: 'nearest', magFilter: 'nearest' },
              opacity: 0.9,
              parameters: NO_DEPTH,
              updateTriggers: { image: pic?.key },
            } as any),
          );
      }
      out.push(
        ...sat,
        new PathLayer<HailRow>({
          id: 'hail-swaths',
          data: swaths,
          getPath: (r) => r[6]!,
          getColor: (r) => rgb(sizeColor(r[3]), 110),
          getWidth: (r) => 1.5 + Math.min(3, (r[3] ?? 20) / 35),
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          extensions: filterExt,
          getFilterValue: (r) => r[2],
          filterRange: [1800, time],
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<HailRow>({
          id: 'hail-dots',
          data: rows,
          getPosition: (r) => [r[0], r[1]],
          getRadius: radius,
          radiusMinPixels: 2.5,
          getFillColor: (r) => rgb(sizeColor(r[3]), isSwath(r) ? 170 : 235),
          stroked: true,
          // storms in the research database get a white rim
          getLineColor: (r) => (isSwath(r) ? [6, 10, 18, 200] : [255, 255, 255, 230]),
          getLineWidth: (r) => (isSwath(r) ? 1 : 2),
          lineWidthUnits: 'pixels',
          extensions: filterExt,
          getFilterValue: (r) => r[2],
          filterRange: [1800, time],
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
      );
      if (live.length) {
        const fade = (r: HailRow) => 1 - (time - r[2]) / W;
        out.push(
          // the swath lights up along its length, then settles back to the faint line
          new PathLayer<HailRow>({
            id: 'hail-live-swath',
            data: live.filter(isSwath),
            getPath: (r) => r[6]!,
            getColor: (r) => { const c = rgb(sizeColor(r[3])); return [c[0], c[1], c[2], 255 * fade(r)] as RGBA; },
            getWidth: 5,
            widthUnits: 'pixels',
            capRounded: true,
            updateTriggers: { getColor: time },
            parameters: ADDITIVE,
          }),
          new ScatterplotLayer<HailRow>({
            id: 'hail-flare',
            data: live,
            getPosition: (r) => [r[0], r[1]],
            getRadius: (r) => radius(r) * (1.5 + 3 * fade(r)),
            getFillColor: (r) => { const c = rgb(sizeColor(r[3])); return [c[0], c[1], c[2], 200 * fade(r)] as RGBA; },
            updateTriggers: { getRadius: time, getFillColor: time },
            parameters: ADDITIVE,
          }),
          new ScatterplotLayer<HailRow>({
            id: 'hail-ring',
            data: live,
            getPosition: (r) => [r[0], r[1]],
            getRadius: (r) => 3000 + (1 - fade(r)) * (14000 + (r[3] ?? 20) * 160),
            stroked: true,
            filled: false,
            lineWidthMinPixels: 2,
            getLineColor: (r) => { const c = rgb(sizeColor(r[3])); return [c[0], c[1], c[2], 255 * fade(r)] as RGBA; },
            updateTriggers: { getRadius: time, getLineColor: time },
            parameters: ADDITIVE,
          }),
        );
      }
      return out;
    },
    // the radar record only: years outside it are left empty, not drawn as zero
    spark: () => d3.range(radarSpan.from, radarSpan.to + 1).map((x) => ({ x, y: byYear[x] ?? 0 })),
    events() {
      return rows.filter((r) => !isSwath(r) || (r[3] ?? 0) >= 100).map((r): TimedEvent => ({
        t: r[2], layer: 'hail', lon: r[0], lat: r[1], zoom: 8,
        title: r[3] != null ? `${likeA(r[3])}-sized hail ${where(r)}` : `Hailstorm ${where(r)}`,
        body: isSwath(r)
          ? `Radar estimated hail up to ${r[3]} mm across a swath ${r[7] ? `about ${Math.round(r[7])} km long ` : ''}on ${isoDate(r[2])}.`
          : `A hailstorm the Northern Hail Project recorded in its research database${r[10] ? ' and confirmed with an expert' : ''}, ${isoDate(r[2])}. Largest hail: ${sizeText(r)}.`,
        stats: [{ v: r[3] != null ? `${r[3]} mm` : '–', l: isSwath(r) ? 'largest hail (radar estimate)' : 'largest hail' }, ...(r[7] ? [{ v: `${Math.round(r[7])} km`, l: 'swath length' }] : [])],
        sources: [{ label: SRC[r[4]].label, url: SRC[r[4]].url }],
        ...(isSwath(r) ? { detail: exposureDetail(r) } : {}),
      }));
    },
    panel(el) {
      el.innerHTML = `${kicker(l, `Hail · ${y0} → ${y1}`)}
        <h2>Hail alley</h2>
        <p class="lede">The hail swaths the Northern Hail Project traced across Saskatchewan on weather radar from ${radarSpan.from} to ${radarSpan.to}, and the hailstorms in its research database. Each storm flares when the timeline reaches it, then stays as a dot sized and coloured by its largest hail, with the swath’s centre line behind it.</p>
        <div class="chips" style="margin:2px 0 10px"><button class="chip" type="button" data-hx="on" style="--c:${color}" title="What grew under each swath that season, from the Annual Crop Inventory">Under the storm</button></div>`;
      ensureExposure();
      const hero = heroStats(el, 4);
      const under = el.appendChild(mk('div', 'hx-box'));
      const chip = el.querySelector<HTMLButtonElement>('[data-hx]')!;
      let underKey = '';
      chip.classList.toggle('on', underOn);
      chip.addEventListener('click', () => { underOn = !underOn; chip.classList.toggle('on', underOn); underKey = ''; });
      under.addEventListener('click', (e) => {
        const i = (e.target as HTMLElement).closest<HTMLElement>('[data-hx-i]')?.dataset.hxI;
        const r = i != null ? withWidth[+i] : null;
        if (r) window.dispatchEvent(new CustomEvent('atlas:event', { detail: recordEvent(r) }));
      });
      /** the chip's season view: what grew under the year's swaths (each piece of ground once) and the five with the most cropland */
      const drawUnder = (y: number) => {
        if (!underOn) { under.innerHTML = ''; return; }
        const ye = EXP?.years[y];
        if (!EXP) { under.innerHTML = `<div class="callout" style="--c:${color}">${expMissing ? 'What grew under the swaths could not be read: run <code>npm run data hailcrop</code>, then reload.' : 'Reading what grew under the swaths…'}</div>`; return; }
        if (!ye || !ye.corridor) {
          under.innerHTML = `<div class="callout" style="--c:${color}">${ye?.noWidth ? `The ${y} swaths come without a width, so the atlas draws no corridor and counts no crops under them.` : radar(y) ? `No crop inventory for ${y}, so nothing is counted.` : `No radar swaths for ${y}: the record runs ${radarSpan.from}–${radarSpan.to}.`} Move the timeline to ${Object.keys(EXP.years).filter((k) => EXP!.years[k].corridor).join(' or ')}.</div>`;
          return;
        }
        const crop = cropOf(ye.km2), top = topOf(y).slice(0, 5), max = top[0]?.e.crop || 1;
        under.innerHTML = `<h3>Under the storm, ${y}</h3>
          <p>The season’s swath corridors over that year’s crop inventory, as the timeline reaches them: ${km2Text(ye.area)} of Saskatchewan lay under at least one corridor, ${km2Text(crop)} of it cropland (${Math.round((crop / ye.area) * 100)}%). Land under two swaths counts once.</p>
          ${classBar(ye.km2)}
          <h3>Most cropland under one swath</h3>
          <ol class="rank-list">${top.map(({ r, e }, k) => `<li data-hx-i="${withWidth.indexOf(r)}"><span class="rk">${k + 1}</span><span><span class="nm">${esc(isoDate(r[2]))} · ${esc(where(r))}</span><br><span class="rd">${r[8]} km wide${e.canola != null ? ` · ${Math.round(e.canola)}% canola` : ''}</span></span><span><div class="bar"><i style="width:${Math.round((e.crop / max) * 100)}%;background:${CROP_CLASSES[1].c}"></i></div><div class="bar-v">${km2Text(e.crop)}</div></span></li>`).join('')}</ol>
          <p class="note">${CORRIDOR_NOTE} ${ye.noWidth ? `${ye.noWidth} of the ${y} swaths come without a width and are left out. ` : ''}The squares on the map are the crop inventory’s ~2 km cells (each its most common class) that a corridor crosses; the numbers come from the finer samples, so the two differ a little. Data: Northern Hail Project (CC BY-NC 4.0), AAFC Annual Crop Inventory (Open Government Licence – Canada).</p>`;
      };
      el.insertAdjacentHTML('beforeend', `<h3>Radar hail swaths a year</h3>`);
      const set = deferChart(el.appendChild(document.createElement('div')), (c) => barChart(c, { data: l.spark(), xDomain: [radarSpan.from, radarSpan.to], color, height: 110, tooltip: (d) => `<b>${d.x}</b><br>${d.y} swaths · ${bigByYear[d.x] ?? 0} with hail 50 mm or larger${maxByYear[d.x] ? ` · largest ${maxByYear[d.x]} mm` : ''}` }));
      el.insertAdjacentHTML('beforeend', `
        <h3>By month</h3><div class="months">${byMonth.map((n, i) => `<span title="${n} in ${MONTHS[i]}"><i style="height:${Math.round((n / Math.max(1, ...byMonth)) * 100)}%"></i>${MONTHS[i][0]}</span>`).join('')}</div>
        <h3>Largest hail</h3>
        <div class="legend">${BANDS.map((b) => `<span><i class="sw" style="background:${b.c}"></i>${b.label}</span>`).join('')}<span><i class="sw" style="background:${NO_SIZE}"></i>size not given</span></div>
        <div class="callout" style="--c:${color}">${fmt.int(swaths.length)} radar hail swaths over Saskatchewan in ${radarSpan.to - radarSpan.from + 1} summers; ${sized.filter((r) => r[3]! >= 50).length} of the ${sized.length} with a size reached 50 mm (golf ball and up). ${field.length} storm${field.length === 1 ? '' : 's'} from the research database (white rims).</div>
        <p class="note">Swath sizes are the radar’s MESH (Maximum Expected Size of Hail), an estimate from the storm’s structure, not a stone anyone measured; the ${radarSpan.from} swaths come without one${sizeless > sizeless0 ? `, as do ${sizeless - sizeless0} later ones` : ''}. The research database has the project’s measured, estimated and reported stones; its few Saskatchewan storms are not a full record, and one whose point was off the map is placed at the town it is named after. Counts depend on radar coverage and on who was there to report hail, so more hail on record doesn’t necessarily mean more hail. Hail damage is a common crop-insurance and home and car insurance claim on the prairies; the layer shows storms, not claims or premiums. Northern Hail Project data is licensed CC BY-NC 4.0, for non-commercial use.</p>
        ${sourceLine(H?.source ?? '')}`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          const k = `${underOn}:${y}:${!!EXP}:${expMissing}`;
          if (k !== underKey) { underKey = k; drawUnder(y); }
          const ye = underOn ? EXP?.years[y] : null;
          if (ye?.corridor) {
            // the chip's season figures in place of the counts
            const crop = cropOf(ye.km2), best = topOf(y)[0];
            hero(0, km2Text(crop), `cropland under the ${y} swaths`);
            hero(1, crop > 0 ? `${Math.round((ye.km2[1] / crop) * 100)}%` : '–', 'of that cropland canola');
            hero(2, `${Math.round((crop / ye.area) * 100)}%`, 'of the ground under them cropland');
            hero(3, best ? km2Text(best.e.crop) : '–', best ? `most under one swath: ${where(best.r)}, ${isoDate(best.r[2])}` : '');
            set(time);
            return;
          }
          if (radar(y)) {
            hero(0, String(byYear[y] ?? 0), `radar swaths in ${y}`);
            hero(1, maxByYear[y] ? `${maxByYear[y]} mm` : '–', maxByYear[y] ? `largest hail in ${y} (radar)` : `no sizes for ${y}`);
          } else {
            hero(0, '–', `no radar record for ${y}`);
            hero(1, '–', `radar swaths: ${radarSpan.from}–${radarSpan.to}`);
          }
          hero(2, fmt.int(lowerBound(rows, time, (r) => r[2]) - lowerBound(sameTimes, time, (t) => t)), `storms on record since ${y0}`);
          const peak = byMonth.indexOf(Math.max(...byMonth));
          hero(3, MONTHS[peak], `busiest month (${Math.round((byMonth[peak] / (swaths.length || 1)) * 100)}%)`);
          set(time);
        },
      };
    },
    describe(info) {
      const r = info.object as HailRow;
      if (!Array.isArray(r)) return null;
      return recordEvent(r);
    },
    tooltip(info) {
      const r = info.object as HailRow;
      if (!Array.isArray(r)) return null;
      return `<b>${isSwath(r) ? 'Hail swath' : 'Hailstorm'}</b><br><span class="tk">Date</span> <span class="tv">${isoDate(r[2])}</span><br><span class="tk">Where</span> ${esc(where(r))}<br><span class="tk">Largest hail</span> <span class="tv">${esc(sizeText(r))}${isSwath(r) && r[3] != null ? ' (radar)' : ''}</span>`;
    },
  };
  return l;
}
