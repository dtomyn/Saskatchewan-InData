// Each 'atlas layer' bundles: deck.gl layers for a moment in time, a timeline sparkline,
// notable events, a story panel, and map tooltips.
import * as d3 from 'd3';
import { ColumnLayer, LineLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { DataFilterExtension, PathStyleExtension } from '@deck.gl/extensions';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { BurnPerimeter, Data, Facility, FirePerimeter, FloodZone, FirePoint, HistoryFeed, Hotspot, MONTHS, Muni, NormalsStation, NowRiverRow, Trip, fmt, interpYearly, km, lowerBound } from './data';
import { DAY_T, HistHotspot, dayT, dayText, firesHistory, riversHistory, tDay } from './history';
import { bandChart, barChart, lineChart, rampCSS, scatterChart, stripes, ChartHandle } from './charts';
import { PROJ_BADGE, SCEN_COLOR, SCEN_SHORT, provinceBand, provinceMedian, projAt, rangeText, windowText } from './projections';
import type { ProjScen, ProjVar } from './data';
import { NormalVar, provinceAnomalies, slope, townMetrics } from './metrics';
import { tornadoLayer } from './tornado';
import { hailLayer } from './hail';
import { justiceLayer } from './justice';
import { treatiesLayer } from './treaties';
import { campingLayer } from './camping';
import { housingLayer } from './housing';
import { jobsLayer } from './jobs';
import { needsLayer } from './needs';
import { commuteLayer } from './commute';
import { schoolsLayer } from './schools';
import { internetLayer } from './internet';
import { communityLayer } from './community';
import { newcomerLayer } from './newcomer';
import { doctorsLayer } from './doctors';
import { childcareLayer } from './childcare';
import { smokeLayer } from './smoke';
import { droughtLayer } from './drought';
import { cropsLayer } from './crops';
import { industryLayer } from './industry';
import { waterLayer } from './water';
import { radonLayer } from './radon';
import { lightLayer } from './light';
import { transitLayer } from './transit';
import { esc, safeUrl } from './html';
import { Affected, CLOSED_COLOR, SCENARIO_CAVEAT, affectedTowns, closedSites, isClosed, scenarioBox, scenarioOn, scenarioTrip, scenarioVersion, setClosed } from './scenario';
import { NOW_T, provinceOutlook, ago, ageTag, plainAge, alertEvent, alertList, alertOutlines, alertTooltip, alertsInEffect, drawable, freshness, isNow, ms, nowBlock, skTime, tickAges } from './now';


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
  /**
   * A live reading (src/now.ts, public/data/now/). A layer with one ends its `range` at today: the timeline's Now stop.
   * `archiveEnd` is where its archive stops (the gap to Now is hatched, "no record yet"); `asOf` is the reading's time
   * (ms); at Now, main.ts draws `build` on top of the layer's own `build`.
   */
  now?: { asOf: () => number | null; archiveEnd: number; build: (ctx: Ctx) => Layer[]; recent?: RecentSpan };
  /**
   * Model output past the record (src/projections.ts): from `from` to the end of `range`, main.ts hatches the timeline,
   * the readout says "projection", and `bands` (each scenario's range at window centres) draw on the sparkline as bands,
   * never as a line.
   */
  projection?: { from: number; bands: () => { color: string; pts: { x: number; lo: number; hi: number }[] }[] };
}
/**
 * The recent span between a layer's archive and Now, drawn from the daily record of its live feed (src/history.ts).
 * Starts at `from` (the first day after the archive), so a provisional day is never joined to the official record.
 * main.ts loads the feed when the timeline first enters the span, hatches the span before `first()`, draws `spark()`
 * dashed on its own scale, and adds `build` while the time is inside the span.
 */
