import { arcgisAll } from '../lib/apis.mjs';
import { censusAllCSDs, censusProfileAll } from '../lib/census.mjs';
import { polys, ringArea } from '../lib/geo.mjs';
import { log, round, writeOut } from '../lib/io.mjs';
import { getPlaces, getProvince, getSmallPlaces } from '../lib/places.mjs';
import { normalizeName } from '../places.mjs';

// Every census subdivision in Saskatchewan (cities, towns, villages, resort villages, rural municipalities, reserves,
// northern municipalities, the unorganized north): Statistics Canada's 2021 cartographic boundary file (served by its
// MapServer as GeoJSON, like the town limits in `needs`), simplified, with the 2021 population and dwelling counts.
// The census layers tint the province by these outlines and read their values from each stage's `csd` table.
export default async function subdivisions() {
  await getProvince();
  let places = [];
  try { places = await getPlaces(); } catch { log('  municipalities.json missing: run the places stage to link the atlas’s own places'); }
  const CSD = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/9';
  const feats = await arcgisAll(CSD, { where: "PRUID='47'", outFields: 'CSDUID,CSDNAME,CSDTYPE,LANDAREA', maxAllowableOffset: '0.001' }, 'csd-47-all', 250);
  const desc = Object.fromEntries((await censusAllCSDs()).map((c) => [c.uid, c]));
  const cen = await censusProfileAll('subdiv-', ['1', '2', '4']);
  const MUNI = /^(City|Town|Village|Northern village|Northern town|Northern hamlet)$/i;
  const smallBy = Object.fromEntries((await getSmallPlaces()).map((q) => [q.csd, q]));
  const types = {};
  const csds = [];
  for (const f of feats) {
    const p = f.properties, uid = String(p.CSDUID);
    if (!f.geometry) { log(`  ${p.CSDNAME}: no outline`); continue; }
    const d = desc[uid];
    const type = d?.type ?? p.CSDTYPE;
    types[p.CSDTYPE] = type;
    const ps = polys(f.geometry, 0.0015, 4);
    if (!ps.length) { log(`  ${p.CSDNAME}: outline vanished when simplified`); continue; }
    const big = ps.map((x) => x[0]).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
    const name = String(d?.name ?? p.CSDNAME).replace(/ \((part|partie)\)$/i, ' (Saskatchewan part)');
    const c = cen[uid];
    const o = { id: uid, n: name, t: p.CSDTYPE, c: [round(big.reduce((a, q) => a + q[0], 0) / big.length, 3), round(big.reduce((a, q) => a + q[1], 0) / big.length, 3)], km2: p.LANDAREA != null ? round(Number(p.LANDAREA), 1) : null };
    if (c?.v[1] != null) o.pop = c.v[1];
    if (c?.v[2] != null) o.pop16 = c.v[2];
    if (c?.v[4] != null) o.dw = c.v[4];
    if (c?.ne) o.ne = 1;
    if (MUNI.test(type)) {
      const key = normalizeName(name.replace(/\(Saskatchewan part\)/i, ''));
      if (places.some((q) => q.key === key)) o.k = key;
    }
    const sp = smallBy[uid];
    if (sp) o.s = sp.key;
    o.p = ps;
    csds.push(o);
  }
  csds.sort((a, b) => a.id.localeCompare(b.id));
  const linked = csds.filter((c) => c.k).length;
  log(`  ${csds.length} census subdivisions (${Object.entries(types).map(([k, v]) => `${v} ${csds.filter((c) => c.t === k).length}`).join(', ')}); ${linked} of ${places.length} atlas places linked, ${csds.filter((c) => c.s).length} small communities; ${csds.filter((c) => c.ne).length} not fully enumerated; ${csds.filter((c) => c.pop == null).length} with no population`);
  await writeOut('subdivisions', {
    source: 'Statistics Canada, 2021 Census Cartographic Boundary Files, census subdivisions',
    censusSource: 'Statistics Canada, Census of Population 2021, Census Profile (98-401-X2021006) by census subdivision, via the census SDMX API',
    types, csds,
  });
}
