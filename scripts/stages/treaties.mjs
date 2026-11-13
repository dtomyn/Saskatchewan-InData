import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { arcgisAll } from '../lib/apis.mjs';
import { BBOX } from '../lib/config.mjs';
import { polys, ringArea } from '../lib/geo.mjs';
import { log, round, writeOut } from '../lib/io.mjs';
import { getProvince, inSask } from '../lib/places.mjs';

// Indigenous Services Canada historic treaty areas, and the Canada Lands Survey System's reserve boundaries.
export default async function treaties() {
  await getProvince();
  const T = 'https://geo.sac-isc.gc.ca/geomatics/rest/services/Donnees_Ouvertes-Open_Data/Historic_Treaty_E/MapServer/0';
  const fs1 = await arcgisAll(T, { where: "ENAME LIKE 'Treaty%'", outFields: 'TAG_ID,ENAME,SUBTYPE_ENAME', maxAllowableOffset: '0.01', geometry: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' }, 'treaties');
  const treaties = fs1.filter((f) => f.geometry).map((f) => {
    const nm = f.properties.ENAME;
    const yrs = (nm.match(/\((\d{4})(?:-(\d{4}))?\)/) ?? []);
    return { name: nm.replace(/\s*\(.*\)$/, ''), label: nm, year: +yrs[1], end: yrs[2] ? +yrs[2] : null, polys: polys(f.geometry, 0.02, 3) };
  })
    // keep treaties with a real share of the province, not ones that only meet it along the border (Treaty 7)
    .filter((t) => {
      // sample a 0.1° grid over the treaty area: count points inside both the treaty and Saskatchewan, at least
      // 0.1° from the provincial border, so a treaty that only meets the border (Treaty 7) doesn't count
      const pts = t.polys.flatMap((p) => p[0]);
      const x0 = Math.max(BBOX.west, Math.min(...pts.map((p) => p[0]))), x1 = Math.min(BBOX.east, Math.max(...pts.map((p) => p[0])));
      const y0 = Math.max(BBOX.south, Math.min(...pts.map((p) => p[1]))), y1 = Math.min(BBOX.north, Math.max(...pts.map((p) => p[1])));
      let hit = 0;
      for (let x = x0; x <= x1; x += 0.1) for (let y = y0; y <= y1; y += 0.1) {
        if (inSask(x, y) && inSask(x + 0.1, y) && inSask(x - 0.1, y) && t.polys.some((p) => booleanPointInPolygon([x, y], { type: 'Polygon', coordinates: p }))) hit++;
      }
      log(`  ${t.label}: ${hit} sample points inside Saskatchewan`);
      return hit >= 3;
    })
    .sort((a, b) => a.year - b.year);
  log(`  ${treaties.length} historic treaty areas in Saskatchewan: ${treaties.map((t) => t.label).join(', ')}`);

  const R = 'https://proxyinternet.nrcan-rncan.gc.ca/arcgis/rest/services/CLSS-SATC/CLSS_Administrative_Boundaries/MapServer/0';
  const fs2 = await arcgisAll(R, { where: '1=1', outFields: 'adminAreaNameEng,adminAreaId,jurisdictionEng,webReference', maxAllowableOffset: '0.0015', geometry: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' }, 'reserves', 500);
  const reserves = [];
  for (const f of fs2) {
    if (!f.geometry) continue;
    const ps = polys(f.geometry, 0.0015);
    if (!ps.length) continue;
    const ring = ps[0][0];
    const c = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
    if (!inSask(c[0], c[1], 0.01)) continue;
    const areaKm2 = ps.reduce((a, p) => a + Math.abs(ringArea(p[0])) * 111.32 * 111.32 * Math.cos((c[1] * Math.PI) / 180), 0);
    // the survey lists names in capitals: title-case them, keeping "I.R." and "No."
    const name = (f.properties.adminAreaNameEng ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
      .replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bI\.r\./g, 'I.R.').replace(/\bIr\b/g, 'IR');
    reserves.push({ name, c: [round(c[0], 3), round(c[1], 3)], km2: round(areaKm2, 1), polys: ps });
  }
  reserves.sort((a, b) => b.km2 - a.km2);
  log(`  ${reserves.length} reserve parcels in Saskatchewan, ${Math.round(reserves.reduce((a, r) => a + r.km2, 0))} km²`);
  await writeOut('treaties', {
    source: 'Indigenous Services Canada, Historic Treaties (ArcGIS REST); Natural Resources Canada, Canada Lands Survey System: Aboriginal Lands of Canada Legislative Boundaries',
    treaties, reserves,
  });
}
