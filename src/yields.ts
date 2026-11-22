// Crop yields: "A century of harvest". AAFC's Canadian Crop Yields give each census division's reported yield every
// year since 1987 (Statistics Canada's survey figures); the divisions rise as columns of bushels an acre, tinted by the
// year against the division's own trend, and play on the timeline. Past the record, AAFC's Canadian Crop Yield
// Forecaster's range for the next harvest is drawn as wire-framed columns between its 10th and 90th percentiles:
// a model range, badged and hatched, never a single value and never in the Finder. Statistics Canada's own series sit
// beside it as separate charts, never joined to it: Saskatchewan since 1908, and the 20 crop districts to 2016.
import * as d3 from 'd3';
import { ColumnLayer, PolygonLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Data, Yields, fmt } from './data';
import { bandChart, barChart, lineChart, rampCSS } from './charts';
import { esc, safeUrl } from './html';
import { AtlasEvent, AtlasLayer, NO_DEPTH, TimedEvent, dashExt, deferChart, heroStats, kicker, mk, rgb, sourceLine } from './layer-kit';
import { link } from './report-kit';

export const YIELDS_COLOR = '#e9c46a';
/** the forecast's colour: the projections' red, so a model range never reads as the record */
const FC_COLOR = '#ff8f86';
const FC_BADGE = '<span class="proj-badge">Model forecast, not a record</span>';
/** the year against the division's own trend: poor years burn red, good ones green, the usual stays wheat-pale */
const ANOM = d3.scaleLinear<string>().domain([-0.45, -0.2, 0, 0.2]).range(['#b3261e', '#e8853a', '#e6dcb4', '#62c46c']).clamp(true);
const NONE = '#5d6678';
/** the running median that stands for a division's trend: 5 years either side, at least 5 values */
const HALF = 5, MIN_N = 5;
/** the Town Report's main crops, in order */
const REPORT_CROPS = ['sw', 'ca', 'dw', 'ba', 'oa', 'pe', 'le', 'fl'];

const med = (xs: number[]) => (xs.length ? d3.median(xs)! : null);
/** each value against the median of its window (null where a value or its window is missing) */
export function anomalies(xs: (number | null)[]): (number | null)[] {
  return xs.map((v, i) => {
    if (v == null) return null;
    const w = xs.slice(Math.max(0, i - HALF), i + HALF + 1).filter((x): x is number => x != null);
    const m = w.length >= MIN_N ? med(w) : null;
    return m ? v / m - 1 : null;
  });
}
/** the running median itself, for the tooltips */
const trendAt = (xs: (number | null)[], i: number) => {
  const w = xs.slice(Math.max(0, i - HALF), i + HALF + 1).filter((x): x is number => x != null);
  return w.length >= MIN_N ? med(w) : null;
};
const fmtV = (v: number, unit: string) => (unit === 'lb/ac' ? fmt.int(v) : v.toFixed(1));
const pctS = (a: number) => `${a >= 0 ? '+' : '−'}${Math.abs(a * 100).toFixed(0)}%`;
const monthName = (m: number) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1] ?? '';

/** A place's census division and its latest yields: per crop the latest year reported and the ten-year average. */
export type PlaceYields = {
  cd: string; year: number;
  rows: { id: string; name: string; unit: string; v: number | null; y: number | null; avg: number | null; n: number }[];
  fc: { year: number; month: number; rows: { name: string; unit: string; lo: number; hi: number }[] } | null;
};
export function placeYields(data: Data, key: string): PlaceYields | null {
  const Y = data.yields;
  const i = Y?.towns[key];
  if (!Y || i == null || !Y.v[Y.crops[0].id]?.[i]) return null;
  const y1 = Y.years.at(-1)!;
  const rows = REPORT_CROPS.flatMap((id) => {
    const c = Y.crops.find((x) => x.id === id);
    const s = Y.v[id]?.[i];
    if (!c || !s) return [];
    const li = s.reduce<number>((a, v, k) => (v != null ? k : a), -1);
    const last10 = s.slice(-10).filter((v): v is number => v != null);
    return [{ id, name: c.name, unit: c.unit, v: li >= 0 ? s[li] : null, y: li >= 0 ? Y.years[li] : null, avg: last10.length >= 5 ? d3.mean(last10)! : null, n: last10.length }];
  }).filter((r) => r.v != null || r.avg != null);
  const F = Y.forecast;
  const fcRows = F.year > y1 ? ['sw', 'ca', 'le'].flatMap((id) => {
    const c = Y.crops.find((x) => x.id === id), r = F.crops[id]?.v[i];
    return c && r ? [{ name: c.name, unit: c.unit, lo: r[0], hi: r[2] }] : [];
  }) : [];
  const month = F.crops.sw?.month ?? F.crops[Object.keys(F.crops)[0]]?.month ?? 0;
  return { cd: Y.cds[i].name, year: y1, rows, fc: fcRows.length ? { year: F.year, month, rows: fcRows } : null };
}

