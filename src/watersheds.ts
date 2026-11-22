// WATERSHEDS: where the water from a place goes. AAFC's Watersheds Project 2013 (the `watersheds` stage): the major basins
// tinted by the sea they drain to, the sub-basins outlined, and the land that drains nowhere in a median year darkened.
//
// Follow a raindrop: with the layer focused, a click anywhere (a town pin too) starts a drop at that point. It runs to
// the gauge at the outlet of the point's own drainage area, then down AAFC's gauge network (Natural Earth's river course
// between two gauges where both sit on it, otherwise a straight step) and, where the network stops short of the sea,
// on down Natural Earth's rivers, but only along a river AAFC sends to the same sea (the stage checks this). It pools
// where the data say the water goes nowhere: land that does not drain in a median year, a lake with no outlet, a
// sub-basin closed in a median year. A click on a River floods gauge (or picking one in the panel) lights up everything
// upstream of it on AAFC's network. Model paths and drainage areas, never a forecast: say so.
import * as d3 from 'd3';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { COORDINATE_SYSTEM } from '@deck.gl/core';
import { BitmapLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Data, Watersheds, WsPlace, WsStation } from './data';
import { fmt } from './data';
import { esc } from './html';
import { ADDITIVE, AtlasLayer, NO_DEPTH, heroStats, kicker, mk, nearestTown, rgb, sourceLine } from './layer-kit';
import { reducedMotion } from './particles';
import { link, metric } from './report-kit';

export const WS_COLOR = '#5fd3c6';
const SEA_COLOR: Record<string, string> = { 'Hudson Bay': '#4f8cff', 'Arctic Ocean': '#b7f0ff', 'Gulf of Mexico': '#f4a261' };
const seaColor = (W: Watersheds, o: number) => SEA_COLOR[W.systems[o]] ?? '#9aa3b2';
const NC_FILL: [number, number, number, number] = [4, 8, 14, 170];
const R_EARTH = 6371;

type Pt = [number, number];
type Fate = 'sea' | 'pool' | 'slough' | 'edge';
/** A raindrop's journey: its route, the running distance along it, what it passes and how it ends. */
type Drop = {
  at: Pt; label: string; fate: Fate; sys: number; end: string;
  pts: Pt[]; cum: number[]; total: number; waters: string[]; basins: string[];
  sub: number; basin: number; t0: number; dur: number;
};

/** What the layer shows, kept while the app is open (the Town Report's button and a return to the layer find it). */
const st = { drop: null as Drop | null, gauge: null as string | null, pending: null as { lon: number; lat: number; label: string; st?: number } | null };
let focusedNow = false;

