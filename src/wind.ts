// The air in motion: two live chips shared by Smoke & air and Wildfires, drawn at the
// timeline's Now stop. **Wind**: ECCC's RDPS 10 m wind for the current forecast hour (`now/wind.json`) as drifting
// trails (src/particles.ts), or still arrows for a visitor who prefers reduced motion. **Smoke forecast**: ECCC's
// FireWork (RAQDPS-FW) surface PM2.5 from wildfire smoke, every third hour to the end of the run (`now/plume.json`),
// as a brown tint with a scrubber that plays by itself. Both are model forecasts: each shows its run and valid time and
// is dropped when that time has passed. The trails count nothing; the smoke is PM2.5 from fires only, never the AQHI or
// a smoke-day count. Neither feeds the Town Finder, and both are hidden with `?film`.
import * as d3 from 'd3';
import { BitmapLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import type { AirGrid, Data, Hotspot, NowPlume, NowWind } from './data';
import { esc } from './html';
import type { Ctx } from './layer-kit';
import { NO_DEPTH } from './layer-kit';
import { drawable, nowBlock, skTime } from './now';
import { Arrow, BRIGHT_MS, Field, Particles, arrowPaths, createParticles, reducedMotion, windAt } from './particles';

export const WIND_COLOR = '#9ad8ff';
export const PLUME_COLOR = '#c79a63';
/** The wind is not drawn once the hour it was forecast for is this many hours past. */
export const WIND_DROP_H = 3;
/** The scrubber moves on a frame this often while it plays, and rests this long on the last one. */
const FRAME_MS = 750, LAST_MS = 2200;

// `frame` indexes plumeFrames(), which drops frames as they pass: `frameT` (the frame's time) is what is shown, and the
// index is found again from it (`frameAt`), so the map, the tooltip and the panel always describe the same frame
const st = { wind: false, plume: false, frame: 0, frameT: null as string | null, playing: true, stepped: 0 };
/** Which chips are on (for a caller that draws something to go with them). */
export const airOn = () => ({ wind: st.wind, plume: st.plume });

// ---- wind

export const windLive = (w: NowWind | null | undefined): boolean => !!w && drawable(w.asOf) && (Date.now() - Date.parse(w.valid)) / 36e5 < WIND_DROP_H;
let field: { of: NowWind; f: Field; arrows: Arrow[] | null; parts: Particles | null } | null = null;
function fieldOf(w: NowWind) {
  if (field?.of !== w) field = { of: w, f: { g: w.grid, u: Float32Array.from(w.u, (x) => x * w.scale), v: Float32Array.from(w.v, (x) => x * w.scale) }, arrows: null, parts: null };
  return field;
}
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
/** The compass point a wind blows from. */
export const windFrom = (u: number, v: number) => COMPASS[Math.round((((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360) / 45) % 8];
const kmh = (ms: number) => Math.round(ms * 3.6);

// ---- smoke forecast

/** The frames not yet wholly past, in order (a frame stands for the hours until the next). */
export function plumeFrames(p: NowPlume | null | undefined) {
  if (!p || !drawable(p.asOf)) return [];
  const now = Date.now();
  return p.frames.filter((f) => Date.parse(f.t) + p.everyH * 36e5 > now);
}
/** The frame on show among `frames` (its index), kept by its time: a frame that has passed gives way to the next. */
function frameAt(frames: NowPlume['frames']) {
  if (!frames.length) return -1;
  let i = st.frameT == null ? -1 : frames.findIndex((f) => f.t === st.frameT);
  if (i < 0) { const t = st.frameT == null ? NaN : Date.parse(st.frameT); i = Math.max(0, frames.findIndex((f) => Date.parse(f.t) > t)); }
  st.frame = i;
  st.frameT = frames[i].t;
  return i;
}
/** Shows frame `i` of `frames`. */
const setFrame = (frames: NowPlume['frames'], i: number) => { st.frame = Math.max(0, Math.min(frames.length - 1, i)); st.frameT = frames[st.frame]?.t ?? null; };
const decoded = new WeakMap<object, Float32Array>();
/** A frame's values in µg/m³ at the grid's nodes. */
function plumeValues(p: NowPlume, f: NowPlume['frames'][number]) {
  let v = decoded.get(f);
  if (v) return v;
  v = new Float32Array(p.grid.nx * p.grid.ny);
  let bytes = '';
  try { bytes = atob(f.d); } catch { /* an unreadable frame draws as no smoke */ }
  for (let i = 0, k = 0; i < bytes.length && k < v.length; i++) {
    const q = bytes.charCodeAt(i);
    if (q) v[k++] = (q / 10) ** 2;
    else k += bytes.charCodeAt(++i) || 0;
  }
  decoded.set(f, v);
  return v;
}
function gridAt(g: AirGrid, v: Float32Array, lon: number, lat: number): number | null {
  const x = (lon - g.w) / g.step, y = (lat - g.s) / g.step;
  if (!(x >= 0 && y >= 0 && x <= g.nx - 1 && y <= g.ny - 1)) return null;
  const x0 = Math.min(g.nx - 2, Math.floor(x)), y0 = Math.min(g.ny - 2, Math.floor(y));
  const fx = x - x0, fy = y - y0, i = y0 * g.nx + x0;
  return (v[i] * (1 - fx) + v[i + 1] * fx) * (1 - fy) + (v[i + g.nx] * (1 - fx) + v[i + g.nx + 1] * fx) * fy;
}
const gridBounds = (g: AirGrid): [number, number, number, number] => [g.w, g.s, g.w + (g.nx - 1) * g.step, g.s + (g.ny - 1) * g.step];

/** Smoke's tint: pale tan through brown, by µg/m³. */
export const plumeRamp = d3.scaleLinear<string>().domain([0, 25, 100, 400]).range(['#e6d3b3', '#c79a63', '#96602f', '#5c3a26']).clamp(true);
/** How strongly a value is painted (0–1): its square root, eased in under 1 µg/m³ so a trace draws nothing. */
export const plumeAlpha = (ug: number) => Math.min(1, Math.sqrt(Math.max(0, ug) / 150)) * Math.min(1, Math.max(0, ug - 0.3) / 0.7) * 0.88;
const images = new WeakMap<object, ImageData>();
/** A frame as a picture for a BitmapLayer over the grid, rows spaced in Web Mercator so it lies true on the map. */
function plumeImage(p: NowPlume, f: NowPlume['frames'][number]) {
  let img = images.get(f);
  if (img) return img;
  const g = p.grid, v = plumeValues(p, f), [w, so, e, no] = gridBounds(g);
  const R = Math.PI / 180, merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * R) / 2));
  const W = (g.nx - 1) * 6, yS = merc(so), yN = merc(no);
  const H = Math.round((W * (yN - yS)) / ((e - w) * R));
  img = new ImageData(W, H);
  if (f.max >= 0.3)
    for (let j = 0; j < H; j++) {
      const lat = (2 * Math.atan(Math.exp(yN - ((j + 0.5) / H) * (yN - yS))) - Math.PI / 2) / R;
      for (let i = 0; i < W; i++) {
        const lon = w + ((i + 0.5) / W) * (e - w);
        const ug = gridAt(g, v, lon, lat) ?? 0;
        const a = plumeAlpha(ug);
        if (a <= 0) continue;
        // fade out over the grid's last degree, so the picture has no hard edge on the map
        const edge = Math.min(1, Math.max(0, Math.min(lon - w, e - lon, lat - so, no - lat)));
        const c = d3.rgb(plumeRamp(ug)), o = (j * W + i) * 4;
        img.data[o] = c.r; img.data[o + 1] = c.g; img.data[o + 2] = c.b; img.data[o + 3] = Math.round(a * edge * 255);
      }
    }
  images.set(f, img);
  return img;
}
const ugText = (v: number) => (v < 1 ? 'under 1 µg/m³' : `${v < 10 ? v.toFixed(1) : Math.round(v)} µg/m³`);
/** "now", "+6 h": how far ahead of the clock a frame is. */
const ahead = (t: string) => { const h = Math.round((Date.parse(t) - Date.now()) / 36e5); return h <= 0 ? 'now' : `+${h} h`; };

