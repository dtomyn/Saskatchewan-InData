// The atlas layer contract (src/main.ts drives it) and the helpers every layer module shares.
// Each atlas layer bundles: deck.gl layers for a moment in time, a timeline sparkline, notable events, a story panel,
// and map tooltips.
import type { Layer, PickingInfo } from '@deck.gl/core';
import * as d3 from 'd3';
import { DataFilterExtension, PathStyleExtension } from '@deck.gl/extensions';
import { ColumnLayer } from '@deck.gl/layers';
import { Data, HistoryFeed, Muni, km } from './data';
import { esc } from './html';
import { barChart, ChartHandle } from './charts';

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

/** A column on each place: the census and town layers (population, crime, housing…) all draw with it. */
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

/** Dashed lines for a PathLayer (`getDashArray`). */
export const dashExt = [new PathStyleExtension({ dash: true })];
