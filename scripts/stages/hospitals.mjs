import { driveTimes } from '../lib/drive.mjs';
import { distKm } from '../lib/geo.mjs';
import { log, round, writeOut } from '../lib/io.mjs';
import { odhfIsHospital, odhfRows, odhfTitle } from '../lib/needs-osm.mjs';
import { getPlaces, getProvince, getSmallPlaces, inSask, straightTimes } from '../lib/places.mjs';
import { normalizeName } from '../places.mjs';

// Statistics Canada Open Database of Healthcare Facilities: Saskatchewan hospitals; drive times from each place.
export default async function hospitals() {
  await getProvince();
  const places = await getPlaces();
  const rows = (await odhfRows()).filter((r) => r.odhf_facility_type === 'Hospitals' && r.latitude && r.longitude);
  const title = odhfTitle;
  // the source's own type is kept so the app can show it
  const isHospital = odhfIsHospital;
  // A few ODHF points are far from the town the row names (Wakaw Hospital sat by Langham): a row whose town is one of
  // the atlas's places or small communities, but whose point is over OFF_KM from it, moves to that town's centre
  // (`approx: 1`, as doctors.json marks a site put at its town's centre).
  const OFF_KM = 15;
  const byKey = new Map([...(await getSmallPlaces()), ...places].map((p) => [p.key, p]));
  const facilities = [];
  let moved = 0;
  for (const r of rows) {
    const f = { name: title(r.facility_name), city: title(r.city), lon: round(+r.longitude), lat: round(+r.latitude), hospital: isHospital(r), ed: null, hours: null, type: r.source_facility_type || null };
    const town = byKey.get(normalizeName(r.city ?? ''));
    if (town && distKm(town.lon, town.lat, f.lon, f.lat) > OFF_KM) { Object.assign(f, { lon: town.lon, lat: town.lat, approx: 1 }); moved++; }
    if (!inSask(f.lon, f.lat, 0.02)) continue;
    // the source lists some sites twice (a hospital and its integrated care centre): keep one, a hospital if either is
    const dup = facilities.find((g) => distKm(g.lon, g.lat, f.lon, f.lat) < 0.3);
    if (dup) { if (f.hospital && !dup.hospital) Object.assign(dup, f); continue; }
    facilities.push(f);
  }
  facilities.sort((a, b) => b.lat - a.lat);
  const hosp = facilities.map((f, i) => ({ ...f, i })).filter((f) => f.hospital);
  log(`  ${facilities.length} facilities, ${hosp.length} counted as hospitals; ${moved} moved to their town's centre (point over ${OFF_KM} km from it)`);
  const d = await driveTimes(places, hosp, 'hosp', { keep: 3 });
  const towns = Object.fromEntries(Object.entries(d.towns).map(([k, v]) => [k, v.map((t) => ({ ...t, f: hosp[t.f].i }))]));
  // tier 2: the three nearest hospitals by straight line (min null)
  const small = Object.fromEntries(Object.entries(straightTimes(await getSmallPlaces(), hosp, { keep: 3 })).map(([k, v]) => [k, v.map((t) => ({ ...t, f: hosp[t.f].i }))]));
  await writeOut('hospitals', {
    source: 'Statistics Canada, Open Database of Healthcare Facilities (ODHF v1), Saskatchewan rows',
    routing: d.routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line',
    routingSource: d.routed ? 'Drive times: OSRM demo server, © OpenStreetMap contributors (ODbL)' : null,
    facilities, towns, small,
  });
}