const kmBetween = (a: Pt, b: Pt) => {
  const r = Math.PI / 180, s = Math.sin(((b[1] - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(s));
};
const pairs = (flat: number[], from = 0): Pt[] => { const out: Pt[] = []; for (let i = from * 2; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; };
/** "Qu’Appelle River Near Lumsden" → "Qu’Appelle River": the water a gauge sits on. */
const waterOf = (gauge: string) => gauge.split(/\s+(?:Near|At|Above|Below|In|From|On|Upstream|Downstream|East Of|West Of|North Of|South Of|Outlet|Inlet|Overflow)\b/i)[0].trim();
/** A Natural Earth name as a water: "Assiniboine" → "Assiniboine River", lakes and rivers kept as they are. */
const riverName = (n: string) => (!n ? '' : /\b(lake|river|creek|bay|reservoir|channel|lac)\b/i.test(n) ? n : `${n} River`);
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/\s+river$/, '').trim();

/** Ray casting on lon/lat rings (holes included, even–odd). */
function inPoly(poly: [number, number][][], x: number, y: number) {
  let inside = false;
  for (const ring of poly)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}

/** The decoded grids: each cell's gauge (index, −1 none) and the non-contributing mask. */
const grids = new WeakMap<Watersheds, { st: Int32Array; nc: Uint8Array }>();
function gridOf(W: Watersheds) {
  let g = grids.get(W);
  if (g) return g;
  const n = W.grid.nx * W.grid.ny, a = new Int32Array(n), m = new Uint8Array(n);
  for (let i = 0, k = 0; i + 1 < W.grid.st.length; i += 2) { a.fill(W.grid.st[i] - 1, k, k + W.grid.st[i + 1]); k += W.grid.st[i + 1]; }
  for (let i = 0, k = 0; i + 1 < W.grid.nc.length; i += 2) { m.fill(W.grid.nc[i], k, k + W.grid.nc[i + 1]); k += W.grid.nc[i + 1]; }
  g = { st: a, nc: m };
  grids.set(W, g);
  return g;
}
const cellIndex = (W: Watersheds, lon: number, lat: number) => {
  const c = Math.floor((lon - W.grid.w) / W.grid.dx), r = Math.floor((lat - W.grid.s) / W.grid.dy);
  return c >= 0 && c < W.grid.nx && r >= 0 && r < W.grid.ny ? r * W.grid.nx + c : -1;
};

/** The major basin holding a point, or −1 (outside AAFC's map). */
const basinAt = (W: Watersheds, x: number, y: number) => W.basins.findIndex((b) => b.polys.some((p) => inPoly(p, x, y)));

/** The journey of a drop of rain that falls at a point: `start` is the gauge whose drainage area holds it (the grid's,
 *  unless given), `drainsHere` false to follow the water on even from land that drains nowhere in a median year. */
function journey(W: Watersheds, at: Pt, label: string, opts: { start?: number; drainsHere?: boolean } = {}): Drop | null {
  const g = gridOf(W), ci = cellIndex(W, at[0], at[1]);
  const k0 = opts.start ?? (ci >= 0 ? g.st[ci] : -1);
  if (k0 == null || k0 < 0 || !W.stations[k0]) return null;
  const s0 = W.stations[k0];
  const base = { at, label, sub: s0.sb, basin: s0.b, t0: 0, dur: 0 };
  if (opts.drainsHere !== false && ci >= 0 && g.nc[ci])
    return { ...base, fate: 'slough', sys: s0.o, end: '', pts: [at, at], cum: [0, 0], total: 0, waters: [], basins: [W.basins[s0.b]?.name ?? ''] };
  const pts: Pt[] = [at];
  const waters: string[] = [];
  const addWater = (w: string) => { if (w && (!waters.length || norm(waters.at(-1)!) !== norm(w))) waters.push(w); };
  const seen = new Set<number>();
  let k = k0;
  for (;;) {
    seen.add(k);
    const s = W.stations[k];
    pts.push([s.lon, s.lat]);
    addWater(waterOf(s.n));
    // a closed sub-basin's links out are gross-only, so its chains end inside it
    if (!s.d.length || seen.has(s.d[0])) break;
    if (s.p) pts.push(...pairs(s.p));
    k = s.d[0];
  }
  const s = W.stations[k];
  let fate: Fate, sys = s.o, end = s.n;
  if (W.closed.includes(s.sb) || s.x) fate = 'pool';
  else if (s.sea) fate = 'sea';
  else if (s.c) {
    fate = 'sea';
    const R = W.rivers.reaches;
    let [r, v] = s.c;
    const seenR = new Set<number>();
    while (r >= 0 && !seenR.has(r)) {
      seenR.add(r);
      pts.push(...pairs(R[r].p, v));
      addWater(riverName(W.rivers.names[R[r].n] ?? ''));
      if (R[r].d < 0) { sys = R[r].o ?? sys; break; }
      r = R[r].d; v = 1;
    }
    end = '';
  } else fate = 'edge';
  if (fate === 'sea') addWater(W.systems[sys]);
  // drop repeated points, then the running distance
  const clean: Pt[] = [];
  for (const p of pts) if (!clean.length || Math.abs(clean.at(-1)![0] - p[0]) + Math.abs(clean.at(-1)![1] - p[1]) > 1e-6) clean.push(p);
  if (clean.length < 2) clean.push(clean[0]);
  const cum = [0];
  for (let i = 1; i < clean.length; i++) cum.push(cum[i - 1] + kmBetween(clean[i - 1], clean[i]));
  // the major basins on the way, sampled every ~15 km
  const basins: string[] = [];
  let lastKm = -Infinity;
  for (let i = 0; i < clean.length; i++) {
    if (cum[i] - lastKm < 15 && i < clean.length - 1) continue;
    lastKm = cum[i];
    const b = basinAt(W, clean[i][0], clean[i][1]);
    const name = b >= 0 ? W.basins[b].name : '';
    if (name && basins.at(-1) !== name && !basins.includes(name)) basins.push(name);
  }
  return { ...base, fate, sys, end, pts: clean, cum, total: cum.at(-1)!, waters, basins };
}

/** Where the drop is after `t` ms: its position, the route so far and the km run. */
function dropAt(d: Drop, clock: number) {
  const f = reducedMotion() || d.dur <= 0 ? 1 : Math.max(0, Math.min(1, (clock - d.t0) / d.dur));
  // ease in and out, so the drop leaves gently and slows into the sea
  const e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
  const target = e * d.total;
  let i = d3.bisectLeft(d.cum, target);
  i = Math.max(1, Math.min(d.cum.length - 1, i));
  const a = d.pts[i - 1], b = d.pts[i], seg = d.cum[i] - d.cum[i - 1];
  const u = seg > 0 ? (target - d.cum[i - 1]) / seg : 1;
  const head: Pt = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  return { f, head, km: target, trail: [...d.pts.slice(0, i), head] };
}

/** Everything upstream of a gauge on AAFC's network: `eff` along effective links, `all` with the gross-only ones too. */
const upCache = new WeakMap<Watersheds, number[][]>();
function upstream(W: Watersheds, k: number) {
  let up = upCache.get(W);
  if (!up) {
    up = W.stations.map(() => []);
    W.stations.forEach((s, i) => { for (const j of s.d) up![j].push(i); });
    upCache.set(W, up);
  }
  const gross: number[][] = W.stations.map(() => []);
  W.stations.forEach((s, i) => { for (const j of s.gl ?? []) gross[j].push(i); });
  const walk = (withGross: boolean) => {
    const seen = new Set([k]), stack = [k];
    while (stack.length) { const a = stack.pop()!; for (const b of [...up![a], ...(withGross ? gross[a] : [])]) if (!seen.has(b)) { seen.add(b); stack.push(b); } }
    return seen;
  };
  return { eff: walk(false), all: walk(true) };
}
let upImage: { key: string; img: ImageData; box: [number, number, number, number]; n: number; nAll: number } | null = null;
function upstreamImage(W: Watersheds, gaugeId: string) {
  if (upImage?.key === gaugeId) return upImage;
  const k = W.gauges[gaugeId];
  if (k == null) return null;
  const { eff, all } = upstream(W, k);
  const g = gridOf(W), { nx, ny } = W.grid;
  const img = new ImageData(nx, ny);
  const c = d3.rgb(WS_COLOR);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let r = 0; r < ny; r++)
    for (let col = 0; col < nx; col++) {
      const i = r * nx + col, s = g.st[i];
      if (s < 0 || !all.has(s)) continue;
      const o = ((ny - 1 - r) * nx + col) * 4;
      const wet = !eff.has(s);
      if (g.nc[i]) { img.data[o] = 10; img.data[o + 1] = 40; img.data[o + 2] = 46; img.data[o + 3] = wet ? 90 : 150; }
      else { img.data[o] = c.r; img.data[o + 1] = c.g; img.data[o + 2] = c.b; img.data[o + 3] = wet ? 70 : 165; }
      const lon = W.grid.w + (col + 0.5) * W.grid.dx, lat = W.grid.s + (r + 0.5) * W.grid.dy;
      x0 = Math.min(x0, lon); x1 = Math.max(x1, lon); y0 = Math.min(y0, lat); y1 = Math.max(y1, lat);
    }
  upImage = { key: gaugeId, img, box: [x0, y0, x1, y1], n: eff.size, nAll: all.size };
  return upImage;
}

const flyTo = (box: [number, number, number, number]) => window.dispatchEvent(new CustomEvent('atlas:fly', { detail: { bounds: [[box[0] - 0.6, box[1] - 0.4], [box[2] + 0.6, box[3] + 0.4]] } }));

/** Starts a drop at a point (the map click, a town); flies to fit its route and runs it once the camera has moved. */
function startDrop(data: Data, lon: number, lat: number, label: string, start?: number) {
  const W = data.watersheds;
  if (!W) return false;
  const d = journey(W, [lon, lat], label, { start });
  if (!d) return false;
  // about 4 s for a short trip, up to 16 s for the run to the Arctic Ocean
  d.dur = d.fate === 'slough' ? 0 : Math.min(16000, 4000 + d.total * 4.5);
  d.t0 = performance.now() + (d.total > 30 ? 900 : 200);
  st.drop = d;
  const xs = d.pts.map((p) => p[0]), ys = d.pts.map((p) => p[1]);
  flyTo(d.total > 30 ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [lon - 1.2, lat - 0.7, lon + 1.2, lat + 0.7]);
  return true;
}

/** A place's label for a drop: the town it is, or "near Moose Jaw". */
function placeLabel(data: Data, lon: number, lat: number) {
  const { town, km } = nearestTown(data.munis, lon, lat);
  return town ? (km < 4 ? town.name : `${Math.round(km)} km from ${town.name}`) : 'here';
}

/** Opens the layer with a drop starting at a place (the Town Report's button). */
export function openDrop(data: Data, key: string) {
  const m = data.munis.find((x) => x.key === key) ?? data.small.find((x) => x.key === key);
  const p = placeOf(data, key);
  if (!m) return;
  st.pending = { lon: m.lon, lat: m.lat, label: m.name, st: p?.st != null && p.st >= 0 ? p.st : undefined };
  window.dispatchEvent(new CustomEvent('atlas:layer', { detail: 'watersheds' }));
}
const placeOf = (data: Data, key: string): WsPlace | undefined => data.watersheds?.towns[key] ?? data.watersheds?.small[key];

/** Fate in words (HTML; outside text escaped). */
function fateText(W: Watersheds, d: Drop) {
  const sub = W.subs[d.sub]?.name ?? '';
  if (d.fate === 'slough') return `It lands on ground that drains nowhere in a median year: it fills a slough or a pothole and <b>never leaves; it sinks or evaporates</b>. In a wet spring it may join the ${esc(sub)} after all.`;
  if (d.fate === 'pool') return `It ends in <b>${esc(waterOf(d.end))}</b>, which has no outlet in a median year: this water never leaves the ${esc(sub)} area; it sinks or evaporates. Only a wet year carries it on.`;
  if (d.fate === 'edge') return `AAFC’s gauge network and the rivers on this map stop at <b>${esc(d.end)}</b>; from there the water carries on to the <b>${esc(W.systems[d.sys])}</b>.`;
  return `It reaches <b>${esc(W.systems[d.sys])}</b> after about <b>${fmt.int(d.total)} km</b>.`;
}

export function watershedsLayer(data: Data): AtlasLayer {
  const W = data.watersheds;
  const color = WS_COLOR;
  type BPoly = { b: number; poly: [number, number][][] };
  const basinPolys: BPoly[] = (W?.basins ?? []).flatMap((b, i) => b.polys.map((poly) => ({ b: i, poly })));
  type SPoly = { s: number; poly: [number, number][][] };
  const subPolys: SPoly[] = (W?.subs ?? []).flatMap((s, i) => s.polys.map((poly) => ({ s: i, poly })));
  const ncPolys = (W?.nc ?? []).map((poly) => ({ poly }));
  type Reach = { n: number; path: Pt[] };
  const reaches: Reach[] = (W?.rivers.reaches ?? []).map((r) => ({ n: r.n, path: pairs(r.p) }));
  const gaugeList = W ? (data.rivers?.stations ?? []).filter((g) => W.gauges[g.id] != null).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const placesBySea = W ? W.systems.map((_, o) => data.munis.filter((m) => W.towns[m.key]?.o === o).length) : [];
  // the Town Report's button starts a drop from its place
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement | null)?.closest?.('[data-ws-drop]') as HTMLElement | null;
    if (b?.dataset.wsDrop) openDrop(data, b.dataset.wsDrop);
  });

  const l: AtlasLayer = {
    id: 'watersheds',
    name: 'Watersheds',
    icon: '💧',
    color,
    range: [2013, 2013.99],
    static: true,
    period: 'AAFC drainage areas, 2013',
    available: !!W,
    unavailable: 'The AAFC watershed files could not be read when this copy of the data was built. Run <code>npm run data watersheds</code>, then reload.',
    build({ focusedId, clock }) {
      if (!W) return [];
      const focused = focusedId === 'watersheds';
      focusedNow = focused;
      if (focused && st.pending) { const p = st.pending; st.pending = null; startDrop(data, p.lon, p.lat, p.label, p.st); }
      const out: Layer[] = [
        new PolygonLayer<BPoly>({
          id: 'watersheds-base',
          data: basinPolys,
          getPolygon: (d) => d.poly,
          getFillColor: (d) => rgb(seaColor(W, W.basins[d.b].sys), focused ? 52 : 30),
          getLineColor: (d) => rgb(seaColor(W, W.basins[d.b].sys), 170),
          lineWidthUnits: 'pixels', getLineWidth: 1.2,
          pickable: focused,
          updateTriggers: { getFillColor: focused },
          parameters: NO_DEPTH,
        } as any),
        new PolygonLayer<{ poly: [number, number][][] }>({
          id: 'watersheds-ncbase',
          data: ncPolys,
          getPolygon: (d) => d.poly,
          getFillColor: NC_FILL,
          getLineColor: [150, 170, 190, 40],
          lineWidthUnits: 'pixels', getLineWidth: 0.5,
          pickable: focused,
          parameters: NO_DEPTH,
        } as any),
        new PolygonLayer<SPoly>({
          id: 'watersheds-subs-base',
          data: subPolys,
          getPolygon: (d) => d.poly,
          filled: true,
          getFillColor: (d) => (W.closed.includes(d.s) ? [0, 0, 0, 70] : [0, 0, 0, 0]),
          getLineColor: (d) => (W.closed.includes(d.s) ? [255, 214, 150, 170] : [235, 245, 255, focused ? 70 : 40]),
          lineWidthUnits: 'pixels', getLineWidth: (d) => (W.closed.includes(d.s) ? 1.4 : 0.7),
          pickable: false,
          updateTriggers: { getLineColor: focused },
          parameters: NO_DEPTH,
        } as any),
        new PathLayer<Reach>({
          id: 'watersheds-rivers-base',
          data: reaches,
          getPath: (d) => d.path,
          getColor: [140, 215, 255, focused ? 120 : 70],
          widthUnits: 'pixels', getWidth: 1.1,
          pickable: focused,
          updateTriggers: { getColor: focused },
          parameters: NO_DEPTH,
        } as any),
      ];
      const up = st.gauge ? upstreamImage(W, st.gauge) : null;
      if (up)
        out.push(new BitmapLayer({
          id: 'watersheds-upstream',
          image: up.img,
          bounds: [W.grid.w, W.grid.s, W.grid.w + W.grid.nx * W.grid.dx, W.grid.s + W.grid.ny * W.grid.dy],
          _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          textureParameters: { minFilter: 'nearest', magFilter: 'nearest' },
          parameters: NO_DEPTH,
          updateTriggers: { image: up.key },
        } as any));
      if (up && st.gauge) {
        const g = W.stations[W.gauges[st.gauge]];
        out.push(new ScatterplotLayer<WsStation>({
          id: 'watersheds-gauge', data: [g], getPosition: (s) => [s.lon, s.lat],
          getRadius: 3000, radiusMinPixels: 6, getFillColor: [255, 255, 255, 255], stroked: true, getLineColor: rgb(color), lineWidthMinPixels: 3,
          parameters: { depthCompare: 'always' },
        } as any));
      }
      const d = st.drop;
      if (d) {
        const c = rgb(seaColor(W, d.sys));
        const now = dropAt(d, clock);
        const done = now.f >= 1;
        out.push(
          new PathLayer<{ path: Pt[] }>({
            id: 'watersheds-route', data: [{ path: d.pts }], getPath: (x) => x.path,
            getColor: [c[0], c[1], c[2], 60], widthUnits: 'pixels', getWidth: 2, parameters: NO_DEPTH,
          } as any),
          new PathLayer<{ path: Pt[] }>({
            id: 'watersheds-trail', data: [{ path: now.trail }], getPath: (x) => x.path,
            getColor: [c[0], c[1], c[2], 235], widthUnits: 'pixels', getWidth: 3.5, capRounded: true, jointRounded: true,
            updateTriggers: { getPath: now.km },
            parameters: ADDITIVE,
          } as any),
          new ScatterplotLayer<Pt>({
            id: 'watersheds-start', data: [d.at], getPosition: (p) => p,
            getRadius: 1500, radiusMinPixels: 4, getFillColor: [255, 255, 255, 200], parameters: { depthCompare: 'always' },
          } as any),
        );
        // the drop and its glow; pooled water spreads in rings
        const pulse = reducedMotion() ? 0.5 : (clock % 1600) / 1600;
        const pooled = done && (d.fate === 'pool' || d.fate === 'slough');
        out.push(
          new ScatterplotLayer<Pt>({
            id: 'watersheds-glow', data: [now.head], getPosition: (p) => p,
            getRadius: pooled ? 3000 + pulse * 14000 : 5000, radiusMinPixels: pooled ? 8 + pulse * 26 : 14,
            getFillColor: [c[0], c[1], c[2], pooled ? Math.round(120 * (1 - pulse)) : 90],
            stroked: pooled, filled: !pooled, getLineColor: [c[0], c[1], c[2], Math.round(220 * (1 - pulse))], lineWidthMinPixels: 2,
            updateTriggers: { getRadius: [pulse, pooled], getFillColor: [pulse, pooled], getLineColor: pulse },
            parameters: ADDITIVE,
          } as any),
          new ScatterplotLayer<Pt>({
            id: 'watersheds-drop', data: [now.head], getPosition: (p) => p,
            getRadius: 1800, radiusMinPixels: 6, getFillColor: [235, 250, 255, 255], stroked: true, getLineColor: c, lineWidthMinPixels: 2,
            parameters: { depthCompare: 'always' },
          } as any),
          new TextLayer<Pt>({
            id: 'watersheds-km', data: [now.head], getPosition: (p) => p,
            getText: () => (d.fate === 'slough' ? 'stays here' : done && d.fate === 'pool' ? `${fmt.int(d.total)} km · no outlet` : done && d.fate === 'sea' ? `${fmt.int(d.total)} km · ${W.systems[d.sys]}` : done && d.fate === 'edge' ? `${fmt.int(d.total)} km · on to the ${W.systems[d.sys]} →` : `${fmt.int(now.km)} km`),
            getSize: 14, getColor: [255, 255, 255, 255], getPixelOffset: [0, -20], getAlignmentBaseline: 'bottom',
            fontFamily: 'Inter, sans-serif', fontWeight: 800, characterSet: 'auto', outlineWidth: 4, outlineColor: [6, 10, 18, 235], fontSettings: { sdf: true },
            updateTriggers: { getText: [Math.round(now.km), done] },
            parameters: { depthCompare: 'always' },
          } as any),
        );
      }
      return out;
    },
    spark: () => [],
    events: () => [],
    click(info) {
      if (!W || !focusedNow) return false;
      const id = info.layer?.id ?? '', o: any = info.object;
      // a River floods gauge lights up what drains to it
      if (id.startsWith('rivers')) {
        const gid: string | undefined = o?.s?.id ?? o?.id;
        if (gid && W.gauges[gid] != null) { pickGauge(gid); return true; }
        return false;
      }
      // a town pin starts a drop from the town
      if (id.startsWith('towns') && o?.key) {
        const p = placeOf(data, o.key);
        return startDrop(data, o.lon, o.lat, o.name, p?.st != null && p.st >= 0 ? p.st : undefined);
      }
      if (!id.startsWith('watersheds') || !info.coordinate) return false;
      const [lon, lat] = info.coordinate as [number, number];
      if (!startDrop(data, lon, lat, placeLabel(data, lon, lat)))
        window.dispatchEvent(new CustomEvent('atlas:event', { detail: { layer: 'watersheds', kind: 'Watersheds', title: 'Outside the mapped drainage areas', body: 'AAFC’s Watersheds Project maps the gauges’ drainage areas of the prairie provinces and the land downstream to Hudson Bay; this spot is outside them, so no drop can be followed from here.' } }));
      return true;
    },
    panel(el) {
      el.innerHTML = `${kicker(l, 'Watersheds · where the water goes')}
        <h2>Follow a raindrop</h2>`;
      if (!W) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const share = Math.round(W.south.share * 100);
      el.insertAdjacentHTML('beforeend', `<p class="lede">Rain on Saskatchewan ends up in three seas: <b>Hudson Bay</b>, the <b>Arctic Ocean</b> or, from the far south, the <b>Gulf of Mexico</b>. The basins are tinted by the sea they drain to. The dark patches are land that, in a median year, drains nowhere at all: water there fills sloughs and potholes and soaks in or evaporates. <b>Click anywhere</b> (a town too) to follow a drop downstream; click a River floods gauge, or pick one below, to light up everything that drains to it.</p>`);
      const hero = heroStats(el, 3);
      hero(0, `${share}%`, `of the province south of ${W.south.top}° N drains nowhere in a median year (${fmt.int(W.south.km2)} km²)`);
      const sys = W.systems.map((s, o) => ({ s, o, n: placesBySea[o] })).sort((a, b) => b.n - a.n);
      hero(2, `${sys[0].n} of ${data.munis.length}`, `places drain to ${sys[0].s}`);
      const dropBox = el.appendChild(mk('div', 'ws-drop'));
      const gaugeBox = el.appendChild(mk('div', 'ws-gauge'));
      gaugeBox.innerHTML = `<h3>What drains to a gauge</h3>
        <select class="ws-gauge-sel" aria-label="River gauge"><option value="">Pick a River floods gauge…</option>${gaugeList.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select>
        <div class="ws-gauge-info"></div>`;
      const sel = gaugeBox.querySelector<HTMLSelectElement>('.ws-gauge-sel')!;
      sel.addEventListener('change', () => pickGauge(sel.value || null));
      el.insertAdjacentHTML('beforeend', `
        <h3>The seas</h3>
        <div class="legend" style="display:grid;gap:6px">${sys.map((x) => `<span><i class="sw" style="background:${seaColor(W, x.o)}"></i><b>${esc(x.s)}</b> · ${x.n} of the ${data.munis.length} places</span>`).join('')}
          <span><i class="sw" style="background:rgba(${NC_FILL.slice(0, 3).join(',')},.9);box-shadow:0 0 0 1px rgba(150,170,190,.5)"></i>land that drains nowhere in a median year</span>
          <span><i class="sw" style="background:rgba(0,0,0,.3);box-shadow:0 0 0 1px rgba(255,214,150,.8)"></i>a sub-basin closed in a median year: ${W.closed.map((i) => esc(W.subs[i].name)).join(', ')}</span></div>
        <p class="note">A drop runs from where it lands to the gauge at the outlet of that spot’s drainage area, then gauge to gauge down Agriculture and Agri-Food Canada’s gauge network, along Natural Earth’s river lines where both gauges sit on one and in a straight step where they do not; where the network stops short of the sea it carries on down Natural Earth’s rivers, only along one that drains to the same sea. So the kilometres are a map’s, shorter than the river’s own windings. “Drains nowhere in a median year” is AAFC’s non-contributing area: land that would not send runoff to a stream in a flood with a two-year return period. In a wet spring much of it spills and joins the rivers, which is part of why the south floods some years and dries out in others. The share is worked out here on a 0.01° grid. A gauge’s area is AAFC’s; the lit cells are on a grid of about 3 km, so edges are blocky. Drainage areas, not flood forecasts.</p>
        ${sourceLine(`${W.source} (${W.licence}); ${W.riverSource} (${W.riverLicence})`)}`);
      let shown = '';
      return {
        update({ clock }) {
          const d = st.drop;
          const key = d ? `${d.at.join(',')}|${d.t0}` : '';
          if (key !== shown) {
            shown = key;
            dropBox.innerHTML = d ? dropHTML(W, d) : `<div class="callout" style="--c:${color}">Click anywhere on the map to drop the rain.</div>`;
          }
          if (d) {
            const now = dropAt(d, clock);
            hero(1, `${fmt.int(now.km)} km`, now.f >= 1 ? (d.fate === 'sea' ? `to ${W.systems[d.sys]}` : d.fate === 'edge' ? `to the map’s edge, on to ${W.systems[d.sys]}` : d.fate === 'slough' ? 'it stays where it fell' : 'to a lake with no outlet') : 'downstream so far');
          } else hero(1, '–', 'click the map to follow a drop');
          if (sel.value !== (st.gauge ?? '')) sel.value = st.gauge ?? '';
          const gi = gaugeBox.querySelector<HTMLElement>('.ws-gauge-info')!;
          const gk = st.gauge ?? '';
          if (gi.dataset.k !== gk) { gi.dataset.k = gk; gi.innerHTML = gk ? gaugeHTML(W, gk) : ''; }
        },
      };
    },
    tooltip(info) {
      if (!W) return null;
      const id = info.layer?.id ?? '', o: any = info.object;
      if (!o) return null;
      if (id === 'watersheds-base') { const b = W.basins[o.b]; return `<b>${esc(b.name)}</b> basin<br><span class="tk">drains to</span> <span class="tv">${esc(W.systems[b.sys])}</span><br><span class="tk">Click to follow a raindrop from here</span>`; }
      if (id === 'watersheds-ncbase') return `<b>Drains nowhere in a median year</b><br><span class="tk">water here fills sloughs and soaks in or evaporates</span><br><span class="tk">Click to follow a raindrop from here</span>`;
      if (id === 'watersheds-rivers-base') { const n = W.rivers.names[o.n]; return n ? `<b>${esc(riverName(n))}</b><br><span class="tk">Natural Earth river line · click to follow a raindrop</span>` : `<span class="tk">River (Natural Earth) · click to follow a raindrop</span>`; }
      return null;
    },
  };

  function pickGauge(id: string | null) {
    st.gauge = id;
    const up = id && W ? upstreamImage(W, id) : null;
    if (up && Number.isFinite(up.box[0])) flyTo(up.box);
  }
  return l;
}

