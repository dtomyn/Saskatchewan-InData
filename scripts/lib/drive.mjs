// Drive times (OSRM demo server): one `table` call ranks candidates, then one `route` per kept trip.

import { OSRM } from './config.mjs';
import { distKm } from './geo.mjs';
import { asJSON, cached, fetchBuf, log, round, sleep } from './io.mjs';

export async function osrm(name, url) {
  return asJSON(await cached(`osrm/${name}.json`, async () => {
    await sleep(1100); // the public demo server asks for at most one request a second
    return fetchBuf(url, { timeout: 60_000 });
  }), name);
}

/**
 * For every place, the fastest few `targets` by road: [{ f: target index, min, km, line }]. Candidates are the
 * `pre` nearest in a straight line; only the best `keep` get a routed line. Falls back to straight lines.
 */
export async function driveTimes(places, targets, tag, { pre = 6, keep = 3 } = {}) {
  const out = {};
  let routed = true;
  for (const p of places) {
    const near = targets.map((t, j) => ({ j, d: distKm(p.lon, p.lat, t.lon, t.lat) })).sort((a, b) => a.d - b.d).slice(0, pre);
    let cand = near.map((c) => ({ f: c.j, min: null, km: round(c.d, 1) }));
    if (routed) {
      try {
        const coords = [p, ...near.map((c) => targets[c.j])].map((x) => `${x.lon},${x.lat}`).join(';');
        const tb = await osrm(`${tag}-table-${p.key.replace(/ /g, '_')}-${near.map((c) => c.j).join('_')}`, `${OSRM}/table/v1/driving/${coords}?sources=0&annotations=duration,distance`);
        if (tb.code !== 'Ok') throw new Error(tb.message ?? tb.code);
        cand = near.map((c, i) => ({ f: c.j, min: tb.durations[0][i + 1] == null ? null : tb.durations[0][i + 1] / 60, km: tb.distances[0][i + 1] == null ? null : tb.distances[0][i + 1] / 1000 }))
          .filter((c) => c.min != null)
          .sort((a, b) => a.min - b.min);
        if (!cand.length) cand = near.map((c) => ({ f: c.j, min: null, km: round(c.d, 1) }));
      } catch (e) {
        log(`  OSRM unavailable (${e.message}); straight-line distances from here on`);
        routed = false;
      }
    }
    const trips = [];
    for (const c of cand.slice(0, keep)) {
      const t = targets[c.f];
      const trip = { f: c.f, min: c.min == null ? null : Math.round(c.min), km: round(c.km, 1) };
      if (routed && c.min != null) {
        try {
          const r = await osrm(`${tag}-route-${p.key.replace(/ /g, '_')}-${t.lon},${t.lat}`, `${OSRM}/route/v1/driving/${p.lon},${p.lat};${t.lon},${t.lat}?overview=simplified&geometries=geojson`);
          const rt = r.routes?.[0];
          if (rt) {
            trip.min = Math.round(rt.duration / 60);
            trip.km = round(rt.distance / 1000, 1);
            const line = [];
            for (const [x, y] of rt.geometry.coordinates) {
              const q = [round(x, 3), round(y, 3)];
              if (!line.length || q[0] !== line.at(-1)[0] || q[1] !== line.at(-1)[1]) line.push(q);
            }
            trip.line = line;
          }
        } catch (e) { log(`  route ${p.name} -> ${t.name ?? tag} failed: ${e.message}`); }
      }
      trips.push(trip);
    }
    out[p.key] = trips;
  }
  return { towns: out, routed };
}
