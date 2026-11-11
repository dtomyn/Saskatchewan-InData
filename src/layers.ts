// Each 'atlas layer' bundles: deck.gl layers for a moment in time, a timeline sparkline,
// notable events, a story panel, and map tooltips.
import * as d3 from 'd3';
import { ColumnLayer, LineLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { DataFilterExtension, PathStyleExtension } from '@deck.gl/extensions';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Data, Facility, FirePoint, MONTHS, Muni, NormalsStation, Trip, fmt, interpYearly, km, lowerBound } from './data';
import { barChart, lineChart, rampCSS, scatterChart, stripes, ChartHandle } from './charts';
import { NormalVar, provinceAnomalies, slope, townMetrics } from './metrics';
import { tornadoLayer } from './tornado';
import { justiceLayer } from './justice';
import { treatiesLayer } from './treaties';
import { campingLayer } from './camping';
import { esc } from './html';


/** `hovered` is the municipality key under the pointer (town pin or column), if any. */
export type Ctx = { time: number; speed: number; data: Data; selected: string | null; hovered: string | null; focusedId: string; clock: number };
/**
 * A moment on the timeline. Only `t`, `layer` ('*' for island-wide), `title` and `body` are required; everything else
 * deepens the event's own view in the side panel (src/events.ts), so an event can be given more detail later without
 * touching the panel. Text fields are plain text (escaped when shown); only `detail` can draw HTML or charts.
 */
export type AtlasEvent = {
  /** when it happened; left out for a place or thing on the map (a river gauge, a station, a hospital) */
  t?: number;
  layer: string; title: string; body: string;
  /** what it is, shown above the title ("River gauge", "Earthquake"); defaults to the layer's name */
  kind?: string;
  /** where the map flies when the event opens */
  lon?: number; lat?: number; zoom?: number;
  /** when it ended, for events that ran a while (a fire season, a closure) */
  end?: number;
  /** headline numbers, shown as tiles */
  stats?: { v: string; l: string }[];
  /** further reading inside the panel: a heading and paragraphs */
  sections?: { title: string; text: string }[];
  /** a photo (http(s) only) with its credit */
  image?: { src: string; credit: string; href?: string };
  /** where to read more */
  sources?: { label: string; url: string }[];
  /** layers that tell this story; "Show it on the map" switches them on (defaults to the event's own layer) */
  layers?: string[];
  /** anything richer a layer wants to draw in the event's panel (a chart, a table), below the headline numbers */
  detail?: (el: HTMLElement) => void;
};
/** A timeline event: one with a date. Layers' events() and CURATED_EVENTS are always these. */
export type TimedEvent = AtlasEvent & { t: number };
export type PanelHandle = { update: (ctx: Ctx) => void };

export interface AtlasLayer {
  id: string;
  name: string;
  icon: string;
  color: string;
  range: [number, number];
  monthly?: boolean;
  /**
   * Doesn't change over time (hospitals, hazard zones, 30-year normals). When focused, the timeline
   * dims and keeps the last time-based layer's range and time, so other visible layers keep animating.
   * `build` should ignore `ctx.time`; `spark` and `events` may return [].
   */
  static?: boolean;
  /** Rail caption for a static layer instead of the year range, e.g. "1981–2010 average". */
  period?: string;
  available: boolean;
  unavailable?: string;
  build: (ctx: Ctx) => Layer[];
  spark: () => { x: number; y: number; color?: string }[];
  events: () => TimedEvent[];
  /**
   * What clicking a feature of this layer on the map opens in the side panel (a quake, a gauge, a station), in the
   * same shape as an event. Optional: a layer without it still gets a panel, built from its tooltip.
   */
  describe?: (info: PickingInfo) => AtlasEvent | null;
  panel: (el: HTMLElement, ctx: Ctx) => PanelHandle;
  tooltip: (info: PickingInfo) => string | null;
  /** Handles a click on one of its own map objects; true if it did. */
  click?: (info: PickingInfo) => boolean;
}

// ---------------------------------------------------------------------------------------------
// shared bits

export type RGBA = [number, number, number, number];
export const rgb = (c: string, a = 255): RGBA => {
  const o = d3.rgb(c);
  return [o.r, o.g, o.b, a];
};
export const ADDITIVE = { blend: true, blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one', blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha', depthWriteEnabled: false } as const;
export const NO_DEPTH = { depthWriteEnabled: false, depthCompare: 'always' } as const;
export const filterExt = [new DataFilterExtension({ filterSize: 1 })];

/** How long (in timeline years) a "new" event keeps glowing; tied to playback speed so it reads the same at any speed. */
export const glowWindow = (speed: number, k = 1) => Math.max(0.25, speed * 0.9 * k);

/** A fractional year (2021.49) as a date, "2021-06-28". */
export const isoDate = (t: number) => new Date(Date.UTC(Math.floor(t), 0, 1) + (t % 1) * 365.25 * 864e5).toISOString().slice(0, 10);
/** A detail chart for a map feature's panel: a heading and a bar chart, drawn once the panel has its width. */
export function detailBars(title: string, data: { x: number; y: number; color?: string }[], color: string, yFormat: (v: number) => string, tip: (d: { x: number; y: number }) => string) {
  return (el: HTMLElement) => {
    if (!data.length) return;
    el.insertAdjacentHTML('beforeend', `<h3>${esc(title)}</h3>`);
    const box = el.appendChild(document.createElement('div'));
    box.className = 'ev-chart';
    const xs = data.map((d) => d.x);
    requestAnimationFrame(() => barChart(box, { data, xDomain: [Math.min(...xs), Math.max(...xs)], color, height: 120, yFormat, tooltip: tip, diverging: data.some((d) => d.y < 0) }));
  };
}

export function nearestTown(munis: Muni[], lon: number, lat: number) {
  let best = munis[0], bd = Infinity;
  for (const m of munis) {
    const d = km(lon, lat, m.lon, m.lat);
    if (d < bd) { bd = d; best = m; }
  }
  return { town: best, km: bd };
}

export const kicker = (l: AtlasLayer, text: string) => `<div class="kicker" style="--c:${l.color}">${text}</div>`;
export const sourceLine = (s: string) => `<div class="source">Source: ${esc(s)}</div>`;
export const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

export function heroStats(el: HTMLElement, n: number) {
  const wrap = mk('div', 'hero');
  const cells = Array.from({ length: n }, () => {
    const s = mk('div', 'stat', '<div class="v">–</div><div class="l"></div>');
    wrap.appendChild(s);
    return { v: s.querySelector('.v') as HTMLElement, l: s.querySelector('.l') as HTMLElement };
  });
  el.appendChild(wrap);
  return (i: number, v: string, l: string) => {
    if (cells[i].v.textContent !== v) cells[i].v.textContent = v;
    if (cells[i].l.textContent !== l) cells[i].l.textContent = l;
  };
}

/** Builds charts after the panel is in the DOM (they need a measured width). */
export function deferChart(el: HTMLElement, make: (el: HTMLElement) => ChartHandle) {
  let h: ChartHandle | null = null;
  requestAnimationFrame(() => (h = make(el)));
  return (t: number) => h?.setPlayhead(t);
}

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// WILDFIRES — the Canadian National Fire Database's start points. Saskatchewan maps no open perimeters for every
// fire, so each fire's scar is drawn as a circle with the same area as the fire: the burned country is to scale.