export type RecentSpan = {
  feed: HistoryFeed; from: number;
  first: () => number | null;
  /** has a record for the day holding `t` (else that day is a gap) */
  covers: (t: number) => boolean;
  spark: () => { x: number; y: number }[];
  build: (ctx: Ctx) => Layer[];
};

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
// WILDFIRES — the Canadian National Fire Database's start points, and the National Burned Area Composite's mapped
// outlines. A fire of 200 ha or more that NBAC outlines (1972 on) is drawn as its outline; every other fire's scar is
// a circle with the same area as the fire, so the burned country is to scale either way. The tooltip says which.

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
  // mapped outlines: each polygon its own row; a start point inside one is drawn by the outline, not a circle
  const perims: BurnPerimeter[] = fires?.perimeters ?? [];
  const outlined = new Set(perims.flatMap((b) => b[4]));
  const circles = points.filter((_, i) => !outlined.has(i));
  type PerimPoly = { b: BurnPerimeter; poly: [number, number][][] };
  const perimPolys: PerimPoly[] = perims.flatMap((b) => b[2].map((poly) => ({ b, poly })));
  const [py0, py1] = fires?.perimeterYears ?? [0, 0];
  /** the biggest start point inside an outline, for its name and cause */
  const mainPoint = (b: BurnPerimeter) => b[4].map((i) => points[i]).sort((a, c) => c[3] - a[3])[0] ?? null;
  // right now: CWFIS satellite hotspots of the last 24 hours and the perimeters it estimates from them
  const nowF = data.now.fires;
  const hotspots = nowF?.hotspots ?? [];
  const perimeters = nowF?.perimeters ?? [];
  const isLive = (id?: string) => !!id?.startsWith('fires-now');
  // the recent span: hotspots kept by the daily record since the archive's last year (heat, not fires; never in the fire statistics)
  const FFROM = y1 + 1;
  let fPts: HistHotspot[] | null = null;
  const fPoints = () => (fPts ??= firesHistory() ? firesHistory()!.points.filter((p) => p[2] >= FFROM) : null) ?? [];
  const fDays = () => (firesHistory()?.sorted ?? []).filter((d) => dayT(d) >= FFROM);
  const firesRecent: RecentSpan = {
    feed: 'fires', from: FFROM,
    first: () => { const d = fDays()[0]; return d ? dayT(d) : null; },
    covers: (t) => t >= FFROM && !!firesHistory()?.covered.has(tDay(t)),
    spark: () => fDays().map((d) => ({ x: dayT(d), y: firesHistory()!.perDay.get(d) ?? 0 })),
    build({ time, speed }) {
      const pts = fPoints();
      if (time < FFROM || !pts.length) return [];
      // about two weeks at 2 yr/s; never less than three days
      const W = Math.max(3 * DAY_T, speed * 0.02);
      const flash = pts.slice(lowerBound(pts, time - W, (p) => p[2]), lowerBound(pts, time, (p) => p[2]));
      return [
        new ScatterplotLayer<HistHotspot>({
          id: 'fires-hist-dots',
          data: pts,
          getPosition: (d) => [d[0], d[1]],
          getRadius: 900,
          radiusMinPixels: 1,
          getFillColor: [255, 214, 140, 60],
          extensions: filterExt,
          getFilterValue: (d) => d[2],
          filterRange: [FFROM, time],
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<HistHotspot>({
          id: 'fires-hist-flash',
          data: flash,
          getPosition: (d) => [d[0], d[1]],
          getRadius: (d) => 2500 + Math.sqrt(d[3] ?? 1) * 900,
          radiusMinPixels: 2,
          getFillColor: (d) => [255, 236, 150, 255 * (1 - (time - d[2]) / W) ** 1.5],
          updateTriggers: { getFillColor: time },
          parameters: ADDITIVE,
        }),
      ];
    },
  };
  /** a hotspot fades with age across the 24-hour window */
  const hotAlpha = (h: Hotspot) => Math.round(255 * Math.max(0.35, 1 - Math.max(0, Date.now() - ms(h[2])) / (24 * 36e5)));
  function firesNow() {
    if (data.now.skipped) return '';
    const fresh = nowF ? freshness(nowF.asOf) : 'old';
    const newest = hotspots.at(-1);
    const north = hotspots.filter((h) => h[1] >= 54).length;
    const body = `<p><b>${hotspots.length}</b> satellite hotspot${hotspots.length === 1 ? '' : 's'} in Saskatchewan in the ${nowF?.hours ?? 24} hours before this reading${newest ? `, the newest seen ${plainAge(newest[2])}` : ''}${hotspots.length && north ? `; ${north} north of 54° N` : ''}. ${perimeters.length ? `${perimeters.length} fire perimeter${perimeters.length === 1 ? '' : 's'} estimated from them (dashed), with heat seen in the last ${nowF?.keepDays ?? 7} days.` : 'No estimated perimeters with heat in the last week.'}</p>
      ${provinceOutlook(data, 'fire')}
      ${fresh !== 'old' ? alertList(alertsInEffect(data, 'fires'), data) : ''}`;
    return nowBlock({ color, asOf: nowF?.asOf ?? null, body, source: nowF?.source ?? '', sourceUrl: nowF?.sourceUrl, missing: 'This copy of the data has no satellite hotspots.' });
  }

  const l: AtlasLayer = {
    id: 'fires',
    name: 'Wildfires',
    icon: '🔥',
    color,
    range: [y0, nowF ? NOW_T : y1 + 0.99],
    available: points.length > 0,
    now: nowF ? {
      asOf: () => ms(nowF.asOf),
      archiveEnd: y1 + 0.99,
      recent: firesRecent,
      build({ clock }) {
        // the list as a whole goes stale (the hourly refresh stopped), not each hotspot: a hotspot is up to 24 h old by design
        if (!drawable(nowF.asOf)) return [];
        const stale = freshness(nowF.asOf) === 'stale';
        const pulse = 0.5 + 0.5 * Math.sin(clock * 3);
        return [
          new PathLayer<any>({
            id: 'fires-now-perims',
            data: perimeters.flatMap((p) => p.polys.map((poly) => ({ p, ring: poly[0] }))),
            getPath: (d) => d.ring,
            getColor: stale ? [150, 150, 160, 200] : [255, 120, 60, 230],
            getWidth: 2,
            widthUnits: 'pixels',
            getDashArray: [6, 4],
            dashJustified: true,
            extensions: dashExt,
            pickable: true,
            parameters: NO_DEPTH,
          } as any),
          new ScatterplotLayer<Hotspot>({
            id: 'fires-now-glow',
            data: hotspots,
            getPosition: (d) => [d[0], d[1]],
            getRadius: (d) => 5000 + Math.sqrt(d[3] ?? 1) * 1800,
            radiusMinPixels: 8,
            getFillColor: (d) => (stale ? [150, 150, 160, 60] : [255, 170, 60, Math.round(hotAlpha(d) * (0.25 + 0.2 * pulse))]),
            updateTriggers: { getFillColor: Math.round(pulse * 20) },
            parameters: ADDITIVE,
          }),
          new ScatterplotLayer<Hotspot>({
            id: 'fires-now-hotspots',
            data: hotspots,
            getPosition: (d) => [d[0], d[1]],
            getRadius: 1500,
            radiusMinPixels: 3,
            getFillColor: (d) => (stale ? [170, 170, 180, 200] : [255, 240, 150, hotAlpha(d)]),
            stroked: true,
            getLineColor: [40, 10, 0, 200],
            lineWidthMinPixels: 0.8,
            pickable: true,
            parameters: NO_DEPTH,
          }),
          ...alertOutlines('fires-now-alerts', alertsInEffect(data, 'fires')),
        ];
      },
    } : undefined,
    unavailable: 'The Canadian National Fire Database could not be downloaded when this copy of the data was built. Run <code>npm run data fires</code>, then reload.',
    build({ time, speed }) {
      const W = glowWindow(speed);
      const plo = lowerBound(points, time - W, (p) => p[2]);
      const phi = lowerBound(points, time, (p) => p[2]);
      const flashing = points.slice(plo, phi);
      return [
        new PolygonLayer<PerimPoly>({
          id: 'fires-perims',
          data: perimPolys,
          getPolygon: (d) => d.poly,
          getFillColor: (d) => (d.b[1] >= 1000 ? [150, 40, 18, 80] : [255, 140, 70, 70]),
          getLineColor: (d) => (d.b[1] >= 1000 ? [210, 80, 40, 150] : [255, 160, 90, 130]),
          getLineWidth: 1,
          lineWidthUnits: 'pixels',
          stroked: true,
          extensions: filterExt,
          getFilterValue: (d) => d.b[3],
          filterRange: [1800, time],
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<FirePoint>({
          id: 'fires-scars',
          data: circles,
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
        ${firesNow()}
        <h2>Where Saskatchewan burns</h2>
        <p class="lede">Every fire the province and Parks Canada reported since ${y0}, at the point it started. New fires flare; each then leaves a scar: ${perims.length ? `its mapped outline where the National Burned Area Composite has one (${fmt.int(perims.length)} burns of 200 ha or more, ${py0}–${py1}), otherwise ` : ''}a circle the size of the area it burned. Almost all of the burning is in the boreal north, and most of it is started by lightning.${nowF ? ' At the <b>Now</b> stop, the pale yellow points are satellite hotspots from the last 24 hours: heat seen from space, not confirmed fires. Gas flares, farm and slash burning show up too.' : ''}</p>`;
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
        <p class="note">${perims.length ? `Outlines are the National Burned Area Composite’s mapped burns (from satellite imagery and agency mapping), simplified to about a twelfth of each burn’s width; a fire under 200 ha, before ${py0} or after ${py1} (the composite’s latest year) is a circle. ` : ''}A circle shows how much ground a fire burned, not its real shape. Older records are less complete, especially for small fires, and much of the far north is an observation zone where fires are watched rather than fought. Prescribed burns are left out.</p>
        ${sourceLine(`${fires?.source ?? ''}${fires?.perimeterSource ? `; ${fires.perimeterSource}` : ''}${fires?.licence ? `. ${fires.licence}` : ''}`)}`);
      return {
        update({ time }) {
          tickAges(el);
          const y = Math.floor(time);
          const cz = causeByYear[y] ?? [0, 0, 0];
          if (nowF && isNow(time, l.range[1])) hero(0, drawable(nowF.asOf) ? fmt.int(hotspots.length) : '–', 'satellite hotspots, last 24 hours');
          else if (nowF && time >= FFROM) {
            const d = tDay(time), n = firesHistory()?.perDay.get(d);
            hero(0, firesRecent.covers(time) ? fmt.int(n ?? 0) : '–', firesRecent.covers(time) ? `satellite hotspots on ${dayText(d)} (not fires)` : `no record for ${dayText(d)}`);
          } else hero(0, fmt.int(countByYear[y] ?? 0), `fires in ${y}`);
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
      const lid = info.layer?.id;
      if (lid?.startsWith('fires-hist') && Array.isArray(info.object)) {
        const [lon, lat, t, frp] = info.object as HistHotspot;
        const { town, km: d } = nearestTown(data.munis, lon, lat);
        return {
          t, layer: 'fires', kind: 'Satellite hotspot (recorded)', lon, lat, zoom: 9,
          title: `Heat seen from a satellite ${d < 5 ? 'at' : 'near'} ${town.name}`,
          body: `A hotspot kept by the atlas’s daily record of CWFIS’s feed${d >= 5 ? `, about ${Math.round(d)} km from ${town.name}` : ''}. It is not a confirmed fire, and hotspots never count in the wildfire statistics.`,
          stats: [{ v: dayText(tDay(t)), l: 'seen (Sask. day)' }, ...(frp != null ? [{ v: `${frp} MW`, l: 'fire radiative power' }] : [])],
          sources: [{ label: 'CWFIS satellite hotspots', url: 'https://cwfis.cfs.nrcan.gc.ca/maps/fm3' }],
        };
      }
      if (isLive(lid)) {
        const x: any = info.object;
        if (x?.a) return alertEvent(x.a, 'fires', data, info.coordinate?.[0], info.coordinate?.[1]);
        if (x?.p) {
          const p = x.p as FirePerimeter;
          const c = p.polys[0][0][0];
          const { town, km: d } = nearestTown(data.munis, c[0], c[1]);
          return {
            layer: 'fires', kind: 'Estimated fire perimeter', lon: c[0], lat: c[1], zoom: 8,
            title: `A fire perimeter ${d < 15 ? 'at' : 'near'} ${town.name}`,
            body: `An outline the Canadian Wildland Fire Information System draws around clusters of satellite hotspots. It is an estimate from heat seen from space, not a mapped perimeter, so it is drawn dashed.`,
            stats: [{ v: fmt.ha(p.ha), l: 'estimated area' }, { v: ago(p.last), l: 'last heat seen' }, { v: skTime(p.first), l: 'first heat seen' }, { v: fmt.int(p.n), l: 'hotspots in it' }],
            sources: [{ label: 'CWFIS fire M3 hotspots and perimeters', url: nowF?.sourceUrl ?? 'https://cwfis.cfs.nrcan.gc.ca/' }],
          };
        }
        if (Array.isArray(x)) {
          const h = x as Hotspot;
          const { town, km: d } = nearestTown(data.munis, h[0], h[1]);
          return {
            layer: 'fires', kind: 'Satellite hotspot', lon: h[0], lat: h[1], zoom: 9,
            title: `Heat seen from a satellite ${d < 5 ? 'at' : 'near'} ${town.name}`,
            body: `A hotspot: a satellite pixel hotter than the ground around it${d >= 5 ? `, about ${Math.round(d)} km from ${town.name}` : ''}. It is not a confirmed fire: gas flares, farm and slash burning and hot industrial sites show up too.`,
            stats: [{ v: ago(h[2]), l: `seen (${skTime(h[2])}, Sask. time)` }, ...(h[3] != null ? [{ v: `${h[3]} MW`, l: 'fire radiative power' }] : []), ...(h[4] ? [{ v: h[4], l: 'sensor' }] : [])],
            sources: [{ label: 'CWFIS satellite hotspots', url: nowF?.sourceUrl ?? 'https://cwfis.cfs.nrcan.gc.ca/' }],
          };
        }
        return null;
      }
      if (lid === 'fires-perims') {
        const { b } = info.object as PerimPoly;
        const mp = mainPoint(b);
        const [lon, lat] = mp ? [mp[0], mp[1]] : (info.coordinate as [number, number] | undefined) ?? b[2][0][0][0];
        const { town, km: d } = nearestTown(data.munis, lon, lat);
        const nmd = mp ? fireName(mp) : null;
        return {
          t: b[3], layer: 'fires', kind: 'Mapped burn outline', lon, lat, zoom: b[1] > 20000 ? 7.5 : 9,
          title: `${nmd ? `${nmd[0].toUpperCase()}${nmd.slice(1)}: ` : ''}${fmt.ha(b[1])} burned ${d < 5 ? 'at' : 'near'} ${town.name}, ${b[0]}`,
          body: `The outline the National Burned Area Composite maps for this burn, from satellite imagery and agency mapping, simplified for the map. ${b[4].length ? `${b[4].length === 1 ? 'One reported fire starts' : `${b[4].length} reported fires start`} inside it${mp ? `; the largest was ${['started by lightning', 'started by people', 'of unknown cause'][mp[4]]}` : ''}.` : 'No reported fire of that year starts inside it, so it appears at the start date the composite gives.'} The area is the composite’s, less unburned islands where it maps them, so it can differ from the size the fire was reported at.`,
          stats: [{ v: fmt.ha(b[1]), l: 'mapped burned area' }, { v: String(b[0]), l: 'year' }, ...(mp ? [{ v: CAUSE[mp[4]].name, l: 'cause' }, { v: fmt.ha(mp[3]), l: 'reported size' }] : [])],
          sources: [{ label: 'National Burned Area Composite (CWFIS)', url: safeUrl(fires?.perimeterUrl) ?? 'https://cwfis.cfs.nrcan.gc.ca/ha/nbac' }],
        };
      }
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
      if (info.layer?.id.startsWith('fires-hist') && Array.isArray(o)) return `<b>Satellite hotspot</b> <span class="tk">recorded, not a confirmed fire</span><br><span class="tk">Seen</span> <span class="tv">${dayText(tDay(o[2]))}</span>${o[3] != null ? `<br><span class="tk">Fire radiative power</span> <span class="tv">${o[3]} MW</span>` : ''}`;
      if (isLive(info.layer?.id)) {
        if (o?.a) return alertTooltip(o.a);
        if (o?.p) return `<b>Estimated fire perimeter</b><br><span class="tk">Area</span> <span class="tv">${fmt.ha(o.p.ha)}</span><br><span class="tk">Last heat seen</span> <span class="tv">${ago(o.p.last)}</span>`;
        if (Array.isArray(o)) return `<b>Satellite hotspot</b> <span class="tk">not a confirmed fire</span><br><span class="tk">Seen</span> <span class="tv">${ago(o[2])}</span>${o[3] != null ? `<br><span class="tk">Fire radiative power</span> <span class="tv">${o[3]} MW</span>` : ''}`;
        return null;
      }
      if (info.layer?.id === 'fires-perims' && o?.b) {
        const b = o.b as BurnPerimeter, mp = mainPoint(b);
        return `<b>${mp?.[5] ? `${esc(mp[5])} fire` : `Burn of ${b[0]}`}</b> <span class="tk">mapped outline</span><br><span class="tk">Mapped area</span> <span class="tv">${fmt.ha(b[1])}</span>${mp ? `<br><span class="tk">Reported</span> <span class="tv">${isoDate(mp[2])}</span><br><span class="tk">Cause</span> ${CAUSE[mp[4]].name}` : `<br><span class="tk">Year</span> <span class="tv">${b[0]}</span>`}`;
      }
      if (!Array.isArray(o)) return null;
      return `<b>${o[5] ? `${esc(o[5])} fire` : 'Wildfire'}</b>${info.layer?.id === 'fires-scars' ? ' <span class="tk">circle of the same area, no mapped outline</span>' : ''}<br><span class="tk">Reported</span> <span class="tv">${isoDate(o[2])}</span><br><span class="tk">Burned</span> <span class="tv">${o[3] < 1 ? '<1 ha' : fmt.ha(o[3])}</span><br><span class="tk">Cause</span> ${CAUSE[o[4]].name}`;
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
  // flood-prone land: the Water Security Agency's published 1:500-year mapping, the same at every point of the timeline
  const FL = data.floods;
  const FLOOD_KIND: Record<FloodZone['kind'], { label: string; fill: RGBA; line: RGBA }> = {
    '500': { label: '1:500-year flood extent', fill: [76, 201, 240, 60], line: [140, 225, 255, 170] },
    fringe: { label: 'flood fringe (1:500-year)', fill: [60, 140, 235, 90], line: [120, 180, 255, 190] },
    floodway: { label: 'floodway (1:500-year, deepest and fastest water)', fill: [40, 80, 220, 140], line: [110, 150, 255, 220] },
    protected: { label: 'protected by dikes', fill: [150, 160, 180, 50], line: [190, 200, 220, 170] },
  };
  const floodPolys = (FL?.zones ?? []).flatMap((z) => z.polys.map((polygon) => ({ z, polygon })))
    .sort((a, b) => ['500', 'protected', 'fringe', 'floodway'].indexOf(a.z.kind) - ['500', 'protected', 'fringe', 'floodway'].indexOf(b.z.kind));
  const floodPlaces = [...new Set((FL?.zones ?? []).map((z) => z.place))].sort();
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
  // right now: each gauge's latest real-time reading (public/data/now/rivers.json)
  const nowR = data.now.rivers;
  const gauge = new Map(stations.map((s) => [s.id, s]));
  const nowRows = (nowR?.rows ?? []).flatMap((row) => { const s = gauge.get(row[0]); return s ? [{ s, row }] : []; });
  const liveOf = new Map(nowRows.map((d) => [d.s.id, d]));
  const FLAG: Record<string, string> = { ice: 'ice-affected', est: 'estimated', dry: 'dry', other: 'flagged' };
  const STALE: [number, number, number, number] = [130, 140, 155, 190];
  const ratioText = (r: number) => (r >= 0.095 ? `${r.toFixed(r >= 1 ? 1 : 2)}×` : r > 0 ? '<0.1×' : '0×');
  // the recent span: each day's highest real-time flow against the normal peak, from the daily record (provisional)
  const RFROM = y1 + 1;
  const rDays = () => (riversHistory()?.sorted ?? []).filter((d) => dayT(d) >= RFROM);
  const rRows = (d: string) => (riversHistory()?.days.get(d) ?? []).flatMap((h) => { const s = gauge.get(h.id); return s?.median ? [{ s, h, r: h.max / s.median, day: d }] : []; });
  let rSpark: { x: number; y: number }[] | null = null;
  const riversRecent: RecentSpan = {
    feed: 'rivers', from: RFROM,
    first: () => { const d = rDays()[0]; return d ? dayT(d) : null; },
    covers: (t) => t >= RFROM && !!riversHistory()?.days.has(tDay(t)),
    spark: () => (rSpark ??= riversHistory() ? rDays().map((d) => { const rows = rRows(d); return { x: dayT(d), y: rows.length ? rows.filter((x) => x.r >= 1.5).length / rows.length : 0 }; }) : null) ?? [],
    build({ time }) {
      if (time < RFROM) return [];
      return [new ColumnLayer<any>({
        id: 'rivers-hist-cols',
        data: rRows(tDay(time)),
        getPosition: (d) => [d.s.lon, d.s.lat],
        radius: 3800,
        diskResolution: 24,
        extruded: true,
        getElevation: (d) => d.r * 27000,
        getFillColor: (d) => rgb(ratioColor(d.r), 150),
        material: { ambient: 0.6, diffuse: 0.6, shininess: 20 },
        pickable: true,
        updateTriggers: { getElevation: tDay(time), getFillColor: tDay(time) },
      })];
    },
  };
  const liveValue = (row: NowRiverRow) => (row[4] != null ? `${ratioText(row[4])} normal peak · ${row[3]} m³/s` : row[2] != null ? `level ${row[2]} m` : 'no value');
  /** The panel's Right now block: gauges reporting, the highest against normal, flags, and alerts. */
  function riversNow() {
    if (data.now.skipped) return '';
    const rows = nowRows.filter((d) => drawable(d.row[1]));
    const flow = rows.filter((d) => d.row[4] != null).sort((a, b) => b.row[4]! - a.row[4]!);
    const flagged = rows.filter((d) => d.row[5]).length;
    const body = `<p>${rows.length} of ${stations.length} gauges have reported in the past day, ${flow.length} of them with a flow. At the <b>Now</b> stop each column is the latest flow against the river’s normal annual peak. A silent gauge shows no reading, not zero: many are seasonal and shut for the winter.${flagged ? ` ${flagged} reading${flagged === 1 ? ' is' : 's are'} flagged ice-affected or estimated (amber ring).` : ''} Real-time data are provisional.</p>
      ${flow.length ? `<div class="now-list">${flow.slice(0, 5).map((d) => `<div><b>${ratioText(d.row[4]!)}</b> ${esc(d.s.name)} <span class="tk">${d.row[3]} m³/s${d.row[5] ? ` · ${FLAG[d.row[5]]}` : ''}</span> ${ageTag(d.row[1])}</div>`).join('')}</div>` : ''}
      ${alertList(alertsInEffect(data, 'rivers'), data)}`;
    return nowBlock({ color, asOf: nowR?.asOf ?? null, body, source: nowR?.source ?? '', sourceUrl: nowR?.sourceUrl, missing: 'This copy of the data has no real-time river readings.' });
  }

  const l: AtlasLayer = {
    id: 'rivers',
    name: 'River floods',
    icon: '≋',
    color,
    range: [y0, nowR ? NOW_T : y1 + 0.99],
    available: !!data.rivers,
    now: nowR ? {
      asOf: () => ms(nowR.asOf),
      archiveEnd: y1 + 0.99,
      recent: riversRecent,
      build() {
        // the file's own time rules first: a reading older than DROP_H is not drawn, an old one is grey
        if (!drawable(nowR.asOf)) return [];
        const rows = nowRows.filter((d) => drawable(d.row[1]));
        const stale = (d: (typeof rows)[number]) => freshness(d.row[1]) === 'stale' || freshness(nowR.asOf) === 'stale';
        return [
          new ColumnLayer<any>({
            id: 'rivers-now-cols',
            data: rows.filter((d) => d.row[4] != null),
            getPosition: (d) => [d.s.lon, d.s.lat],
            radius: 3800,
            diskResolution: 24,
            extruded: true,
            getElevation: (d) => d.row[4] * 27000,
            getFillColor: (d) => (stale(d) ? STALE : rgb(ratioColor(d.row[4]), 235)),
            material: { ambient: 0.6, diffuse: 0.6, shininess: 40 },
            pickable: true,
          }),
          // a gauge that reads only a level (a lake, a reservoir) gets a dot: there is no flow to compare
          new ScatterplotLayer<any>({
            id: 'rivers-now-level',
            data: rows.filter((d) => d.row[4] == null),
            getPosition: (d) => [d.s.lon, d.s.lat],
            getRadius: 2600,
            radiusMinPixels: 3,
            getFillColor: (d) => (stale(d) ? STALE : [210, 240, 255, 220]),
            pickable: true,
            parameters: NO_DEPTH,
          }),
          // ice-affected or estimated readings: an amber ring
          new ScatterplotLayer<any>({
            id: 'rivers-now-flags',
            data: rows.filter((d) => d.row[5]),
            getPosition: (d) => [d.s.lon, d.s.lat],
            getRadius: 6500,
            radiusMinPixels: 6,
            stroked: true,
            filled: false,
            lineWidthMinPixels: 1.5,
            getLineColor: [255, 196, 90, 230],
            pickable: true,
            parameters: NO_DEPTH,
          }),
          ...alertOutlines('rivers-now-alerts', alertsInEffect(data, 'rivers')),
        ];
      },
    } : undefined,
    build({ time, speed }) {
      const y = Math.floor(time);
      const W = glowWindow(speed, 1.2);
      const live = stations.map((s) => ({ s, r: interpYearly(Object.fromEntries(Object.entries(s.peaks).map(([k, v]) => [k, v / s.median])), time) }));
      const ripples = stations
        .map((s) => ({ s, r: ratio(s, y), t: peakT(s, y) }))
        .filter((d) => d.r != null && d.r >= 1.5 && time >= d.t && time - d.t < W);
      return [
        ...(floodPolys.length ? [new PolygonLayer<(typeof floodPolys)[number]>({
          id: 'rivers-flood-base',
          data: floodPolys,
          getPolygon: (d) => d.polygon,
          getFillColor: (d) => FLOOD_KIND[d.z.kind].fill,
          getLineColor: (d) => FLOOD_KIND[d.z.kind].line,
          lineWidthMinPixels: 1,
          stroked: true,
          extruded: false,
          pickable: true,
          parameters: NO_DEPTH,
        } as any)] : []),
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
        ${riversNow()}
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
        ${FL ? `<h3>Flood-prone land · the 1:${FL.returnPeriod}-year flood</h3>
        <p class="note" style="margin-top:0">Shaded on the map in ${floodPlaces.length} communities the Water Security Agency has studied: the land a <b>1:${FL.returnPeriod}-year flood</b> (a 0.2% chance in any year) would cover, as the agency modelled it, not as this atlas computes it. Where the Flood Damage Reduction Program mapped it, the darker floodway is where water runs deepest and fastest; the flood fringe is the rest. It is not a forecast, and it says nothing about this year’s river levels. Most of the province has no published flood map: no shading does not mean no risk.</p>
        <div class="legend">${(['500', 'fringe', 'floodway', 'protected'] as const).map((k) => `<span><i class="sw" style="background:rgba(${FLOOD_KIND[k].fill.slice(0, 3).join(',')},${Math.max(0.35, FLOOD_KIND[k].fill[3] / 255)});box-shadow:0 0 0 1px rgba(${FLOOD_KIND[k].line.slice(0, 3).join(',')},.9)"></i>${FLOOD_KIND[k].label}</span>`).join('')}</div>
        <p class="note">${floodPlaces.map(esc).join(' · ')}</p>
        ${sourceLine(`${FL.source}, read ${FL.asOf}. ${FL.licence}`)}` : ''}
        ${sourceLine(data.rivers?.source ?? '')}`);
      return {
        update({ time }) {
          tickAges(el);
          const y = Math.floor(time);
          const sh = share[y];
          if (nowR && isNow(time, l.range[1])) {
            const flow = nowRows.filter((d) => drawable(d.row[1]) && d.row[4] != null);
            hero(0, String(flow.filter((d) => d.row[4]! >= 1.5).length), `of ${flow.length} gauges at 1.5× their normal peak right now`);
          } else if (nowR && time >= RFROM) {
            const rows = rRows(tDay(time));
            hero(0, rows.length ? String(rows.filter((x) => x.r >= 1.5).length) : '–', rows.length ? `of ${rows.length} gauges ≥1.5× on ${dayText(tDay(time))} (provisional)` : `no record for ${dayText(tDay(time))}`);
          } else hero(0, sh ? `${sh.high}` : '–', sh ? `of ${sh.n} gauges ≥1.5× in ${y}` : `no gauge data in ${y}`);
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
      if (o.a) return alertEvent(o.a, 'rivers', data, info.coordinate?.[0], info.coordinate?.[1]);
      if (o.z && FL) {
        const z = o.z as FloodZone;
        const pdf = z.pdf ? safeUrl(z.pdf) : null;
        return {
          layer: 'rivers', kind: 'Flood-prone land', lon: info.coordinate?.[0], lat: info.coordinate?.[1], zoom: 12,
          title: `${z.place}: ${FLOOD_KIND[z.kind].label}`,
          body: `Land the Water Security Agency mapped as ${FLOOD_KIND[z.kind].label}${z.water ? ` along ${z.water}` : ''}: what a 1:${FL.returnPeriod}-year flood (a 0.2% chance in any year) would cover, as the agency modelled it${z.program ? ` for the ${z.program}` : ''}${z.year ? ` (${z.year})` : ''}. A published hazard map, not a forecast or a record.`,
          sources: [{ label: 'Water Security Agency GeoHub', url: FL.sourceUrl }, ...(pdf ? [{ label: 'Flood map (PDF)', url: pdf }] : [])],
        };
      }
      const st = o.s ?? o;
      const lv = liveOf.get(st.id);
      const years = Object.keys(st.peaks).map(Number).sort((a, b) => a - b);
      if (!years.length) return null;
      const rec = years.reduce((a, y) => (st.peaks[y] > st.peaks[a] ? y : a), years[0]);
      const high = years.filter((y) => st.peaks[y] / st.median >= 1.5).length;
      return {
        layer: 'rivers', kind: 'River gauge', lon: st.lon, lat: st.lat, zoom: 9.5,
        title: st.name, body: `Water Survey of Canada gauge ${st.id}, ${years.length} years of record (${years[0]}–${years.at(-1)}). Each bar is a year's highest flow against the river's normal annual peak.`,
        stats: [
          ...(lv && drawable(lv.row[1]) ? [{ v: liveValue(lv.row), l: `right now, read ${ago(lv.row[1])}${lv.row[5] ? ` (${FLAG[lv.row[5]]})` : ''}${freshness(lv.row[1]) === 'stale' ? ' · stale' : ''}` }] : nowR ? [{ v: 'no reading', l: 'in the past day (many gauges are seasonal)' }] : []),
          { v: `${st.median} m³/s`, l: 'normal annual peak' }, { v: `${(st.peaks[rec] / st.median).toFixed(1)}×`, l: `record, ${rec}` }, { v: `${high} of ${years.length}`, l: 'years at 1.5× normal or more' }, ...(st.area ? [{ v: `${fmt.int(st.area)} km²`, l: 'drains' }] : [])],
        detail: detailBars('Peak flow each year, against normal', years.map((y) => ({ x: y, y: st.peaks[y] / st.median, color: ratioColor(st.peaks[y] / st.median) })), color, (v) => `${v.toFixed(1)}×`, (d) => `<b>${d.x}</b> · ${d.y.toFixed(2)}× normal`),
        sources: [{ label: 'HYDAT, Environment and Climate Change Canada', url: 'https://wateroffice.ec.gc.ca/' }],
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('rivers')) return null;
      if (o.a) return alertTooltip(o.a);
      if (o.z) return `<b>${esc(o.z.place)}</b><br><span class="tk">${FLOOD_KIND[o.z.kind as FloodZone['kind']].label}</span>${o.z.water ? `<br><span class="tk">${esc(o.z.water)}</span>` : ''}<br><span class="tk">Water Security Agency mapping, not a forecast</span>`;
      const s = o.s ?? o;
      const rec = Object.entries(s.peaks as Record<string, number>).reduce((a, b) => (b[1] > a[1] ? b : a));
      const lv = o.row as NowRiverRow | undefined;
      if (o.h) return `<b>${esc(s.name)}</b> <span class="tk">provisional</span><br><span class="tk">${dayText(o.day)}</span> <span class="tv">${ratioText(o.r)} normal peak at its highest</span><br><span class="tk">Flow that day</span> <span class="tv">${o.h.min}–${o.h.max} m³/s, mean ${o.h.mean}</span><br><span class="tk">Readings</span> <span class="tv">${o.h.n}</span>${o.h.flag ? `<br><span class="tk">Flagged</span> <span class="tv">${FLAG[o.h.flag] ?? 'flagged'}</span>` : ''}`;
      return `<b>${esc(s.name)}</b><br><span class="tk">Gauge</span> <span class="tv">${esc(s.id)}</span>${lv ? `<br><span class="tk">Right now</span> <span class="tv">${liveValue(lv)}</span><br><span class="tk">Read</span> <span class="tv">${ago(lv[1])}${freshness(lv[1]) === 'stale' ? ' · stale' : ''}</span>${lv[5] ? `<br><span class="tk">Flagged</span> <span class="tv">${FLAG[lv[5]]}</span>` : ''}` : ''}${o.r != null ? `<br><span class="tk">This year</span> <span class="tv">${o.r.toFixed(2)}× normal</span>` : ''}<br><span class="tk">Normal annual peak</span> <span class="tv">${s.median} m³/s</span><br><span class="tk">Record</span> <span class="tv">${rec[1]} m³/s (${rec[0]})</span>`;
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
  // past the record: ClimateData.ca's projections at the atlas's places (src/projections.ts), to 2100, hatched
  const P = data.projections;
  const PFROM = y1 + 1;
  const SCENS: ProjScen[] = ['ssp126', 'ssp585'];
  // the projections are changes from 1971–2000; the record's anomalies are from 1961–1990. The record's own mean anomaly
  // over 1971–2000 moves one onto the other (a province-wide shift, from the atlas's own stations, not from a model)
  const r7100 = ys.filter((y) => y >= 1971 && y <= 2000).map((y) => anomalies[y]);
  const SHIFT = r7100.length >= 20 ? d3.mean(r7100) ?? 0 : 0;
  const projRamp = d3.scaleLinear<string>().domain([0, 2, 4, 7]).range(['#9aa3b2', '#f4a08a', '#e0312b', '#7a1036']).clamp(true);
  const projH = (v: number) => 3600 + Math.max(0, v) * 30000;
  let bandsMemo: ReturnType<typeof provinceBand>[] | null = null;
  const bands = () => (bandsMemo ??= P ? SCENS.map((sc) => provinceBand(P, sc, 'tg', SHIFT)) : []);
  type ProjCol = { m: Muni; lo: number; hi: number; spreadLo: number; spreadHi: number; t: number };
  let projMemo: { t: number; rows: ProjCol[] } | null = null;
  const projCols = (time: number): ProjCol[] => {
    if (!P) return [];
    const t = Math.round(time * 4) / 4;
    if (projMemo?.t === t) return projMemo.rows;
    const rows = data.munis.flatMap((m) => {
      const a = projAt(P, m.key, 'tg', 'ssp126', t, SHIFT), b = projAt(P, m.key, 'tg', 'ssp585', t, SHIFT);
      return a && b ? [{ m, lo: a.med, hi: b.med, spreadLo: Math.min(a.lo, b.lo), spreadHi: Math.max(a.hi, b.hi), t }] : [];
    });
    projMemo = { t, rows };
    return rows;
  };
  // the published window nearest a time (between centres the map interpolates, and says so)
  const windowOf = (t: number) => {
    const ws = P?.windows ?? [];
    const w = ws.reduce((a, b) => (Math.abs(b + 15 - t) < Math.abs(a + 15 - t) ? b : a), ws[0] ?? 2041);
    return Math.abs(w + 15 - t) < 1 || t >= ws[ws.length - 1] + 15 ? `${windowText(w)} average` : `near the ${windowText(w)} average (interpolated)`;
  };

  const l: AtlasLayer = {
    id: 'climate',
    name: 'Climate',
    icon: '🌡',
    color,
    range: [y0, P ? 2100.99 : y1 + 0.99],
    available: !!data.climate,
    projection: P ? { from: PFROM, bands: () => bands().map((b, i) => ({ color: SCEN_COLOR[SCENS[i]], pts: b })) } : undefined,
    build({ time, focusedId }) {
      if (P && time >= PFROM) {
        // a projection: a wire frame for the high-emissions median around a solid core for the low one, so every place
        // shows a range, and nothing on the map looks like a measured column
        const rows = projCols(time);
        const out: Layer[] = [
          new ColumnLayer<ProjCol>({
            id: 'climate-proj-hi', data: rows, getPosition: (d) => [d.m.lon, d.m.lat], radius: 9000, diskResolution: 6, extruded: true,
            filled: false, wireframe: true, getElevation: (d) => projH(d.hi), getLineColor: (d) => rgb(projRamp(d.hi), 230), pickable: true,
            updateTriggers: { getElevation: rows, getLineColor: rows },
          } as any),
          new ColumnLayer<ProjCol>({
            id: 'climate-proj-lo', data: rows, getPosition: (d) => [d.m.lon, d.m.lat], radius: 4500, diskResolution: 6, extruded: true,
            getElevation: (d) => projH(d.lo), getFillColor: (d) => rgb(projRamp(d.lo), 150), material: { ambient: 0.65, diffuse: 0.5 }, pickable: true,
            updateTriggers: { getElevation: rows, getFillColor: rows },
          }),
        ];
        if (focusedId === 'climate')
          out.push(new TextLayer<ProjCol>({
            id: 'climate-proj-labels', data: rows, getPosition: (d) => [d.m.lon, d.m.lat, projH(d.hi) + 7000],
            getText: (d) => `${rangeText(d.lo, d.hi)}°`, getSize: 11, getColor: [255, 214, 200, 230], characterSet: 'auto',
            fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, outlineWidth: 3, outlineColor: [6, 10, 18, 220], fontSettings: { sdf: true },
            billboard: true, updateTriggers: { getText: rows, getPosition: rows }, parameters: NO_DEPTH,
          } as any));
        return out;
      }
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
      el.innerHTML = `${kicker(l, P ? 'Homogenized temperature record · and projections' : 'Homogenized temperature record')}
        <h2>A warming prairie</h2>
        <p class="lede">Annual mean temperature at ${stations.length} long-running weather stations, shown as the difference from each station’s 1961–1990 average. Columns grow and redden as years run warm; blue means cooler than normal.${P ? ` Past ${y1} the timeline runs on to 2100, hatched: there it shows <b>published model projections</b>, not a record, as a range between a low- and a high-emissions future.` : ''}</p>
        <div class="proj-now" hidden>${PROJ_BADGE}</div>`;
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Saskatchewan warming stripes (${y0}–${y1})</h3>`);
      const setA = deferChart(el.appendChild(mk('div')), (c) =>
        stripes(c, { cells: ys.map((x) => ({ x, color: div(anomalies[x]), label: `<b>${x}</b><br>${fmt.signed(anomalies[x], 2)} °C vs 1961–90` })), xDomain: [y0, y1], height: 50 }),
      );
      const barTip = (d: { x: number; y: number }) => `<b>${d.x}</b><br>${fmt.signed(d.y, 2)} °C vs 1961–90`;
      el.insertAdjacentHTML('beforeend', P ? `<h3>Anomaly by year, then projected (°C vs 1961–90)</h3>` : `<h3>Anomaly by year (°C)</h3>`);
      const setB = deferChart(el.appendChild(mk('div')), (c) =>
        P
          ? bandChart(c, {
              bars: l.spark(), from: PFROM, xDomain: [y0, 2100], height: 160, yFormat: (v) => fmt.signed(v, 0), barTip,
              bands: bands().map((b, i) => ({ label: `${SCEN_SHORT[SCENS[i]]}`, color: SCEN_COLOR[SCENS[i]], pts: b })),
              bandTip: (x, rows) => `<b>${windowOf(x)}</b> · projection<br>${rows.map((r) => `<span class="sw" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${r.color};margin-right:6px"></span>${r.label}: <span class="tv">${fmt.signed(r.med, 1)}</span> (models ${fmt.signed(r.lo, 1)} to ${fmt.signed(r.hi, 1)})`).join('<br>')}`,
            })
          : barChart(c, { data: l.spark(), xDomain: [y0, y1], color, height: 120, diverging: true, yFormat: (v) => fmt.signed(v, 1), tooltip: barTip }),
      );
      el.insertAdjacentHTML('beforeend', `
        <div class="ramp" style="background:${rampCSS((t) => div(-1.5 + t * 3))}"></div>
        <div class="ramp-labels"><span>−1.5 °C</span><span>normal</span><span>+1.5 °C</span></div>
        <div class="callout" style="--c:${color}">Since 1950 Saskatchewan’s long-running stations have warmed about <b>${trend != null ? (trend * 10).toFixed(2) : '–'} °C per decade</b>. On the prairies the warming is strongest in winter.</div>
        <p class="note">AHCCD data are adjusted by Environment and Climate Change Canada to remove artificial jumps from station moves and instrument changes, so long-term trends are comparable. Series currently end in ${y1}.</p>`);
      if (P) {
        const VARS: ProjVar[] = ['tg', 'tx', 'tn', 'pr'];
        const unit = (v: ProjVar) => (P.vars[v].unit === 'mm' ? ' mm' : ' °C');
        const dp = (v: ProjVar) => (P.vars[v].unit === '°C' ? 1 : 0);
        const cell = (v: ProjVar, w: number) => { const a = provinceMedian(P, v, 'ssp126', w), b = provinceMedian(P, v, 'ssp585', w); return a != null && b != null ? `${rangeText(a, b, dp(v))}${unit(v)}` : '–'; };
        el.insertAdjacentHTML('beforeend', `
          <h3>What the models project ${PROJ_BADGE}</h3>
          <div class="legend"><span><i class="sw proj-sw" style="--c:${SCEN_COLOR.ssp126}"></i>${P.scenarios.ssp126}</span><span><i class="sw proj-sw" style="--c:${SCEN_COLOR.ssp585}"></i>${P.scenarios.ssp585}</span></div>
          <table class="proj-table"><thead><tr><th>Change from ${esc(P.baseline)}</th>${P.windows.map((w) => `<th>${windowText(w)}</th>`).join('')}</tr></thead>
          <tbody>${VARS.map((v) => `<tr><td>${esc(P.vars[v].label)}</td>${P.windows.map((w) => `<td>${cell(v, w)}</td>`).join('')}</tr>`).join('')}</tbody></table>
          <p class="note">Each cell runs from the low-emissions to the high-emissions projection: the middle (median) of ${'26'} models for the median place in the atlas, as a 30-year average. The models’ own spread, their ${P.percentiles[0]}th to ${P.percentiles[1]}th percentile, is wider still: hover the chart above. On the map, past ${y1}, each place shows a solid core for the low-emissions median and a wire frame for the high-emissions one. Between the published windows the map and the chart interpolate, and 1971–2000 is where every model’s change is zero. To continue the record, the chart and the map add ${fmt.signed(SHIFT, 2)} °C, the stations’ own average anomaly over 1971–2000, so both read against 1961–1990; the table does not. Projections are statistically downscaled CMIP6 models (CanDCS-U6) for each place’s ~10 km grid cell, not a forecast of any one year, and they never rank towns in the Town Finder.</p>
          ${sourceLine(`${P.source}, read ${P.asOf}. ${P.licence}`)}`);
      }
      el.insertAdjacentHTML('beforeend', sourceLine(data.climate?.source ?? ''));
      const badge = el.querySelector<HTMLElement>('.proj-now')!;
      return {
        update({ time }) {
          const projected = !!P && time >= PFROM;
          badge.hidden = !projected;
          if (projected) {
            const rows = projCols(time);
            const lo = d3.mean(rows, (r) => r.lo) ?? 0, hi = d3.mean(rows, (r) => r.hi) ?? 0;
            hero(0, `${rangeText(lo, hi)}°`, `projected, ${windowOf(time)}`);
            hero(1, String(warmest), `warmest year on record (${fmt.signed(anomalies[warmest])}°)`);
            hero(2, `${rangeText(d3.min(rows, (r) => r.spreadLo) ?? 0, d3.max(rows, (r) => r.spreadHi) ?? 0)}°`, `${P!.percentiles[0]}th–${P!.percentiles[1]}th pct., any place`);
            hero(3, trend != null ? `${fmt.signed(trend * 10, 2)}°` : '–', 'per decade since 1950 (record)');
          } else {
            const y = Math.floor(time);
            const a = anomalies[y];
            hero(0, a != null ? `${fmt.signed(a)}°` : '–', `provincial anomaly ${y}`);
            hero(1, String(warmest), `warmest year (${fmt.signed(anomalies[warmest])}°)`);
            const recent = ys.filter((x) => x > y1 - 10).map((x) => anomalies[x]);
            hero(2, `${fmt.signed(d3.mean(recent) ?? 0)}°`, `${y1 - 9}–${y1} average`);
            hero(3, trend != null ? `${fmt.signed(trend * 10, 2)}°` : '–', 'per decade since 1950');
          }
          setA(time); setB(time);
        },
      };
    },
    describe(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('climate')) return null;
      if (info.layer.id.startsWith('climate-proj') && P) {
        const c = o as ProjCol;
        const row = (sc: ProjScen, w: number) => projAt(P, c.m.key, 'tg', sc, w + 15, SHIFT);
        return {
          layer: 'climate', kind: 'Climate projection', lon: c.m.lon, lat: c.m.lat, zoom: 8,
          title: `${c.m.name}: projected warming`,
          body: `Projection, not a record. Mean temperature, ${windowOf(c.t)}, against 1961–1990: ${rangeText(c.lo, c.hi)} °C, from the middle of the models under low emissions to the middle under high emissions; the models’ ${P.percentiles[0]}th–${P.percentiles[1]}th percentile ${rangeText(c.spreadLo, c.spreadHi)} °C.`,
          stats: P.windows.map((w) => { const a = row('ssp126', w), b = row('ssp585', w); return { v: a && b ? `${rangeText(a.med, b.med)}°` : '–', l: `${windowText(w)} (projection)` }; }),
          sources: [{ label: 'CanDCS-U6 (open.canada.ca)', url: P.sourceUrl }],
        };
      }
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
      if (info.layer.id.startsWith('climate-proj')) {
        const c = o as ProjCol;
        return `<b>${esc(c.m.name)}</b> <span class="proj-badge">projection</span><br><span class="tk">${windowOf(c.t)}</span> <span class="tv">${rangeText(c.lo, c.hi)} °C vs 1961–90</span><br><span class="tk">low to high emissions (model medians); ${P!.percentiles[0]}th–${P!.percentiles[1]}th percentile ${rangeText(c.spreadLo, c.spreadHi)} °C</span>`;
      }
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

export const dashExt = [new PathStyleExtension({ dash: true })];

function hospitalsLayer(data: Data): AtlasLayer {
  const color = '#6c8cff';
  const H = data.hospitals;
  const fac: Facility[] = H?.facilities ?? [];
  const routed = !!H && H.routing !== 'straight-line';
  const unit = routed ? 'min' : 'km';
  const tripsOf = (key: string) => H?.towns[key];
  const tv = (t: Trip) => t.min ?? t.km;
  // a place's trip to its nearest hospital: the real one, or under a closure scenario (src/scenario.ts) the nearest open
  // one the stage kept; `beyond` when every kept hospital is closed (the drive is then longer than the last kept one)
  const nearest = (key: string): { t: Trip; beyond: boolean } | null => {
    const trips = tripsOf(key);
    if (!trips?.length) return null;
    if (!scenarioOn('hospitals')) return { t: trips[0], beyond: false };
    const { trip, beyond } = scenarioTrip('hospitals', trips);
    return trip ? { t: trip, beyond: false } : beyond ? { t: beyond, beyond: true } : null;
  };
  const val = (key: string) => { const n = nearest(key); return n ? tv(n.t) : null; };
  const ramp = d3.scaleLinear<string>().domain([5, 45, 150]).range(['#e3f1ff', color, '#e0457b']).interpolate(d3.interpolateRgb).clamp(true);
  const height = (v: number) => 3600 + Math.min(v, 300) * 600;
  const edColor = (f: Facility) => (f.hospital ? color : '#7d879c');
  const tripText = (t: Trip) => (t.min != null ? `${t.min} min` : `${Math.round(t.km)} km (straight line)`);
  const addText = (a: Affected) => (a.added == null ? `more than +${Math.round(tv(a.beyond!) - tv(a.before))} ${unit}` : `+${Math.round(a.added)} ${unit}`);

  // road lines: the hovered / selected town's (its nearest and next, or under a scenario its closed and new routes), and
  // with a scenario and nothing hovered, every affected town's new route. Cumulative lengths drive the travelling pulse.
  type RowKind = 'near' | 'alt' | 'closed' | 'new';
  type Row = { t: Trip; kind: RowKind; label: boolean; path: [number, number][]; cum: number[] };
  const row = (m: Muni, t: Trip, kind: RowKind, label: boolean): Row => {
    const path: [number, number][] = t.line ?? [[m.lon, m.lat], [fac[t.f].lon, fac[t.f].lat]];
    const cum = [0];
    for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], (path[k][1] - path[k - 1][1]) * 1.5));
    return { t, kind, label, path, cum };
  };
  let memoKey: string | null = null;
  let memoRows: Row[] = [];
  const rowsFor = (key: string | null) => {
    const mk = `${key}|${scenarioVersion}`;
    if (mk === memoKey) return memoRows;
    memoKey = mk;
    const m = data.munis.find((x) => x.key === key);
    const trips = m ? tripsOf(m.key) ?? [] : [];
    if (!scenarioOn('hospitals')) {
      memoRows = m ? trips.slice(0, 2).map((t, i) => row(m, t, i === 0 ? 'near' : 'alt', true)) : [];
    } else if (m) {
      const n = nearest(m.key);
      memoRows = [
        ...(trips[0] && isClosed('hospitals', trips[0].f) ? [row(m, trips[0], 'closed', true)] : []),
        ...(n && !n.beyond ? [row(m, n.t, n.t === trips[0] ? 'near' : 'new', true)] : []),
      ];
    } else {
      memoRows = affectedTowns('hospitals', data.munis, tripsOf).flatMap((a) => [row(a.m, a.before, 'closed', false), ...(a.after ? [row(a.m, a.after, 'new', false)] : [])]);
    }
    return memoRows;
  };
  const along = (r: Row, q: number): [number, number] => {
    const d = q * r.cum[r.cum.length - 1];
    const k = Math.max(1, lowerBound(r.cum, d, (c) => c));
    if (k >= r.path.length) return r.path[r.path.length - 1];
    const f = (d - r.cum[k - 1]) / (r.cum[k] - r.cum[k - 1] || 1);
    return [r.path[k - 1][0] + (r.path[k][0] - r.path[k - 1][0]) * f, r.path[k - 1][1] + (r.path[k][1] - r.path[k - 1][1]) * f];
  };
  const ROW_COLOR: Record<RowKind, RGBA> = { near: rgb('#ffffff', 235), new: rgb('#ffffff', 235), alt: rgb(color, 200), closed: rgb(CLOSED_COLOR, 210) };

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
      const sc = scenarioOn('hospitals');
      const out: Layer[] = [];
      if (focused) out.push(...townColumns('hospitals', data.munis, (m) => val(m.key), height, (v, m) => (sc && nearest(m.key)?.beyond ? rgb(CLOSED_COLOR, 235) : rgb(ramp(v), 235)), scenarioVersion, selected));

      const rows = rowsFor(hovered ?? selected);
      if (rows.length) {
        const q = (clock % 2600) / 2600;
        const moving = rows.filter((r) => r.kind !== 'closed' && r.kind !== 'alt');
        out.push(
          new PathLayer<Row>({
            id: 'hospitals-trips',
            data: rows,
            getPath: (r) => r.path,
            getColor: (r) => ROW_COLOR[r.kind],
            getWidth: (r) => (r.kind === 'near' || r.kind === 'new' ? (r.label ? 4 : 3) : 2.5),
            widthUnits: 'pixels',
            capRounded: true,
            jointRounded: true,
            extensions: dashExt,
            // a closed hospital's route is dashed, like a straight line standing in for a road
            getDashArray: (r) => (r.kind === 'closed' ? [4, 3] : !r.t.line ? [3, 2] : [0, 0]),
            dashJustified: true,
            updateTriggers: { getColor: scenarioVersion, getDashArray: scenarioVersion, getWidth: scenarioVersion },
            parameters: NO_DEPTH,
          } as any),
          new ScatterplotLayer<Row>({
            id: 'hospitals-pulse',
            data: moving,
            getPosition: (r) => along(r, q),
            getRadius: 2600,
            radiusMinPixels: 3,
            getFillColor: [255, 255, 255, 230],
            updateTriggers: { getPosition: q },
            parameters: ADDITIVE,
          }),
          new TextLayer<Row>({
            id: 'hospitals-mins',
            data: rows.filter((r) => r.label),
            getPosition: (r) => r.path[r.path.length - 1],
            getText: (r) => `${r.kind === 'closed' ? 'closed · ' : ''}${tripText(r.t)}\n${fac[r.t.f].name}`,
            getSize: (r) => (r.kind === 'near' || r.kind === 'new' ? 13 : 11),
            getColor: (r) => (r.kind === 'closed' ? rgb(CLOSED_COLOR) : r.kind === 'alt' ? [214, 222, 255, 235] : [255, 255, 255, 255]),
            getPixelOffset: [0, -14],
            getAlignmentBaseline: 'bottom',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 700,
            characterSet: 'auto',
            outlineWidth: 3,
            outlineColor: [6, 10, 18, 230],
            fontSettings: { sdf: true },
            updateTriggers: { getText: scenarioVersion, getColor: scenarioVersion },
            parameters: { depthCompare: 'always' },
          } as any),
        );
      }

      // round-the-clock ERs breathe; smaller sites are drawn dimmer; a hospital closed in a scenario is red and still
      const p = (clock % 2400) / 2400;
      const shut = (i: number) => sc && isClosed('hospitals', i);
      out.push(
        new ScatterplotLayer<Facility>({
          id: 'hospitals-halo',
          data: fac.filter((f, i) => f.hospital && !shut(i)),
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
          getFillColor: (f, { index }) => (shut(index) ? rgb(CLOSED_COLOR) : f.hospital ? [255, 255, 255, 255] : [16, 22, 38, 235]),
          stroked: true,
          getLineColor: (f, { index }) => (shut(index) ? [255, 255, 255, 255] : rgb(edColor(f))),
          lineWidthMinPixels: 2.5,
          pickable: true,
          updateTriggers: { getFillColor: scenarioVersion, getLineColor: scenarioVersion },
          parameters: { depthCompare: 'always' },
        } as any),
      );
      if (sc)
        out.push(new TextLayer<{ f: number; name: string }>({
          id: 'hospitals-closed',
          data: closedSites('hospitals'),
          getPosition: (c) => [fac[c.f].lon, fac[c.f].lat],
          getText: () => 'closed (scenario)',
          getSize: 11,
          getColor: rgb(CLOSED_COLOR),
          getPixelOffset: [0, 16],
          getAlignmentBaseline: 'top',
          fontFamily: 'Inter, sans-serif',
          fontWeight: 700,
          outlineWidth: 3,
          outlineColor: [6, 10, 18, 230],
          fontSettings: { sdf: true },
          updateTriggers: { getPosition: scenarioVersion },
          parameters: { depthCompare: 'always' },
        } as any));
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
      const sc = scenarioOn('hospitals');
      const n24 = fac.filter((f) => f.hospital).length;
      el.insertAdjacentHTML('beforeend', `<p class="lede">The ${fac.length} Saskatchewan sites Statistics Canada’s Open Database of Healthcare Facilities files as hospitals, ${n24} of them hospitals proper (the rest are health centres and clinics). Column height shows the ${routed ? '<b>typical drive</b>' : '<b>straight-line distance</b>'} from each town centre to its nearest hospital. Hover or click a town to see its routes.</p>`);
      if (sc) el.appendChild(scenarioBox('hospitals', data.munis, tripsOf, (f) => fac[f]?.name ?? '', addText, tripText));
      const hero = heroStats(el, 4);
      const rows = data.munis.flatMap((m) => { const n = nearest(m.key); return n ? [{ m, v: tv(n.t), n }] : []; });
      rows.sort((a, b) => a.v - b.v);
      const near = routed ? 20 : 15;
      hero(0, sc ? `${n24 - closedSites('hospitals').length} of ${n24}` : String(n24), sc ? 'hospitals open in this scenario' : 'hospitals');
      hero(1, `${Math.round(d3.median(rows, (r) => r.v) ?? 0)} ${unit}`, 'median place to a hospital');
      hero(2, `${rows.filter((r) => r.v <= near && !r.n.beyond).length} of ${rows.length}`, `towns within ${near} ${unit}`);
      const far = rows.at(-1);
      hero(3, far ? `${far.n.beyond ? '>' : ''}${Math.round(far.v)} ${unit}` : '–', far ? `farthest: ${far.m.name}` : '');
      const max = d3.max(rows, (r) => r.v) ?? 1;
      const small = fac.filter((f) => f.ed !== '24/7');
      const hosp = fac.map((f, i) => ({ f, i })).filter((x) => x.f.hospital).sort((a, b) => a.f.name.localeCompare(b.f.name));
      el.insertAdjacentHTML('beforeend', `
        <h3>${routed ? 'Drive' : 'Distance'} to the nearest hospital${sc ? ' <span class="sc-tag">scenario</span>' : ''}</h3>
        <ol class="rank-list">${rows.map((r, i) => `<li data-key="${r.m.key}"><span class="rk">${i + 1}</span><span><span class="nm">${r.m.name}</span><br><span class="rd">${esc(fac[r.n.t.f].name)} · ${Math.round(r.n.t.km)} km${r.n.beyond ? ' · <b class="sc-closed">every hospital kept for it is closed</b>' : ''}</span></span><span><div class="bar"><i style="width:${Math.round((r.v / max) * 100)}%;background:${r.n.beyond ? CLOSED_COLOR : ramp(r.v)}"></i></div><div class="bar-v">${r.n.beyond ? '>' : ''}${Math.round(r.v)}</div></span></li>`).join('')}</ol>
        <div class="ramp" style="background:${rampCSS((t) => ramp(5 + t * 145))}"></div>
        <div class="ramp-labels"><span>5 ${unit}</span><span>45</span><span>150+ ${unit}</span></div>
        <div class="legend"><span><i class="sw" style="background:#fff;box-shadow:0 0 0 2px ${color}"></i>hospital</span><span><i class="sw" style="background:#101626;box-shadow:0 0 0 2px #7d879c"></i>health centre or clinic</span>${sc ? `<span><i class="sw" style="background:${CLOSED_COLOR}"></i>closed in this scenario</span>` : ''}</div>
        <h3>What if a hospital closed?</h3>
        <p class="note" style="margin-top:0">Pick a hospital (or click one on the map) to see which towns would drive farther, and how much farther. Each town keeps its ${H.towns[data.munis[0]?.key]?.length ?? 3} fastest hospitals by road, so up to two closures can be combined.</p>
        <select class="sc-pick" aria-label="Close a hospital in a scenario"><option value="">Close a hospital…</option>${hosp.map((x) => `<option value="${x.i}"${isClosed('hospitals', x.i) ? ' disabled' : ''}>${esc(x.f.name)} · ${esc(x.f.city)}</option>`).join('')}</select>
        ${small.length ? `<div class="callout" style="--c:${color}">${small.length} health centres and clinics are on the map but left out of the ranking: they may not offer emergency or in-patient care.</div>` : ''}
        <p class="note">${routed ? 'Drive times are the OSRM router’s estimate for normal free-flowing traffic on OpenStreetMap roads, from the town centre. They don’t include winter roads, gravel, or air ambulance, which serves much of the far north.' : 'No routing service was reachable when this data was built, so these are straight-line distances, not drive times.'} The facility list is Statistics Canada’s 2020 compilation: rural emergency departments in Saskatchewan have had temporary closures for staffing since, and services (surgery, maternity, emergency hours) differ by hospital — check the Saskatchewan Health Authority before relying on one.</p>
        ${sourceLine(`${H.source}. ${H.routingSource ?? 'Straight-line distances.'}`)}`);
      el.querySelector<HTMLSelectElement>('.sc-pick')!.addEventListener('change', (e) => {
        const i = +(e.target as HTMLSelectElement).value;
        if (fac[i]) setClosed('hospitals', i, fac[i].name, true);
      });
      el.querySelector('.rank-list')!.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('hospitals')) return null;
      if (id === 'hospitals-sites') {
        const f = info.object as Facility;
        const shut = isClosed('hospitals', info.index);
        return `<b>${esc(f.name)}</b><br><span class="tk">${f.hospital ? 'Hospital' : 'Health centre or clinic'} · ${esc(f.city)}</span>${f.type ? `<br><span class="tk">Listed as</span> <span class="tv">${esc(f.type)}</span>` : ''}${shut ? '<br><span class="tk sc-closed">Closed in your scenario</span>' : ''}${f.hospital ? `<br><span class="tk tk-click">Click: ${shut ? 'reopen it' : 'what if this closed?'}</span>` : ''}`;
      }
      const o: any = info.object;
      const n = o.m ? nearest(o.m.key) : null;
      if (!n) return null;
      const e = n.t, sc = scenarioOn('hospitals');
      return `<b>${o.m.name}</b><br><span class="tk">Nearest ${sc ? 'open ' : ''}hospital${sc ? ' (scenario)' : ''}</span> <span class="tv">${n.beyond ? 'more than ' : ''}${e.min != null ? `${e.min} min` : `${Math.round(e.km)} km`}</span><br><span class="tk">${n.beyond ? 'every hospital kept for it is closed' : `${esc(fac[e.f].name)} · ${Math.round(e.km)} km by ${e.min != null ? 'road' : 'straight line'}`}</span><br><span class="tk">Click for town report</span>`;
    },
    describe(info) {
      if (info.layer?.id !== 'hospitals-sites') return null;
      const f = info.object as Facility, i = info.index;
      const near = data.munis.filter((m) => tripsOf(m.key)?.[0]?.f === i);
      const shut = isClosed('hospitals', i);
      return {
        layer: 'hospitals', kind: f.hospital ? 'Hospital' : 'Health centre or clinic', lon: f.lon, lat: f.lat, zoom: 8,
        title: f.name,
        body: `${f.hospital ? 'Hospital' : 'Health centre or clinic'} in ${f.city}${f.type ? `, listed as ${f.type}` : ''}. ${f.hospital ? `It is the nearest hospital by road for ${near.length} of the atlas’s places${near.length ? `: ${near.map((m) => m.name).join(', ')}` : ''}.` : 'The ranking counts hospitals proper only, so no town’s drive leads here.'}`,
        stats: near.length ? [{ v: String(near.length), l: 'places it is nearest to' }, { v: `${Math.round(d3.max(near, (m) => tv(tripsOf(m.key)![0])) ?? 0)} ${unit}`, l: 'longest of those drives' }] : [],
        detail: f.hospital ? (el) => {
          el.insertAdjacentHTML('beforeend', `<button class="sc-btn" style="--c:${CLOSED_COLOR}">${shut ? '↺ Reopen it' : scenarioOn('hospitals') ? '✕ Close this one too' : '✕ What if this closed?'}</button><p class="note">${esc(SCENARIO_CAVEAT)}</p>`);
          el.querySelector('.sc-btn')!.addEventListener('click', () => setClosed('hospitals', i, f.name, !shut));
        } : undefined,
      };
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
  return [provinceLayer(data), crimeLayer(data), justiceLayer(data), treatiesLayer(data), firesLayer(data), tornadoLayer(data), hailLayer(data), riversLayer(data), climateLayer(data), smokeLayer(data), droughtLayer(data), cropsLayer(data), normalsLayer(data), lightLayer(data), populationLayer(data), housingLayer(data), jobsLayer(data), needsLayer(data), schoolsLayer(data), internetLayer(data), communityLayer(data), newcomerLayer(data), transitLayer(data), childcareLayer(data), industryLayer(data), waterLayer(data), radonLayer(data), hospitalsLayer(data), doctorsLayer(data), campingLayer(data), commuteLayer(data)];
}
