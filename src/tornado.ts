// Tornadoes: Environment and Climate Change Canada's verified tornado database (1980–2009) and the Northern Tornadoes
// Project's investigated events (2017 →) for Saskatchewan. Each touchdown flares as a spinning funnel of light, then
// stays as a dot coloured by its rating. There is no open record for 2010–2016, and the layer says so.
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
const isNTP = (r: TornadoRow) => r[12] === 1;
const defaultRating = (r: TornadoRow) => (r[13] & 1) === 1;
const estimatedEnd = (r: TornadoRow) => (r[13] & 2) === 2;
/** F on the old Fujita scale (ECCC, to 2009), EF on the Enhanced Fujita scale (NTP); a "default" EF0 was seen but left no damage to rate. */
const fLabel = (r: TornadoRow) => (r[3] == null ? 'unrated' : `${isNTP(r) ? 'EF' : 'F'}${r[3]}${defaultRating(r) ? ' (default)' : ''}`);
const SRC = [
  { label: 'Canadian National Tornado Database (ECCC)', url: 'https://open.canada.ca/data/en/dataset/fd3355a7-ae34-4df7-b477-07306182db69', by: 'Environment and Climate Change Canada' },
  { label: 'Northern Tornadoes Project, Western University', url: 'https://www.uwo.ca/ntp/', by: 'the Northern Tornadoes Project' },
];