function firesLayer(data: Data): AtlasLayer {
  const color = '#ff8a3d';
  const fires = data.fires;
  const points: FirePoint[] = fires?.points ?? [];
  const CAUSE = [
    { name: 'Lightning', c: '#ffe08a' },
    { name: 'Human', c: '#ff6a3d' },
    { name: 'Unknown', c: '#ffb36b' },
  ];
  const causeRGB = CAUSE.map((c) => rgb(c.c));
  const radiusM = (ha: number) => Math.sqrt((ha * 10000) / Math.PI);

  const countByYear: Record<number, number> = {};
  const haByYear: Record<number, number> = {};
  const causeByYear: Record<number, number[]> = {};
  for (const p of points) {
    const y = Math.floor(p[2]);
    countByYear[y] = (countByYear[y] ?? 0) + 1;
    haByYear[y] = (haByYear[y] ?? 0) + p[3];
    (causeByYear[y] ??= [0, 0, 0])[p[4]]++;
  }
  const y0 = Math.floor(points[0]?.[2] ?? 1959);
  const y1 = Math.floor(points.at(-1)?.[2] ?? 2025);
  const bySize = [...points].sort((a, b) => b[3] - a[3]);
  const rankOf = new Map(bySize.map((p, i) => [p, i + 1]));
  const fireName = (p: FirePoint) => (p[5] ? `the ${p[5].replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())} fire` : null);

  const l: AtlasLayer = {
    id: 'fires',
    name: 'Wildfires',
    icon: '🔥',
    color,
    range: [y0, y1 + 0.99],
    available: points.length > 0,
    unavailable: 'The Canadian National Fire Database could not be downloaded when this copy of the data was built. Run <code>npm run data fires</code>, then reload.',
    build({ time, speed }) {
      const W = glowWindow(speed);
      const plo = lowerBound(points, time - W, (p) => p[2]);
      const phi = lowerBound(points, time, (p) => p[2]);
      const flashing = points.slice(plo, phi);
      return [
        new ScatterplotLayer<FirePoint>({
          id: 'fires-scars',
          data: points,
          getPosition: (d) => [d[0], d[1]],
          getRadius: (d) => radiusM(d[3]),
          radiusMinPixels: 0.6,
          getFillColor: (d) => (d[3] >= 1000 ? [150, 40, 18, 70] : [255, 140, 70, 60]),
          extensions: filterExt,
          getFilterValue: (d) => d[2],
          filterRange: [1800, time],
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<FirePoint>({
          id: 'fires-flash',
          data: flashing,
          getPosition: (d) => [d[0], d[1]],
          getRadius: (d) => {
            const a = (time - d[2]) / W;
            return (2500 + radiusM(d[3]) * 1.2) * (0.4 + a * 1.2);
          },
          radiusMinPixels: 2,
          getFillColor: (d) => {
            const a = (time - d[2]) / W;
            const c = causeRGB[d[4]];
            return [c[0], c[1], c[2], 255 * (1 - a) ** 1.5] as RGBA;
          },
          updateTriggers: { getRadius: time, getFillColor: time },
          parameters: ADDITIVE,
        }),
      ];
    },
    spark: () => d3.range(y0, y1 + 1).map((x) => ({ x, y: haByYear[x] ?? 0 })),
    events() {
      return points.filter((p) => p[3] >= 100000).map((p) => {
        const { town, km: d } = nearestTown(data.munis, p[0], p[1]);
        const nmd = fireName(p);
        return {
          t: p[2], layer: 'fires', lon: p[0], lat: p[1], zoom: 7.5,
          title: `${fmt.ha(p[3])} wildfire ${d < 15 ? 'at' : 'near'} ${town.name}`,
          body: `${nmd ? `${nmd[0].toUpperCase()}${nmd.slice(1)}, a` : 'A'} ${CAUSE[p[4]].name.toLowerCase()}-caused fire${d >= 15 ? ` about ${Math.round(d)} km from ${town.name}` : ''}: one of the largest in the provincial record.`,
          stats: [{ v: fmt.ha(p[3]), l: 'burned' }, { v: CAUSE[p[4]].name, l: 'cause' }, { v: `#${rankOf.get(p)}`, l: `largest of ${fmt.int(points.length)} recorded fires` }],
        };
      });
    },
    panel(el) {
      el.innerHTML = `${kicker(l, `Wildfire history · ${y0} → ${y1}`)}
        <h2>Where Saskatchewan burns</h2>
        <p class="lede">Every fire the province and Parks Canada reported since ${y0}, at the point it started. New fires flare; each then leaves a scar drawn as a circle the size of the area it burned. Almost all of the burning is in the boreal north, and most of it is started by lightning.</p>`;
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Area burned per year</h3>`);
      const set = deferChart(el.appendChild(mk('div')), (c) =>
        barChart(c, { data: l.spark(), xDomain: [y0, y1], color, height: 130, yFormat: (v) => d3.format('~s')(v), tooltip: (d) => `<b>${d.x}</b><br>${fmt.ha(d.y)} burned<br>${fmt.int(countByYear[d.x] ?? 0)} fires` }),
      );
      const top = Object.entries(haByYear).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const north = points.filter((p) => p[1] >= 54).reduce((a, p) => a + p[3], 0) / (points.reduce((a, p) => a + p[3], 0) || 1);
      el.insertAdjacentHTML('beforeend', `
        <div class="callout" style="--c:${color}">Worst years on record: ${top.map(([y, v]) => `<b>${y}</b> (${fmt.ha(v)})`).join(', ')}. ${Math.round(north * 100)}% of all the area burned since ${y0} lies north of 54° N.</div>
        <h3>Cause</h3>
        <div class="legend">${CAUSE.map((c) => `<span><i class="sw" style="background:${c.c}"></i>${c.name}</span>`).join('')}</div>
        <p class="note">A circle shows how much ground a fire burned, not its real shape. Older records are less complete, especially for small fires, and much of the far north is an observation zone where fires are watched rather than fought. Prescribed burns are left out.</p>
        ${sourceLine(fires?.source ?? '')}`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          const cz = causeByYear[y] ?? [0, 0, 0];
          hero(0, fmt.int(countByYear[y] ?? 0), `fires in ${y}`);
          hero(1, fmt.ha(haByYear[y] ?? 0), `burned in ${y}`);
          const tot = cz[0] + cz[1] + cz[2];
          hero(2, tot ? `${Math.round((cz[0] / tot) * 100)}%` : '–', `started by lightning in ${y}`);
          let cum = 0;
          for (const [yy, v] of Object.entries(haByYear)) if (+yy <= y) cum += v;
          hero(3, fmt.ha(cum), `burned since ${y0}`);
          set(time);
        },
      };
    },
    describe(info) {
      const o = info.object as FirePoint;
      if (!Array.isArray(o)) return null;
      const [lon, lat, t, ha, cause] = o;
      const { town, km: d } = nearestTown(data.munis, lon, lat);
      const nmd = fireName(o);
      return {
        t, layer: 'fires', kind: 'Wildfire', lon, lat, zoom: ha > 10000 ? 8 : 9.5,
        title: `${ha < 1 ? 'A spot fire' : `A ${fmt.ha(ha)} fire`} ${d < 5 ? 'at' : 'near'} ${town.name}`,
        body: `${nmd ? `Named ${nmd.replace(/^the /, '')}. ` : ''}Where a reported fire started${d >= 5 ? `, about ${Math.round(d)} km from ${town.name}` : ''}.`,
        stats: [{ v: isoDate(t), l: 'reported' }, { v: ha < 1 ? 'under 1 ha' : fmt.ha(ha), l: 'final size' }, { v: CAUSE[cause].name, l: 'cause' }, { v: `#${fmt.int(rankOf.get(o) ?? 0)}`, l: `by size, of ${fmt.int(points.length)}` }],
        sources: [{ label: 'Canadian National Fire Database (CWFIS)', url: 'https://cwfis.cfs.nrcan.gc.ca/ha/nfdb' }],
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!Array.isArray(o)) return null;
      return `<b>${o[5] ? `${esc(o[5])} fire` : 'Wildfire'}</b><br><span class="tk">Reported</span> <span class="tv">${isoDate(o[2])}</span><br><span class="tk">Burned</span> <span class="tv">${o[3] < 1 ? '<1 ha' : fmt.ha(o[3])}</span><br><span class="tk">Cause</span> ${CAUSE[o[4]].name}`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// RIVER FLOODS

function riversLayer(data: Data): AtlasLayer {
  const color = '#4cc9f0';
  const stations = data.rivers?.stations ?? [];
  const ratio = (s: (typeof stations)[number], y: number) => (s.peaks[y] != null ? s.peaks[y] / s.median : null);
  const ratioColor = d3.scaleLinear<string>().domain([0.4, 1, 1.5, 2.5]).range(['#123a5c', '#1f78b4', '#4cc9f0', '#f1fbff']).clamp(true);
  const years = new Set<number>();
  for (const s of stations) for (const y of Object.keys(s.peaks)) years.add(+y);
  const ys = [...years].sort((a, b) => a - b);
  const share: Record<number, { n: number; high: number }> = {};
  for (const y of ys) {
    let n = 0, high = 0;
    for (const s of stations) { const r = ratio(s, y); if (r != null) { n++; if (r >= 1.5) high++; } }
    share[y] = { n, high };
  }
  const y0 = ys.find((y) => share[y].n >= 3) ?? 1914;
  const y1 = ys.at(-1) ?? 2024;
  // when in the year each station's peak happened (for ripple timing)
  const peakT = (s: (typeof stations)[number], y: number) => {
    const d = s.peakDates[y];
    if (!d) return y + 0.9;
    const dt = new Date(d);
    return y + (dt.getUTCMonth() + dt.getUTCDate() / 31) / 12;
  };

  const l: AtlasLayer = {
    id: 'rivers',
    name: 'River floods',
    icon: '≋',
    color,
    range: [y0, y1 + 0.99],
    available: !!data.rivers,
    build({ time, speed }) {
      const y = Math.floor(time);
      const W = glowWindow(speed, 1.2);
      const live = stations.map((s) => ({ s, r: interpYearly(Object.fromEntries(Object.entries(s.peaks).map(([k, v]) => [k, v / s.median])), time) }));
      const ripples = stations
        .map((s) => ({ s, r: ratio(s, y), t: peakT(s, y) }))
        .filter((d) => d.r != null && d.r >= 1.5 && time >= d.t && time - d.t < W);
      return [
        new ScatterplotLayer<any>({
          id: 'rivers-base',
          data: stations,
          getPosition: (s) => [s.lon, s.lat],
          getRadius: 2000,
          radiusMinPixels: 2,
          getFillColor: [76, 201, 240, 60],
          pickable: true,
          parameters: NO_DEPTH,
        }),
        new ColumnLayer<any>({
          id: 'rivers-cols',
          data: live.filter((d) => d.r != null),
          getPosition: (d) => [d.s.lon, d.s.lat],
          radius: 3800,
          diskResolution: 24,
          extruded: true,
          getElevation: (d) => d.r * 27000,
          getFillColor: (d) => rgb(ratioColor(d.r), 235),
          material: { ambient: 0.6, diffuse: 0.6, shininess: 40 },
          pickable: true,
          updateTriggers: { getElevation: time, getFillColor: time },
        }),
        new ScatterplotLayer<any>({
          id: 'rivers-ripples',
          data: ripples,
          getPosition: (d) => [d.s.lon, d.s.lat],
          getRadius: (d) => 4500 + ((time - d.t) / W) * 27000 * Math.min(d.r, 4),
          stroked: true,
          filled: false,
          lineWidthMinPixels: 2,
          getLineColor: (d) => [190, 240, 255, 255 * (1 - (time - d.t) / W)],
          updateTriggers: { getRadius: time, getLineColor: time },
          parameters: ADDITIVE,
        }),
      ];
    },
    spark: () => ys.filter((y) => y >= y0).map((x) => ({ x, y: share[x].n >= 3 ? share[x].high / share[x].n : 0 })),
    events() {
      const ev: TimedEvent[] = ys
        .filter((y) => share[y].n >= 8 && share[y].high / share[y].n >= 0.4)
        .map((y) => ({ stats: [{ v: `${share[y].high} of ${share[y].n}`, l: 'gauges at 1.5× normal or more' }, { v: `${Math.round((share[y].high / share[y].n) * 100)}%`, l: 'of gauged rivers' }], t: y + 0.05, layer: 'rivers', title: `${y}: high water across the province`, body: `${share[y].high} of ${share[y].n} gauged rivers peaked at 1.5× their normal annual high or more.` }));
      return ev;
    },
    panel(el) {
      el.innerHTML = `${kicker(l, 'River gauges · HYDAT')}
        <h2>When the rivers rise</h2>
        <p class="lede">Each column is a river gauge. Its height is that year’s highest flow compared with the river’s typical annual peak — a column at 2× means the river ran at double its usual flood-season high. Ripples mark years a river hit 1.5× or more.</p>`;
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Share of gauges at 1.5× normal peak or higher</h3>`);
      const set = deferChart(el.appendChild(mk('div')), (c) =>
        barChart(c, {
          data: l.spark(), xDomain: [y0, y1], color, height: 120, yFormat: (v) => `${Math.round(v * 100)}%`,
          tooltip: (d) => `<b>${d.x}</b><br>${share[d.x].high} of ${share[d.x].n} gauges ≥1.5× normal`,
        }),
      );
      const records = stations
        .flatMap((s) => Object.entries(s.peaks).map(([y, v]) => ({ s, y, r: v / s.median })))
        .sort((a, b) => b.r - a.r)
        .filter((d, i, arr) => arr.findIndex((x) => x.s === d.s) === i)
        .slice(0, 5);
      el.insertAdjacentHTML('beforeend', `
        <h3>Most extreme peaks on record</h3>
        <div class="legend" style="display:grid;gap:6px">${records.map((d) => `<span><b>${d.r.toFixed(1)}×</b> · ${esc(d.s.name)} <span class="tk">(${esc(d.s.peakDates[d.y] ?? d.y)})</span></span>`).join('')}</div>
        <h3>Peak flow vs. normal</h3>
        <div class="ramp" style="background:${rampCSS((t) => ratioColor(0.4 + t * 2.1))}"></div>
        <div class="ramp-labels"><span>0.4×</span><span>1×</span><span>1.5×</span><span>2.5×+</span></div>
        <p class="note">Gauges measure river flow, not flooded area — a high ratio means high water, not necessarily property damage. Many prairie rivers are regulated by dams and reservoirs, and spring peaks often come from snowmelt and ice jams. For a specific property, check the Water Security Agency’s flood-risk information.</p>
        ${sourceLine(data.rivers?.source ?? '')}`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          const sh = share[y];
          hero(0, sh ? `${sh.high}` : '–', sh ? `of ${sh.n} gauges ≥1.5× in ${y}` : `no gauge data in ${y}`);
          let best: { s: any; r: number } | null = null;
          for (const s of stations) { const r = ratio(s, y); if (r != null && (!best || r > best.r)) best = { s, r }; }
          hero(1, best ? `${best.r.toFixed(1)}×` : '–', best ? `${best.s.name.split(/ (at|near|above|below) /i)[0]} in ${y}` : 'biggest relative peak');
          hero(2, fmt.int(stations.length), 'gauges with 8+ years');
          hero(3, String(y0), 'first year with 3+ gauges');
          set(time);
        },
      };
    },
    describe(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('rivers')) return null;
      const st = o.s ?? o;
      const years = Object.keys(st.peaks).map(Number).sort((a, b) => a - b);
      if (!years.length) return null;
      const rec = years.reduce((a, y) => (st.peaks[y] > st.peaks[a] ? y : a), years[0]);
      const high = years.filter((y) => st.peaks[y] / st.median >= 1.5).length;
      return {
        layer: 'rivers', kind: 'River gauge', lon: st.lon, lat: st.lat, zoom: 9.5,
        title: st.name, body: `Water Survey of Canada gauge ${st.id}, ${years.length} years of record (${years[0]}–${years.at(-1)}). Each bar is a year's highest flow against the river's normal annual peak.`,
        stats: [{ v: `${st.median} m³/s`, l: 'normal annual peak' }, { v: `${(st.peaks[rec] / st.median).toFixed(1)}×`, l: `record, ${rec}` }, { v: `${high} of ${years.length}`, l: 'years at 1.5× normal or more' }, ...(st.area ? [{ v: `${fmt.int(st.area)} km²`, l: 'drains' }] : [])],
        detail: detailBars('Peak flow each year, against normal', years.map((y) => ({ x: y, y: st.peaks[y] / st.median, color: ratioColor(st.peaks[y] / st.median) })), color, (v) => `${v.toFixed(1)}×`, (d) => `<b>${d.x}</b> · ${d.y.toFixed(2)}× normal`),
        sources: [{ label: 'HYDAT, Environment and Climate Change Canada', url: 'https://wateroffice.ec.gc.ca/' }],
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('rivers')) return null;
      const s = o.s ?? o;
      const rec = Object.entries(s.peaks as Record<string, number>).reduce((a, b) => (b[1] > a[1] ? b : a));
      return `<b>${esc(s.name)}</b><br><span class="tk">Gauge</span> <span class="tv">${esc(s.id)}</span>${o.r != null ? `<br><span class="tk">This year</span> <span class="tv">${o.r.toFixed(2)}× normal</span>` : ''}<br><span class="tk">Normal annual peak</span> <span class="tv">${s.median} m³/s</span><br><span class="tk">Record</span> <span class="tv">${rec[1]} m³/s (${rec[0]})</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// CLIMATE

function climateLayer(data: Data): AtlasLayer {
  const color = '#f25f5c';
  const stations = data.climate?.stations ?? [];
  const div = d3.scaleLinear<string>().domain([-1.5, -0.4, 0, 0.4, 1.5]).range(['#2b6cb0', '#7fb3e6', '#9aa3b2', '#f4a08a', '#e0312b']).clamp(true);
  const anomalies = provinceAnomalies(data);
  const ys = Object.keys(anomalies).map(Number).sort((a, b) => a - b);
  const y0 = ys[0] ?? 1900, y1 = ys.at(-1) ?? 2020;
  const warmest = ys.reduce((a, b) => (anomalies[b] > anomalies[a] ? b : a), y0);
  const trend = slope(ys.filter((y) => y >= 1950).map((y) => [y, anomalies[y]]));

  const l: AtlasLayer = {
    id: 'climate',
    name: 'Climate',
    icon: '🌡',
    color,
    range: [y0, y1 + 0.99],
    available: !!data.climate,
    build({ time, focusedId }) {
      const live = stations
        .map((s) => {
          const series = Object.fromEntries(Object.entries(s.temp).map(([k, v]) => [k, v - s.baseline]));
          return { s, a: interpYearly(series, time) };
        })
        .filter((d) => d.a != null) as { s: (typeof stations)[number]; a: number }[];
      const layers: Layer[] = [
        new ColumnLayer<any>({
          id: 'climate-cols',
          data: live,
          getPosition: (d) => [d.s.lon, d.s.lat],
          radius: 7500,
          diskResolution: 6,
          extruded: true,
          getElevation: (d) => 3600 + Math.abs(d.a) * 48000,
          getFillColor: (d) => rgb(div(d.a), 240),
          material: { ambient: 0.65, diffuse: 0.5 },
          pickable: true,
          updateTriggers: { getElevation: time, getFillColor: time },
        }),
      ];
      if (focusedId === 'climate')
        layers.push(
          new TextLayer<any>({
            id: 'climate-labels',
            data: live,
            getPosition: (d) => [d.s.lon, d.s.lat, 3600 + Math.abs(d.a) * 48000 + 7000],
            getText: (d) => `${d.a >= 0 ? '+' : '−'}${Math.abs(d.a).toFixed(1)}°`,
            getSize: 12,
            getColor: [235, 240, 248, 230],
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 600,
            outlineWidth: 3,
            outlineColor: [6, 10, 18, 220],
            fontSettings: { sdf: true },
            billboard: true,
            updateTriggers: { getText: time, getPosition: time },
            parameters: NO_DEPTH,
          } as any),
        );
      return layers;
    },
    spark: () => ys.map((x) => ({ x, y: anomalies[x], color: div(anomalies[x]) })),
    events: () => [{ stats: [{ v: `${fmt.signed(anomalies[warmest])} °C`, l: 'above the 1961–1990 normal' }, { v: `${stations.length}`, l: 'stations averaged' }], t: warmest + 0.5, layer: 'climate', title: `${warmest}: warmest year in the provincial record`, body: `Province-average temperature ran ${fmt.signed(anomalies[warmest])} °C above the 1961–1990 normal.` }],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Homogenized temperature record')}
        <h2>A warming prairie</h2>
        <p class="lede">Annual mean temperature at ${stations.length} long-running weather stations, shown as the difference from each station’s 1961–1990 average. Columns grow and redden as years run warm; blue means cooler than normal.</p>`;
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Saskatchewan warming stripes (${y0}–${y1})</h3>`);
      const setA = deferChart(el.appendChild(mk('div')), (c) =>
        stripes(c, { cells: ys.map((x) => ({ x, color: div(anomalies[x]), label: `<b>${x}</b><br>${fmt.signed(anomalies[x], 2)} °C vs 1961–90` })), xDomain: [y0, y1], height: 50 }),
      );
      el.insertAdjacentHTML('beforeend', `<h3>Anomaly by year (°C)</h3>`);
      const setB = deferChart(el.appendChild(mk('div')), (c) =>
        barChart(c, { data: l.spark(), xDomain: [y0, y1], color, height: 120, diverging: true, yFormat: (v) => fmt.signed(v, 1), tooltip: (d) => `<b>${d.x}</b><br>${fmt.signed(d.y, 2)} °C vs 1961–90` }),
      );
      el.insertAdjacentHTML('beforeend', `
        <div class="ramp" style="background:${rampCSS((t) => div(-1.5 + t * 3))}"></div>
        <div class="ramp-labels"><span>−1.5 °C</span><span>normal</span><span>+1.5 °C</span></div>
        <div class="callout" style="--c:${color}">Since 1950 Saskatchewan’s long-running stations have warmed about <b>${trend != null ? (trend * 10).toFixed(2) : '–'} °C per decade</b>. On the prairies the warming is strongest in winter.</div>
        <p class="note">AHCCD data are adjusted by Environment and Climate Change Canada to remove artificial jumps from station moves and instrument changes, so long-term trends are comparable. Series currently end in ${y1}.</p>
        ${sourceLine(data.climate?.source ?? '')}`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          const a = anomalies[y];
          hero(0, a != null ? `${fmt.signed(a)}°` : '–', `provincial anomaly ${y}`);
          hero(1, String(warmest), `warmest year (${fmt.signed(anomalies[warmest])}°)`);
          const recent = ys.filter((x) => x > y1 - 10).map((x) => anomalies[x]);
          hero(2, `${fmt.signed(d3.mean(recent) ?? 0)}°`, `${y1 - 9}–${y1} average`);
          hero(3, trend != null ? `${fmt.signed(trend * 10, 2)}°` : '–', 'per decade since 1950');
          setA(time); setB(time);
        },
      };
    },
    describe(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('climate')) return null;
      const st = o.s;
      const ys = Object.keys(st.temp).map(Number).sort((a, b) => a - b);
      if (!ys.length) return null;
      const an = (y: number) => st.temp[y] - st.baseline;
      const warm = ys.reduce((a, y) => (an(y) > an(a) ? y : a), ys[0]);
      const recent = ys.filter((y) => y >= ys.at(-1)! - 9);
      const recentMean = recent.reduce((a, y) => a + an(y), 0) / recent.length;
      return {
        layer: 'climate', kind: 'Weather station', lon: st.lon, lat: st.lat, zoom: 9,
        title: st.name, body: `Annual mean temperature, ${ys[0]}–${ys.at(-1)}, as the difference from this station's 1961–1990 normal of ${st.baseline.toFixed(1)} °C. Blue years ran cool, red years warm.`,
        stats: [{ v: `${st.baseline.toFixed(1)} °C`, l: '1961–1990 normal' }, { v: `${fmt.signed(recentMean)} °C`, l: `average, last ${recent.length} years` }, { v: String(warm), l: `warmest year (${fmt.signed(an(warm))} °C)` }, { v: String(ys.length), l: 'years of record' }],
        detail: detailBars('Each year against normal (°C)', ys.map((y) => ({ x: y, y: an(y), color: div(an(y)) })), color, (v) => fmt.signed(v), (d) => `<b>${d.x}</b> · ${fmt.signed(d.y, 2)} °C`),
        sources: [{ label: 'ECCC Adjusted and Homogenized Canadian Climate Data', url: 'https://api.weather.gc.ca/collections/ahccd-annual' }],
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('climate')) return null;
      const s = o.s;
      const yrs = Object.keys(s.temp);
      return `<b>${esc(s.name)}</b><br><span class="tk">This year</span> <span class="tv">${fmt.signed(o.a, 2)} °C vs normal</span><br><span class="tk">1961–90 normal</span> <span class="tv">${s.baseline.toFixed(1)} °C</span><br><span class="tk">Record</span> <span class="tv">${yrs[0]}–${yrs.at(-1)}</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// CLIMATE NORMALS — a 30-year average, so the layer is the same at every point of its range

function normalsLayer(data: Data): AtlasLayer {
  const color = '#c5e86c';
  const stations = data.normals?.stations ?? [];
  const [p0, p1] = (data.normals?.period.match(/\d{4}/g) ?? ['1981', '2010']).map(Number);
  type Var = { key: NormalVar; chip: string; label: string; unit: string; best: string; low: boolean; ramp: (v: number) => string; domain: [number, number] };
  const scale = (domain: [number, number], a: string, b: string) => d3.scaleSequential(d3.interpolateRgb(a, b)).domain(domain).clamp(true);
  const VARS: Var[] = [
    { key: 'sun', chip: 'Sunshine', label: 'Bright sunshine', unit: 'h', best: 'Sunniest', low: false, domain: [2000, 2500], ramp: scale([2000, 2500], '#4b4a3a', '#fff07a') },
    { key: 'wetDays', chip: 'Rain days', label: 'Days with rain or snow (≥0.2 mm)', unit: 'days', best: 'Fewest rain days', low: true, domain: [80, 150], ramp: scale([80, 150], '#bfe3ff', '#1d4f91') },
    { key: 'frostDays', chip: 'Frost days', label: 'Days with a low of 0 °C or below', unit: 'days', best: 'Fewest frost days', low: true, domain: [180, 240], ramp: scale([180, 240], '#2f7a8a', '#dff4ff') },
    { key: 'snow', chip: 'Snowfall', label: 'Snowfall', unit: 'cm', best: 'Least snow', low: true, domain: [70, 180], ramp: scale([70, 180], '#5d7184', '#ffffff') },
  ];
  let cur = VARS[0];
  const val = (s: NormalsStation, v = cur) => s[v.key] ?? null;
  const fmtV = (v: number, x = cur) => `${fmt.int(v)} ${x.unit}`;
  const ranked = (v = cur) => stations.filter((s) => val(s, v) != null).sort((a, b) => (v.low ? val(a, v)! - val(b, v)! : val(b, v)! - val(a, v)!));
  const liveCache: Partial<Record<NormalVar, NormalsStation[]>> = {};
  const height = (v: number) => 4500 + Math.max(0, (v - cur.domain[0] * 0.8) / (cur.domain[1] - cur.domain[0] * 0.8)) * 90000;

  const l: AtlasLayer = {
    id: 'normals',
    name: 'Climate normals',
    icon: '☀',
    color,
    range: [p0, p1 + 0.99],
    static: true,
    period: `${p0}–${p1} average`,
    available: stations.length > 0,
    unavailable: 'Environment Canada’s climate-normals service could not be reached when this copy of the data was built. Run <code>npm run data normals</code>, then reload.',
    build({ focusedId }) {
      const live = (liveCache[cur.key] ??= stations.filter((s) => val(s) != null));
      const layers: Layer[] = [
        new ScatterplotLayer<NormalsStation>({
          id: 'normals-base',
          data: stations,
          getPosition: (s) => [s.lon, s.lat],
          getRadius: 2700,
          radiusMinPixels: 2,
          getFillColor: [197, 232, 108, 70],
          pickable: true,
          parameters: NO_DEPTH,
        }),
        new ColumnLayer<NormalsStation>({
          id: 'normals-cols',
          data: live,
          getPosition: (s) => [s.lon, s.lat],
          radius: 6000,
          diskResolution: 20,
          extruded: true,
          getElevation: (s) => height(val(s)!),
          getFillColor: (s) => rgb(cur.ramp(val(s)!), 240),
          material: { ambient: 0.6, diffuse: 0.55, shininess: 40 },
          pickable: true,
          updateTriggers: { getElevation: cur.key, getFillColor: cur.key },
        }),
      ];
      if (focusedId === 'normals')
        layers.push(
          new TextLayer<NormalsStation>({
            id: 'normals-labels',
            data: live,
            getPosition: (s) => [s.lon, s.lat, height(val(s)!) + 7000],
            getText: (s) => fmt.int(val(s)!),
            getSize: 11,
            getColor: [235, 240, 248, 230],
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 600,
            outlineWidth: 3,
            outlineColor: [6, 10, 18, 220],
            fontSettings: { sdf: true },
            billboard: true,
            updateTriggers: { getText: cur.key, getPosition: cur.key },
            parameters: NO_DEPTH,
          } as any),
        );
      return layers;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, `Climate normals · ${p0}–${p1} average`)}
        <h2>What a town feels like</h2>`;
      if (!data.normals) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      el.insertAdjacentHTML('beforeend', `<p class="lede">Annual temperature hides the differences you feel day to day. These are Environment Canada’s <b>30-year averages (${p0}–${p1})</b> at ${stations.length} weather stations, so this layer has no timeline: other layers keep playing underneath. Pick what the columns show:</p>
        <div class="chips" style="margin:2px 0 10px">${VARS.map((v) => `<button class="chip" data-v="${v.key}" style="--c:${color}">${v.chip}</button>`).join('')}</div>`);
      const hero = heroStats(el, 4);
      const body = el.appendChild(mk('div'));
      const draw = () => {
        el.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === cur.key));
        const r = ranked();
        const lo = r.at(-1), hi = r[0];
        hero(0, hi ? fmtV(val(hi)!) : '–', hi ? `${cur.best.toLowerCase()}: ${hi.name}` : '');
        hero(1, lo ? fmtV(val(lo)!) : '–', lo ? `other extreme: ${lo.name}` : '');
        hero(2, String(r.length), `stations report ${cur.chip.toLowerCase()}`);
        const med = d3.median(r, (s) => val(s)!);
        hero(3, med != null ? fmtV(med) : '–', 'provincial median');
        const max = d3.max(r, (s) => val(s)!) ?? 1;
        body.innerHTML = `<h3>${cur.best} · ${cur.label}</h3>
          <ol class="rank-list">${r.map((s, i) => `<li><span class="rk">${i + 1}</span><span><span class="nm">${esc(s.name)}</span>${s.yrs < 20 ? `<br><span class="rd">${s.yrs} yrs of record</span>` : ''}</span><span><div class="bar"><i style="width:${Math.round((val(s)! / max) * 100)}%;background:${cur.ramp(val(s)!)}"></i></div><div class="bar-v">${fmt.int(val(s)!)}</div></span></li>`).join('')}</ol>
          <div class="ramp" style="background:${rampCSS((t) => cur.ramp(cur.domain[0] + t * (cur.domain[1] - cur.domain[0])))}"></div>
          <div class="ramp-labels"><span>${cur.domain[0]} ${cur.unit}</span><span>${cur.domain[1]}+ ${cur.unit}</span></div>
          ${cur.key === 'sun' ? `<div class="callout" style="--c:${color}">Only ${r.length} Saskatchewan stations measure sunshine. The Town Report and Town Finder borrow the nearest one (within 150 km) and name it.</div>` : ''}`;
      };
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-v]')?.dataset.v;
        const v = VARS.find((x) => x.key === k);
        if (v) { cur = v; draw(); }
      });
      draw();
      el.insertAdjacentHTML('beforeend', `
        <p class="note">A “normal” is the average of ${p1 - p0 + 1} years of daily observations, the standard climate reference period. Some stations have gaps; those with under 20 years behind a value are flagged. Newer ${p0 + 10}–${p1 + 10} normals are not yet in Environment Canada’s open API.</p>
        ${sourceLine(data.normals.source)}`);
      return { update() {} };
    },
    tooltip(info) {
      const o = info.object as NormalsStation;
      if (!o || !info.layer?.id.startsWith('normals')) return null;
      const row = (k: string, v: string | null) => (v ? `<br><span class="tk">${k}</span> <span class="tv">${v}</span>` : '');
      const n = (v: number | undefined, u: string) => (v != null ? `${fmt.int(v)} ${u}` : null);
      return `<b>${esc(o.name)}</b>${row('Sunshine', n(o.sun, 'h/yr'))}${row('Rain days', n(o.wetDays, '/yr'))}${row('Frost days', n(o.frostDays, '/yr'))}${row('Snowfall', n(o.snow, 'cm/yr'))}${row('Precipitation', n(o.precip, 'mm/yr'))}${row('Jan / Jul mean', o.tJan != null && o.tJul != null ? `${o.tJan.toFixed(1)} / ${o.tJul.toFixed(1)} °C` : null)}${row('Wettest month', o.wet ? `${MONTHS[o.wet[0] - 1]} (${fmt.int(o.wet[1])} mm)` : null)}<br><span class="tk">${p0}–${p1} normals${o.yrs < 20 ? ` · ${o.yrs} yrs of record` : ''}</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// MUNICIPAL LAYERS (population, housing, crime) share a column renderer

export function townColumns(id: string, munis: Muni[], value: (m: Muni) => number | null, height: (v: number) => number, colorOf: (v: number, m: Muni) => RGBA, time: number, selected: string | null) {
  const live = munis.map((m) => ({ m, v: value(m) })).filter((d) => d.v != null) as { m: Muni; v: number }[];
  return [
    new ColumnLayer<any>({
      id: `${id}-cols`,
      data: live,
      getPosition: (d) => [d.m.lon, d.m.lat],
      radius: 5000,
      diskResolution: 28,
      extruded: true,
      getElevation: (d) => height(d.v),
      getFillColor: (d) => colorOf(d.v, d.m),
      getLineColor: [255, 255, 255, 200],
      material: { ambient: 0.55, diffuse: 0.65, shininess: 60 },
      pickable: true,
      updateTriggers: { getElevation: [time, selected], getFillColor: [time, selected] },
    }),
  ];
}

function populationLayer(data: Data): AtlasLayer {
  const color = '#3ecf8e';
  const pop = data.population?.munis ?? {};
  const keys = Object.keys(pop);
  const allYears = new Set<number>();
  Object.values(pop).forEach((p) => Object.keys(p.pop).forEach((y) => allYears.add(+y)));
  const ys = [...allYears].sort((a, b) => a - b);
  const y0 = ys[0] ?? 2001, y1 = ys.at(-1) ?? 2025;
  const total = (y: number) => d3.sum(Object.values(pop), (p) => p.pop[y] ?? 0);
  // colour: growth over the previous five years (or since the first year), so booming and shrinking towns stand apart
  const growth = (key: string, t: number) => {
    const p = pop[key]?.pop;
    const now = interpYearly(p, t), before = interpYearly(p, Math.max(y0, t - 5));
    return now != null && before ? now / before - 1 : null;
  };
  const ramp = d3.scaleLinear<string>().domain([-0.1, 0, 0.1, 0.25]).range(['#7a2e3a', '#5d6b84', '#3ecf8e', '#d9ffef']).interpolate(d3.interpolateRgb).clamp(true);
  let shownTime = y0;

  const l: AtlasLayer = {
    id: 'population',
    name: 'Population',
    icon: '◍',
    color,
    range: [y0, y1 + 0.99],
    available: keys.length > 0,
    unavailable: 'Statistics Canada’s population table could not be downloaded when this copy of the data was built. Run <code>npm run data population</code>, then reload.',
    build({ time, selected }) {
      shownTime = time;
      return townColumns('population', data.munis, (m) => interpYearly(pop[m.key]?.pop, time), (v) => Math.sqrt(v) * 300, (_v, m) => rgb(ramp(growth(m.key, time) ?? 0), 240), time, selected);
    },
    spark: () => ys.map((x) => ({ x, y: total(x) })),
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, `Statistics Canada estimates · ${y0} → ${y1}`)}
        <h2>Where Saskatchewan is growing</h2>
        <p class="lede">Column height shows each place’s population on 1 July; colour shows how much it grew over the five years before (green growing, grey flat, red shrinking). Watch the bedroom towns around Saskatoon and Regina pull ahead.</p>`;
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Population, largest places</h3>`);
      const palette = ['#3ecf8e', '#4cc9f0', '#ffd166', '#ff8a3d', '#b388ff', '#ff5d8f'];
      const big = keys.filter((k) => !['saskatoon', 'regina'].includes(k)).sort((a, b) => (pop[b].pop[y1] ?? 0) - (pop[a].pop[y1] ?? 0)).slice(0, 6);
      const series = big.map((k, i) => ({ key: k, label: data.munis.find((m) => m.key === k)?.name ?? k, color: palette[i], width: 2, values: Object.entries(pop[k].pop).map(([y, v]) => ({ x: +y, y: v })) }));
      const set = deferChart(el.appendChild(mk('div')), (c) => lineChart(c, { series, xDomain: [y0, y1], height: 160, yFormat: (v) => d3.format('~s')(v), valueFormat: fmt.int }));
      el.insertAdjacentHTML('beforeend', `<div class="legend">${series.map((s) => `<span><i class="sw" style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>
        <p class="note">Saskatoon and Regina are left off the chart so the smaller cities can be read; their columns are on the map.</p>`);
      const fast = keys.map((k) => ({ k, g: growth(k, y1) })).filter((r) => r.g != null && (pop[r.k].pop[y1] ?? 0) >= 2000).sort((a, b) => b.g! - a.g!);
      const nm = (k: string) => data.munis.find((m) => m.key === k)?.name ?? k;
      el.insertAdjacentHTML('beforeend', `
        <div class="callout" style="--c:${color}">Fastest growing over ${y1 - 5}–${y1} (2,000+ people): ${fast.slice(0, 3).map((r) => `<b>${nm(r.k)}</b> (${fmt.signed(r.g! * 100, 0)}%)`).join(', ')}. Shrinking most: ${fast.slice(-2).reverse().map((r) => `<b>${nm(r.k)}</b> (${fmt.signed(r.g! * 100, 0)}%)`).join(', ')}.</div>
        <h3>Colour: five-year growth</h3>
        <div class="ramp" style="background:${rampCSS((t) => ramp(-0.1 + t * 0.35))}"></div>
        <div class="ramp-labels"><span>−10%</span><span>0</span><span>+10%</span><span>+25%</span></div>
        <p class="note">Covers the ${keys.length} places in the atlas, each as its census subdivision (the city, town or northern village itself, not its rural municipality). Lloydminster counts only its Saskatchewan side. Estimates are revised after each census.</p>
        ${sourceLine(data.population?.source ?? '')}`);
      return {
        update({ time }) {
          const y = Math.min(Math.floor(time), y1);
          hero(0, fmt.int(total(y)), `people in the atlas’s ${keys.length} places, ${y}`);
          hero(1, `${fmt.signed(((total(y) / total(y0)) - 1) * 100, 0)}%`, `growth since ${y0}`);
          const share = (total(y) && pop.saskatoon && pop.regina) ? ((pop.saskatoon.pop[y] ?? 0) + (pop.regina.pop[y] ?? 0)) / total(y) : null;
          hero(2, share != null ? `${Math.round(share * 100)}%` : '–', `of them in Saskatoon or Regina`);
          const top = keys.map((k) => ({ k, g: growth(k, y) })).filter((r) => r.g != null && (pop[r.k].pop[y] ?? 0) >= 2000).sort((a, b) => b.g! - a.g!)[0];
          hero(3, top ? nm(top.k) : '–', top ? `fastest growing (${fmt.signed(top.g! * 100, 0)}% in 5 yrs)` : '');
          set(time);
        },
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('population')) return null;
      const g = growth(o.m.key, shownTime);
      return `<b>${o.m.name}</b><br><span class="tk">Population</span> <span class="tv">${fmt.int(o.v)}</span>${g != null ? `<br><span class="tk">Five-year growth</span> <span class="tv">${fmt.signed(g * 100, 1)}%</span>` : ''}<br><span class="tk">Click for town report</span>`;
    },
  };
  return l;
}

