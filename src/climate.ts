// CLIMATE
import * as d3 from 'd3';
import type { Layer } from '@deck.gl/core';
import { ColumnLayer, TextLayer } from '@deck.gl/layers';
import { Data, Muni, interpYearly, fmt } from './data';
import type { ProjScen, ProjVar } from './data';
import { AtlasLayer, rgb, NO_DEPTH, kicker, heroStats, deferChart, mk, sourceLine, detailBars } from './layer-kit';
import { provinceAnomalies, slope } from './metrics';
import { provinceBand, projAt, windowText, SCEN_COLOR, rangeText, PROJ_BADGE, SCEN_SHORT, provinceMedian } from './projections';
import { stripes, bandChart, barChart, rampCSS } from './charts';
import { esc } from './html';

export function climateLayer(data: Data): AtlasLayer {
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