// ---- the map

let turn = { clock: -1, owner: '' };
let lastClock = 0;
/**
 * The chips' deck layers for one atlas layer (`owner`, its id; the layer's `now.build` calls this, so they draw only at
 * Now). When two layers ask in the same frame, only the first draws.
 */
export function airLayers(owner: string, ctx: Ctx): Layer[] {
  const nw = ctx.data.now;
  if (nw.skipped || (!st.wind && !st.plume)) return [];
  if (turn.clock === ctx.clock && turn.owner !== owner) return [];
  turn = { clock: ctx.clock, owner };
  const out: Layer[] = [];
  const frames = st.plume ? plumeFrames(nw.plume) : [];
  if (frames.length) {
    const still = reducedMotion();
    frameAt(frames);
    if (st.playing && !still && ctx.clock - st.stepped > (st.frame >= frames.length - 1 ? LAST_MS : FRAME_MS)) {
      setFrame(frames, (st.frame + 1) % frames.length);
      st.stepped = ctx.clock;
    }
    const f = frames[st.frame];
    out.push(new BitmapLayer({
      id: `${owner}-air-plume-base`, image: plumeImage(nw.plume!, f), bounds: gridBounds(nw.plume!.grid), pickable: true,
      parameters: NO_DEPTH, textureParameters: { minFilter: 'linear', magFilter: 'linear' },
    } as any));
  }
  if (st.wind && windLive(nw.wind)) {
    const fd = fieldOf(nw.wind!);
    // Smoke & air has no fires of its own: the satellite hotspots sit under the wind, so it is plain where smoke would go
    if (owner !== 'fires' && nw.fires && drawable(nw.fires.asOf) && nw.fires.hotspots.length)
      out.push(new ScatterplotLayer<Hotspot>({
        id: `${owner}-air-hot-base`, data: nw.fires.hotspots, getPosition: (h) => [h[0], h[1]],
        getRadius: 3500, radiusMinPixels: 3, radiusMaxPixels: 9, getFillColor: [255, 138, 61, 230],
        stroked: true, getLineColor: [40, 14, 6, 230], lineWidthMinPixels: 1, parameters: NO_DEPTH,
      } as any));
    if (reducedMotion()) {
      fd.arrows ??= arrowPaths(fd.f);
      out.push(new PathLayer<Arrow>({
        id: `${owner}-air-arrows`, data: fd.arrows, getPath: (a) => a.path,
        getColor: (a) => [200, 228, 255, Math.round(110 + 145 * Math.min(1, a.s / BRIGHT_MS))],
        getWidth: 1.6, widthUnits: 'pixels', capRounded: true, jointRounded: true, parameters: { depthCompare: 'always' },
      } as any));
    } else {
      fd.parts ??= createParticles(fd.f);
      // a long gap (the layer was off, the tab hidden) is not caught up on
      const dt = Math.min(0.05, Math.max(0, (ctx.clock - lastClock) / 1000));
      fd.parts.step(dt, ctx.view.zoom, ctx.view.box);
      out.push(new PathLayer({
        id: `${owner}-air-wind`, data: fd.parts.data(), _pathType: 'open',
        getWidth: 1.8, widthUnits: 'pixels', capRounded: true, parameters: { depthCompare: 'always' },
      } as any));
    }
    lastClock = ctx.clock;
  }
  return out;
}

