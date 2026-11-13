import { OSRM } from '../lib/config.mjs';
import { osrm } from '../lib/drive.mjs';
import { distKm } from '../lib/geo.mjs';
import { log, writeOut } from '../lib/io.mjs';
import { getPlaces } from '../lib/places.mjs';

// Workday Reach: the drive between every pair of places (OSRM table, one call: the demo server takes up to 100
// coordinates). `min[i][j]` is the drive in minutes from place i to place j, `km[i][j]` its length.
export default async function commute() {
  const places = await getPlaces();
  const keys = places.map((p) => p.key);
  const n = places.length;
  let min = null, kms = null, routed = true;
  try {
    if (n > 100) throw new Error(`${n} places is more than one table call takes`);
    const coords = places.map((p) => `${p.lon},${p.lat}`).join(';');
    let h = 0;
    for (let i = 0; i < coords.length; i++) h = (h * 31 + coords.charCodeAt(i)) | 0;
    const tb = await osrm(`commute-matrix-${n}-${(h >>> 0).toString(36)}`, `${OSRM}/table/v1/driving/${coords}?annotations=duration,distance`);
    if (tb.code !== 'Ok') throw new Error(tb.message ?? tb.code);
    min = tb.durations.map((row) => row.map((v) => (v == null ? null : Math.round(v / 60))));
    kms = tb.distances.map((row) => row.map((v) => (v == null ? null : Math.round(v / 1000))));
  } catch (e) {
    log(`  OSRM unavailable (${e.message}); rough straight-line drive times instead`);
    routed = false;
  }
  if (!routed) {
    // a rough drive: 80 km/h along a road 1.3 times the straight line
    kms = places.map((a) => places.map((b) => Math.round(distKm(a.lon, a.lat, b.lon, b.lat) * 1.3)));
    min = kms.map((row) => row.map((v) => Math.round((v / 80) * 60)));
  }
  const near = keys.map((_, i) => min[i].filter((v, j) => j !== i && v != null && v <= 45).length).sort((a, b) => a - b);
  log(`  ${n}×${n} drive times; the median place has ${near[n >> 1]} other places within 45 min`);
  await writeOut('commute', {
    source: routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving; © OpenStreetMap contributors (ODbL)' : 'Straight-line distance × 1.3 at 80 km/h (no routing service was reachable)',
    routed,
    asOf: new Date().toISOString().slice(0, 10),
    keys, min, km: kms,
  });
}