function dropHTML(W: Watersheds, d: Drop) {
  const sub = W.subs[d.sub]?.name, basin = W.basins[d.basin]?.name;
  return `<h3>A drop that falls ${d.label === 'here' ? 'here' : `at ${esc(d.label)}`}</h3>
    <p style="margin:0 0 6px">${sub ? `It starts in the <b>${esc(sub)}</b> sub-basin` : 'It starts'}${basin ? ` of the ${esc(basin)} basin` : ''}. ${fateText(W, d)}</p>
    ${d.waters.length > 1 ? `<div class="legend" style="display:flex;flex-wrap:wrap;gap:4px 8px"><span class="tk">On the way:</span>${d.waters.map((w, i) => `<span>${i ? '› ' : ''}${esc(w)}</span>`).join('')}</div>` : ''}
    ${d.basins.length > 1 ? `<p class="note" style="margin-top:4px">Basins it crosses: ${d.basins.map(esc).join(' › ')}</p>` : ''}`;
}

function gaugeHTML(W: Watersheds, id: string) {
  const k = W.gauges[id];
  const s = W.stations[k];
  const up = upstreamImage(W, id);
  if (!s || !up) return '';
  const wet = Math.max(0, s.g - s.e);
  return `<div class="metric-grid" style="margin-top:8px">
      ${metric('Drains', WS_COLOR, `${fmt.int(s.g)} km²`, `gross drainage area (AAFC) · ${fmt.int(s.e)} km² of it contributes in a median year`)}
      ${metric('Gauges upstream', WS_COLOR, fmt.int(up.n - 1), `on AAFC’s network${up.nAll > up.n ? `, and ${fmt.int(up.nAll - up.n)} more whose water reaches it only in a wet year (pale)` : ''}`)}
    </div>
    <p class="note">${esc(s.n)} drains to ${esc(W.systems[s.o])}. ${wet > 0 ? `${fmt.int(wet)} km² of its area (${Math.round((wet / Math.max(1, s.g)) * 100)}%) drains nowhere in a median year (darker).` : ''}</p>`;
}