function crimeLayer(data: Data): AtlasLayer {
  const color = '#ff4d8d';
  const cr = data.crime?.munis ?? {};
  const ramp = d3.scaleSequential(d3.interpolateRgb('#4a0f2b', '#ffd1e3')).domain([40, 400]).clamp(true);
  const ys = [...new Set(Object.values(cr).flatMap((c) => Object.keys(c.csi ?? {})))].map(Number).sort((a, b) => a - b);
  const y0 = ys[0] ?? 1998, y1 = ys.at(-1) ?? 2024;
  const prov = data.crime?.prov ?? {};
  const pcsi = prov.csi ?? {};
  type Measure = { key: 'csi' | 'vcsi' | 'clear'; chip: string; label: string };
  const MEASURES: Measure[] = [
    { key: 'csi', chip: 'All crime', label: 'Crime Severity Index' },
    { key: 'vcsi', chip: 'Violent', label: 'Violent Crime Severity Index' },
    { key: 'clear', chip: 'Solved', label: 'Weighted clearance rate (%)' },
  ];
  let cur = MEASURES[0];
  const rural = (k: string) => data.crime?.service?.[k]?.level === 'rural';
  const nm = (k: string) => data.munis.find((m) => m.key === k)?.name ?? k;

  const l: AtlasLayer = {
    id: 'crime',
    name: 'Crime severity',
    icon: '◆',
    color,
    range: [y0, y1 + 0.99],
    available: !!data.crime,
    unavailable: `Statistics Canada’s download service was offline when this copy of the data was built. Run <code>npm run data crime</code> to fetch the Crime Severity Index, then reload.`,
    build({ time, selected }) {
      const k = cur.key;
      const ramp2 = k === 'clear' ? d3.scaleSequential(d3.interpolateRgb('#3a1a4a', '#b8ffde')).domain([15, 60]).clamp(true) : ramp;
      return townColumns('crime', data.munis, (m) => interpYearly(cr[m.key]?.[k], time), (v) => (k === 'clear' ? v * 1800 : Math.sqrt(v) * 5000), (v) => rgb(ramp2(v), 240), time, `${selected}${k}`);
    },
    spark: () => ys.map((x) => ({ x, y: pcsi[x] ?? 0 })),
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Justice · police-reported crime')}
        <h2>How much crime, and how serious?</h2>`;
      if (!data.crime) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      el.insertAdjacentHTML('beforeend', `<p class="lede">Statistics Canada’s Crime Severity Index weights each police-reported crime by how serious it is, so one robbery counts for more than several thefts. 100 is Canada’s 2006 level. Saskatchewan has long had the highest index of any province. Pick what the columns show:</p>
        <div class="chips" style="margin:2px 0 10px">${MEASURES.map((m) => `<button class="chip" data-m="${m.key}" style="--c:${color}">${m.chip}</button>`).join('')}</div>`);
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Crime Severity Index: Saskatchewan and selected police services</h3>`);
      const palette = ['#4cc9f0', '#ffd166', '#3ecf8e', '#b388ff', '#ff8a3d'];
      const hl = ['regina', 'saskatoon', 'prince albert', 'north battleford', 'moose jaw'];
      const series = hl.filter((k) => cr[k]?.csi).map((k, i) => ({ key: k, label: nm(k), color: palette[i], width: 2, values: Object.entries(cr[k].csi ?? {}).map(([y, v]) => ({ x: +y, y: v })) }));
      series.push({ key: 'sk', label: 'Saskatchewan', color: '#ffffff', width: 2, dashed: true, values: Object.entries(pcsi).map(([y, v]) => ({ x: +y, y: v })) } as any);
      const set = deferChart(el.appendChild(mk('div')), (c) => lineChart(c, { series, xDomain: [y0, y1], height: 170, yFormat: (v) => String(Math.round(v)) }));
      el.insertAdjacentHTML('beforeend', `<div class="legend">${series.map((s) => `<span><i class="sw" style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>
        <div class="ramp" style="background:${rampCSS((t) => ramp(40 + t * 360))}"></div>
        <div class="ramp-labels"><span>40</span><span>220</span><span>400+</span></div>`);
      const list = el.appendChild(mk('div'));
      el.insertAdjacentHTML('beforeend', `
        <p class="note">Each place is shown by its own police service: a municipal force (Regina, Saskatoon, Prince Albert, Moose Jaw, Estevan, Weyburn) or the RCMP’s municipal detachment. A few northern villages have no municipal series and use the surrounding rural RCMP detachment, which covers a wider area${Object.keys(cr).filter(rural).length ? ` (${Object.keys(cr).filter(rural).map(nm).join(', ')})` : ''}. Service hubs score high partly because people come in from the surrounding area to shop, work and drink; a small town’s index can jump on a handful of incidents. The clearance rate is the weighted share of crimes police solved (charged or cleared otherwise).</p>
        ${sourceLine(data.crime.source)}`);
      let lastY = -1;
      const drawList = (y: number) => {
        const rows = Object.entries(cr).map(([k, c]) => ({ k, v: c[cur.key]?.[y] })).filter((r) => r.v != null) as { k: string; v: number }[];
        rows.sort((a, b) => (cur.key === 'clear' ? b.v - a.v : a.v - b.v));
        const max = d3.max(rows, (r) => r.v) ?? 1;
        list.innerHTML = `<h3>${cur.label}, ${y} · ${cur.key === 'clear' ? 'most solved first' : 'lowest first'}</h3>
          <ol class="rank-list">${rows.map((r, i) => `<li data-key="${r.k}"><span class="rk">${i + 1}</span><span><span class="nm">${nm(r.k)}</span>${rural(r.k) ? '<br><span class="rd">rural RCMP detachment</span>' : ''}</span><span><div class="bar"><i style="width:${Math.round((r.v / max) * 100)}%;background:${color}"></i></div><div class="bar-v">${r.v.toFixed(0)}</div></span></li>`).join('')}</ol>`;
      };
      list.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-m]')?.dataset.m;
        const m = MEASURES.find((x) => x.key === k);
        if (m) { cur = m; lastY = -1; el.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === cur.key)); }
      });
      el.querySelector<HTMLButtonElement>('[data-m="csi"]')?.classList.add('on');
      return {
        update({ time }) {
          const y = Math.min(Math.floor(time), y1);
          hero(0, pcsi[y] ? pcsi[y].toFixed(0) : '–', `Saskatchewan CSI ${y}`);
          hero(1, prov.vcsi?.[y] ? prov.vcsi[y].toFixed(0) : '–', `violent CSI ${y}`);
          hero(2, prov.clear?.[y] ? `${prov.clear[y].toFixed(0)}%` : '–', `of crime solved (weighted) ${y}`);
          const peak = Object.entries(pcsi).reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0] as [string, number]);
          hero(3, peak[0] || '–', peak[0] ? `peak year (CSI ${peak[1].toFixed(0)})` : '');
          if (y !== lastY) { lastY = y; drawList(y); }
          set(time);
        },
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('crime')) return null;
      const s = data.crime?.service?.[o.m.key];
      return `<b>${o.m.name}</b><br><span class="tk">${cur.label}</span> <span class="tv">${o.v.toFixed(1)}</span>${s ? `<br><span class="tk">${esc(s.name)}</span>` : ''}<br><span class="tk">Click for town report</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// HOSPITAL ACCESS — a static layer: where emergency care is today, and how long the drive takes

const dashExt = [new PathStyleExtension({ dash: true })];

function hospitalsLayer(data: Data): AtlasLayer {
  const color = '#6c8cff';
  const H = data.hospitals;
  const fac: Facility[] = H?.facilities ?? [];
  const routed = !!H && H.routing !== 'straight-line';
  const unit = routed ? 'min' : 'km';
  const er = new Map((H ? townMetrics(data) : []).map((t) => [t.muni.key, t.hospital]));
  // minutes to the nearest 24/7 ER, avoiding ferries where possible (km if no drive times could be computed)
  const val = (key: string) => { const e = er.get(key); return e ? e.min ?? e.km : null; };
  const ramp = d3.scaleLinear<string>().domain([5, 45, 150]).range(['#e3f1ff', color, '#e0457b']).interpolate(d3.interpolateRgb).clamp(true);
  const height = (v: number) => 3600 + Math.min(v, 300) * 600;
  const edColor = (f: Facility) => (f.hospital ? color : '#7d879c');
  const tripText = (t: Trip) => (t.min != null ? `${t.min} min` : `${Math.round(t.km)} km (straight line)`);

  // road lines for the hovered / selected town, with cumulative lengths for the travelling pulse
  type Row = { t: Trip; i: number; path: [number, number][]; cum: number[] };
  let memoKey: string | null = null;
  let memoRows: Row[] = [];
  const rowsFor = (key: string | null) => {
    if (key === memoKey) return memoRows;
    memoKey = key;
    const m = data.munis.find((x) => x.key === key);
    memoRows = !m || !H ? [] : (H.towns[m.key] ?? []).map((t, i) => {
      const path: [number, number][] = t.line ?? [[m.lon, m.lat], [fac[t.f].lon, fac[t.f].lat]];
      const cum = [0];
      for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], (path[k][1] - path[k - 1][1]) * 1.5));
      return { t, i, path, cum };
    });
    return memoRows;
  };
  const along = (r: Row, q: number): [number, number] => {
    const d = q * r.cum[r.cum.length - 1];
    const k = Math.max(1, lowerBound(r.cum, d, (c) => c));
    if (k >= r.path.length) return r.path[r.path.length - 1];
    const f = (d - r.cum[k - 1]) / (r.cum[k] - r.cum[k - 1] || 1);
    return [r.path[k - 1][0] + (r.path[k][0] - r.path[k - 1][0]) * f, r.path[k - 1][1] + (r.path[k][1] - r.path[k - 1][1]) * f];
  };

  const l: AtlasLayer = {
    id: 'hospitals',
    name: 'Hospital access',
    icon: '✚',
    color,
    range: [new Date().getFullYear(), new Date().getFullYear() + 0.99],
    static: true,
    period: 'hospitals listed in 2020',
    available: fac.length > 0,
    unavailable: 'Statistics Canada’s Open Database of Healthcare Facilities could not be downloaded when this copy of the data was built. Run <code>npm run data hospitals</code>, then reload.',
    build({ selected, hovered, focusedId, clock }) {
      const focused = focusedId === 'hospitals';
      const out: Layer[] = [];
      if (focused) out.push(...townColumns('hospitals', data.munis, (m) => val(m.key), height, (v) => rgb(ramp(v), 235), 0, selected));

      const rows = rowsFor(hovered ?? selected);
      if (rows.length) {
        const q = (clock % 2600) / 2600;
        out.push(
          new PathLayer<Row>({
            id: 'hospitals-trips',
            data: rows,
            getPath: (r) => r.path,
            getColor: (r) => (r.i === 0 ? rgb('#ffffff', 235) : rgb(color, 200)),
            getWidth: (r) => (r.i === 0 ? 4 : 2.5),
            widthUnits: 'pixels',
            capRounded: true,
            jointRounded: true,
            extensions: dashExt,
            getDashArray: (r) => (!r.t.line ? [3, 2] : [0, 0]),
            dashJustified: true,
            parameters: NO_DEPTH,
          } as any),
          new ScatterplotLayer<Row>({
            id: 'hospitals-pulse',
            data: rows,
            getPosition: (r) => along(r, q),
            getRadius: 2600,
            radiusMinPixels: 3,
            getFillColor: (r) => (r.i === 0 ? [255, 255, 255, 230] : rgb(color, 230)),
            updateTriggers: { getPosition: q },
            parameters: ADDITIVE,
          }),
          new TextLayer<Row>({
            id: 'hospitals-mins',
            data: rows,
            getPosition: (r) => r.path[r.path.length - 1],
            getText: (r) => `${tripText(r.t)}\n${fac[r.t.f].name}`,
            getSize: (r) => (r.i === 0 ? 13 : 11),
            getColor: (r) => (r.i === 0 ? [255, 255, 255, 255] : [214, 222, 255, 235]),
            getPixelOffset: [0, -14],
            getAlignmentBaseline: 'bottom',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 700,
            characterSet: 'auto',
            outlineWidth: 3,
            outlineColor: [6, 10, 18, 230],
            fontSettings: { sdf: true },
            parameters: { depthCompare: 'always' },
          } as any),
        );
      }

      // round-the-clock ERs breathe; smaller sites are drawn dimmer
      const p = (clock % 2400) / 2400;
      out.push(
        new ScatterplotLayer<Facility>({
          id: 'hospitals-halo',
          data: fac.filter((f) => f.hospital),
          getPosition: (f) => [f.lon, f.lat],
          getRadius: 4000 + p * 15000,
          radiusMinPixels: 5,
          stroked: true,
          filled: false,
          lineWidthMinPixels: 1.5,
          getLineColor: rgb(color, 210 * (1 - p)),
          updateTriggers: { getRadius: p, getLineColor: p },
          parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<Facility>({
          id: 'hospitals-sites',
          data: fac,
          getPosition: (f) => [f.lon, f.lat],
          getRadius: (f) => (f.hospital ? 3400 : 2400),
          radiusMinPixels: focused ? 5 : 4,
          radiusMaxPixels: 13,
          getFillColor: (f) => (f.hospital ? [255, 255, 255, 255] : [16, 22, 38, 235]),
          stroked: true,
          getLineColor: (f) => rgb(edColor(f)),
          lineWidthMinPixels: 2.5,
          pickable: true,
          parameters: { depthCompare: 'always' },
        } as any),
      );
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Hospital access · drive to the nearest hospital')}
        <h2>How far to a hospital?</h2>`;
      if (!H) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const n24 = fac.filter((f) => f.hospital).length;
      el.insertAdjacentHTML('beforeend', `<p class="lede">The ${fac.length} Saskatchewan sites Statistics Canada’s Open Database of Healthcare Facilities files as hospitals, ${n24} of them hospitals proper (the rest are health centres and clinics). Column height shows the ${routed ? '<b>typical drive</b>' : '<b>straight-line distance</b>'} from each town centre to its nearest hospital. Hover or click a town to see its routes.</p>`);
      const hero = heroStats(el, 4);
      const rows = data.munis.flatMap((m) => { const e = er.get(m.key), v = val(m.key); return e && v != null ? [{ m, v, e }] : []; });
      rows.sort((a, b) => a.v - b.v);
      const near = routed ? 20 : 15;
      hero(0, String(n24), 'hospitals');
      hero(1, `${Math.round(d3.median(rows, (r) => r.v) ?? 0)} ${unit}`, 'median place to a hospital');
      hero(2, `${rows.filter((r) => r.v <= near).length} of ${rows.length}`, `towns within ${near} ${unit}`);
      const far = rows.at(-1);
      hero(3, far ? `${Math.round(far.v)} ${unit}` : '–', far ? `farthest: ${far.m.name}` : '');
      const max = d3.max(rows, (r) => r.v) ?? 1;
      const small = fac.filter((f) => f.ed !== '24/7');
      el.insertAdjacentHTML('beforeend', `
        <h3>${routed ? 'Drive' : 'Distance'} to the nearest hospital</h3>
        <ol class="rank-list">${rows.map((r, i) => `<li><span class="rk">${i + 1}</span><span><span class="nm">${r.m.name}</span><br><span class="rd">${esc(r.e.name)} · ${Math.round(r.e.km)} km</span></span><span><div class="bar"><i style="width:${Math.round((r.v / max) * 100)}%;background:${ramp(r.v)}"></i></div><div class="bar-v">${Math.round(r.v)}</div></span></li>`).join('')}</ol>
        <div class="ramp" style="background:${rampCSS((t) => ramp(5 + t * 145))}"></div>
        <div class="ramp-labels"><span>5 ${unit}</span><span>45</span><span>150+ ${unit}</span></div>
        <div class="legend"><span><i class="sw" style="background:#fff;box-shadow:0 0 0 2px ${color}"></i>hospital</span><span><i class="sw" style="background:#101626;box-shadow:0 0 0 2px #7d879c"></i>health centre or clinic</span></div>
        ${small.length ? `<div class="callout" style="--c:${color}">${small.length} health centres and clinics are on the map but left out of the ranking: they may not offer emergency or in-patient care.</div>` : ''}
        <p class="note">${routed ? 'Drive times are the OSRM router’s estimate for normal free-flowing traffic on OpenStreetMap roads, from the town centre. They don’t include winter roads, gravel, or air ambulance, which serves much of the far north.' : 'No routing service was reachable when this data was built, so these are straight-line distances, not drive times.'} The facility list is Statistics Canada’s 2020 compilation: rural emergency departments in Saskatchewan have had temporary closures for staffing since, and services (surgery, maternity, emergency hours) differ by hospital — check the Saskatchewan Health Authority before relying on one.</p>
        ${sourceLine(`${H.source}. ${H.routingSource ?? 'Straight-line distances.'}`)}`);
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('hospitals')) return null;
      if (id === 'hospitals-sites') {
        const f = info.object as Facility;
        return `<b>${esc(f.name)}</b><br><span class="tk">${f.hospital ? 'Hospital' : 'Health centre or clinic'} · ${esc(f.city)}</span>${f.type ? `<br><span class="tk">Listed as</span> <span class="tv">${esc(f.type)}</span>` : ''}`;
      }
      const o: any = info.object;
      const e = er.get(o.m?.key);
      if (!e) return null;
      return `<b>${o.m.name}</b><br><span class="tk">Nearest hospital</span> <span class="tv">${e.min != null ? `${e.min} min` : `${Math.round(e.km)} km`}</span><br><span class="tk">${esc(e.name)} · ${Math.round(e.km)} km by ${e.min != null ? 'road' : 'straight line'}</span><br><span class="tk">Click for town report</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// CURATED EVENTS — moments the data alone doesn't name. Kept to well-documented facts; each links to a source.

export const CURATED_EVENTS: TimedEvent[] = [
  {
    t: 1874.71, layer: '*', kind: 'Treaty', title: '1874 — Treaty 4 signed at Fort Qu’Appelle',
    body: 'Cree, Saulteaux and Assiniboine leaders and the Crown sign Treaty 4 at Fort Qu’Appelle on 15 September 1874, covering most of what is now southern Saskatchewan.',
    lon: -103.79, lat: 50.77, zoom: 7,
    sections: [{ title: 'Why it matters on this map', text: 'Most of the reserves in the south of the province were set aside under Treaty 4. Its terms, including the promises read out at the signing, are still the subject of claims and negotiation today. Turn on Treaties & reserves to see the treaty areas.' }],
    sources: [{ label: 'Treaty 4 (The Canadian Encyclopedia)', url: 'https://www.thecanadianencyclopedia.ca/en/article/treaty-4' }],
    layers: ['treaties'],
  },
  {
    t: 1876.64, layer: '*', kind: 'Treaty', title: '1876 — Treaty 6 signed at Fort Carlton',
    body: 'Plains and Woods Cree, Assiniboine and other nations sign Treaty 6 at Fort Carlton in August 1876 and at Fort Pitt that September. It covers the centre of the province.',
    lon: -106.53, lat: 52.87, zoom: 7,
    sections: [{ title: 'The medicine chest', text: 'Treaty 6 is the only numbered treaty with a “medicine chest” clause, which First Nations have long held to mean a promise of health care.' }],
    sources: [{ label: 'Treaty 6 (The Canadian Encyclopedia)', url: 'https://www.thecanadianencyclopedia.ca/en/article/treaty-6' }],
    layers: ['treaties'],
  },
  {
    t: 1885.88, layer: '*', kind: 'Justice', title: '1885 — Louis Riel tried and hanged in Regina',
    body: 'After the North-West Resistance ended at Batoche in May 1885, Métis leader Louis Riel was tried for high treason in Regina that summer, convicted, and hanged there on 16 November 1885.',
    lon: -104.61, lat: 50.45, zoom: 8,
    sections: [
      { title: 'A trial still argued over', text: 'Riel was tried before a magistrate and a jury of six English-speaking Protestants; the jury recommended mercy, which was refused. Eight Cree and Assiniboine men were hanged at Battleford later that month, in Canada’s largest mass execution.' },
    ],
    sources: [{ label: 'Louis Riel (The Canadian Encyclopedia)', url: 'https://www.thecanadianencyclopedia.ca/en/article/louis-riel' }],
    layers: ['justice', 'treaties'],
  },
  {
    t: 1905.67, layer: '*', title: '1905 — Saskatchewan becomes a province',
    body: 'Saskatchewan and Alberta are carved from the North-West Territories on 1 September 1905, with Regina as Saskatchewan’s capital.',
    lon: -105.9, lat: 52.5, zoom: 5,
    sources: [{ label: 'Saskatchewan (The Canadian Encyclopedia)', url: 'https://www.thecanadianencyclopedia.ca/en/article/saskatchewan' }],
    layers: ['population'],
  },
  {
    t: 1912.5, layer: '*', kind: 'Tornado', title: '1912 — The Regina Cyclone',
    body: 'On 30 June 1912 a tornado cut through downtown Regina, killing 28 people: still the deadliest tornado in Canadian history.',
    lon: -104.61, lat: 50.45, zoom: 10,
    sections: [{ title: 'Before the record begins', text: 'The national tornado database on this map starts in 1980, so the Regina Cyclone is not one of its tracks. Turn on Tornadoes to see how often they touch down across the south.' }],
    sources: [{ label: 'Regina Cyclone (The Canadian Encyclopedia)', url: 'https://www.thecanadianencyclopedia.ca/en/article/regina-cyclone' }],
    layers: ['tornadoes'],
  },
  {
    t: 1927.2, layer: '*', kind: 'Parks', title: '1927 — Prince Albert National Park is created',
    body: 'Canada sets aside Prince Albert National Park in the boreal forest north of Prince Albert in 1927: Saskatchewan’s first national park and still its largest park of any kind.',
    lon: -106.2, lat: 53.95, zoom: 8,
    sections: [{ title: 'Grey Owl’s cabin', text: 'The writer and conservationist Grey Owl lived at Ajawaan Lake in the park from 1931 until his death in 1938; his cabin is still reached by trail or canoe. Turn on Camping & rec to see the park’s campgrounds and light the campfires from Prince Albert.' }],
    sources: [{ label: 'Prince Albert National Park (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Prince_Albert_National_Park' }],
    layers: ['camping'],
  },
  {
    t: 2011.45, layer: '*', kind: 'Flood', title: '2011 — The Souris River floods',
    body: 'A wet spring and heavy June rains send the Souris River to record flows; Roche Percée and low-lying parts of Estevan flood, and the flood carries on downstream into North Dakota.',
    lon: -102.8, lat: 49.12, zoom: 9,
    sources: [{ label: '2011 Souris River flood (Wikipedia)', url: 'https://en.wikipedia.org/wiki/2011_Souris_River_flood' }],
    layers: ['rivers'],
  },
  {
    t: 2015.5, layer: '*', kind: 'Wildfire', title: '2015 — The north burns',
    body: 'Hundreds of fires burn across northern Saskatchewan in late June and July 2015; La Ronge, Air Ronge and the Lac La Ronge Indian Band are among the communities evacuated, in one of the largest evacuations in the province’s history.',
    lon: -105.3, lat: 55.1, zoom: 7,
    sources: [{ label: '2015 Saskatchewan wildfires (Wikipedia)', url: 'https://en.wikipedia.org/wiki/2015_Saskatchewan_wildfires' }],
    layers: ['fires'],
  },
];

// ---------------------------------------------------------------------------------------------
// JUST THE PROVINCE — the plain map the atlas opens on, with nothing overlaid

function provinceLayer(data: Data): AtlasLayer {
  const l: AtlasLayer = {
    id: 'province',
    name: 'Just the province',
    icon: '◌',
    color: '#4cc9f0',
    range: [1900, 2026],
    static: true,
    period: 'no data overlaid',
    available: true,
    build: () => [],
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Start here')}
        <h2>Saskatchewan, plain</h2>
        <p class="lede">Nothing is overlaid yet. The dots are the ${data.munis.length} cities, towns and northern villages in the atlas.</p>
        <ol class="howto">
          <li><b>Click a town dot</b> for its report card: crime, the drive to court, police and hospital, hazards and climate.</li>
          <li><b>Layer</b> (top left, or press <kbd>L</kbd>): flip a switch to put a data set on the map, and click its name for its story and timeline. <i>Clear the map</i> turns them all off.</li>
          <li>On a history layer, press <b>▶</b> (or <kbd>Space</kbd>) on the timeline to play the years.</li>
          <li><b>Town Finder</b> ranks places by what matters to you.</li>
          <li><b>Data &amp; sources</b> shows where every number comes from.</li>
        </ol>
        <p class="note">Drag to pan, scroll to zoom, right-drag (or Ctrl-drag) to tilt and turn the map.</p>`;
      return { update() {} };
    },
    tooltip: () => null,
  };
  return l;
}

export function buildLayers(data: Data): AtlasLayer[] {
  return [provinceLayer(data), crimeLayer(data), justiceLayer(data), treatiesLayer(data), firesLayer(data), tornadoLayer(data), riversLayer(data), climateLayer(data), normalsLayer(data), populationLayer(data), hospitalsLayer(data), campingLayer(data)];
}
