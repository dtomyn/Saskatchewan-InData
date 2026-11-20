import { distKm } from '../lib/geo.mjs';
import { log, readOut, writeOut } from '../lib/io.mjs';
import { getPlaces } from '../lib/places.mjs';

// Climate twins (plans/wow/5-climate-twin.md): for each place, window and scenario, the Saskatchewan weather station
// whose climate normals today are nearest the place's projected climate. Nothing is downloaded: it reads
// projections.json (CanDCS-U6 changes from 1971–2000) and normals.json (station normals), both built before it.
//
// Like with like. A projection is a change against the models' own baseline, never an absolute value, so a place's
// future is its *observed* normals plus the projected change since the normals' period. The published change is from
// 1971–2000; the part of it the models had already made by the normals' period is estimated by interpolating between
// 1971–2000 (zero, by definition) and the 2021–2050 median, and taken off (BASE below; say so in the app).
//
// A place's observed normals are its nearest station's (borrowed, named with its distance). The match is on annual
// mean temperature and total precipitation, each scaled by its spread (standard deviation) across the stations. A match
// farther than MAX_D is no twin (0.6 is about 1 °C, or 35 mm, off): "warmer than anywhere in Saskatchewan today" when the target is above every station.
const MAX_D = 0.6;
/** A place borrows normals from at most this far. */
const REACH_KM = 120;
/** A station stands for a place (and takes its name) when it is that place's own station and this close. */
const OWN_KM = 30;

export default async function twins() {
  const places = await getPlaces();
  const N = await readOut('normals'), P = await readOut('projections');
  const [n0, n1] = N.period.match(/\d{4}/g).map(Number);
  if (!n0 || !n1) throw new Error(`twins: cannot read the normals period "${N.period}"`);
  const stations = N.stations.filter((s) => s.tMean != null && s.precip != null).map((s) => ({ id: s.id, name: s.name, lon: s.lon, lat: s.lat, t: s.tMean, p: s.precip, yrs: s.yrs }));
  if (stations.length < 30) throw new Error(`twins: only ${stations.length} stations with temperature and precipitation normals`);
  const sd = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
  const sdT = sd(stations.map((s) => s.t)), sdP = sd(stations.map((s) => s.p));
  const maxT = Math.max(...stations.map((s) => s.t));

  // each place's own station, and each station's nearest place
  const own = {};
  for (const pl of places) {
    let bi = -1, bd = Infinity;
    stations.forEach((s, i) => { const d = distKm(pl.lon, pl.lat, s.lon, s.lat); if (d < bd) { bd = d; bi = i; } });
    if (bd <= REACH_KM) own[pl.key] = { s: bi, km: Math.round(bd) };
  }
  stations.forEach((s, i) => {
    let best = null, bd = Infinity;
    for (const pl of places) { const d = distKm(pl.lon, pl.lat, s.lon, s.lat); if (d < bd) { bd = d; best = pl; } }
    s.near = best.key; s.km = Math.round(bd);
    if (own[best.key]?.s === i && bd <= OWN_KM) s.k = best.key;
  });

  // the share of the change to the first window that the models had made by the normals' period
  const W = P.windowYears, c0 = 1971 + W / 2, c1 = P.windows[0] + W / 2, cn = n0 + (n1 - n0 + 1) / 2;
  const f = Math.min(1, Math.max(0, (cn - c0) / (c1 - c0)));
  const scens = Object.keys(P.scenarios);
  // `ok` narrows the stations: the 10th percentile's twin is looked for among those no warmer than the median's twin,
  // the 90th's among those no cooler, so a range never reads backwards
  const match = (t, p, ok = () => true) => {
    let bi = -1, bd = Infinity;
    stations.forEach((s, i) => { if (!ok(s)) return; const d = Math.hypot((s.t - t) / sdT, (s.p - p) / sdP); if (d < bd) { bd = d; bi = i; } });
    const i = bd <= MAX_D ? bi : t > maxT ? -1 : -2;
    return [i, Math.round(t * 10) / 10, Math.round(p), Math.round(bd * 100) / 100];
  };
  const towns = {};
  let n = 0, warmer = 0, none = 0, self = 0, order = 0;
  for (const pl of places) {
    const o = own[pl.key], pr = P.towns[pl.key];
    if (!o || !pr) continue;
    const st = stations[o.s];
    const base = (v) => f * scens.reduce((a, sc) => a + pr[v][sc][0][1], 0) / scens.length;
    const bT = base('tg'), bP = base('pr');
    const tw = {};
    for (const sc of scens)
      // per window: the twins for the models' median, 10th and 90th percentile (each variable's own percentile)
      tw[sc] = P.windows.map((_, wi) => {
        const at = (q, ok) => match(st.t + pr.tg[sc][wi][q] - bT, st.p + pr.pr[sc][wi][q] - bP, ok);
        const med = at(1), mt = med[0] >= 0 ? stations[med[0]].t : null;
        const lo = at(2, mt == null ? undefined : (s) => s.t <= mt), hi = at(3, mt == null ? undefined : (s) => s.t >= mt);
        if (med[0] === -1) hi[0] = -1; // past the warmest station at the median: the 90th percentile is too
        return [med, lo, hi];
      });
    for (const sc of scens) for (const [med, lo, hi] of tw[sc]) {
      n++;
      if (med[0] === -1) warmer++; else if (med[0] === -2) none++; else if (med[0] === o.s) self++;
      const T = (e) => (e[0] >= 0 ? stations[e[0]].t : null);
      if (T(med) != null && ((T(lo) != null && T(med) < T(lo)) || (T(hi) != null && T(med) > T(hi)))) order++;
    }
    towns[pl.key] = { s: o.s, km: o.km, base: [Math.round(bT * 100) / 100, Math.round(bP)], tw };
  }
  const missing = places.filter((pl) => !towns[pl.key]).map((pl) => pl.name);
  log(`  ${stations.length} stations (spread ${sdT.toFixed(2)} °C, ${sdP.toFixed(0)} mm; warmest ${maxT} °C), ${Object.keys(towns).length} places${missing.length ? ` (no station within ${REACH_KM} km: ${missing.join(', ')})` : ''}`);
  log(`  ${n} median twins: ${warmer} warmer than anywhere, ${none} with no close match, ${self} the place's own station; ${order} outside their 10th–90th percentile twins in temperature`);
  await writeOut('twins', {
    source: 'Worked out by the atlas from ECCC’s CanDCS-U6 projections (projections.json) and Canadian Climate Normals (normals.json)',
    asOf: P.asOf,
    normalsPeriod: N.period,
    baseline: P.baseline,
    baseShare: Math.round(f * 100) / 100,
    maxD: MAX_D,
    spread: { t: Math.round(sdT * 100) / 100, p: Math.round(sdP) },
    maxT,
    windows: P.windows,
    windowYears: W,
    scenarios: P.scenarios,
    stations,
    towns,
  });
}
