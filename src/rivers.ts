// RIVER FLOODS
import * as d3 from 'd3';
import { ColumnLayer, ScatterplotLayer, PolygonLayer } from '@deck.gl/layers';
import { Data, FloodZone, NowRiverRow, interpYearly, fmt } from './data';
import { AtlasLayer, RGBA, RecentSpan, rgb, NO_DEPTH, glowWindow, ADDITIVE, TimedEvent, kicker, heroStats, deferChart, mk, sourceLine, detailBars } from './layer-kit';
import { riversHistory, dayT, tDay, dayText } from './history';
import { drawable, ageTag, alertList, alertsInEffect, nowBlock, NOW_T, ms, freshness, alertOutlines, tickAges, isNow, alertEvent, ago, alertTooltip } from './now';
import { esc, safeUrl } from './html';
import { barChart, rampCSS } from './charts';

export function riversLayer(data: Data): AtlasLayer {
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