export function yieldsLayer(data: Data): AtlasLayer {
  const color = YIELDS_COLOR;
  const Y: Yields | null = data.yields;
  const years = Y?.years ?? [];
  const y0 = years[0] ?? 1987, y1 = years.at(-1) ?? 2025;
  const F = Y?.forecast;
  const fYear = F && F.year > y1 ? F.year : null;
  const crops = Y?.crops ?? [];
  const cds = Y?.cds ?? [];
  let crop = crops[0]?.id ?? 'sw';
  const cropOf = (id = crop) => crops.find((c) => c.id === id) ?? { id, name: id, unit: 'bu/ac' };
  const series = (i: number, id = crop) => Y?.v[id]?.[i] ?? null;
  // per crop: each division's anomalies, the middle division's yield a year and its anomalies, the crop's typical value
  const memo = new Map<string, { an: ((number | null)[] | null)[]; mid: (number | null)[]; midAn: (number | null)[]; ref: number }>();
  const stats = (id = crop) => {
    let s = memo.get(id);
    if (s) return s;
    const rows = cds.map((_, i) => series(i, id));
    const mid = years.map((_, k) => med(rows.flatMap((r) => (r?.[k] != null ? [r[k]!] : []))));
    s = {
      an: rows.map((r) => (r ? anomalies(r) : null)),
      mid, midAn: anomalies(mid),
      ref: med(rows.flatMap((r) => (r ?? []).filter((v): v is number => v != null))) ?? 1,
    };
    memo.set(id, s);
    return s;
  };
  /** the middle division's forecast range (the median of the divisions' 10th, 50th and 90th percentiles) */
  const fcMid = (id = crop) => {
    const rs = (F?.crops[id]?.v ?? []).filter((r): r is [number, number, number] => !!r);
    if (!fYear || !rs.length) return null;
    return { lo: med(rs.map((r) => r[0]))!, med: med(rs.map((r) => r[1]))!, hi: med(rs.map((r) => r[2]))! };
  };
  // the province since 1908 (Statistics Canada), a separate series
  const P = Y?.province;
  const provAt = (y: number, id = crop) => { const k = P?.years.indexOf(y) ?? -1; return k >= 0 ? P!.v[id]?.[k] ?? null : null; };
  const SRC = { label: 'AAFC Canadian Crop Yields (open.canada.ca)', url: safeUrl(Y?.sourceUrl) ?? 'https://open.canada.ca/data/en/dataset/9253a01b-f1d9-4b67-ba98-857667827c7b' };
  const SRC_P = { label: 'Statistics Canada Table 32-10-0359-01', url: safeUrl(Y?.provinceUrl) ?? 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3210035901' };
  type Part = { i: number; poly: [number, number][][] };
  const parts: Part[] = cds.flatMap((c, i) => c.polys.map((poly) => ({ i, poly })));
  const hasData = (i: number) => !!Y?.v[crops[0]?.id]?.[i];
  const H = 80000; // metres for the crop's typical yield
  let shownYear = y1;

  const yearIndex = (t: number) => years.indexOf(Math.floor(t));
  const isFc = (t: number) => fYear != null && Math.floor(t) === fYear;

  const l: AtlasLayer = {
    id: 'yields',
    name: 'Crop yields',
    icon: '🚜',
    color,
    range: [y0, (fYear ?? y1) + 0.999],
    available: !!Y && years.length > 0,
    unavailable: 'AAFC’s Canadian Crop Yields could not be read when this copy of the data was built. Run <code>npm run data yields</code>, then reload.',
    projection: fYear ? {
      from: fYear,
      bands: () => { const m = fcMid(); return m ? [{ color: FC_COLOR, pts: [{ x: fYear, lo: m.lo, hi: m.hi }, { x: fYear + 0.999, lo: m.lo, hi: m.hi }] }] : []; },
    } : undefined,
    build({ time, focusedId }) {
      if (!Y) return [];
      const focused = focusedId === 'yields';
      const k = yearIndex(time), fc = isFc(time);
      shownYear = fc ? fYear! : Math.floor(time);
      const s = stats();
      const c = cropOf();
      const out: Layer[] = [
        new PolygonLayer<Part>({
          id: 'yields-cds',
          data: parts,
          getPolygon: (d) => d.poly,
          getFillColor: (d) => {
            if (!hasData(d.i) || fc) return [0, 0, 0, 0];
            const a = k >= 0 ? s.an[d.i]?.[k] ?? null : null;
            return a == null ? rgb(NONE, 40) : rgb(ANOM(a), focused ? 105 : 70);
          },
          getLineColor: (d) => (fc && hasData(d.i) ? rgb(FC_COLOR, 200) : hasData(d.i) ? [235, 240, 250, 140] : [235, 240, 250, 60]),
          getDashArray: fc ? [5, 4] : [0, 0],
          dashJustified: true,
          extensions: dashExt,
          lineWidthUnits: 'pixels',
          getLineWidth: 1.1,
          pickable: true,
          parameters: NO_DEPTH,
          updateTriggers: { getFillColor: [k, crop, focused, fc], getLineColor: [fc], getDashArray: [fc] },
        } as any),
      ];
      const live = cds.map((d, i) => ({ d, i })).filter(({ i }) => hasData(i));
      if (!fc && k >= 0) {
        const cols = live.flatMap(({ d, i }) => { const v = series(i)?.[k]; return v != null ? [{ d, i, v, a: s.an[i]?.[k] ?? null }] : []; });
        out.push(new ColumnLayer<any>({
          id: 'yields-cols',
          data: cols,
          getPosition: (o) => o.d.c,
          radius: 13000,
          diskResolution: 24,
          extruded: true,
          getElevation: (o) => (o.v / s.ref) * H,
          getFillColor: (o) => (o.a == null ? rgb(NONE, 230) : rgb(ANOM(o.a), 240)),
          material: { ambient: 0.55, diffuse: 0.65, shininess: 50 },
          pickable: true,
          transitions: { getElevation: 350 },
          updateTriggers: { getElevation: [k, crop], getFillColor: [k, crop] },
        }));
        if (focused)
          out.push(new TextLayer<any>({
            id: 'yields-labels',
            data: cols,
            getPosition: (o) => [o.d.c[0], o.d.c[1], (o.v / s.ref) * H + 6000],
            getText: (o) => fmtV(o.v, c.unit),
            getSize: 12,
            getColor: [244, 246, 252, 235],
            fontFamily: 'Inter, sans-serif',
            fontWeight: 700,
            outlineWidth: 4,
            outlineColor: [6, 10, 18, 235],
            fontSettings: { sdf: true },
            characterSet: 'auto',
            parameters: { depthCompare: 'always' },
            updateTriggers: { getText: [k, crop], getPosition: [k, crop] },
          } as any));
      }
      if (fc) {
        const rows = F!.crops[crop]?.v ?? [];
        const cols = live.flatMap(({ d, i }) => (rows[i] ? [{ d, i, r: rows[i]! }] : []));
        // the range between the model's 10th and 90th percentiles: a solid low column inside a wire frame to the high one
        out.push(new ColumnLayer<any>({
          id: 'yields-fc-lo',
          data: cols,
          getPosition: (o) => o.d.c,
          radius: 11000,
          diskResolution: 6,
          extruded: true,
          getElevation: (o) => (o.r[0] / s.ref) * H,
          getFillColor: rgb(FC_COLOR, 90),
          pickable: true,
          updateTriggers: { getElevation: [crop] },
        }));
        out.push(new ColumnLayer<any>({
          id: 'yields-fc-hi',
          data: cols,
          getPosition: (o) => o.d.c,
          radius: 13000,
          diskResolution: 6,
          extruded: true,
          filled: false,
          wireframe: true,
          getElevation: (o) => (o.r[2] / s.ref) * H,
          getLineColor: rgb(FC_COLOR, 230),
          pickable: true,
          updateTriggers: { getElevation: [crop] },
        }));
      }
      return out;
    },
    // the middle division's yield a year, tinted by its own trend
    spark: () => { const s = stats(); return years.flatMap((y, k) => (s.mid[k] != null ? [{ x: y, y: s.mid[k]!, color: s.midAn[k] == null ? color : ANOM(s.midAn[k]!) }] : [])); },
    events(): TimedEvent[] {
      if (!Y) return [];
      const ev: TimedEvent[] = [];
      const sw = crops.find((c) => c.id === 'sw') ? 'sw' : crops[0].id;
      const at = (yr: number, id: string) => {
        const k = years.indexOf(yr);
        if (k < 0) return null;
        const s = stats(id);
        const hit = cds.map((d, i) => ({ d, i, v: series(i, id)?.[k] ?? null, a: s.an[i]?.[k] ?? null })).filter((x) => x.v != null && x.a != null) as { d: Yields['cds'][0]; i: number; v: number; a: number }[];
        return { k, s, hit, low: hit.filter((x) => x.a <= -0.25), worst: hit.reduce<(typeof hit)[0] | null>((w, x) => (!w || x.a < w.a ? x : w), null) };
      };
      const prov5 = (yr: number, id: string) => { const xs = d3.range(yr - 5, yr).map((y) => provAt(y, id)).filter((v): v is number => v != null); return xs.length >= 3 ? d3.mean(xs)! : null; };
      // 2021: the drought harvest, beside the Drought layer
      const d21 = at(2021, sw), c21 = at(2021, 'ca');
      if (d21?.worst) {
        const c = cropOf(sw);
        const pv = provAt(2021, sw), p5 = prov5(2021, sw), cv = provAt(2021, 'ca'), c5 = prov5(2021, 'ca');
        const D = data.drought;
        const jul = D ? D.months.indexOf('2021-07') : -1;
        const dShare = D && jul >= 0 ? D.share[jul][2] : null;
        // the last year the province's spring wheat was lower
        const lower = pv != null ? (P?.years ?? []).filter((y) => y < 2021 && (provAt(y, sw) ?? Infinity) < pv).at(-1) ?? null : null;
        ev.push({
          t: 2021.62, layer: 'yields', kind: 'Harvest', layers: ['yields', 'drought'], lon: -106.4, lat: 51.4, zoom: 5.5,
          title: '2021: the harvest the drought took',
          body: `Drought cut the 2021 harvest across the farm belt. ${pv != null && p5 != null ? `Spring wheat averaged ${fmtV(pv, c.unit)} ${c.unit} across Saskatchewan, against ${fmtV(p5, c.unit)} over the five years before${lower ? `, the lowest since ${lower}` : ''} (Statistics Canada).` : ''}${cv != null && c5 != null ? ` Canola fell to ${fmtV(cv, 'bu/ac')} bu/ac from ${fmtV(c5, 'bu/ac')}.` : ''} ${d21.low.length} of ${d21.hit.length} census divisions harvested spring wheat at least a quarter below their own trend; the worst, ${d21.worst.d.name}, got ${fmtV(d21.worst.v, c.unit)} ${c.unit}, ${pctS(d21.worst.a)} against it.${dShare != null ? ` At the end of July ${dShare.toFixed(0)}% of the province was in severe drought or worse on the Drought Monitor: switch on the Drought layer to see where.` : ' The Drought layer shows where it was dry.'}`,
          stats: [
            ...(pv != null ? [{ v: `${fmtV(pv, c.unit)}`, l: `${c.unit} spring wheat, Saskatchewan 2021` }] : []),
            ...(p5 != null ? [{ v: `${fmtV(p5, c.unit)}`, l: `${c.unit}, 2016–2020 average` }] : []),
            { v: `${d21.low.length} of ${d21.hit.length}`, l: 'divisions 25%+ below their own trend' },
            ...(c21?.worst ? [{ v: `${pctS(c21.worst.a)}`, l: `canola in ${c21.worst.d.name}, the worst` }] : []),
            ...(dShare != null ? [{ v: `${dShare.toFixed(0)}%`, l: 'of the province at D2+, end of July 2021' }] : []),
          ],
          sections: [
            { title: 'Reading the columns', text: 'Each column is a census division’s reported yield; its colour is that year against the division’s own trend (the median of the eleven years around it), so a division that always grows less is not painted as failing.' },
            { title: 'On the Drought layer', text: 'The Drought layer’s month-end maps show the dry area spreading through the summer of 2021; “Show it on the map” switches both layers on.' },
          ],
          detail: (el) => {
            const k = d21.k;
            const rows = d21.hit.slice().sort((a, b) => a.a - b.a);
            if (!rows.length) return;
            el.insertAdjacentHTML('beforeend', `<h3>Spring wheat 2021 against each division’s trend</h3>`);
            const box = el.appendChild(mk('div', 'ev-chart'));
            requestAnimationFrame(() => barChart(box, { data: rows.map((x, n) => ({ x: n, y: Math.round(x.a * 100), color: ANOM(x.a) })), xDomain: [0, rows.length - 1], color, height: 120, yFormat: (v) => `${v}%`, diverging: true, tooltip: (d) => { const x = rows[d.x]; return `<b>${esc(x.d.name)}</b><br>${fmtV(x.v, c.unit)} ${c.unit} in ${years[k]} · ${pctS(x.a)} against its trend`; } }));
          },
          sources: [SRC, SRC_P, ...(D ? [{ label: 'AAFC Canadian Drought Monitor', url: safeUrl(D.sourceUrl) ?? 'https://open.canada.ca/data/en/dataset/292646cd-619f-4200-afb1-8b2c52f984a2' }] : [])],
        });
      }
      // the worst year on the census-division record, if it is not 2021
      const s = stats(sw);
      const kw = s.midAn.reduce<number>((w, a, k) => (a != null && (w < 0 || a < s.midAn[w]!) ? k : w), -1);
      if (kw >= 0 && years[kw] !== 2021) {
        const yr = years[kw], d = at(yr, sw), c = cropOf(sw), pv = provAt(yr, sw), p5 = prov5(yr, sw);
        if (d)
          ev.push({
            t: yr + 0.62, layer: 'yields', kind: 'Harvest', layers: ['yields'], lon: -106.4, lat: 51.4, zoom: 5.5,
            title: `${yr}: the poorest ${c.name.toLowerCase()} year on the census-division record`,
            body: `Measured against each division’s own trend, ${yr} was the worst ${c.name.toLowerCase()} year since ${y0}: the middle division harvested ${fmtV(s.mid[kw]!, c.unit)} ${c.unit}, ${pctS(s.midAn[kw]!)} against its trend, and ${d.low.length} of ${d.hit.length} divisions fell a quarter or more below theirs.${pv != null && p5 != null ? ` Across the province ${c.name.toLowerCase()} averaged ${fmtV(pv, c.unit)} ${c.unit}, against ${fmtV(p5, c.unit)} over the five years before (Statistics Canada).` : ''}`,
            stats: [{ v: `${pctS(s.midAn[kw]!)}`, l: 'middle division against its trend' }, { v: `${d.low.length} of ${d.hit.length}`, l: 'divisions 25%+ below their trend' }, ...(pv != null ? [{ v: fmtV(pv, c.unit), l: `${c.unit} spring wheat, Saskatchewan ${yr}` }] : [])],
            sources: [SRC, SRC_P],
          });
      }
      return ev;
    },
    panel(el) {
      el.innerHTML = `${kicker(l, `Canadian Crop Yields · ${y0} → ${y1}${fYear ? ` · forecast ${fYear}` : ''}`)}
        <h2>A century of harvest</h2>`;
      if (!Y) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      el.insertAdjacentHTML('beforeend', `<p class="lede">How much each acre gave, census division by census division, every harvest since ${y0}. The columns are the reported yield; their colour is the year against the division’s own trend, so a dry year burns red wherever it struck. Farm towns ride these numbers. Pick a crop and play the timeline${fYear ? `; past ${y1} the columns turn to wire frames, the range of Agriculture and Agri-Food Canada’s forecast for ${fYear}` : ''}.</p>
        <div class="chips" style="margin:2px 0 10px">${crops.map((c) => `<button class="chip" data-crop="${esc(c.id)}" style="--c:${color}">${esc(c.name)}</button>`).join('')}</div>`);
      const hero = heroStats(el, 4);
      const box = el.appendChild(mk('div'));
      const set = { a: (_t: number) => {}, b: (_t: number) => {} };
      const draw = () => {
        const c = cropOf(), s = stats(), m = fcMid();
        const pk = P ? P.years.map((y, k) => ({ y, v: P.v[crop]?.[k] ?? null })).filter((x) => x.v != null) as { y: number; v: number }[] : [];
        const pAn = anomalies(pk.map((x) => x.v));
        const rec = pk.filter((x) => x.y < (P?.provisionalFrom ?? Infinity));
        const lo = rec.reduce<(typeof rec)[0] | null>((w, x) => (!w || x.v < w.v ? x : w), null);
        const hi = rec.reduce<(typeof rec)[0] | null>((w, x) => (!w || x.v > w.v ? x : w), null);
        const prov = pk.find((x) => x.y >= (P?.provisionalFrom ?? Infinity));
        const DS = Y.districts;
        const dRows = (DS.v[crop] ?? []);
        const dSeries = (f: (xs: number[]) => number | undefined, key: string, label: string, col: string, width = 1.5, dashed = false) => ({ key, label, color: col, width, dashed, values: DS.years.flatMap((y, k) => { const xs = dRows.map((r) => r[k]).filter((v): v is number => v != null); const v = xs.length >= 5 ? f(xs) : undefined; return v != null ? [{ x: y, y: v }] : []; }) });
        box.innerHTML = `
          <h3>${esc(c.name)}, the middle census division · ${c.unit}</h3>
          <div class="yl-mid"></div>
          ${m ? `<div class="yl-fc">${FC_BADGE} <span>${fYear}: ${fmtV(m.lo, c.unit)}–${fmtV(m.hi, c.unit)} ${c.unit} in the middle division, the 10th to 90th percentile of AAFC’s Canadian Crop Yield Forecaster, run in mid-${monthName(F!.crops[crop]!.month)} ${fYear}${F!.crops[crop]!.months.length > 1 ? ` (run monthly since ${monthName(F!.crops[crop]!.months[0])})` : ''}. A model range for the harvest, not a reported yield; Statistics Canada’s survey figures for ${fYear} follow in December and by division in February.</span></div>` : ''}
          <h3>Saskatchewan since ${pk[0]?.y ?? 1908} · ${esc(c.name.toLowerCase())}, ${c.unit}</h3>
          <div class="yl-century"></div>
          ${lo && hi ? `<div class="callout" style="--c:${color}">The poorest ${esc(c.name.toLowerCase())} harvest in the province’s record was <b>${lo.y}</b>: ${fmtV(lo.v, c.unit)} ${c.unit}${lo.y >= 1929 && lo.y <= 1939 ? ', in the Dirty Thirties' : ''}. The best was ${hi.y}, at ${fmtV(hi.v, c.unit)}. ${prov ? `The ${prov.y} bar is Statistics Canada’s early estimate (${fmtV(prov.v, c.unit)} ${c.unit}), drawn grey: it is revised in December.` : ''}</div>` : ''}
          ${dRows.length ? `<h3>Before 2017: the ${DS.n} crop districts, ${DS.years[0]}–${DS.years.at(-1)}</h3><div class="yl-dist"></div><p class="note">A separate series: until 2016 Statistics Canada published Saskatchewan by its ${DS.n} crop districts, which have no open boundaries, so they are not on the map. The lines are the highest, middle and lowest district each year.</p>` : ''}
          <h3>Colour: the year against the division’s own trend</h3>
          <div class="ramp" style="background:${rampCSS((t) => ANOM(-0.45 + t * 0.65))}"></div>
          <div class="ramp-labels"><span>−45%</span><span>−20%</span><span>trend</span><span>+20%</span></div>`;
        const midBars = years.flatMap((y, k) => (s.mid[k] != null ? [{ x: y, y: s.mid[k]!, color: s.midAn[k] == null ? color : ANOM(s.midAn[k]!) }] : []));
        const barTip = (d: { x: number; y: number }) => { const k = years.indexOf(d.x); return `<b>${d.x}</b> · ${fmtV(d.y, c.unit)} ${c.unit}${s.midAn[k] != null ? `<br><span class="tk">against its trend</span> ${pctS(s.midAn[k]!)}` : ''}`; };
        set.a = deferChart(box.querySelector('.yl-mid') as HTMLElement, (e) => m
          ? bandChart(e, { bars: midBars, bands: [{ label: 'AAFC forecast', color: FC_COLOR, pts: [{ x: fYear!, ...m }, { x: fYear! + 1, ...m }] }], from: fYear!, xDomain: [y0, fYear!], height: 140, yFormat: (v) => (c.unit === 'lb/ac' ? fmt.int(v) : String(v)), barTip, bandTip: (_x, rows) => `<b>${fYear} · model forecast</b><br>${rows.map((r) => `${fmtV(r.lo, c.unit)}–${fmtV(r.hi, c.unit)} ${c.unit} (median ${fmtV(r.med, c.unit)})`).join('<br>')}` })
          : barChart(e, { data: midBars, xDomain: [y0, y1], color, height: 140, yFormat: (v) => (c.unit === 'lb/ac' ? fmt.int(v) : String(v)), tooltip: barTip }));
        const cent = pk.map((x, n) => ({ x: x.y, y: x.v, color: x.y >= (P?.provisionalFrom ?? Infinity) ? '#8a94a8' : pAn[n] == null ? color : ANOM(pAn[n]!) }));
        set.b = deferChart(box.querySelector('.yl-century') as HTMLElement, (e) => barChart(e, { data: cent, xDomain: [pk[0]?.y ?? 1908, pk.at(-1)?.y ?? y1], color, height: 130, yFormat: (v) => (c.unit === 'lb/ac' ? fmt.int(v) : String(v)), tooltip: (d) => { const n = pk.findIndex((x) => x.y === d.x); return `<b>${d.x}</b> · ${fmtV(d.y, c.unit)} ${c.unit}${d.x >= (P?.provisionalFrom ?? Infinity) ? '<br><span class="tk">early estimate, revised in December</span>' : pAn[n] != null ? `<br><span class="tk">against its trend</span> ${pctS(pAn[n]!)}` : ''}`; } }));
        const dBox = box.querySelector('.yl-dist') as HTMLElement | null;
        if (dBox) deferChart(dBox, (e) => lineChart(e, {
          height: 120, xDomain: [DS.years[0], DS.years.at(-1)!], yZero: false, valueFormat: (v) => `${fmtV(v, c.unit)} ${c.unit}`,
          series: [dSeries((xs) => d3.max(xs), 'hi', 'Highest district', '#62c46c'), dSeries((xs) => d3.median(xs), 'mid', 'Middle district', color, 2), dSeries((xs) => d3.min(xs), 'lo', 'Lowest district', '#e8853a')],
        }));
      };
      draw();
      el.insertAdjacentHTML('beforeend', `
        <p class="note"><b>Yields are as published:</b> bushels an acre, pounds an acre for lentils, for the whole census division, not one farm’s fields. A blank, suppressed or too-unreliable figure is missing, never zero, and a division that grows little of a crop often has none. From 2017 AAFC’s figures are Statistics Canada’s own by census division (the atlas checked: ${Y.check.same} of ${Y.check.cells} division-years the same in Table 32-10-0002-01); before that Statistics Canada published Saskatchewan by crop districts, and the division figures are AAFC’s compilation. Statistics Canada counts the north’s few farms (Division 18) with Division 16. The trend a colour is measured against is the atlas’s own: the median of the division’s eleven years around it (at least five reported). The middle division is the median of the divisions reporting that year, not a provincial average. The province chart is Statistics Canada’s separate provincial series and is never joined to the division record. Data: ${esc(Y.licence)}; ${esc(Y.statcanLicence)}.</p>
        ${sourceLine(Y.source)}${sourceLine(Y.provinceSource)}${sourceLine(Y.districtSource)}${sourceLine(Y.boundarySource)}`);
      const chips = el.querySelector('.chips')!;
      const mark = () => chips.querySelectorAll<HTMLButtonElement>('[data-crop]').forEach((b) => b.classList.toggle('on', b.dataset.crop === crop));
      chips.addEventListener('click', (e) => {
        const id = (e.target as HTMLElement).closest<HTMLElement>('[data-crop]')?.dataset.crop;
        if (!id || id === crop || !crops.some((c) => c.id === id)) return;
        crop = id;
        mark();
        draw();
        // the timeline's sparkline and forecast band follow the crop (main.ts redraws them on resize)
        window.dispatchEvent(new Event('resize'));
      });
      mark();
      return {
        update({ time }) {
          const c = cropOf(), s = stats();
          const fc = isFc(time), k = yearIndex(time), y = Math.floor(time);
          if (fc) {
            const m = fcMid();
            hero(0, m ? `${fmtV(m.lo, c.unit)}–${fmtV(m.hi, c.unit)}` : '–', `${c.unit} ${c.name.toLowerCase()}, middle division: model range for ${fYear}`);
            const rows = (F!.crops[crop]?.v ?? []).filter(Boolean).length;
            hero(1, String(rows), `divisions in the forecast (10th–90th percentile)`);
          } else if (k >= 0) {
            const an = cds.map((_, i) => s.an[i]?.[k] ?? null).filter((a): a is number => a != null);
            hero(0, s.mid[k] != null ? fmtV(s.mid[k]!, c.unit) : '–', `${c.unit} ${c.name.toLowerCase()}, middle division, ${y}`);
            hero(1, an.length ? `${an.filter((a) => a <= -0.15).length} of ${an.length}` : '–', `divisions 15%+ below their own trend, ${y}`);
          } else {
            hero(0, '–', `division record begins ${y0}`);
            hero(1, '–', '');
          }
          const pv = provAt(fc ? fYear! : y);
          hero(2, pv != null ? fmtV(pv, c.unit) : '–', pv != null ? `${c.unit}, Saskatchewan ${fc ? fYear : y}${(fc ? fYear! : y) >= (P?.provisionalFrom ?? Infinity) ? ' (early estimate)' : ''} · Statistics Canada` : 'Saskatchewan (Statistics Canada)');
          const pk = P ? P.years.map((yy, n) => ({ y: yy, v: P.v[crop]?.[n] ?? null })).filter((x) => x.v != null && x.y < P.provisionalFrom) as { y: number; v: number }[] : [];
          const lo = pk.reduce<(typeof pk)[0] | null>((w, x) => (!w || x.v < w.v ? x : w), null);
          hero(3, lo ? fmtV(lo.v, c.unit) : '–', lo ? `${c.unit} in ${lo.y}, the province’s poorest since ${pk[0].y}` : '');
          set.a(time);
          set.b(time);
        },
      };
    },
    describe(info: PickingInfo): AtlasEvent | null {
      const o: any = info.object;
      const id = info.layer?.id ?? '';
      if (!Y || !id.startsWith('yields')) return null;
      const i: number | undefined = o?.i;
      if (i == null || !hasData(i)) return null;
      const d = cds[i], c = cropOf(), s = stats(), xs = series(i);
      const fcr = fYear ? F!.crops[crop]?.v[i] ?? null : null;
      const last10 = (xs ?? []).slice(-10).filter((v): v is number => v != null);
      const k21 = years.indexOf(2021);
      const v21 = k21 >= 0 ? xs?.[k21] ?? null : null;
      const bars = years.flatMap((y, k) => (xs?.[k] != null ? [{ x: y, y: xs[k]!, color: s.an[i]?.[k] == null ? color : ANOM(s.an[i]![k]!) }] : []));
      return {
        layer: 'yields', kind: 'Census division', lon: d.c[0], lat: d.c[1], zoom: 6.6,
        title: d.name,
        body: `${c.name} in ${d.name}, every harvest reported since ${y0}${fcr ? `, and AAFC’s forecast range for ${fYear}` : ''}. Yields are for the whole division, as Statistics Canada reports them.${d.uid === '4716' ? ' Statistics Canada counts the farms of Division 18, the north, with this division.' : ''}`,
        stats: [
          ...(last10.length ? [{ v: fmtV(d3.mean(last10)!, c.unit), l: `${c.unit}, ten-year average (${last10.length} of the last 10 years reported)` }] : []),
          ...(v21 != null ? [{ v: fmtV(v21, c.unit), l: `${c.unit} in 2021${s.an[i]?.[k21] != null ? `, ${pctS(s.an[i]![k21]!)} against its trend` : ''}` }] : []),
          ...(fcr ? [{ v: `${fmtV(fcr[0], c.unit)}–${fmtV(fcr[2], c.unit)}`, l: `${c.unit}, ${fYear} model range (10th–90th percentile)` }] : []),
        ],
        detail: (el) => {
          if (!bars.length) return;
          el.insertAdjacentHTML('beforeend', `<h3>${esc(c.name)}, ${c.unit}</h3>${fcr ? FC_BADGE : ''}`);
          const b = el.appendChild(mk('div', 'ev-chart'));
          const tip = (p: { x: number; y: number }) => { const k = years.indexOf(p.x); const t = xs ? trendAt(xs, k) : null; return `<b>${p.x}</b> · ${fmtV(p.y, c.unit)} ${c.unit}${t != null ? `<br><span class="tk">trend</span> ${fmtV(t, c.unit)} · ${pctS(p.y / t - 1)}` : ''}`; };
          requestAnimationFrame(() => (fcr
            ? bandChart(b, { bars, bands: [{ label: 'AAFC forecast', color: FC_COLOR, pts: [{ x: fYear!, lo: fcr[0], med: fcr[1], hi: fcr[2] }, { x: fYear! + 1, lo: fcr[0], med: fcr[1], hi: fcr[2] }] }], from: fYear!, xDomain: [y0, fYear!], height: 130, barTip: tip, bandTip: (_x, rows) => `<b>${fYear} · model forecast</b><br>${rows.map((r) => `${fmtV(r.lo, c.unit)}–${fmtV(r.hi, c.unit)} ${c.unit}`).join('')}` })
            : barChart(b, { data: bars, xDomain: [y0, y1], color, height: 130, tooltip: tip })));
        },
        sources: [SRC],
      };
    },
    tooltip(info) {
      const o: any = info.object;
      const id = info.layer?.id ?? '';
      if (!Y || !o || !id.startsWith('yields')) return null;
      const i: number = o.i;
      const d = cds[i];
      if (!d) return null;
      if (!hasData(i)) return `<b>${esc(d.name)}</b><br><span class="tk">The north: no yields published; Statistics Canada counts its few farms with Division 16</span>`;
      const c = cropOf(), s = stats(), xs = series(i);
      const row = (k: string, v: string) => `<br><span class="tk">${k}</span> <span class="tv">${v}</span>`;
      if (isFc(shownYear)) {
        const r = F!.crops[crop]?.v[i];
        return `<b>${esc(d.name)}</b><br><span class="tk">${esc(c.name)} ${fYear}: model forecast, not a record</span>${r ? row('10th–90th percentile', `${fmtV(r[0], c.unit)}–${fmtV(r[2], c.unit)} ${c.unit}`) + row('Median', `${fmtV(r[1], c.unit)} ${c.unit}`) : row('Forecast', 'none for this division')}${row('Run', `mid-${monthName(F!.crops[crop]?.month ?? 0)} ${fYear}, AAFC`)}`;
      }
      const k = years.indexOf(shownYear);
      const v = k >= 0 ? xs?.[k] ?? null : null;
      const t = k >= 0 && xs ? trendAt(xs, k) : null;
      return `<b>${esc(d.name)}</b>${row(`${esc(c.name)} ${shownYear}`, v != null ? `${fmtV(v, c.unit)} ${c.unit}` : 'not published')}${t != null && v != null ? row('Its own trend', `${fmtV(t, c.unit)} · ${pctS(v / t - 1)}`) : ''}<br><span class="tk">Click for every year</span>`;
    },
  };
  return l;
}

// ---- the Town Report section (src/panels.ts places it)

/** Crop yields: the place's census division, its latest yield and ten-year average for the main crops, and the
 *  forecast range, badged as a model. */
export function yieldsRows(data: Data, key: string) {
  const p = placeYields(data, key);
  if (!p) return '';
  const last = (r: PlaceYields['rows'][0]) => (r.v == null ? '—' : `${fmtV(r.v, r.unit)}${r.y !== p.year ? ` <span class="tk">(${r.y})</span>` : ''}`);
  return `<h3>The harvest around it · ${esc(p.cd)}</h3>
    <table class="yl-table"><tr><th>Crop</th><th>${p.year}</th><th>10-year average</th></tr>
      ${p.rows.map((r) => `<tr><td>${esc(r.name)} <span class="tk">${r.unit}</span></td><td>${last(r)}</td><td>${r.avg != null ? `${fmtV(r.avg, r.unit)}${r.n < 10 ? ` <span class="tk">(${r.n} yrs)</span>` : ''}` : '—'}</td></tr>`).join('')}
    </table>
    ${p.fc ? `<div class="proj-row"><div class="pr-k">${FC_BADGE}</div><div class="pr-v">${p.fc.year}: ${p.fc.rows.map((r) => `${esc(r.name.toLowerCase())} <b>${fmtV(r.lo, r.unit)}–${fmtV(r.hi, r.unit)}</b> ${r.unit}`).join(' · ')}</div><div class="pr-s">AAFC’s Canadian Crop Yield Forecaster for the division, run in mid-${monthName(p.fc.month)} ${p.fc.year}: its 10th to 90th percentile, not a reported yield.</div></div>` : ''}
    <p class="note" style="margin-top:6px">Reported yields for the whole census division (Statistics Canada, via AAFC), not this town’s fields; a blank is a crop the division grows too little of to publish.</p>
    <div class="tr-falls" style="margin-top:8px">${link('yields', '🚜 Crop yields on the map')}</div>`;
}