/** The tooltip over the smoke picture; `undefined` when the thing under the pointer is not one of the chips' layers. */
export function airTooltip(info: PickingInfo, data: Data): string | null | undefined {
  if (!info.layer?.id.endsWith('-air-plume-base')) return undefined;
  const fs = plumeFrames(data.now.plume), p = data.now.plume, f = fs[frameAt(fs)];
  const [lon, lat] = (info.coordinate ?? []) as number[];
  if (!p || !f || lon == null || lat == null) return null;
  const v = gridAt(p.grid, plumeValues(p, f), lon, lat);
  // where nothing is tinted there is nothing to point at (and a click there opens nothing)
  if (v == null || plumeAlpha(v) <= 0) return null;
  return `<b>Wildfire smoke forecast</b> <span class="tk">${Math.abs(lat).toFixed(1)}°N ${Math.abs(lon).toFixed(1)}°W</span><br><span class="tk">Fine particles from fires</span> <span class="tv">${ugText(v)}</span><br><span class="tk">For</span> <span class="tv">${esc(skTime(f.t))} (${ahead(f.t)})</span><br><span class="tk">Model run</span> <span class="tv">${esc(skTime(p.run))}</span>`;
}

// ---- the panel

/**
 * The two chips and, under them, a Right now block for each that is on. `id` is the atlas layer the panel belongs to;
 * `atNow` says whether a timeline time is its Now stop (the only place the chips draw). Returns the panel's update.
 */
