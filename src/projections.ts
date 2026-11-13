// Climate projections (plans/digital-twin/3-forecasts-and-what-ifs.md, 3b): Environment and Climate Change Canada's
// CMIP6 downscaled projections (CanDCS-U6) per place, from the `projections` stage. Model output, never a record:
// everything drawn from here is hatched, dashed or wire-framed, carries a "projection, not a record" badge, and shows a
// range (two scenarios, each with the models' 10th–90th percentile spread), never a single number. Projections never
// feed the Town Finder: a projection should not rank towns.
import type { Data, ProjScen, ProjVar, ProjWindow, Projections } from './data';
import { esc } from './html';

export const PROJ_BADGE = '<span class="proj-badge">Projection, not a record</span>';
export const SCEN_SHORT: Record<ProjScen, string> = { ssp126: 'low emissions', ssp585: 'high emissions' };
export const SCEN_COLOR: Record<ProjScen, string> = { ssp126: '#f4b183', ssp585: '#e0312b' };
const centre = (start: number, years: number) => start + years / 2;
export const windowText = (start: number, years = 30) => `${start}–${start + years - 1}`;

export type Range = { med: number; lo: number; hi: number };

/**
 * A place's windows, led by 1971–2000 itself: every model's change from its own 1971–2000 average is zero there, so
 * the band starts from nothing, by definition rather than by estimate.
 */
const rowsOf = (P: Projections, key: string, v: ProjVar, sc: ProjScen): ProjWindow[] | null => {
  const rows = P.towns[key]?.[v]?.[sc];
  return rows?.length ? [[1971, 0, 0, 0], ...rows] : null;
};

/**
 * A place's change in a variable at time `t` under a scenario, between window centres (held after the last one).
 * `shift` is added to every value: the climate layer passes the record's own 1971–2000 anomaly, to put the change on
 * its 1961–1990 baseline.
 */
export function projAt(P: Projections, key: string, v: ProjVar, sc: ProjScen, t: number, shift = 0): Range | null {
  const rows = rowsOf(P, key, v, sc);
  if (!rows) return null;
  const c = (r: ProjWindow) => centre(r[0], P.windowYears);
  const at = (r: ProjWindow): Range => ({ med: r[1] + shift, lo: r[2] + shift, hi: r[3] + shift });
  if (t <= c(rows[0])) return at(rows[0]);
  if (t >= c(rows[rows.length - 1])) return at(rows[rows.length - 1]);
  const i = rows.findIndex((r) => c(r) > t);
  const a = at(rows[i - 1]), b = at(rows[i]), f = (t - c(rows[i - 1])) / (c(rows[i]) - c(rows[i - 1]));
  return { med: a.med + (b.med - a.med) * f, lo: a.lo + (b.lo - a.lo) * f, hi: a.hi + (b.hi - a.hi) * f };
}

/** One window's change for a place, as published (not interpolated). */
export function projWindow(P: Projections, key: string, v: ProjVar, sc: ProjScen, start: number): Range | null {
  const r = P.towns[key]?.[v]?.[sc]?.find((w) => w[0] === start);
  return r ? { med: r[1], lo: r[2], hi: r[3] } : null;
}

/**
 * The province band at window centres (1971–2000 first): each window's change averaged over the atlas's places, plus
 * `shift`. Averaging each place's 10th and 90th percentiles makes the band a little wider than the spread of the
 * average would be.
 */
export function provinceBand(P: Projections, sc: ProjScen, v: ProjVar = 'tg', shift = 0) {
  const keys = Object.keys(P.towns);
  return [1971, ...P.windows].map((w) => {
    const x = centre(w, P.windowYears);
    const rs = keys.map((k) => projAt(P, k, v, sc, x, shift)).filter((r): r is Range => !!r);
    const mean = (f: (r: Range) => number) => rs.reduce((a, r) => a + f(r), 0) / (rs.length || 1);
    return { x, start: w, med: mean((r) => r.med), lo: mean((r) => r.lo), hi: mean((r) => r.hi) };
  });
}

/** The median place's median change: a province summary for the panel's table. */
export function provinceMedian(P: Projections, v: ProjVar, sc: ProjScen, start: number) {
  const xs = Object.keys(P.towns).map((k) => projWindow(P, k, v, sc, start)?.med).filter((x): x is number => x != null).sort((a, b) => a - b);
  return xs.length ? xs[Math.floor(xs.length / 2)] : null;
}

const sgn = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
/** "+2.1 to +4.0": from the smaller to the larger. */
export const rangeText = (lo: number, hi: number, d = 1) => `${sgn(Math.min(lo, hi), d)} to ${sgn(Math.max(lo, hi), d)}`;

/** The Town Report's one row: "By the 2050s: +x to +y °C", with the daily highs and lows beneath it. */
export function townProjectionRow(data: Data, key: string) {
  const P = data.projections;
  if (!P?.towns[key]) return '';
  const w = 2041;
  const get = (v: ProjVar, sc: ProjScen) => projWindow(P, key, v, sc, w);
  const lo = get('tg', 'ssp126'), hi = get('tg', 'ssp585');
  if (!lo || !hi) return '';
  const pair = (v: ProjVar) => { const a = get(v, 'ssp126'), b = get(v, 'ssp585'); return a && b ? rangeText(a.med, b.med) : '–'; };
  return `<div class="proj-row">
    <div class="pr-k">${PROJ_BADGE}</div>
    <div class="pr-v">By the 2050s: <b>${rangeText(lo.med, hi.med)} °C</b></div>
    <div class="pr-s">Mean temperature, ${windowText(w)} against ${esc(P.baseline)}: the middle of the models under low and high emissions (${P.percentiles[0]}th–${P.percentiles[1]}th percentile of all models: ${rangeText(lo.lo, hi.hi)} °C). Daily highs ${pair('tx')} °C, lows ${pair('tn')} °C. ECCC, CMIP6 (CanDCS-U6).</div>
  </div>`;
}