/** The Town Report's row: where the town's rain goes, and whether its centre drains nowhere in a median year. */
export function watershedRow(data: Data, key: string) {
  const W = data.watersheds, p = placeOf(data, key), m = data.munis.find((x) => x.key === key) ?? data.small.find((x) => x.key === key);
  if (!W || !p || !m) return '';
  const d = journey(W, [m.lon, m.lat], m.name, { start: p.st >= 0 ? p.st : undefined, drainsHere: false });
  const sub = W.subs[p.sb]?.name ?? '', basin = W.basins[p.b]?.name ?? '';
  const where = d?.fate === 'pool' ? `${esc(waterOf(d.end))}` : d?.fate === 'edge' ? `${esc(W.systems[d.sys])}` : `${esc(W.systems[d?.sys ?? p.o])}`;
  const via = d && d.waters.length > 1 ? `via ${d.waters.slice(1, -1).slice(0, 4).map(esc).join(', ')}${d.fate === 'sea' ? ` · about ${fmt.int(d.total)} km` : ''}` : '';
  const head = d?.fate === 'pool' ? `no outlet in a median year (${esc(sub)} area)` : via;
  return `<h3>Watershed</h3>
    <div class="metric-grid">
      ${metric('Rain here ends up in', d ? seaColor(W, d.sys) : WS_COLOR, where, `${esc(sub)} sub-basin of the ${esc(basin)} basin${head ? `<br>${head}` : ''}`)}
      ${metric('Drains nowhere?', WS_COLOR, p.nc ? 'Yes' : 'No', p.nc ? 'its centre sits on land that, in a median year, drains nowhere as AAFC maps it: water fills sloughs and soaks in or evaporates (regional mapping: town storm sewers are not in it)' : 'its centre drains to a stream in a median year, as AAFC maps it')}
    </div>
    <div class="tr-falls" style="margin-top:8px"><button class="tr-fall" data-ws-drop="${esc(key)}" type="button">💧 Follow a raindrop from ${esc(m.name)} ›</button>${link('watersheds', '💧 Watersheds on the map')}</div>`;
}

/** The small-community report's row (the same, in its own tile style). */
export function watershedSmallRow(data: Data, key: string) {
  const W = data.watersheds, p = placeOf(data, key), m = data.small.find((x) => x.key === key);
  if (!W || !p || !m) return '';
  const d = journey(W, [m.lon, m.lat], m.name, { start: p.st >= 0 ? p.st : undefined, drainsHere: false });
  const sub = W.subs[p.sb]?.name ?? '';
  const v = d?.fate === 'pool' ? esc(waterOf(d.end)) : esc(W.systems[d?.sys ?? p.o]);
  return `<div class="metric"><div class="mk">Rain here ends up in</div><div class="mv">${v}</div><div class="ms">${esc(sub)} sub-basin${d?.fate === 'pool' ? ' · no outlet in a median year' : ''}${p.nc ? ' · its centre drains nowhere in a median year' : ''} (AAFC)</div></div>`;
}
