import fs from 'node:fs/promises';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { unzipSync } from 'fflate';
import { arcgisAll } from '../lib/apis.mjs';
import { edgeKm, polys, ringArea } from '../lib/geo.mjs';
import { cachedFile, log, readOut, round, writeOut } from '../lib/io.mjs';
import { parseCSV } from '../lib/parse.mjs';
import { getPlaces, getProvince, getSmallPlaces, smallAreas } from '../lib/places.mjs';

// Radon: Health Canada's Cross-Canada Survey of Radon Concentrations in Homes (long-term tests in volunteer homes,
// 2009–2011), one row per home with its 2007 health region and postal FSA. Summarised as the share of tested homes at or
// above Canada's guideline (200 Bq/m³) for each health region (on StatCan's matching 2007 health region boundaries) and
// each postal area (FSA, on StatCan's 2021 FSA boundaries), and for each place: its health region and its own FSAs.
export default async function radon() {
  await getProvince();
  const places = await getPlaces();
  let needs = null;
  try { needs = await readOut('needs'); } catch { log('  needs.json missing: places fall back to the FSA at their centre'); }
  const GUIDE = 200, OLD_GUIDE = 600, FEW = 20;
  const DATASET = 'https://open.canada.ca/data/en/dataset/b3bad1b0-32d4-4656-8a64-59b43900d482';
  const CSV = 'https://open.canada.ca/data/dataset/b3bad1b0-32d4-4656-8a64-59b43900d482/resource/1bf4724b-8f38-4932-9c32-e11a45011dcf/download/radon-concentration.csv';
  const HR_ZIP = 'https://www150.statcan.gc.ca/n1/pub/82-402-x/2011001/data-donnees/boundary-limites/arcinfo/hr047b06-eng.zip';

  // --- the survey: Saskatchewan homes. "<15" (below the detection limit) counts as under every threshold.
  const rows = parseCSV(await fs.readFile(await cachedFile('radon/radon-concentration.csv', CSV), 'latin1')).filter((r) => r.ProvinceTerritory === 'SK');
  if (rows.length < 500) throw new Error(`only ${rows.length} Saskatchewan rows in the radon survey CSV`);
  const tally = () => ({ n: 0, hi: 0, vhi: 0, vals: [] });
  const add = (t, v) => { t.n++; if (v >= GUIDE) t.hi++; if (v >= OLD_GUIDE) t.vhi++; t.vals.push(v); };
  const byHR = {}, byFSA = {}, hrOfFSA = {}, prov = tally();
  for (const r of rows) {
    const raw = r.AverageRadonConcentrationInBqPerM3;
    const v = /^</.test(raw) ? 0 : Number(raw);
    if (!Number.isFinite(v)) continue;
    add(prov, v);
    add(byHR[r.HealthRegionCode2007] ??= tally(), v);
    const f = r.ForwardSortationAreaCodes;
    if (/^S\d[A-Z]$/.test(f)) { add(byFSA[f] ??= tally(), v); ((hrOfFSA[f] ??= {})[r.HealthRegionCode2007] = (hrOfFSA[f][r.HealthRegionCode2007] ?? 0) + 1); }
  }
  const median = (vals) => { const s = [...vals].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
  const summary = (t) => ({ n: t.n, hi: t.hi, vhi: t.vhi, med: median(t.vals) });

  // --- 2007 health region boundaries (StatCan 82-402-X, 2006 census geography; the same Saskatchewan RHAs as in 2007),
  // an ESRI shapefile in Statistics Canada Lambert, read and unprojected here.
  const zip = unzipSync(new Uint8Array(await fs.readFile(await cachedFile('radon/hr047b06-eng.zip', HR_ZIP))));
  const part = (ext) => { const k = Object.keys(zip).find((n) => n.toLowerCase().endsWith(ext)); if (!k) throw new Error(`no ${ext} in the health region zip`); return Buffer.from(zip[k]); };
  const dbf = part('.dbf'), shp = part('.shp');
  const nRec = dbf.readUInt32LE(4), hLen = dbf.readUInt16LE(8), rLen = dbf.readUInt16LE(10);
  const fields = [];
  for (let i = 32; dbf[i] !== 0x0d; i += 32) fields.push({ name: dbf.toString('latin1', i, i + 11).replace(/\0.*$/, ''), len: dbf[i + 16] });
  const attrs = [];
  for (let r = 0; r < nRec; r++) {
    let o = hLen + r * rLen + 1;
    const a = {};
    for (const f of fields) { a[f.name] = dbf.toString('latin1', o, o + f.len).trim(); o += f.len; }
    attrs.push(a);
  }
  // inverse Lambert conformal conic (2SP) on GRS 1980, Statistics Canada's parameters (from the .prj)
  const A = 6378137, FL = 1 / 298.257222101, E = Math.sqrt(FL * (2 - FL)), D2R = Math.PI / 180;
  const LAM0 = -91.86666666666666 * D2R, PHI0 = 63.390675 * D2R, P1 = 49 * D2R, P2 = 77 * D2R, FE = 6200000, FN = 3000000;
  const mF = (p) => Math.cos(p) / Math.sqrt(1 - (E * Math.sin(p)) ** 2);
  const tF = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2);
  const NN = (Math.log(mF(P1)) - Math.log(mF(P2))) / (Math.log(tF(P1)) - Math.log(tF(P2)));
  const FF = mF(P1) / (NN * tF(P1) ** NN), RHO0 = A * FF * tF(PHI0) ** NN;
  const unproject = (x, y) => {
    const dx = x - FE, dy = RHO0 - (y - FN);
    const rho = Math.sign(NN) * Math.hypot(dx, dy);
    const t = (rho / (A * FF)) ** (1 / NN);
    let phi = Math.PI / 2 - 2 * Math.atan(t);
    for (let i = 0; i < 8; i++) phi = Math.PI / 2 - 2 * Math.atan(t * ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2));
    return [(Math.atan2(dx, dy) / NN + LAM0) / D2R, phi / D2R];
  };
  // polygon records: rings in order; clockwise rings are outer, counter-clockwise ones holes in the outer around them
  const shapes = [];
  for (let o = 100; o + 8 <= shp.length;) {
    const len = shp.readInt32BE(o + 4) * 2, s = o + 8;
    o = s + len;
    if (shp.readInt32LE(s) !== 5) { shapes.push(null); continue; }
    const nParts = shp.readInt32LE(s + 36), nPts = shp.readInt32LE(s + 40);
    const starts = Array.from({ length: nParts }, (_, i) => shp.readInt32LE(s + 44 + i * 4));
    const p0 = s + 44 + nParts * 4;
    const rings = starts.map((st, i) => {
      const end = i + 1 < nParts ? starts[i + 1] : nPts;
      const ring = [];
      for (let k = st; k < end; k++) ring.push(unproject(shp.readDoubleLE(p0 + k * 16), shp.readDoubleLE(p0 + k * 16 + 8)));
      return ring;
    });
    const outers = rings.filter((r) => ringArea(r) < 0).map((r) => [r]);
    for (const h of rings.filter((r) => ringArea(r) >= 0)) {
      const host = outers.find((p) => booleanPointInPolygon(h[0], { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [p[0]] } }));
      if (host) host.push(h);
    }
    shapes.push({ type: 'MultiPolygon', coordinates: outers.map((p) => p.map((r) => [...r].reverse())) });
  }
  // the survey merged Mamawetan Churchill River, Keewatin Yatthé and Athabasca (4711–4713) into one region, 4714
  const surveyHR = (uid) => (['4711', '4712', '4713'].includes(uid) ? '4714' : uid);
  const NAMES = { 4714: 'Mamawetan Churchill River, Keewatin Yatthé and Athabasca' };
  const hrGeoms = {};
  attrs.forEach((a, i) => { if (shapes[i]) (hrGeoms[surveyHR(a.HRUID2007)] ??= { names: [], parts: [] }).parts.push(shapes[i]), hrGeoms[surveyHR(a.HRUID2007)].names.push(a.ENG_LABEL); });
  const centre = (ps) => {
    const big = ps.map((p) => p[0]).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
    return [round(big.reduce((s, p) => s + p[0], 0) / big.length, 2), round(big.reduce((s, p) => s + p[1], 0) / big.length, 2)];
  };
  const keepBig = (ps, min) => ps.filter((p) => Math.abs(ringArea(p[0])) > min);
  const regions = Object.keys(byHR).sort().map((id) => {
    const g = hrGeoms[id];
    if (!g) throw new Error(`no boundary for health region ${id}`);
    const ps = keepBig(g.parts.flatMap((geom) => polys(geom, 0.004, 3)), 0.002);
    const name = NAMES[id] ?? g.names[0].replace(/ Regional Health Authority$| Health Authority$/, '').replace('Yatth�', 'Yatthé');
    return { id, name, ...summary(byHR[id]), c: centre(ps), polys: ps };
  });
  const hrFeat = regions.map((r) => ({ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: hrGeoms[r.id].parts.flatMap((g) => g.coordinates) } }));

  // --- FSA boundaries (Statistics Canada 2021): only the postal areas the survey has homes in
  const FSA = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/14';
  const fsaFeats = (await arcgisAll(FSA, { where: "PRUID='47'", outFields: 'CFSAUID', maxAllowableOffset: '0.001' }, 'fsa-47', 200)).filter((f) => f.geometry && byFSA[f.properties.CFSAUID]);
  const fsas = fsaFeats.map((f) => {
    const id = f.properties.CFSAUID;
    const hrs = Object.entries(hrOfFSA[id] ?? {}).sort((a, b) => b[1] - a[1]);
    return { id, ...summary(byFSA[id]), hr: hrs[0]?.[0] ?? null, urban: id[1] !== '0', polys: keepBig(polys(f.geometry, id[1] === '0' ? 0.004 : 0.0015, 3), id[1] === '0' ? 0.002 : 0.00002) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const missing = Object.keys(byFSA).filter((id) => !fsas.some((f) => f.id === id));
  if (missing.length) log(`  radon: FSAs in the survey with no 2021 boundary: ${missing.join(', ')}`);

  // --- per place: its health region (centre in the 2007 outline) and its postal areas: urban FSAs that cover a
  // quarter or more of the town limits' outline points (or hold its centre), else the rural FSA its centre is in
  const inFeat = (pt, geom) => booleanPointInPolygon(pt, { type: 'Feature', properties: {}, geometry: geom });
  const towns = {}, small = {};
  const sAreas = await smallAreas();
  const smallP = await getSmallPlaces();
  for (const p of [...places, ...smallP]) {
    const tier2 = p.tier === 2;
    let ri = hrFeat.findIndex((f) => booleanPointInPolygon([p.lon, p.lat], f));
    if (ri < 0) ri = hrFeat.map((f, i) => ({ i, d: edgeKm(p.lon, p.lat, f.geometry) })).sort((a, b) => a.d - b.d)[0].i;
    const area = tier2 ? sAreas[p.key] : needs?.areas?.[p.key];
    const pts = area?.length ? area.flatMap((poly) => poly[0]) : [];
    const own = fsaFeats.filter((f) => f.properties.CFSAUID[1] !== '0').filter((f) => inFeat([p.lon, p.lat], f.geometry) || (pts.length && pts.filter((pt) => inFeat(pt, f.geometry)).length >= pts.length / 4) || (() => {
      // a small urban FSA wholly inside the town: its own points fall inside the limits
      if (!area?.length) return false;
      const ring = (f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates[0])[0];
      const lim = { type: 'MultiPolygon', coordinates: area };
      return ring.filter((pt) => inFeat(pt, lim)).length >= ring.length / 2;
    })()).map((f) => f.properties.CFSAUID);
    const f = own.length ? own : fsaFeats.filter((g) => inFeat([p.lon, p.lat], g.geometry)).map((g) => g.properties.CFSAUID);
    const t = tally();
    for (const id of f) { const b = byFSA[id]; t.n += b.n; t.hi += b.hi; t.vhi += b.vhi; t.vals.push(...b.vals); }
    (tier2 ? small : towns)[p.key] = { r: ri, f, ...(f.length ? { fn: t.n, fhi: t.hi } : {}) };
  }
  const few = Object.entries(towns).filter(([, t]) => t.fn != null && t.fn < FEW).length;
  log(`  ${prov.n} Saskatchewan homes: ${regions.length} health regions, ${fsas.length} FSAs; ${Object.keys(towns).length} places (${few} on fewer than ${FEW} FSA tests)`);
  await writeOut('radon', {
    source: 'Health Canada, Cross-Canada Survey of Radon Concentrations in Homes (2009–2011; final report 2012), open data',
    licence: 'Open Government Licence – Canada',
    areaSource: 'Statistics Canada, Health Regions: Boundaries and Correspondence with Census Geography (82-402-X), Saskatchewan health regions in effect December 2007 (2006 census geography); 2021 Census Cartographic Boundary Files, forward sortation areas',
    url: DATASET, reportUrl: 'https://www.canada.ca/en/health-canada/services/environmental-workplace-health/reports-publications/radiation/cross-canada-survey-radon-concentrations-homes-final-report-health-canada-2012.html',
    testUrl: 'https://www.canada.ca/en/health-canada/services/health-risks-safety/radiation/radon/test-your-home.html',
    guide: GUIDE, oldGuide: OLD_GUIDE, few: FEW, years: '2009–2011',
    prov: summary(prov), regions, fsas, towns, small,
  });
}
