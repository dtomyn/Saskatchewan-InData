import { arcgisAll } from '../lib/apis.mjs';
import { ringArea } from '../lib/geo.mjs';
import { cachedJSON, log, round, writeOut } from '../lib/io.mjs';
import { getProvince, inSask, setPlaces, setSmallPlaces } from '../lib/places.mjs';
import { PLACES_LIST, PLACE_KEYS, normalizeName } from '../places.mjs';

// The place list (scripts/places.mjs), located with the Canadian Geographical Names Database.
export default async function places() {
  await getProvince();
  const KINDS = ['CITY', 'TOWN', 'VILG', 'NV', 'UNP', 'HAM', 'MUN1', 'MUN2'];
  const out = [];
  for (const p of PLACES_LIST) {
    const q = p.geo ?? p.name;
    const res = await cachedJSON(`cgndb/${normalizeName(q).replace(/ /g, '_')}.json`, `https://geogratis.gc.ca/services/geoname/en/geonames.json?${new URLSearchParams({ q, province: '47' })}`);
    const want = normalizeName(q);
    const hits = (res.items ?? []).filter((i) => normalizeName(i.name) === want && KINDS.includes(i.concise?.code));
    hits.sort((a, b) => KINDS.indexOf(a.concise.code) - KINDS.indexOf(b.concise.code));
    const h = hits[0];
    if (!h) { log(`  ✖ ${p.name}: no populated place in the CGNDB`); continue; }
    const lon = round(h.longitude), lat = round(h.latitude);
    if (!inSask(lon, lat, 0.05)) { log(`  ✖ ${p.name}: located outside Saskatchewan (${lon}, ${lat})`); continue; }
    const kind = { CITY: 'City', TOWN: 'Town', VILG: 'Village', NV: 'Northern village' }[h.concise.code] ?? 'Community';
    // a coarse region from latitude: the populated south, the parkland centre, the boreal north
    const rd = lat >= 54.3 ? 'North' : lat >= 51.6 ? 'Central' : 'South';
    out.push({ key: normalizeName(p.name), name: p.name, rd, kind, lon, lat, cgndb: h.id });
  }
  log(`  ${out.length} of ${PLACES_LIST.length} places located`);
  setPlaces(out);
  // tier 2: every other city, town, village, resort village and northern municipality, from its 2021 census
  // subdivision (the same boundary service as the `subdivisions` stage); placed at the area centroid of its largest part
  const CSD = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/9';
  const feats = await arcgisAll(CSD, { where: "PRUID='47'", outFields: 'CSDUID,CSDNAME,CSDTYPE,LANDAREA', maxAllowableOffset: '0.001' }, 'csd-47-all', 250);
  const KIND = { CY: 'City', T: 'Town', VL: 'Village', RV: 'Resort village', NV: 'Northern village', NT: 'Northern town', NH: 'Northern hamlet' };
  const taken = new Set(out.map((p) => p.key));
  const centroid = (ring) => {
    let a = 0, x = 0, y = 0;
    for (let i = 1; i < ring.length; i++) { const [x0, y0] = ring[i - 1], [x1, y1] = ring[i]; const f = x0 * y1 - x1 * y0; a += f; x += (x0 + x1) * f; y += (y0 + y1) * f; }
    return a ? [x / (3 * a), y / (3 * a)] : ring[0];
  };
  const small = [];
  for (const f of feats) {
    const pr = f.properties, kind = KIND[pr.CSDTYPE];
    if (!kind || !f.geometry) continue;
    const name = String(pr.CSDNAME).replace(/ \((part|partie)\)$/i, '');
    let key = normalizeName(name);
    if (PLACE_KEYS.has(key)) continue; // one of the 62
    if (taken.has(key)) key = `${key} ${pr.CSDTYPE.toLowerCase()}`;
    if (taken.has(key)) { log(`  ✖ ${name} (${pr.CSDTYPE}): name taken twice`); continue; }
    taken.add(key);
    const ps = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const big = ps.map((q) => q[0]).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
    const [lon, lat] = centroid(big).map((v) => round(v));
    const rd = lat >= 54.3 ? 'North' : lat >= 51.6 ? 'Central' : 'South';
    const part = /\((part|partie)\)$/i.test(String(pr.CSDNAME));
    small.push({ key, name: part ? `${name} (Saskatchewan part)` : name, rd, kind, lon, lat, tier: 2, csd: String(pr.CSDUID) });
  }
  small.sort((a, b) => a.key.localeCompare(b.key));
  log(`  tier 2: ${small.length} other communities (${Object.values(KIND).map((k) => `${k} ${small.filter((p) => p.kind === k).length}`).filter((t) => !/ 0$/.test(t)).join(', ')})`);
  setSmallPlaces(small);
  await writeOut('municipalities', [...out.map((p) => ({ ...p, tier: 1 })), ...small]);
}
