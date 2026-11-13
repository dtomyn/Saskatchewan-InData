// Smoke & air: Environment and Climate Change Canada's National Air Pollution Surveillance (NAPS) hourly PM2.5 at
// Saskatchewan's monitoring stations. Each year a station counts its smoke days (24-hour mean PM2.5 above 25 µg/m³) and
// stands as a column that tall, coloured from haze to the fire layer's ember red. A place borrows the nearest station's
// record, the way it borrows a climate station's.
import * as d3 from 'd3';
import { ColumnLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { Data, MONTHS, SmokeStation, interpYearly, km } from './data';
import { barChart } from './charts';
import { esc } from './html';
import { AtlasLayer, NO_DEPTH, TimedEvent, deferChart, detailBars, heroStats, kicker, mk, rgb, sourceLine } from './layers';

export const SMOKE_COLOR = '#e8a87c';
/** haze → amber → the fire layer's ember red, by smoke days in a year */
export const smokeRamp = d3.scaleLinear<string>().domain([0, 5, 15, 30, 60]).range(['#8f8a84', '#d8c3a5', '#ffb36b', '#ff6a3d', '#c4352a']).clamp(true);
/** a place borrows a station up to this far away */
export const SMOKE_REACH_KM = 150;
/** the per-place average covers the last this-many years of the network's record */
const WINDOW = 10;
const MIN_YEARS = 5;

const years = (s: SmokeStation) => Object.keys(s.days).map(Number).sort((a, b) => a - b);
/** the latest year any station has counted */
export const smokeLastYear = (data: Data) => Math.max(...(data.smoke?.stations ?? []).flatMap(years), 0) || null;

export type PlaceSmoke = { name: string; dist: number; avg: number; n: number; from: number; to: number; worst: { y: number; days: number } };

/** A place's smoke days: the nearest station within 150 km with at least five counted years in the last ten, borrowed. */
export function placeSmoke(data: Data, m: { lon: number; lat: number }): PlaceSmoke | null {
  const last = smokeLastYear(data);
  if (!data.smoke || !last) return null;
  let best: PlaceSmoke | null = null;
  for (const s of data.smoke.stations) {
    const d = km(m.lon, m.lat, s.lon, s.lat);
    if (d > SMOKE_REACH_KM || (best && d >= best.dist)) continue;
    const ys = years(s).filter((y) => y > last - WINDOW);
    if (ys.length < MIN_YEARS) continue;
    const w = ys.reduce((a, y) => (s.days[y] > s.days[a] ? y : a), ys[0]);
    best = { name: s.name, dist: d, avg: ys.reduce((a, y) => a + s.days[y], 0) / ys.length, n: ys.length, from: ys[0], to: ys.at(-1)!, worst: { y: w, days: s.days[w] } };
  }
  return best;
}

export function smokeLayer(data: Data): AtlasLayer {
  const color = SMOKE_COLOR;
  const sm = data.smoke;
  const stations = sm?.stations ?? [];
  const limit = sm?.limit ?? 25;
  const all = [...new Set(stations.flatMap(years))].sort((a, b) => a - b);
  const y0 = all[0] ?? 2000, y1 = all.at(-1) ?? 2023;
  // the provincial picture: the mean of the stations counted that year (two or more)
  const mean: Record<number, { v: number; n: number }> = {};
  for (const y of all) {
    const xs = stations.map((s) => s.days[y]).filter((v) => v != null);
    if (xs.length >= 2) mean[y] = { v: d3.mean(xs)!, n: xs.length };
  }
  const ys = Object.keys(mean).map(Number);
  const worstYear = ys.reduce((a, y) => (mean[y].v > mean[a].v ? y : a), ys[0] ?? y1);
  const worstAt = (y: number) => stations.filter((s) => s.days[y] != null).sort((a, b) => b.days[y] - a.days[y]);
  const recent = ys.filter((y) => y > y1 - 10), early = ys.filter((y) => y <= y1 - 10);
  const avgOf = (yy: number[]) => (yy.length ? d3.mean(yy, (y) => mean[y].v)! : null);
  const H = (days: number) => 2500 + days * 1500;

  const l: AtlasLayer = {
    id: 'smoke',
    name: 'Smoke & air',
    icon: '🌫',
    color,
    range: [y0, y1 + 0.99],
    available: !!sm,
    unavailable: 'Environment Canada’s air-quality archive (NAPS) could not be reached when this copy of the data was built. Run <code>npm run data smoke</code>, then reload.',
    build({ time, focusedId }) {
      const live = stations
        .map((s) => ({ s, d: interpYearly(s.days, time) }))
        .filter((x) => x.d != null) as { s: SmokeStation; d: number }[];
      const layers: Layer[] = [
        new ScatterplotLayer<any>({
          id: 'smoke-base',
          data: stations,
          getPosition: (s) => [s.lon, s.lat],
          getRadius: 9000,
          radiusMinPixels: 3,
          getFillColor: rgb(color, 70),
          pickable: true,
          parameters: NO_DEPTH,
        }),
        new ColumnLayer<any>({
          id: 'smoke-cols',
          data: live,
          getPosition: (x) => [x.s.lon, x.s.lat],
          radius: 8000,
          diskResolution: 20,
          extruded: true,
          getElevation: (x) => H(x.d),
          getFillColor: (x) => rgb(smokeRamp(x.d), 230),
          material: { ambient: 0.65, diffuse: 0.5 },
          pickable: true,
          updateTriggers: { getElevation: time, getFillColor: time },
        }),
      ];
      if (focusedId === 'smoke')
        layers.push(
          new TextLayer<any>({
            id: 'smoke-labels',
            data: live,
            getPosition: (x) => [x.s.lon, x.s.lat, H(x.d) + 7000],
            getText: (x) => `${x.s.name} ${Math.round(x.d)} d`,
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
    spark: () => ys.map((x) => ({ x, y: mean[x].v, color: smokeRamp(mean[x].v) })),
    events(): TimedEvent[] {
      if (!ys.length) return [];
      const y = worstYear;
      const ranked = worstAt(y);
      const top = ranked[0];
      return [{
        t: y + 0.6, layer: 'smoke', kind: 'Smoke season', layers: ['smoke', 'fires'],
        title: `${y}: the smokiest year on record`,
        body: `Saskatchewan’s air-monitoring stations averaged ${Math.round(mean[y].v)} smoke days in ${y}, days when the 24-hour average of fine particles (PM2.5) topped ${limit} µg/m³. ${top ? `${top.name} counted ${top.days[y]}, and its worst day (${top.peakDate[y]}) averaged ${Math.round(top.peak[y])} µg/m³.` : ''}`,
        stats: [
          { v: `${Math.round(mean[y].v)}`, l: `smoke days, average of ${mean[y].n} stations` },
          ...(top ? [{ v: `${top.days[y]}`, l: `at ${top.name}` }] : []),
          { v: `${Math.round(Math.max(...ranked.map((s) => s.peak[y])))} µg/m³`, l: 'worst 24-hour average' },
        ],
        sections: [{ title: 'Where the smoke comes from', text: 'Most smoke days fall between May and September, when wildfires burn in the northern forest, upwind in Alberta and British Columbia, or as far off as Quebec and the Northwest Territories. A few winter days come from cold-air inversions trapping local smoke and exhaust instead.' }],
        detail: (el) => el.insertAdjacentHTML('beforeend', `<h3>Smoke days by station, ${y}</h3><div class="legend" style="display:grid;gap:6px">${ranked.map((s) => `<span><span class="sw" style="background:${smokeRamp(s.days[y])}"></span><b>${s.days[y]}</b> · ${esc(s.name)} <span class="tk">(worst day ${esc(s.peakDate[y])}, ${Math.round(s.peak[y])} µg/m³)</span></span>`).join('')}</div>`),
        sources: [{ label: 'ECCC National Air Pollution Surveillance (NAPS) program', url: sm!.sourceUrl }],
      }];
    },
    panel(el) {
      el.innerHTML = `${kicker(l, 'Fine particles · NAPS')}
        <h2>Smoke on the wind</h2>
        <p class="lede">Each column is an air-monitoring station. Its height is how many days that year the air averaged more than ${limit} µg/m³ of fine particles (PM2.5) over 24 hours: on the prairies, nearly always wildfire smoke. Haze-grey is a clear year; ember red is a summer under smoke.</p>`;
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Smoke days a year, average of the stations</h3>`);
      const set = deferChart(el.appendChild(mk('div')), (c) =>
        barChart(c, { data: l.spark(), xDomain: [y0, y1], color, height: 120, yFormat: (v) => `${Math.round(v)}`, tooltip: (d) => `<b>${d.x}</b><br>${d.y.toFixed(1)} smoke days, average of ${mean[d.x].n} stations` }),
      );
      const months = MONTHS.map((_, i) => d3.sum(stations, (s) => s.months[i]));
      const mTotal = d3.sum(months) || 1;
      const season = d3.sum(months.slice(4, 9));
      el.insertAdjacentHTML('beforeend', `
        <h3>Stations</h3>
        <div class="legend" style="display:grid;gap:6px">${stations.map((s) => { const yy = years(s); return `<span><b>${esc(s.name)}</b> · ${yy[0]}–${yy.at(-1)} · ${yy.length} years counted · ${Math.round(d3.mean(yy, (y) => s.days[y])!)} smoke days a year on average</span>`; }).join('')}</div>
        <h3>Smoke days a year</h3>
        <div class="ramp" style="background:linear-gradient(90deg, ${[0, 5, 15, 30, 60].map((v) => smokeRamp(v)).join(', ')})"></div>
        <div class="ramp-labels"><span>0</span><span>5</span><span>15</span><span>30</span><span>60+</span></div>
        <div class="callout" style="--c:${color}">${Math.round((season / mTotal) * 100)}% of all smoke days counted here fell between May and September, the wildfire season.</div>
        <p class="note">A smoke day is a calendar day whose 24-hour average PM2.5 is above ${limit} µg/m³, the World Health Organization’s 2005 24-hour guideline (Canada’s 2020 ambient standard is 27). Fine particles also come from traffic, industry and winter inversions, so not every such day is smoke. A day counts only with ${sm?.minHours ?? 18} or more of its 24 hourly readings; a station-year counts only when ${Math.round((sm?.minShare ?? 0.75) * 100)}% of its days, and of its May–September days, are valid, so some years are missing. Stations in the same city are joined into one record. Only ${stations.length} stations monitor PM2.5 in Saskatchewan, all in or near cities; Environment Canada’s archive has Saskatchewan data to ${y1}${sm?.filesTo && sm.filesTo > y1 ? ` (its ${sm.filesTo} file does not include Saskatchewan yet)` : ''}.</p>
        ${sourceLine(sm?.source ?? '')}`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          hero(0, mean[y] ? mean[y].v.toFixed(0) : '–', mean[y] ? `smoke days in ${y}, ${mean[y].n}-station average` : `no stations counted in ${y}`);
          hero(1, String(worstYear), `smokiest year (${mean[worstYear] ? Math.round(mean[worstYear].v) : '–'} days)`);
          const a = avgOf(recent), b = avgOf(early);
          hero(2, a != null ? a.toFixed(0) : '–', `days a year, ${recent[0] ?? '–'}–${y1}${b != null ? ` (${b.toFixed(0)} before)` : ''}`);
          hero(3, String(stations.length), 'stations');
          set(time);
        },
      };
    },
    describe(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('smoke')) return null;
      const s: SmokeStation = o.s ?? o;
      const yy = years(s);
      if (!yy.length) return null;
      const w = yy.reduce((a, y) => (s.days[y] > s.days[a] ? y : a), yy[0]);
      const pk = yy.reduce((a, y) => (s.peak[y] > s.peak[a] ? y : a), yy[0]);
      const busiest = s.months.map((n, i) => ({ n, i })).sort((a, b) => b.n - a.n).filter((x) => x.n > 0).slice(0, 3);
      return {
        layer: 'smoke', kind: 'Air-monitoring station', lon: s.lon, lat: s.lat, zoom: 9,
        title: s.name, body: `NAPS station${s.ids.length > 1 ? 's' : ''} ${s.ids.join(' and ')}, ${yy.length} years counted (${yy[0]}–${yy.at(-1)}). Each bar is a year’s smoke days: days the 24-hour average PM2.5 topped ${limit} µg/m³.`,
        stats: [
          { v: `${Math.round(d3.mean(yy, (y) => s.days[y])!)}`, l: 'smoke days a year on average' },
          { v: `${s.days[w]}`, l: `smoke days in ${w}, its worst year` },
          { v: `${Math.round(s.peak[pk])} µg/m³`, l: `worst day, ${s.peakDate[pk]}` },
          ...(busiest.length ? [{ v: busiest.map((x) => MONTHS[x.i]).join(', '), l: 'smokiest months' }] : []),
        ],
        detail: detailBars('Smoke days each year', yy.map((y) => ({ x: y, y: s.days[y], color: smokeRamp(s.days[y]) })), color, (v) => `${Math.round(v)}`, (d) => `<b>${d.x}</b> · ${d.y} smoke days`),
        sources: [{ label: 'ECCC National Air Pollution Surveillance (NAPS) program', url: sm!.sourceUrl }],
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('smoke')) return null;
      const s: SmokeStation = o.s ?? o;
      const yy = years(s);
      return `<b>${esc(s.name)}</b> <span class="tk">air station</span>${o.d != null ? `<br><span class="tk">This year</span> <span class="tv">${Math.round(o.d)} smoke days</span>` : ''}<br><span class="tk">Average</span> <span class="tv">${yy.length ? Math.round(d3.mean(yy, (y) => s.days[y])!) : '–'} days a year</span><br><span class="tk">Record</span> <span class="tv">${yy[0] ?? '–'}–${yy.at(-1) ?? '–'}</span>`;
    },
  };
  return l;
}

