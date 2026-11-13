// Hail: the Northern Hail Project's (Western University) radar hail swaths over Saskatchewan for 2022–2024, and the
// hailstorms its research database records, most investigated on the ground. Each storm flares as a burst of ice when
// the timeline reaches it, then stays as a dot sized and coloured by its largest hail, with the swath's centre line
// behind it. Swath sizes are the radar's MESH (Maximum Expected Size of Hail), an estimate, not a measured stone.
import * as d3 from 'd3';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { HailRow, fmt, lowerBound, MONTHS } from './data';
import { barChart } from './charts';
import { esc } from './html';
import { ADDITIVE, AtlasLayer, NO_DEPTH, RGBA, TimedEvent, deferChart, filterExt, glowWindow, heroStats, isoDate, kicker, nearestTown, rgb, sourceLine } from './layer-kit';
import type { Data } from './data';

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

/** Hail on record near a place: storms whose swath or point passes within 50 km, and the largest hail among them. */
export type PlaceHail = { n: number; from: number; to: number; max: { mm: number; t: number; name: string | null; radar: boolean } | null };
export function placeHail(data: Data, m: { lon: number; lat: number }): PlaceHail | null {
  const rows = data.hail?.rows;
  if (!rows?.length) return null;
  let n = 0;
  let max: PlaceHail['max'] = null;
  for (const r of rows) {
    if (hailKm(r, m.lon, m.lat) > HAIL_REACH_KM) continue;
    n++;
    if (r[3] != null && (!max || r[3] > max.mm)) max = { mm: r[3], t: r[2], name: r[5], radar: isSwath(r) };
  }
  return { n, from: Math.floor(rows[0][2]), to: Math.floor(rows.at(-1)![2]), max };
}

export function hailLayer(data: Data): AtlasLayer {
  const color = '#c3b5ff';
  const H = data.hail;
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
    byMonth[Math.min(11, Math.floor((r[2] % 1) * 12))]++;
  }
  const y0 = Math.floor(rows[0]?.[2] ?? 2022), y1 = Math.floor(rows.at(-1)?.[2] ?? 2024);
  const radar = (y: number) => y >= radarSpan.from && y <= radarSpan.to;
  const sized = swaths.filter((r) => r[3] != null);
  const sizeless = swaths.length - sized.length;
  const sizeless0 = swaths.filter((r) => r[3] == null && Math.floor(r[2]) === radarSpan.from).length;
  const radius = (r: HailRow) => 1800 + (r[3] ?? 20) * 55;
  const where = (r: HailRow) => {
    if (r[5]) return `near ${r[5]}`;
    const { town, km } = nearestTown(data.munis, r[0], r[1]);
    return `${Math.round(km)} km from ${town.name}`;
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
      const W = glowWindow(speed, 0.25);
      const lo = lowerBound(rows, time - W, (r) => r[2]);
      const hi = lowerBound(rows, time, (r) => r[2]);
      const live = rows.slice(lo, hi);
      const out: Layer[] = [
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
      ];
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
      }));
    },
    panel(el) {
      el.innerHTML = `${kicker(l, `Hail · ${y0} → ${y1}`)}
        <h2>Hail alley</h2>
        <p class="lede">The hail swaths the Northern Hail Project traced across Saskatchewan on weather radar from ${radarSpan.from} to ${radarSpan.to}, and the hailstorms in its research database. Each storm flares when the timeline reaches it, then stays as a dot sized and coloured by its largest hail, with the swath’s centre line behind it.</p>`;
      const hero = heroStats(el, 4);
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
          if (radar(y)) {
            hero(0, String(byYear[y] ?? 0), `radar swaths in ${y}`);
            hero(1, maxByYear[y] ? `${maxByYear[y]} mm` : '–', maxByYear[y] ? `largest hail in ${y} (radar)` : `no sizes for ${y}`);
          } else {
            hero(0, '–', `no radar record for ${y}`);
            hero(1, '–', `radar swaths: ${radarSpan.from}–${radarSpan.to}`);
          }
          hero(2, fmt.int(lowerBound(rows, time, (r) => r[2])), `storms on record since ${y0}`);
          const peak = byMonth.indexOf(Math.max(...byMonth));
          hero(3, MONTHS[peak], `busiest month (${Math.round((byMonth[peak] / (swaths.length || 1)) * 100)}%)`);
          set(time);
        },
      };
    },
    describe(info) {
      const r = info.object as HailRow;
      if (!Array.isArray(r)) return null;
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
        ],
        sources: [{ label: SRC[r[4]].label, url: SRC[r[4]].url }],
      };
    },
    tooltip(info) {
      const r = info.object as HailRow;
      if (!Array.isArray(r)) return null;
      return `<b>${isSwath(r) ? 'Hail swath' : 'Hailstorm'}</b><br><span class="tk">Date</span> <span class="tv">${isoDate(r[2])}</span><br><span class="tk">Where</span> ${esc(where(r))}<br><span class="tk">Largest hail</span> <span class="tv">${esc(sizeText(r))}${isSwath(r) && r[3] != null ? ' (radar)' : ''}</span>`;
    },
  };
  return l;
}