export function tornadoLayer(data: Data): AtlasLayer {
  const color = '#9ad8ff';
  const T = data.tornadoes;
  const rows: TornadoRow[] = T?.rows ?? [];
  const spans = T?.sources ?? [{ name: 'ECCC', from: 1980, to: 2009, scale: 'F' }];
  const covered = (y: number) => spans.some((s) => y >= s.from && y <= s.to);
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
  const gap = d3.range(y0, y1 + 1).filter((y) => !covered(y));
  const gapText = gap.length ? `${gap[0]}–${gap.at(-1)}` : '';
  const tracks = rows.filter((r) => r[4] != null && r[5] != null);
  const nNTP = rows.filter(isNTP).length;
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
    unavailable: 'The tornado records could not be downloaded when this copy of the data was built. Run <code>npm run data tornadoes</code>, then reload.',
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
          // estimated ends (from NTP's track length and direction) are drawn fainter and thinner than mapped ones
          getColor: (r) => rgb(fColor(r[3]), estimatedEnd(r) ? 140 : 230),
          getWidth: (r) => (estimatedEnd(r) ? 2 : 3),
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
    // years with no open record are left empty, not drawn as zero
    spark: () => d3.range(y0, y1 + 1).filter(covered).map((x) => ({ x, y: byYear[x] ?? 0 })),
    events() {
      return rows.filter((r) => (r[3] ?? 0) >= 3 || r[8] > 0 || r[9] > 0).map((r): TimedEvent => ({
        t: r[2], layer: 'tornadoes', lon: r[0], lat: r[1], zoom: 8.5,
        title: `${fLabel(r)} tornado ${where(r)}`,
        body: `${r[8] > 0 ? `${r[8]} ${r[8] === 1 ? 'person' : 'people'} killed. ` : ''}${r[9] > 0 ? `${r[9]} injured. ` : ''}A tornado rated ${fLabel(r)} by ${SRC[r[12]].by}, ${isoDate(r[2])}.`,
        stats: [{ v: fLabel(r), l: isNTP(r) ? 'Enhanced Fujita rating' : 'Fujita rating' }, ...(r[8] ? [{ v: String(r[8]), l: 'deaths' }] : []), ...(r[9] ? [{ v: String(r[9]), l: 'injuries' }] : [])],
        sources: [{ label: SRC[r[12]].label, url: SRC[r[12]].url }],
      }));
    },
    panel(el) {
      el.innerHTML = `${kicker(l, `Tornadoes · ${y0} → ${y1}`)}
        <h2>Tornado country</h2>
        <p class="lede">Every tornado Environment Canada verified in Saskatchewan from 1980 to 2009, and every one the Northern Tornadoes Project has investigated since 2017. Each flares as a funnel when the timeline reaches it, then stays as a dot coloured by its rating (0 weakest to 5). The timeline steps by month: watch them crowd into June and July.</p>`;
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Tornadoes a year</h3>`);
      const set = deferChart(el.appendChild(mk('div')), (c) => barChart(c, { data: l.spark(), xDomain: [y0, y1], color, height: 120, tooltip: (d) => `<b>${d.x}</b><br>${d.y} tornadoes · ${strongByYear[d.x] ?? 0} rated 2 or stronger` }));
      el.insertAdjacentHTML('beforeend', `${gap.length ? `<p class="note" style="margin-top:2px">No open record covers ${gapText}: the gap in the chart is missing data, not a quiet spell.</p>` : ''}
        <h3>By month</h3><div class="months">${byMonth.map((n, i) => `<span title="${n} in ${MONTHS[i]}"><i style="height:${Math.round((n / Math.max(...byMonth)) * 100)}%"></i>${MONTHS[i][0]}</span>`).join('')}</div>
        <h3>Rating</h3>
        <div class="legend">${[0, 1, 2, 3, 4].map((f) => `<span><i class="sw" style="background:${F_COLORS[f]}"></i>${f}</span>`).join('')}<span><i class="sw" style="background:#8a96ad"></i>unrated</span></div>
        <div class="callout" style="--c:${color}">${rows.length - nNTP} tornadoes from Environment Canada’s database and ${nNTP} from the Northern Tornadoes Project. ${rows.filter((r) => (r[3] ?? 0) >= 2).length} were rated 2 or stronger; ${rows.reduce((a, r) => a + r[8], 0)} deaths and ${rows.reduce((a, r) => a + r[9], 0)} injuries are on record.</div>
        <p class="note">The two records aren’t the same measure. Environment Canada used the original Fujita scale (F); the Northern Tornadoes Project uses the Enhanced Fujita scale (EF) and finds tornadoes no one reported, by searching radar, satellite and drone imagery, especially in the forested north. A “default EF0” is a tornado that was seen but left no damage to rate. Counts depend on someone or something spotting a tornado, so more tornadoes on record doesn’t necessarily mean more tornadoes. Track lines are mapped end points (bright) or, for NTP events, estimated from the track’s length and direction (faint). The Northern Tornadoes Project data is licensed CC BY-NC 4.0, for non-commercial use.</p>
        ${sourceLine(T?.source ?? '')}`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          if (covered(y)) {
            hero(0, String(byYear[y] ?? 0), `tornadoes in ${y}`);
            hero(1, String(strongByYear[y] ?? 0), `rated 2 or stronger in ${y}`);
          } else {
            hero(0, '–', `no open record for ${y}`);
            hero(1, '–', `gap: ${gapText}`);
          }
          hero(2, fmt.int(lowerBound(rows, time, (r) => r[2])), `on record since ${y0}`);
          const peak = byMonth.indexOf(Math.max(...byMonth));
          hero(3, MONTHS[peak], `busiest month (${Math.round((byMonth[peak] / (rows.length || 1)) * 100)}%)`);
          set(time);
        },
      };
    },
    describe(info) {
      const r = info.object as TornadoRow;
      if (!Array.isArray(r)) return null;
      const s = SRC[r[12]];
      return {
        t: r[2], layer: 'tornadoes', kind: 'Tornado', lon: r[0], lat: r[1], zoom: 9,
        title: `${fLabel(r)} tornado ${where(r)}`,
        body: `${isNTP(r) ? 'Investigated' : 'Verified'} by ${s.by}. Touched down ${isoDate(r[2])}${r[6] ? `, on a track about ${(r[6] / 1000).toFixed(1)} km long${estimatedEnd(r) ? ' (the end point on the map is estimated from its length and direction)' : ''}` : ''}.${defaultRating(r) ? ' Rated a default EF0: seen, but it left no damage to rate.' : ''}`,
        stats: [
          { v: fLabel(r), l: isNTP(r) ? 'Enhanced Fujita rating' : 'Fujita rating' },
          ...(r[6] ? [{ v: `${(r[6] / 1000).toFixed(1)} km`, l: 'track length' }] : []),
          ...(r[7] ? [{ v: `${fmt.int(r[7])} m`, l: 'widest' }] : []),
          { v: String(r[8]), l: 'deaths' }, { v: String(r[9]), l: 'injuries' },
          ...(r[10] ? [{ v: fmt.money(r[10] * 1000), l: 'damage (then-year $)' }] : []),
        ],
        sources: [{ label: s.label, url: s.url }],
      };
    },
    tooltip(info) {
      const r = info.object as TornadoRow;
      if (!Array.isArray(r)) return null;
      return `<b>${fLabel(r)} tornado</b><br><span class="tk">Date</span> <span class="tv">${isoDate(r[2])}</span><br><span class="tk">Where</span> ${esc(where(r))}${r[8] || r[9] ? `<br><span class="tk">Deaths / injuries</span> <span class="tv">${r[8]} / ${r[9]}</span>` : ''}<br><span class="tk">${isNTP(r) ? 'Northern Tornadoes Project' : 'Environment Canada'}</span>`;
    },
  };
  return l;
}
