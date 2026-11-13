// What grows here: Agriculture and Agri-Food Canada's Annual Crop Inventory, a 30 m satellite map of crops and land
// cover made every year since 2009 over the farm belt (it stops around 55–56° N). The stage folds it into 3 km Web
// Mercator cells (about 1.8 km on the ground) that each take their most common class, grouped into eleven; the layer
// paints each year's grid, and a place reads the land within 25 km by class. Small fields vanish into their neighbours.
import * as d3 from 'd3';
import { BitmapLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { Data } from './data';
import { lineChart } from './charts';
import { esc, safeUrl } from './html';
import { AtlasLayer, NO_DEPTH, TimedEvent, deferChart, heroStats, kicker, mk, rgb, sourceLine } from './layers';

export const CROPS_COLOR = '#c9d65b';
/** the stage's classes in order (letters b…l on the map), with a colour and a short name */
export const CROP_CLASSES = [
  { name: 'Cereals', c: '#d4a373', farm: true },
  { name: 'Canola', c: '#ffe23d', farm: true },
  { name: 'Pulses', c: '#a7c957', farm: true },
  { name: 'Other crops and fallow', c: '#f4a261', farm: true },
  { name: 'Pasture and forage', c: '#8ab17d', farm: true },
  { name: 'Grassland and shrub', c: '#8d7b5a', farm: false },
  { name: 'Forest', c: '#2f6d4f', farm: false },
  { name: 'Wetland', c: '#4c9a9a', farm: false },
  { name: 'Water', c: '#3a6ea5', farm: false },
  { name: 'Built-up', c: '#d0d3d9', farm: false },
  { name: 'Bare or burned', c: '#8a7f78', farm: false },
];
const RADIUS_KM = 25;

/** A place's land within 25 km, latest year mapped: shares by class (%), and the cropped share then and in the first year mapped. */
export type PlaceCrops = { y: number; s: number[]; top: number[]; crop: number; y0: number; crop0: number };
export function placeCrops(data: Data, key: string): PlaceCrops | null {
  const C = data.crops;
  const rows = C?.towns[key];
  if (!C || !rows) return null;
  const last = rows.reduce((a, r, i) => (r ? i : a), -1), first = rows.findIndex((r) => r);
  if (last < 0) return null;
  const s = rows[last]!, s0 = rows[first]!;
  const cropped = (r: number[]) => r[0] + r[1] + r[2] + r[3];
  const top = s.map((v, i) => ({ v, i })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).map((x) => x.i);
  return { y: C.years[last], s, top, crop: cropped(s), y0: C.years[first], crop0: cropped(s0) };
}

/** a place's land as a stacked bar, largest first */
export function cropsBar(p: PlaceCrops) {
  return `<div class="crop-bar">${p.top.map((i) => `<i style="width:${p.s[i]}%;background:${CROP_CLASSES[i].c}" title="${CROP_CLASSES[i].name}: ${p.s[i]}%"></i>`).join('')}</div>
    <div class="legend" style="margin-top:4px">${p.top.slice(0, 5).map((i) => `<span><i class="sw" style="background:${CROP_CLASSES[i].c}"></i>${CROP_CLASSES[i].name} ${p.s[i]}%</span>`).join('')}</div>`;
}

export function cropsLayer(data: Data): AtlasLayer {
  const color = CROPS_COLOR;
  const C = data.crops;
  const years = C?.years ?? [];
  const share = C?.share ?? [];
  const g = C?.grid;
  const grids = new Map<number, Uint8Array>();
  const pics = new Map<number, HTMLCanvasElement>();
  const decode = (i: number) => {
    let a = grids.get(i);
    if (a || !C || !g) return a ?? null;
    a = new Uint8Array(g.w * g.h);
    let k = 0;
    for (const [, n, ch] of C.maps[i].matchAll(/(\d*)([a-z])/g)) a.fill(ch.charCodeAt(0) - 97, k, (k += n ? +n : 1)); // 0 not mapped, 1… classes
    grids.set(i, a);
    return a;
  };
  const RGBA = [[0, 0, 0, 0], ...CROP_CLASSES.map((c) => rgb(c.c, 230))];
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
  /** the map in force at time t: the year it falls in (a growing season's map holds for the calendar year) */
  const yearAt = (t: number) => years.indexOf(Math.floor(t));
  const R = 6378137;
  const cellAt = (lon: number, lat: number) => {
    if (!g) return -1;
    const x = (R * lon * Math.PI) / 180, y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const c = Math.floor((x - g.x0) / g.px), r = Math.floor((g.y1 - y) / g.px);
    return c >= 0 && c < g.w && r >= 0 && r < g.h ? r * g.w + c : -1;
  };
  const a0 = years[0] ?? 2009, a1 = (years.at(-1) ?? 2025) + 0.999;
  const SRC = { label: 'AAFC Annual Crop Inventory (open.canada.ca)', url: safeUrl(C?.sourceUrl) ?? 'https://open.canada.ca/data/en/dataset/ba2645d5-4458-414d-b196-6303ac06c1c9' };
  const cropped = (s: number[]) => s[0] + s[1] + s[2] + s[3];
  // the year canola covered the most ground, and the wettest spring (the most "other crops and fallow", which holds land too wet to seed)
  const canolaPeak = share.reduce((a, s, i) => (s[1] > share[a][1] ? i : a), 0);
  const wetYear = share.reduce((a, s, i) => (s[3] > share[a][3] ? i : a), 0);
  let shown = -1;

  const l: AtlasLayer = {
    id: 'crops',
    name: 'What grows here',
    icon: '🌱',
    color,
    range: [a0, a1],
    available: !!C && years.length > 0,
    unavailable: 'The Annual Crop Inventory could not be read when this copy of the data was built. Run <code>npm run data crops</code>, then reload.',
    build({ time }) {
      if (!C || !g) return [];
      const i = yearAt(time);
      shown = i;
      const pic = i >= 0 ? picture(i) : null;
      const out: Layer[] = [];
      if (pic)
        out.push(new BitmapLayer({
          id: 'crops-map',
          image: pic,
          bounds: g.bounds as [number, number, number, number],
          textureParameters: { minFilter: 'nearest', magFilter: 'nearest' },
          opacity: 0.8,
          pickable: true,
          parameters: NO_DEPTH,
          updateTriggers: { image: i },
        } as any));
      return out;
    },
    spark: () => years.map((y, i) => ({ x: y + 0.5, y: share[i][1], color: CROP_CLASSES[1].c })),
    events(): TimedEvent[] {
      if (!C || years.length < 3) return [];
      const ev: TimedEvent[] = [];
      const s = share[wetYear];
      if (s[3] >= 2 * (d3.median(share, (x) => x[3]) ?? 0))
        ev.push({
          t: years[wetYear] + 0.6, layer: 'crops', kind: 'Farm year', layers: ['crops'], lon: -104.5, lat: 51.2, zoom: 5.6,
          title: `${years[wetYear]}: fields too wet to seed`,
          body: `In ${years[wetYear]}, ${s[3].toFixed(0)}% of the mapped farm belt fell in “other crops and fallow”, against a usual ${(d3.median(share, (x) => x[3]) ?? 0).toFixed(0)}%. Most of the difference is land the crop inventory marks as too wet to be seeded: fields that stood under water through a wet spring.`,
          stats: [{ v: `${s[3].toFixed(0)}%`, l: 'other crops and fallow' }, { v: `${s[0].toFixed(0)}%`, l: 'cereals' }, { v: `${s[1].toFixed(0)}%`, l: 'canola' }],
          sources: [SRC],
        });
      const c = share[canolaPeak];
      ev.push({
        t: years[canolaPeak] + 0.55, layer: 'crops', kind: 'Farm year', layers: ['crops'], lon: -106, lat: 52, zoom: 5.6,
        title: `${years[canolaPeak]}: the most canola on the map`,
        body: `Canola covered ${c[1].toFixed(0)}% of the mapped farm belt in ${years[canolaPeak]}, up from ${share[0][1].toFixed(0)}% in ${years[0]}: the yellow of July on the prairie.`,
        stats: [{ v: `${c[1].toFixed(0)}%`, l: `canola, ${years[canolaPeak]}` }, { v: `${share[0][1].toFixed(0)}%`, l: `canola, ${years[0]}` }],
        sources: [SRC],
      });
      return ev;
    },
    panel(el) {
      el.innerHTML = `${kicker(l, `Annual Crop Inventory · ${years[0] ?? ''} → ${years.at(-1) ?? ''}`)}
        <h2>What grows here</h2>
        <p class="lede">Every year Agriculture and Agri-Food Canada maps what is growing on each 30 m square of the farm belt from satellite images, checked against crop insurance records. Here each square of about 2 km takes its most common class. Play the timeline to watch canola spread, pulses come and go, and pasture give way to crops.</p>`;
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Share of the farm belt, by year</h3>`);
      const set = deferChart(el.appendChild(mk('div')), (c) =>
        lineChart(c, {
          height: 140, xDomain: [a0, a1], yFormat: (v) => `${Math.round(v)}%`, valueFormat: (v) => `${v.toFixed(1)}%`,
          series: [0, 1, 2, 4, 5].map((k) => ({ key: `c${k}`, label: CROP_CLASSES[k].name, color: CROP_CLASSES[k].c, width: k === 1 ? 2 : 1.5, values: years.map((y, i) => ({ x: y + 0.5, y: share[i][k] })) })),
        }),
      );
      el.insertAdjacentHTML('beforeend', `
        <h3>Classes</h3>
        <div class="legend" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${CROP_CLASSES.map((c) => `<span><i class="sw" style="background:${c.c}"></i>${c.name}</span>`).join('')}</div>
        <div class="callout" style="--c:${color}">Cropland (cereals, canola, pulses and other crops) covered <b>${years.length ? cropped(share.at(-1)!).toFixed(0) : '–'}%</b> of the mapped farm belt in ${years.at(-1) ?? ''}, against ${years.length ? cropped(share[0]).toFixed(0) : '–'}% in ${years[0] ?? ''}.</div>
        <p class="note"><b>Each square shows its most common class, so small fields, shelterbelts, sloughs and farmyards vanish into their neighbours.</b> The inventory is a satellite classification, right for about nine fields in ten; a class it was unsure of can flip from year to year. It covers the farm belt only (to about 55° N early on, a little further north lately): land north of that, and cloud the satellites could not see through, is left blank. Shares are of the land mapped in every year, so the chart compares like with like. Wheat, barley, oats and the other grains are cereals; “other crops and fallow” includes summerfallow and fields too wet to seed; native grassland and shrub are one class. Data: ${esc(C?.licence ?? 'Open Government Licence – Canada')}.</p>
        ${sourceLine(C?.source ?? '')}`);
      return {
        update({ time }) {
          const i = yearAt(time);
          if (i >= 0) {
            hero(0, `${share[i][1].toFixed(0)}%`, `canola, ${years[i]}`);
            hero(1, `${share[i][0].toFixed(0)}%`, `cereals, ${years[i]}`);
            hero(2, `${share[i][2].toFixed(0)}%`, `pulses, ${years[i]}`);
            hero(3, `${(share[i][4] + share[i][5]).toFixed(0)}%`, `pasture and grassland, ${years[i]}`);
          } else for (let k = 0; k < 4; k++) hero(k, '–', k ? '' : `maps begin ${years[0] ?? 2009}`);
          set(time);
        },
      };
    },
    tooltip(info) {
      if (!C || info.layer?.id !== 'crops-map' || shown < 0) return null;
      const [lon, lat] = info.coordinate ?? [];
      const k = lon != null ? cellAt(lon, lat) : -1;
      const a = decode(shown);
      if (k < 0 || !a || !a[k]) return null;
      const c = CROP_CLASSES[a[k] - 1];
      return `<b>${c.name}</b> <span class="tk">most of this ~2 km square</span><br><span class="tk">Crop inventory</span> <span class="tv">${years[shown]}</span>`;
    },
  };
  return l;
}

/** "of the land within 25 km cropped in 2025 (74% in 2009) · most: …" for the Town Report, under the cropped share */
export const cropsText = (p: PlaceCrops) => `of the land within ${RADIUS_KM} km cropped in ${p.y}${p.y0 !== p.y ? ` (${p.crop0}% in ${p.y0})` : ''} · most: ${p.top.slice(0, 3).map((i) => `${CROP_CLASSES[i].name.toLowerCase()} ${p.s[i]}%`).join(', ')}`;
export const CROPS_RADIUS_KM = RADIUS_KM;
