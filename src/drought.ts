// Drought: Agriculture and Agri-Food Canada's Canadian Drought Monitor, the monthly map of abnormally dry (D0) to
// exceptional drought (D4) areas that federal, provincial and university scientists agree on at each month's end. The
// stage reads it as raw categories on a 10 km Web Mercator grid over Saskatchewan; the layer paints each month's grid
// on the map in the drought monitor's own colours (D4 lifted from near-black maroon so it shows on the dark map), and a
// place takes the category of the cell its centre is in.
import * as d3 from 'd3';
import { BitmapLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { Data, MONTHS, fmt, lowerBound } from './data';
import { lineChart } from './charts';
import { esc } from './html';
import { AtlasLayer, NO_DEPTH, TimedEvent, deferChart, detailBars, heroStats, kicker, mk, rgb, sourceLine } from './layers';

export const DROUGHT_COLOR = '#e0a43a';
/** D0–D4: the drought monitor's ramp (yellow, tan, orange, red, dark red), its darkest step lifted for the dark map */
export const DROUGHT_CATS = [
  { d: 0, short: 'D0', label: 'Abnormally dry', c: '#efe05a', every: 'once every 3–5 years' },
  { d: 1, short: 'D1', label: 'Moderate drought', c: '#f7c873', every: 'once every 5–10 years' },
  { d: 2, short: 'D2', label: 'Severe drought', c: '#ff9a1f', every: 'once every 10–20 years' },
  { d: 3, short: 'D3', label: 'Extreme drought', c: '#ec3b2a', every: 'once every 20–25 years' },
  { d: 4, short: 'D4', label: 'Exceptional drought', c: '#b81d4a', every: 'once every 50 years' },
];
const NA_COLOR = '#5d6678';
const NONE_COLOR = '#3a4558';
/** the per-place window: the last this-many years of maps */
const WINDOW = 10;

/** A map letter as a category: -1 none, 0–4 D0–D4, null not analyzed. */
const level = (ch: string): number | null => (ch === 'n' ? null : ch >= 'b' && ch <= 'f' ? ch.charCodeAt(0) - 98 : -1);
const catText = (v: number | null) => (v == null ? 'not analyzed' : v < 0 ? 'no drought' : `${DROUGHT_CATS[v].short} ${DROUGHT_CATS[v].label.toLowerCase()}`);
const catColor = (v: number | null) => (v == null ? NA_COLOR : v < 0 ? NONE_COLOR : DROUGHT_CATS[v].c);
/** "2021-07" → 2021.5 (the start of July on the timeline) */
const ymT = (ym: string) => +ym.slice(0, 4) + (+ym.slice(5, 7) - 1) / 12;
const ymText = (ym: string) => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

/** A place's drought record: months at D2 or worse in the last ten years of maps, and the latest month's category. */
export type PlaceDrought = { d2: number; n: number; from: string; to: string; now: number | null; worst: { v: number; ym: string } | null };
export function placeDrought(data: Data, key: string): PlaceDrought | null {
  const D = data.drought;
  const s = D?.towns[key];
  if (!D || !s) return null;
  const last = ymT(D.months.at(-1)!);
  let d2 = 0, n = 0, first = -1, worst: PlaceDrought['worst'] = null;
  D.months.forEach((ym, i) => {
    if (ymT(ym) <= last - WINDOW) return;
    const v = level(s[i]);
    if (v == null) return;
    if (first < 0) first = i;
    n++;
    if (v >= 2) d2++;
    if (v >= 0 && (!worst || v >= worst.v)) worst = { v, ym };
  });
  if (!n) return null;
  return { d2, n, from: D.months[first], to: D.months.at(-1)!, now: level(s.at(-1)!), worst };
}

/** the latest month's category for the Town Report, "now D1 moderate drought (Oct 2026)" */
export const droughtNow = (p: PlaceDrought) => `${p.now == null ? 'not analyzed' : p.now < 0 ? 'no drought' : catText(p.now)} at the end of ${ymText(p.to)}`;

/** a place's monthly categories as a strip of coloured ticks, oldest left */
export function droughtStrip(data: Data, key: string) {
  const D = data.drought;
  const s = D?.towns[key];
  if (!D || !s) return '';
  const y0 = +D.months[0].slice(0, 4), y1 = +D.months.at(-1)!.slice(0, 4);
  const ticks = d3.range(Math.ceil(y0 / 5) * 5, y1 + 1, 5);
  const t0 = ymT(D.months[0]), span = ymT(D.months.at(-1)!) + 1 / 12 - t0;
  return `<div class="dm-strip">${D.months.map((ym, i) => `<i style="left:${(((ymT(ym) - t0) / span) * 100).toFixed(2)}%;background:${catColor(level(s[i]))}" title="${ymText(ym)}: ${catText(level(s[i]))}"></i>`).join('')}</div>
    <div class="dm-axis">${ticks.map((y) => `<span style="left:${(((y - t0) / span) * 100).toFixed(2)}%">${y}</span>`).join('')}</div>`;
}

export function droughtLayer(data: Data): AtlasLayer {
  const color = DROUGHT_COLOR;
  const D = data.drought;
  const months = D?.months ?? [];
  const ts = months.map(ymT);
  const share = D?.share ?? [];
  const g = D?.grid;
  // decoded maps and their pictures, made on first use
  const grids = new Map<number, Uint8Array>();
  const pics = new Map<number, HTMLCanvasElement>();
  const decode = (i: number) => {
    let a = grids.get(i);
    if (a || !D || !g) return a ?? null;
    a = new Uint8Array(g.w * g.h);
    let k = 0;
    for (const [, n, ch] of D.maps[i].matchAll(/(\d*)([a-z])/g)) {
      const v = ch === 'n' ? 6 : ch.charCodeAt(0) - 97; // 0 none, 1–5 D0–D4, 6 not analyzed
      a.fill(v, k, (k += n ? +n : 1));
    }
    grids.set(i, a);
    return a;
  };
  const RGBA = [[0, 0, 0, 0], ...DROUGHT_CATS.map((c) => rgb(c.c, 215)), rgb(NA_COLOR, 70)];
  const picture = (i: number) => {
    let cv = pics.get(i);
    const a = decode(i);
    if (cv || !a || !g) return cv ?? null;
    cv = document.createElement('canvas');
    cv.width = g.w;
    cv.height = g.h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(g.w, g.h);
    for (let k = 0; k < a.length; k++) img.data.set(RGBA[a[k]], k * 4);
    ctx.putImageData(img, 0, 0);
    pics.set(i, cv);
    return cv;
  };
  /** the map in force at time t: the latest month that has started (a missing month keeps the one before) */
  const monthAt = (t: number) => {
    const i = lowerBound(ts, t + 1e-6, (x) => x) - 1;
    return i >= 0 && t - ts[i] < 3 / 12 ? i : -1;
  };
  const R = 6378137;
  const cellAt = (lon: number, lat: number) => {
    if (!g) return -1;
    const x = (R * lon * Math.PI) / 180, y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const c = Math.floor((x - g.x0) / g.px), r = Math.floor((g.y1 - y) / g.px);
    return c >= 0 && c < g.w && r >= 0 && r < g.h ? r * g.w + c : -1;
  };

  // the provincial picture: share of the province's area at D2 or worse, by month and by year
  const byYear: Record<number, { sum: number; n: number; peak: number }> = {};
  months.forEach((ym, i) => {
    const y = +ym.slice(0, 4);
    const b = (byYear[y] ??= { sum: 0, n: 0, peak: i });
    b.sum += share[i][2];
    b.n++;
    if (share[i][2] > share[b.peak][2]) b.peak = i;
  });
  const fullYears = Object.keys(byYear).map(Number).filter((y) => byYear[y].n >= 6);
  // the early maps left the north out: the last month with part of the province not analyzed
  const lastNA = share.reduce((a, s, i) => (s[5] > 1 ? i : a), -1);
  const yMean = (y: number) => byYear[y].sum / byYear[y].n;
  const worstYear = fullYears.reduce((a, y) => (yMean(y) > yMean(a) ? y : a), fullYears[0] ?? 0);
  const worstMonth = share.reduce((a, s, i) => (s[2] > share[a][2] ? i : a), 0);
  const worstCat = (s: number[]) => (s[4] >= 0.5 ? 4 : s[3] >= 0.5 ? 3 : s[2] >= 0.5 ? 2 : s[1] >= 0.5 ? 1 : 0);
  const a0 = ts[0] ?? 2002.8, a1 = (ts.at(-1) ?? 2026) + 1 / 12 - 0.001;
  const yr0 = Math.floor(a0), yr1 = Math.floor(a1);
  const towns = data.munis.filter((m) => D?.towns[m.key]);
  const SRC = { label: 'AAFC Canadian Drought Monitor (open.canada.ca)', url: D?.sourceUrl ?? 'https://open.canada.ca/data/en/dataset/292646cd-619f-4200-afb1-8b2c52f984a2' };
  let shown = -1;

  const l: AtlasLayer = {
    id: 'drought',
    name: 'Drought',
    icon: '🌾',
    color,
    range: [a0, a1],
    monthly: true,
    available: !!D && months.length > 0,
    unavailable: 'The Canadian Drought Monitor could not be read when this copy of the data was built. Run <code>npm run data drought</code>, then reload.',
    build({ time, focusedId }) {
      if (!D || !g) return [];
      const i = monthAt(time);
      shown = i;
      const out: Layer[] = [];
      const pic = i >= 0 ? picture(i) : null;
      if (pic)
        out.push(new BitmapLayer({
          id: `drought-map`,
          image: pic,
          bounds: g.bounds as [number, number, number, number],
          textureParameters: { minFilter: 'nearest', magFilter: 'nearest' },
          opacity: 0.75,
          pickable: true,
          parameters: NO_DEPTH,
          updateTriggers: { image: i },
        } as any));
      if (focusedId === 'drought' && i >= 0)
        out.push(new ScatterplotLayer<any>({
          id: 'drought-towns',
          data: towns,
          getPosition: (m) => [m.lon, m.lat],
          getRadius: 2600,
          radiusMinPixels: 3,
          getFillColor: (m) => rgb(catColor(level(D.towns[m.key][i])), 255),
          stroked: true,
          getLineColor: [6, 10, 18, 230],
          lineWidthMinPixels: 1,
          pickable: true,
          parameters: NO_DEPTH,
          updateTriggers: { getFillColor: i },
        }));
      return out;
    },
    // moderate drought or worse, coloured by the worst category covering at least 0.5% of the province
    spark: () => months.map((_, i) => ({ x: ts[i], y: share[i][1], color: DROUGHT_CATS[worstCat(share[i])].c })),
    events(): TimedEvent[] {
      if (!D || !fullYears.length) return [];
      const y = worstYear, b = byYear[y], p = b.peak, s = share[p];
      const yi = months.map((ym, i) => (ym.startsWith(`${y}-`) ? i : -1)).filter((i) => i >= 0);
      const d3max = Math.max(...yi.map((i) => share[i][3])), d4max = Math.max(...yi.map((i) => share[i][4]));
      const hit = towns.filter((m) => yi.some((i) => (level(D.towns[m.key][i]) ?? -1) >= 3));
      return [{
        t: ts[p] + 0.5 / 12, layer: 'drought', kind: 'Drought year', layers: ['drought'], lon: -106.5, lat: 51, zoom: 5.4,
        title: `${y}: the worst drought year on the map`,
        body: `In ${y} an average ${yMean(y).toFixed(0)}% of Saskatchewan was in severe drought or worse (D2+) on the Canadian Drought Monitor’s month-end maps, the most of any year since ${yr0 + 1}. It peaked at the end of ${ymText(months[p])}, with ${s[2].toFixed(0)}% of the province at D2 or worse${d3max >= 1 ? ` and, at its height that year, ${d3max.toFixed(0)}% in extreme drought (D3)${d4max >= 0.5 ? ` and ${d4max.toFixed(1)}% in exceptional drought (D4)` : ''}` : ''}.${hit.length ? ` ${hit.length} of the atlas’s places sat in extreme drought or worse at least one month that year.` : ''}`,
        stats: [
          { v: `${yMean(y).toFixed(0)}%`, l: `of the province at D2+, ${y} average` },
          { v: `${s[2].toFixed(0)}%`, l: `at D2+, end of ${ymText(months[p])}` },
          { v: `${d3max.toFixed(0)}%`, l: 'at D3+ at its worst' },
          ...(hit.length ? [{ v: String(hit.length), l: 'atlas places at D3+ some month' }] : []),
        ],
        sections: [
          { title: 'Reading the categories', text: DROUGHT_CATS.map((c) => `${c.short} ${c.label.toLowerCase()}: conditions expected ${c.every}`).join('. ') + '.' },
          ...(worstMonth !== p ? [{ title: 'The single worst month', text: `By area, the worst single month on the map is ${ymText(months[worstMonth])}, when ${share[worstMonth][2].toFixed(0)}% of the province was at D2 or worse; ${y} was drier for longer.` }] : []),
        ],
        detail: detailBars(`Share of Saskatchewan at D2 or worse, ${y}`, yi.map((i) => ({ x: +months[i].slice(5, 7), y: share[i][2], color: DROUGHT_CATS[worstCat(share[i])].c })), color, (v) => `${Math.round(v)}%`, (d) => `<b>${MONTHS[d.x - 1]} ${y}</b> · ${d.y.toFixed(1)}% at D2+`),
        sources: [SRC],
      }];
    },
    panel(el) {
      el.innerHTML = `${kicker(l, `Canadian Drought Monitor · ${yr0} → ${yr1}`)}
        <h2>Dry years on the prairie</h2>
        <p class="lede">Each month Agriculture and Agri-Food Canada and its provincial and university partners agree on a map of where Canada is abnormally dry (D0) or in drought (D1 to D4), weighing rain, snowpack, soil moisture, streamflow and crop reports. Play the timeline to watch the dry years spread and break. Farm towns live by this map.</p>`;
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Share of the province in drought</h3>`);
      const set = deferChart(el.appendChild(mk('div')), (c) => {
        const series = [1, 2, 3].map((d) => ({ key: `d${d}`, label: `${DROUGHT_CATS[d].short} or worse`, color: DROUGHT_CATS[d].c, width: d === 2 ? 2 : 1.5, values: months.map((_, i) => ({ x: ts[i], y: share[i][d] })) }));
        return lineChart(c, { height: 130, xDomain: [a0, a1], yFormat: (v) => `${Math.round(v)}%`, valueFormat: (v) => `${v.toFixed(1)}%`, series });
      });
      const rank = fullYears.map((y) => ({ y, v: yMean(y) })).sort((a, b) => b.v - a.v).slice(0, 5);
      el.insertAdjacentHTML('beforeend', `
        <h3>Categories</h3>
        <div class="legend" style="display:grid;gap:6px">${DROUGHT_CATS.map((c) => `<span><span class="sw" style="background:${c.c}"></span><b>${c.short}</b> ${c.label} <span class="tk">· expected ${c.every}</span></span>`).join('')}<span><span class="sw" style="background:${NA_COLOR}"></span>Not analyzed (the earliest maps covered farmland only)</span></div>
        <h3>Driest years</h3>
        <div class="legend" style="display:grid;gap:6px">${rank.map((r) => `<span><b>${r.y}</b> · ${r.v.toFixed(0)}% of the province at D2+ on average · worst ${ymText(months[byYear[r.y].peak])} (${share[byYear[r.y].peak][2].toFixed(0)}%)</span>`).join('')}</div>
        <div class="callout" style="--c:${color}">Over the last ten years of maps, ${(() => { const ps = towns.map((m) => placeDrought(data, m.key)).filter((p): p is PlaceDrought => !!p); const top = ps.length ? Math.max(...ps.map((p) => p.d2)) : 0; const who = towns.filter((m) => placeDrought(data, m.key)?.d2 === top).map((m) => esc(m.name)); return `${who.slice(0, 3).join(', ')}${who.length > 3 ? ` and ${who.length - 3} more` : ''} spent the most months in severe drought or worse: ${top} of ${ps[0]?.n ?? 120}`; })()}.</div>
        <p class="note">The Drought Monitor is a consensus map drawn by hand from many indicators, not a measurement; its edges are generalised, and a place takes the category of the 10 km map cell its centre is in, so a town near an edge can read one step off. Each month is the map for the end of that month. ${lastNA >= 0 ? `Until ${ymText(months[lastNA])} the maps covered only the agricultural south, so the north shows as not analyzed. ` : ''} Percentages are of the province’s land and lakes. Data: Open Government Licence – Canada.</p>
        ${sourceLine(D?.source ?? '')}`);
      return {
        update({ time }) {
          const i = monthAt(time);
          if (i >= 0) {
            hero(0, `${share[i][2].toFixed(0)}%`, `at D2+ (severe or worse), ${ymText(months[i])}`);
            hero(1, `${share[i][0].toFixed(0)}%`, `abnormally dry or worse, ${ymText(months[i])}`);
          } else {
            hero(0, '–', `maps begin ${ymText(months[0] ?? '2002-11')}`);
            hero(1, '–', '');
          }
          hero(2, String(worstYear), `driest year (${fullYears.length ? yMean(worstYear).toFixed(0) : '–'}% at D2+ on average)`);
          hero(3, fmt.int(months.length), 'monthly maps');
          set(time);
        },
      };
    },
    describe(info) {
      const m: any = info.object;
      if (!D || !m?.key || info.layer?.id !== 'drought-towns') return null;
      const p = placeDrought(data, m.key);
      const i = shown >= 0 ? shown : months.length - 1;
      return {
        layer: 'drought', kind: 'Drought record', lon: m.lon, lat: m.lat, zoom: 7.5,
        title: m.name,
        body: `${m.name} at the end of ${ymText(months[i])}: ${catText(level(D.towns[m.key][i]))}. Each tick below is one monthly map, ${ymText(months[0])} to ${ymText(months.at(-1)!)}; the category is the one for the 10 km map cell the town centre is in.`,
        stats: p ? [
          { v: String(p.d2), l: `months at D2+ of ${p.n}, ${p.from.slice(0, 4)}–${p.to.slice(0, 4)}` },
          { v: catText(p.now), l: `latest map, ${ymText(p.to)}` },
          ...(p.worst ? [{ v: DROUGHT_CATS[p.worst.v].short, l: `worst in ten years, last in ${ymText(p.worst.ym)}` }] : []),
        ] : [],
        detail: (el) => el.insertAdjacentHTML('beforeend', `<h3>Every month on the map</h3>${droughtStrip(data, m.key)}`),
        sources: [SRC],
      };
    },
    tooltip(info) {
      if (!D || !info.layer?.id.startsWith('drought')) return null;
      const i = shown;
      if (i < 0) return null;
      const m: any = info.object;
      if (info.layer.id === 'drought-towns' && m?.key) {
        const p = placeDrought(data, m.key);
        return `<b>${esc(m.name)}</b><br><span class="tk">${ymText(months[i])}</span> <span class="tv">${catText(level(D.towns[m.key][i]))}</span>${p ? `<br><span class="tk">Months at D2+</span> <span class="tv">${p.d2} of the last ${p.n}</span>` : ''}`;
      }
      const [lon, lat] = info.coordinate ?? [];
      const k = lon != null ? cellAt(lon, lat) : -1;
      const a = decode(i);
      if (k < 0 || !a || !a[k]) return null;
      const v = a[k] === 6 ? null : a[k] - 1;
      return `<b>${catText(v)}</b><br><span class="tk">Drought Monitor</span> <span class="tv">end of ${ymText(months[i])}</span>${v != null && v >= 0 ? `<br><span class="tk">Expected</span> ${DROUGHT_CATS[v].every}` : ''}`;
    },
  };
  return l;
}