export function airPanel(host: HTMLElement, data: Data, opts: { id: string; atNow: (t: number) => boolean }): { update: (ctx: Ctx) => void } {
  if (data.now.skipped) return { update() {} };
  const W = data.now.wind, P = data.now.plume;
  host.insertAdjacentHTML('beforeend', `<div class="air-live">
    <div class="chips"><button class="chip" data-air="wind" style="--c:${WIND_COLOR}" title="The wind right now, as drifting trails">● Wind</button><button class="chip" data-air="plume" style="--c:${PLUME_COLOR}" title="Where wildfire smoke is forecast to drift over the next three days">● Smoke forecast</button></div>
    <div class="air-body"></div>
    <p class="note air-away" hidden>The wind and the smoke forecast are drawn at the timeline’s <b>Now</b> stop.</p>
  </div>`);
  const body = host.querySelector<HTMLElement>('.air-body')!, away = host.querySelector<HTMLElement>('.air-away')!;
  const places = data.munis;
  let time = NaN, shown: string | null = null, shownN = -1, shownPlay: boolean | null = null, shownStill: boolean | null = null;

  const windBlock = () => {
    if (!st.wind) return '';
    let text = '';
    if (W && windLive(W)) {
      const f = fieldOf(W).f, w: [number, number] = [0, 0];
      const at = places.map((m) => (windAt(f, m.lon, m.lat, w) ? { m, u: w[0], v: w[1], s: Math.hypot(w[0], w[1]) } : null)).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.s - a.s);
      const top = at[0], mid = at[Math.floor(at.length / 2)];
      text = `<p>The wind ${W.height} m above the ground in Environment Canada’s ${esc(W.model)} model: its forecast for <b>${esc(skTime(W.valid))}</b> Saskatchewan time, from the model run of ${esc(skTime(W.run))} (a new run every 6 hours).</p>
        ${top ? `<p>Strongest at the atlas’s places: <b>${kmh(top.s)} km/h</b> from the ${windFrom(top.u, top.v)} at ${esc(top.m.name)}; the middle place has ${kmh(mid.s)} km/h.</p>` : ''}
        <p class="tk">${reducedMotion() ? 'Your device asks for reduced motion, so still arrows are drawn: each points where the wind blows to, longer and brighter where it is stronger.' : 'The trails drift where the wind blows, faster and brighter where it is stronger.'} They show its direction and speed and count nothing. A model’s forecast for that hour, not a measurement${opts.id === 'fires' ? '' : '; the orange dots are satellite hotspots of the last 24 hours, not confirmed fires'}.</p>`;
    } else if (W) text = `<p class="now-old">The last wind forecast here was for ${esc(skTime(W.valid))}, which is more than ${WIND_DROP_H} hours ago, so no wind is drawn. The hourly refresh may have stopped.</p>`;
    return nowBlock({ color: WIND_COLOR, asOf: W?.asOf ?? null, body: text, source: W?.source ?? '', sourceUrl: W?.sourceUrl, missing: 'This copy of the data has no wind forecast.' });
  };
  const plumeBlock = () => {
    if (!st.plume) return '';
    const frames = plumeFrames(P);
    let text = '';
    if (P && frames.length) {
      const peak = frames.reduce((b, f) => (f.max > b.max ? f : b));
      text = `<p>Fine particles (PM2.5) from wildfire smoke at the surface, forecast by Environment Canada’s FireWork model (${esc(P.model)}), model run of <b>${esc(skTime(P.run))}</b> Saskatchewan time, shown every ${P.everyH} hours until ${esc(skTime(frames.at(-1)!.t))} (a new run every 12 hours).</p>
        <div class="air-scrub"><button class="air-play" type="button" aria-label="Play or pause the forecast"></button><input type="range" min="0" max="${frames.length - 1}" step="1" value="${Math.max(0, frameAt(frames))}" aria-label="Forecast hour"><span class="air-when"></span></div>
        <p class="air-stat"></p>
        <div class="ramp" style="background:linear-gradient(90deg,${[0.3, 1, 5, 25, 100, 400].map((v, i, a) => `${d3.color(plumeRamp(v))!.copy({ opacity: plumeAlpha(v) })} ${(i / (a.length - 1)) * 100}%`).join(',')}),#0b1220"></div>
        <div class="ramp-labels"><span>0</span><span>1</span><span>5</span><span>25</span><span>100</span><span>400+ µg/m³</span></div>
        <p class="tk">${peak.max < 1 ? 'The model has no smoke above 1 µg/m³ anywhere on its map in these hours, so nothing is tinted. ' : ''}A model’s forecast, not a reading. It is the smoke from fires alone: not the AQHI (an index of three pollutants) and not the smoke-day count on this layer’s columns.</p>`;
    } else if (P) text = `<p class="now-old">The last smoke forecast here ran to ${esc(skTime(P.frames.at(-1)!.t))} and that time has passed, so nothing is drawn. The hourly refresh may have stopped.</p>`;
    return nowBlock({ color: PLUME_COLOR, asOf: P?.asOf ?? null, body: text, source: P?.source ?? '', sourceUrl: P?.sourceUrl, missing: 'This copy of the data has no smoke forecast.' });
  };
  /** the scrubber's own line and the play button, which change with every frame */
  const syncFrame = () => {
    const frames = plumeFrames(P), scrub = body.querySelector<HTMLInputElement>('.air-scrub input');
    // a frame passed since the block was built (the list is shorter, or empty): build it again for the new list
    if (st.plume && P && scrub && frames.length !== shownN && shownN >= 0) { draw(); return; }
    if (!scrub || !P || !frames.length) return;
    const still = reducedMotion();
    frameAt(frames);
    if (shown === st.frameT && shownN === frames.length && shownPlay === st.playing && shownStill === still) return;
    shown = st.frameT; shownN = frames.length; shownPlay = st.playing; shownStill = still;
    const f = frames[st.frame];
    scrub.value = String(st.frame);
    scrub.style.setProperty('--p', `${(st.frame / Math.max(1, frames.length - 1)) * 100}%`);
    body.querySelector('.air-when')!.textContent = `${skTime(f.t)} · ${ahead(f.t)}`;
    const btn = body.querySelector<HTMLButtonElement>('.air-play')!;
    btn.textContent = st.playing && !still ? '❚❚' : '▶';
    btn.disabled = still;
    btn.title = still ? 'Your device asks for reduced motion: drag the slider instead' : st.playing ? 'Pause' : 'Play';
    const v = plumeValues(P, f), w = places.map((m) => ({ m, v: gridAt(P.grid, v, m.lon, m.lat) ?? 0 })).sort((a, b) => b.v - a.v)[0];
    body.querySelector('.air-stat')!.innerHTML = `Highest on the map at this hour: <b>${ugText(f.max)}</b>${w && w.v >= 1 ? `; at the atlas’s places, ${ugText(w.v)} at ${esc(w.m.name)}` : '; under 1 µg/m³ at every one of the atlas’s places'}.`;
  };
  const draw = () => {
    body.innerHTML = plumeBlock() + windBlock();
    host.querySelectorAll<HTMLElement>('[data-air]').forEach((b) => b.classList.toggle('on', st[b.dataset.air as 'wind' | 'plume']));
    shown = null; shownN = -1;
    syncFrame();
  };
  host.querySelector('.air-live .chips')!.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>('[data-air]')?.dataset.air as 'wind' | 'plume' | undefined;
    if (!k) return;
    st[k] = !st[k];
    if (k === 'plume' && st.plume) { setFrame(plumeFrames(P), 0); st.playing = true; st.stepped = performance.now(); }
    // the chips draw at Now only: turning one on from elsewhere on the timeline goes there (which rebuilds this panel)
    if (st[k] && !opts.atNow(time)) window.dispatchEvent(new CustomEvent('atlas:layer', { detail: opts.id }));
    else draw();
  });
  body.addEventListener('input', (e) => {
    if (!(e.target as HTMLElement).matches('.air-scrub input')) return;
    setFrame(plumeFrames(P), +(e.target as HTMLInputElement).value);
    st.playing = false;
    syncFrame();
  });
  body.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.air-play')) return;
    st.playing = !st.playing;
    st.stepped = performance.now();
    syncFrame();
  });
  draw();
  return {
    update(ctx) {
      time = ctx.time;
      away.hidden = !(st.wind || st.plume) || opts.atNow(time);
      syncFrame();
    },
  };
}
