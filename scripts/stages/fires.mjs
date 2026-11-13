import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { strFromU8, unzipSync } from 'fflate';
import { edgeKm, ringArea, vwRing } from '../lib/geo.mjs';
import { cached, cachedJSON, fetchBuf, log, round, writeOut } from '../lib/io.mjs';
import { fracYear, ymdFrac } from '../lib/parse.mjs';
import { getProvince, inSask } from '../lib/places.mjs';

// Canadian National Fire Database (CWFIS, Natural Resources Canada): every reported fire's start point.
export default async function fires() {
  await getProvince();
  const zip = await cached('raw/nfdb-points.zip', () => fetchBuf('https://cwfis.cfs.nrcan.gc.ca/downloads/nfdb/fire_pnt/current_version/NFDB_point_txt.zip', { timeout: 600_000 }));
  const files = unzipSync(new Uint8Array(zip), { filter: (f) => /\.txt$/i.test(f.name) });
  const name = Object.keys(files)[0];
  const lines = strFromU8(files[name]).replace(/^﻿/, '').split(/\r?\n/);
  const h = lines[0].split(',');
  const I = (k) => h.indexOf(k);
  const iLat = I('LATITUDE'), iLon = I('LONGITUDE'), iY = I('YEAR'), iM = I('MONTH'), iD = I('DAY'), iHa = I('SIZE_HA'), iC = I('CAUSE'), iAg = I('SRC_AGENCY'), iT = I('FIRE_TYPE'), iName = I('FIRENAME');
  // CNFDB causes: N natural (lightning), H human, H-PB prescribed burn, U unknown, RE reburn
  const cause = (c) => (c === 'N' || c === 'L' ? 0 : /^H/.test(c) ? 1 : 2);
  const points = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const c = line.split(',');
    if (c[iAg] !== 'SK' && c[iAg] !== 'PC') continue;
    const lon = +c[iLon], lat = +c[iLat], y = +c[iY];
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !(y >= 1900) || !inSask(lon, lat, 0.01)) { skipped++; continue; }
    if ((c[iT] && /prescribed/i.test(c[iT])) || c[iC] === 'H-PB' || c[iC] === 'RE') continue;
    const ha = Math.max(0, +c[iHa] || 0);
    // compact row: lon, lat, time (fractional year), hectares, cause (0 lightning, 1 human, 2 unknown)
    points.push([round(lon, 3), round(lat, 3), round(ymdFrac(y, +c[iM], +c[iD]), 3), round(ha, 1), cause(c[iC])]);
    const nm = c[iName]?.trim();
    if (ha >= 20000 && nm) points.at(-1).push(nm);
  }
  points.sort((a, b) => a[2] - b[2]);
  log(`  ${points.length} Saskatchewan fires (${skipped} rows off the map or undated), ${points[0]?.[2] | 0}–${points.at(-1)?.[2] | 0}`);

  // the National Burned Area Composite: mapped burn outlines, one WFS request a year (a big year is ~20 MB), cached.
  // WFS 1.0.0 with EPSG:4326 answers lon/lat in that order (2.0.0 swaps them).
  const NBAC = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs';
  const nbacYears = async () => {
    const q = new URLSearchParams({ service: 'WFS', version: '1.0.0', request: 'GetFeature', typeName: 'public:nbac', propertyName: 'year', CQL_FILTER: "admin_area='SK'", outputFormat: 'application/json' });
    const day = new Date().toISOString().slice(0, 10);
    const j = await cachedJSON(`nbac/sk-years-${day}.json`, `${NBAC}?${q}`, { timeout: 300_000 });
    return [...new Set(j.features.map((f) => +f.properties.year).filter((y) => y >= 1900))].sort((a, b) => a - b);
  };
  const perimeters = [];
  let linked = 0;
  {
    const years = await nbacYears();
    if (years.length < 20) throw new Error(`NBAC lists only ${years.length} Saskatchewan years`);

    // points by year, for linking a perimeter to the start points inside it
    const byYear = new Map();
    points.forEach((p, i) => { const y = Math.floor(p[2]); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(i); });
    const outlined = new Set();
    // outlines only for fires of 200 ha or more (smaller ones stay circles), simplified by Visvalingam–Whyatt to
    // triangles of a sixth of the fire's width, dropping parts under 40 ha and unburned islands under 200 ha: ~1.3 MB
    const MIN_HA = 200;
    const ringHa = (ring) => Math.abs(ringArea(ring)) * 111.32 * 110.57 * Math.cos((ring[0][1] * Math.PI) / 180) * 100;
    for (const y of years) {
      const q = new URLSearchParams({ service: 'WFS', version: '1.0.0', request: 'GetFeature', typeName: 'public:nbac', propertyName: 'year,adj_ha,poly_ha,prescribed,ag_sdate,hs_sdate,geometry', srsName: 'EPSG:4326', CQL_FILTER: `admin_area='SK' AND year=${y}`, outputFormat: 'application/json' });
      const fc = await cachedJSON(`nbac/sk-${y}.json`, `${NBAC}?${q}`, { timeout: 600_000 });
      for (const f of fc.features ?? []) {
        const pr = f.properties, g = f.geometry;
        const ha = +(pr.adj_ha ?? pr.poly_ha) || 0;
        if (!g || ha < MIN_HA || /^t/i.test(String(pr.prescribed ?? ''))) continue;
        const minArea = (Math.sqrt(ha / 100) / 111 / 6) ** 2 / 2;
        const ps = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
          .map((p) => p.map((r) => vwRing(r, minArea).map(([x, y]) => [round(x, 3), round(y, 3)]).filter((c, i, a) => !i || c[0] !== a[i - 1][0] || c[1] !== a[i - 1][1])).filter((r, i) => r.length >= 4 && ringHa(r) >= (i ? 200 : 40)))
          .filter((p) => p.length && ringHa(p[0]) >= 40);
        if (!ps.length) continue;
        // the NFDB start points of the same year inside it (or within 1 km of its edge)
        let [w, so, e, n] = [180, 90, -180, -90];
        for (const p of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) for (const [x, yy] of p[0]) { w = Math.min(w, x); e = Math.max(e, x); so = Math.min(so, yy); n = Math.max(n, yy); }
        const near = (i) => points[i][0] >= w - 0.02 && points[i][0] <= e + 0.02 && points[i][1] >= so - 0.01 && points[i][1] <= n + 0.01;
        const inside = (byYear.get(y) ?? []).filter((i) => !outlined.has(i) && near(i) && (booleanPointInPolygon([points[i][0], points[i][1]], f) || edgeKm(points[i][0], points[i][1], g) <= 1));
        inside.forEach((i) => outlined.add(i));
        linked += inside.length;
        // when it appears: its first start point, else the agency's or the hotspots' start date, else mid-season
        const date = pr.ag_sdate || pr.hs_sdate;
        const t = inside.length ? Math.min(...inside.map((i) => points[i][2])) : (date ? fracYear(`${String(date).slice(0, 10)}T12:00:00Z`) : y + 0.55);
        // compact row: year, hectares (NBAC's, adjusted for unburned islands where it has them), polygons, time, start points inside
        perimeters.push([y, round(ha, 0), ps, round(t, 3), inside]);
      }
    }
    perimeters.sort((a, b) => a[3] - b[3]);
    log(`  ${perimeters.length} NBAC perimeters ${years[0]}–${years.at(-1)}; ${linked} of the start points lie inside one`);
  }
  await writeOut('fires', {
    source: 'Natural Resources Canada, Canadian Wildland Fire Information System: Canadian National Fire Database, fire points (NFDB_point)',
    perimeterSource: 'Natural Resources Canada, Canadian Forest Service: National Burned Area Composite (NBAC), CWFIS GeoServer layer public:nbac',
    perimeterUrl: 'https://cwfis.cfs.nrcan.gc.ca/ha/nbac',
    licence: 'Open Government Licence – Canada', licenceUrl: 'https://open.canada.ca/en/open-government-licence-canada',
    perimeterYears: perimeters.length ? [perimeters.reduce((a, p) => Math.min(a, p[0]), 9999), perimeters.reduce((a, p) => Math.max(a, p[0]), 0)] : null,
    perimeters, points,
  });
}
