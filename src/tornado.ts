// Tornadoes: Environment and Climate Change Canada's verified tornado database for Saskatchewan, 1980–2009. Each
// touchdown flares as a spinning funnel of light, then stays as a dot coloured by its Fujita rating.
import * as d3 from 'd3';
import { ColumnLayer, LineLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { TornadoRow, fmt, lowerBound, MONTHS } from './data';
import { barChart } from './charts';
import { esc } from './html';
import { ADDITIVE, AtlasLayer, NO_DEPTH, RGBA, TimedEvent, deferChart, filterExt, glowWindow, heroStats, isoDate, kicker, mk, nearestTown, rgb, sourceLine } from './layers';
import type { Data } from './data';

const F_COLORS = ['#9ad8ff', '#ffe08a', '#ffad5c', '#ff5d5d', '#ff3dbb', '#ffffff'];
const fColor = (f: number | null) => (f == null ? '#8a96ad' : F_COLORS[Math.min(5, f)]);
const fLabel = (f: number | null) => (f == null ? 'unrated' : `F${f}`);

export function tornadoLayer(data: Data): AtlasLayer {
  const color = '#9ad8ff';
  const T = data.tornadoes;
  const rows: TornadoRow[] = T?.rows ?? [];
  const byYear: Record<number, number> = {};
  const strongByYear: Record<number, number> = {};
  const byMonth = new Array(12).fill(0);
  for (const r of rows) {
    const y = Math.floor(r[2]);
    byYear[y] = (byYear[y] ?? 0) + 1;
    if ((r[3] ?? 0) >= 2) strongByYear[y] = (strongByYear[y] ?? 0) + 1;
    byMonth[Math.min(11, Math.floor((r[2] % 1) * 12))]++;
  }
  const y0 = Math.floor(rows[0]?.[2] ?? 1980), y1 = Math.floor(rows.at(-1)?.[2] ?? 2009);
  const tracks = rows.filter((r) => r[4] != null && r[5] != null);
  const where = (r: TornadoRow) => {
    if (r[11]) return `near ${r[11]}`;
    const { town, km } = nearestTown(data.munis, r[0], r[1]);
    return `${Math.round(km)} km from ${town.name}`;
  };

  const l: AtlasLayer = {
    id: 'tornadoes',
    name: 'Tornadoes',
    icon: '🌪',
    color,
    range: [y0, y1 + 0.99],
    monthly: true,
    available: rows.length > 0,
    unavailable: 'Environment Canada’s tornado database could not be downloaded when this copy of the data was built. Run <code>npm run data tornadoes</code>, then reload.',
    build({ time, speed }) {
      const W = glowWindow(speed, 0.25);
      const lo = lowerBound(rows, time - W, (r) => r[2]);
      const hi = lowerBound(rows, time, (r) => r[2]);
      const live = rows.slice(lo, hi);
      const out: Layer[] = [
        new ScatterplotLayer<TornadoRow>({
          id: 'tornadoes-scars',
          data: rows,
          getPosition: (r) => [r[0], r[1]],
          getRadius: (r) => 2200 + (r[3] ?? 0) * 1200,
          radiusMinPixels: 2,
          getFillColor: (r) => rgb(fColor(r[3]), 150),
          stroked: true,
          getLineColor: [6, 10, 18, 200],
          lineWidthMinPixels: 0.5,
          extensions: filterExt,
          getFilterValue: (r) => r[2],
          filterRange: [1800, time],
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
        new LineLayer<TornadoRow>({
          id: 'tornadoes-tracks',
          data: tracks,
          getSourcePosition: (r) => [r[0], r[1]],
          getTargetPosition: (r) => [r[4]!, r[5]!],
          getColor: (r) => rgb(fColor(r[3]), 230),
          getWidth: 3,
          widthUnits: 'pixels',
          extensions: filterExt,
          getFilterValue: (r) => r[2],
          filterRange: [1800, time],
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
      ];
      if (live.length) {
        out.push(
          new ColumnLayer<TornadoRow>({
            id: 'tornadoes-funnel',
            data: live,
            getPosition: (r) => [r[0], r[1]],
            radius: 1600,
            diskResolution: 12,
            extruded: true,
            getElevation: (r) => (1 - (time - r[2]) / W) * (25000 + (r[3] ?? 0) * 20000),
            getFillColor: (r) => { const a = 1 - (time - r[2]) / W; const c = rgb(fColor(r[3])); return [c[0], c[1], c[2], 220 * a] as RGBA; },
            material: false,
            updateTriggers: { getElevation: time, getFillColor: time },
            parameters: ADDITIVE,
          } as any),
          new ScatterplotLayer<TornadoRow>({
            id: 'tornadoes-ring',
            data: live,
            getPosition: (r) => [r[0], r[1]],
            getRadius: (r) => 3000 + ((time - r[2]) / W) * (18000 + (r[3] ?? 0) * 8000),
            stroked: true,
            filled: false,
            lineWidthMinPixels: 2,
            getLineColor: (r) => { const a = 1 - (time - r[2]) / W; const c = rgb(fColor(r[3])); return [c[0], c[1], c[2], 255 * a] as RGBA; },
            updateTriggers: { getRadius: time, getLineColor: time },
            parameters: ADDITIVE,
          }),
        );
      }
      return out;
    },
    spark: () => d3.range(y0, y1 + 1).map((x) => ({ x, y: byYear[x] ?? 0 })),
    events() {
      return rows.filter((r) => (r[3] ?? 0) >= 3 || r[8] > 0).map((r): TimedEvent => ({
        t: r[2], layer: 'tornadoes', lon: r[0], lat: r[1], zoom: 8.5,
        title: `${fLabel(r[3])} tornado ${where(r)}`,
        body: `${r[8] > 0 ? `${r[8]} ${r[8] === 1 ? 'person' : 'people'} killed. ` : ''}${r[9] > 0 ? `${r[9]} injured. ` : ''}A verified ${fLabel(r[3])} tornado, ${isoDate(r[2])}.`,
        stats: [{ v: fLabel(r[3]), l: 'Fujita rating' }, ...(r[8] ? [{ v: String(r[8]), l: 'deaths' }] : []), ...(r[9] ? [{ v: String(r[9]), l: 'injuries' }] : [])],
      }));
    },
    panel(el) {
      el.innerHTML = `${kicker(l, `Verified tornadoes · ${y0} → ${y1}`)}
        <h2>Tornado country</h2>
        <p class="lede">Every tornado Environment Canada verified in Saskatchewan from ${y0} to ${y1}. Each one flares as a funnel when the timeline reaches it, then stays as a dot coloured by its strength on the Fujita scale (F0 weakest to F5). The timeline steps by month: watch them crowd into June and July.</p>`;
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Tornadoes a year</h3>`);
      const set = deferChart(el.appendChild(mk('div')), (c) => barChart(c, { data: l.spark(), xDomain: [y0, y1], color, height: 120, tooltip: (d) => `<b>${d.x}</b><br>${d.y} tornadoes · ${strongByYear[d.x] ?? 0} F2 or stronger` }));
      el.insertAdjacentHTML('beforeend', `<h3>By month</h3><div class="months">${byMonth.map((n, i) => `<span title="${n} in ${MONTHS[i]}"><i style="height:${Math.round((n / Math.max(...byMonth)) * 100)}%"></i>${MONTHS[i][0]}</span>`).join('')}</div>
        <h3>Fujita rating</h3>
        <div class="legend">${[0, 1, 2, 3, 4].map((f) => `<span><i class="sw" style="background:${F_COLORS[f]}"></i>F${f}</span>`).join('')}<span><i class="sw" style="background:#8a96ad"></i>unrated</span></div>
        <div class="callout" style="--c:${color}">${rows.filter((r) => (r[3] ?? 0) >= 2).length} of the ${rows.length} were F2 or stronger. ${rows.reduce((a, r) => a + r[8], 0)} deaths and ${rows.reduce((a, r) => a + r[9], 0)} injuries are on record for these years.</div>
        <p class="note">Counts depend on someone seeing a tornado or its damage: on the open prairie many went unreported, so more people and better radar mean more tornadoes on record, not necessarily more tornadoes. Only ${tracks.length} have a mapped end point; the rest show where they touched down. Since 2017 the Northern Tornadoes Project has surveyed far more thoroughly; its records are not in this layer yet.</p>
        ${sourceLine(T?.source ?? '')}`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          hero(0, String(byYear[y] ?? 0), `tornadoes in ${y}`);
          hero(1, String(strongByYear[y] ?? 0), `F2 or stronger in ${y}`);
          hero(2, fmt.int(lowerBound(rows, time, (r) => r[2])), `since ${y0}`);
          const peak = byMonth.indexOf(Math.max(...byMonth));
          hero(3, MONTHS[peak], `busiest month (${Math.round((byMonth[peak] / (rows.length || 1)) * 100)}%)`);
          set(time);
        },
      };
    },
    describe(info) {
      const r = info.object as TornadoRow;
      if (!Array.isArray(r)) return null;
      return {
        t: r[2], layer: 'tornadoes', kind: 'Tornado', lon: r[0], lat: r[1], zoom: 9,
        title: `${fLabel(r[3])} tornado ${where(r)}`,
        body: `Verified by Environment and Climate Change Canada. Touched down ${isoDate(r[2])}${r[6] ? `, on a track about ${(r[6] / 1000).toFixed(1)} km long` : ''}.`,
        stats: [
          { v: fLabel(r[3]), l: 'Fujita rating' },
          ...(r[6] ? [{ v: `${(r[6] / 1000).toFixed(1)} km`, l: 'track length' }] : []),
          ...(r[7] ? [{ v: `${fmt.int(r[7])} m`, l: 'widest' }] : []),
          { v: String(r[8]), l: 'deaths' }, { v: String(r[9]), l: 'injuries' },
          ...(r[10] ? [{ v: fmt.money(r[10] * 1000), l: 'damage (then-year $)' }] : []),
        ],
        sources: [{ label: 'Canadian National Tornado Database (ECCC)', url: 'https://open.canada.ca/data/en/dataset/fd3355a7-ae34-4df7-b477-07306182db69' }],
      };
    },
    tooltip(info) {
      const r = info.object as TornadoRow;
      if (!Array.isArray(r)) return null;
      return `<b>${fLabel(r[3])} tornado</b><br><span class="tk">Date</span> <span class="tv">${isoDate(r[2])}</span><br><span class="tk">Where</span> ${esc(where(r))}${r[8] || r[9] ? `<br><span class="tk">Deaths / injuries</span> <span class="tv">${r[8]} / ${r[9]}</span>` : ''}`;
    },
  };
  return l;
}
