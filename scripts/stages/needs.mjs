import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { arcgisAll } from '../lib/apis.mjs';
import { distKm, edgeKm, polys } from '../lib/geo.mjs';
import { log, round, writeOut } from '../lib/io.mjs';
import { NEEDS_KINDS, needsOSM } from '../lib/needs-osm.mjs';
import { getPlaces, getProvince, getSmallPlaces, inSask, smallAreas } from '../lib/places.mjs';
import { PLACE_KEYS, normalizeName } from '../places.mjs';

// Daily needs: grocery stores, pharmacies, schools, banks and credit unions, gas stations, libraries, post offices and
// clinics mapped in OpenStreetMap, counted for each place inside its municipal limits (its 2021 census subdivision,
// Statistics Canada's cartographic boundary) or up to NEEDS_SLACK_KM outside them. A place with no matching census
// subdivision falls back to a radius around its centre.
export default async function needs() {
  await getProvince();
  const places = await getPlaces();
  const SLACK_KM = 1, FALLBACK_KM = 3;
  const KINDS = NEEDS_KINDS;

  // municipal limits: Saskatchewan's city, town, village and northern municipality census subdivisions
  const CSD = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/9';
  const csds = await arcgisAll(CSD, { where: "PRUID='47' AND CSDTYPE IN ('CY','T','VL','NV','NT','NH')", outFields: 'CSDUID,CSDNAME,CSDTYPE', maxAllowableOffset: '0.0002' }, 'csd-47-municipal', 500);
  const TYPE = { CY: 'City', T: 'Town', VL: 'Village', NV: 'Northern village', NT: 'Northern town', NH: 'Northern hamlet' };
  const area = {};
  for (const f of csds) {
    const key = normalizeName(String(f.properties.CSDNAME).replace(/\((part|partie)\)/i, ''));
    if (PLACE_KEYS.has(key) && !area[key] && f.geometry) area[key] = { name: `${String(f.properties.CSDNAME).replace(/ \((part|partie)\)$/i, ' (Saskatchewan part)')}, ${TYPE[f.properties.CSDTYPE] ?? f.properties.CSDTYPE}`, geom: f.geometry };
  }
  const bboxOf = (geom) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    const ps = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    for (const p of ps) for (const [x, y] of p[0]) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
    return [b[0] - 0.03, b[1] - 0.02, b[2] + 0.03, b[3] + 0.02];
  };

  const osm = await needsOSM();
  const all = [];
  for (const e of osm.elements) {
    const t = e.tags ?? {};
    const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
    if (lon == null || !inSask(lon, lat, 0.05)) continue;
    const k = KINDS.findIndex((x) => x.test(t));
    if (k < 0) continue;
    const name = (t.name ?? t.brand ?? '').trim();
    // the same place mapped twice (a point inside its building outline): same kind, close, same name or one unnamed
    const dup = all.find((s) => s.k === k && distKm(s.lon, s.lat, lon, lat) < 0.15 && (!s.name || !name || normalizeName(s.name) === normalizeName(name)));
    if (dup) { if (!dup.name && name) dup.name = name; continue; }
    all.push({ lon, lat, k, name, osm: `${e.type[0]}${e.id}` });
  }

  const towns = {}, areas = {}, used = new Set(), small = {};
  const sAreas = await smallAreas();
  const smallP = await getSmallPlaces();
  for (const p of [...places, ...smallP]) {
    const tier2 = p.tier === 2;
    const a = tier2 ? (sAreas[p.key] ? { name: p.name, geom: { type: 'MultiPolygon', coordinates: sAreas[p.key] } } : null) : area[p.key];
    const n = KINDS.map(() => 0);
    const take = (s, i) => { n[s.k]++; used.add(i); };
    if (a) {
      const f = { type: 'Feature', properties: {}, geometry: a.geom };
      const [w, s0, e0, n0] = bboxOf(a.geom);
      all.forEach((s, i) => {
        if (s.lon < w || s.lon > e0 || s.lat < s0 || s.lat > n0) return;
        if (booleanPointInPolygon([s.lon, s.lat], f) || edgeKm(s.lon, s.lat, a.geom) <= SLACK_KM) take(s, i);
      });
      if (tier2) small[p.key] = { n, how: 'csd' };
      else { towns[p.key] = { n, how: 'csd', csd: a.name }; areas[p.key] = polys(a.geom, 0.0004, 4); }
    } else {
      all.forEach((s, i) => { if (distKm(p.lon, p.lat, s.lon, s.lat) <= FALLBACK_KM) take(s, i); });
      (tier2 ? small : towns)[p.key] = { n, how: 'radius', r: FALLBACK_KM };
    }
  }
  // keep only the sites that count for some place: [lon, lat, kind, name, osm id]
  const sites = [];
  all.forEach((s, i) => { if (used.has(i)) sites.push([round(s.lon, 5), round(s.lat, 5), s.k, s.name || null, s.osm]); });
  const radius = places.filter((p) => towns[p.key].how === 'radius').map((p) => p.name);
  log(`  ${all.length} sites in Saskatchewan, ${sites.length} inside the atlas's places; ${places.length - radius.length} places by municipal limits${radius.length ? `, by ${FALLBACK_KM} km radius: ${radius.join(', ')}` : ''}`);
  const met = Object.values(towns).map((t) => t.n.filter((x) => x > 0).length);
  log(`  needs met: ${met.filter((x) => x === KINDS.length).length} places have all ${KINDS.length}, fewest ${Math.min(...met)}`);
  await writeOut('needs', {
    source: 'OpenStreetMap contributors (shop=supermarket, grocery; amenity=pharmacy, school, bank, fuel, library, post_office, clinic, doctors; healthcare=pharmacy, clinic, doctor; ODbL), via Overpass',
    areaSource: 'Statistics Canada, 2021 Census Cartographic Boundary Files, census subdivisions (municipal limits)',
    asOf: new Date().toISOString().slice(0, 10),
    kinds: KINDS.map((k) => k.id), slackKm: SLACK_KM, fallbackKm: FALLBACK_KM,
    // `small`: the tier-2 communities, counted inside their own census subdivision (outline in subdivisions.json)
    sites, towns, areas, small,
  });
}
