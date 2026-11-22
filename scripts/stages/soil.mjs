import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import GeoJSONVT from 'geojson-vt';
import vtpbf from 'vt-pbf';
import { OUT } from '../lib/config.mjs';
import { dp, dpRing } from '../lib/geo.mjs';
import { cachedFile, cachedJSON, log, readOut, round, writeAtomic, writeOut } from '../lib/io.mjs';
import { parseCSV } from '../lib/parse.mjs';
import { getPlaces, getProvince, getSmallPlaces } from '../lib/places.mjs';
import { writePMTiles } from '../lib/pmtiles.mjs';

// Soil: Agriculture and Agri-Food Canada's Saskatchewan detailed soil survey (SKSIDv4, 1:100,000; the CanSIS copy of
// the province's soil survey), its derived "Thematic Soil Maps of Saskatchewan" for each polygon's capability for
// agriculture, and AAFC's Prairie Soil Zones. The survey's 67,166 polygons go into a PMTiles file the app reads with
// range requests (each carrying small integers); what the integers mean (the map units' soils, each soil's name, order,
// great group, drainage, parent material and horizons) goes into soil.json, with the zones as a picture for province
// scale, per place its zone and the land within 10 km by capability class.
//
// Geometry: the survey's GeoPackage (EPSG:3857, read with node:sqlite), not the Thematic layer's FeatureServer, because
// only the GeoPackage carries the MAPUNIT key that links a polygon to its components. The Thematic layer has the same
// polygons under other ids: each of its records is matched to a survey polygon by its centroid and area.
const SURVEY = 'https://agriculture.canada.ca/atlas/data_donnees/detailedSoilSurvey/data_donnees/';
const CSV = `${SURVEY}csv/sk_dtl_soil_sol/`;
const GPKG = `${SURVEY}geoPackage/sk_dtl_soil.gpkg`;
const ZONES = 'https://agriculture.canada.ca/atlas/data_donnees/soilOfCanadaDerived/data_donnees/geojson/wc_soil_zone.geojson';
const THEMATIC = 'https://services.arcgis.com/lGOekm0RsNxYnT3j/arcgis/rest/services/Thematic_soil_maps_of_Saskatchewan/FeatureServer/0';
const FILE = 'tiles/soil.pmtiles';
/** tiles from zoom 7 (below it the app draws the 3 km grids); past 9 the app overzooms, which a 1:100,000 survey's
 *  linework (good to about 50 m) bears */
const MIN_Z = 7, MAX_Z = 9;
/** geojson-vt's simplification, in tile units (4,096 a tile) */
const TOLERANCE = 3;
/** budgets: the archive and soil.json */
const MAX_TILES_MB = 15, MAX_JSON_MB = 3;
/** a place reads the land within this radius of its centre */
const RADIUS_KM = 10;
const R = 6378137;
const lonOf = (x) => (x / R) * (180 / Math.PI), latOf = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
const mx = (lon) => (R * lon * Math.PI) / 180, my = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

export const ZONE_NAMES = ['Brown', 'Dark Brown', 'Black', 'Dark Gray', 'Gray'];
/** capability classes: 1–7, then O (organic soils, not rated) */
const CAP_CODES = ['1', '2', '3', '4', '5', '6', '7', 'O'];
const TEXTURES = { GS: 'Gravelly sand', S: 'Sand', FS: 'Fine sand', LS: 'Loamy sand', GLS: 'Gravelly loamy sand', SL: 'Sandy loam', FL: 'Fine sandy loam', GSL: 'Gravelly sandy loam', VL: 'Very fine sandy loam', L: 'Loam', SIL: 'Silt loam', GL: 'Gravelly loam', CL: 'Clay loam', SICL: 'Silty clay loam', C: 'Clay', SIC: 'Silty clay', HC: 'Heavy clay', O: 'Organic', UD: 'Undifferentiated' };
const TEX_CODES = Object.keys(TEXTURES);
/** surface texture groups for colouring (0 undifferentiated) */
const TEX_GROUPS = ['Undifferentiated', 'Coarse (sands)', 'Moderately coarse (sandy loams)', 'Medium (loams)', 'Moderately fine (clay loams)', 'Fine (clays)', 'Organic'];
const TEX_GROUP = { GS: 1, S: 1, FS: 1, LS: 1, GLS: 1, SL: 2, FL: 2, GSL: 2, VL: 2, L: 3, SIL: 3, GL: 3, CL: 4, SICL: 4, C: 5, SIC: 5, HC: 5, O: 6, UD: 0 };
/** the soil colouring's classes: Chernozems by great group (the zones' soils), the other orders whole */
const SOIL_CLASSES = ['', 'Brown Chernozem', 'Dark Brown Chernozem', 'Black Chernozem', 'Dark Gray Chernozem', 'Solonetzic', 'Luvisolic', 'Regosolic', 'Gleysolic', 'Brunisolic', 'Organic', 'Vertisolic', 'Other'];
const SOIL_ORDER_CLASS = { SZ: 5, LU: 6, RG: 7, GL: 8, BR: 9, OR: 10, VE: 11 };
const ORDERS = { CH: 'Chernozemic', SZ: 'Solonetzic', LU: 'Luvisolic', RG: 'Regosolic', GL: 'Gleysolic', BR: 'Brunisolic', OR: 'Organic', VE: 'Vertisolic', PZ: 'Podzolic', CY: 'Cryosolic' };
const GROUPS = { BC: 'Brown Chernozem', DBC: 'Dark Brown Chernozem', BLC: 'Black Chernozem', DGC: 'Dark Gray Chernozem', DYB: 'Sombric Brunisol', EB: 'Eutric Brunisol', MB: 'Melanic Brunisol', SB: 'Dystric Brunisol', F: 'Fibrisol', M: 'Mesisol', H: 'Humisol', FO: 'Folisol', G: 'Gleysol', HG: 'Humic Gleysol', LG: 'Luvic Gleysol', GL: 'Gray Luvisol', GBL: 'Gray Brown Luvisol', R: 'Regosol', HR: 'Humic Regosol', SZ: 'Solonetz', SS: 'Solodized Solonetz', SO: 'Solod', V: 'Vertisol', HV: 'Humic Vertisol', HFP: 'Humo-Ferric Podzol', FHP: 'Ferro-Humic Podzol', OC: 'Organic Cryosol', SC: 'Static Cryosol', TC: 'Turbic Cryosol' };
/** subgroups (3rd edition), only those read unambiguously from the specification; any other is left out of the name */
const SUBGROUPS = { O: 'Orthic', CA: 'Calcareous', GL: 'Gleyed', GLCA: 'Gleyed Calcareous', R: 'Rego', E: 'Eluviated', GLR: 'Gleyed Rego', GLE: 'Gleyed Eluviated', D: 'Dark', GLD: 'Gleyed Dark', B: 'Brown', DB: 'Dark Brown', BL: 'Black', DG: 'Dark Gray', SZ: 'Solonetzic', GLSZ: 'Gleyed Solonetzic', T: 'Terric', TY: 'Typic', BR: 'Brunisolic', CU: 'Cumulic', GLCU: 'Gleyed Cumulic', GLB: 'Gleyed Brown', GLBL: 'Gleyed Black', GLDB: 'Gleyed Dark Brown', GLDG: 'Gleyed Dark Gray', HU: 'Humic', FI: 'Fibric', ME: 'Mesic', TFI: 'Terric Fibric', HY: 'Hydric', LM: 'Limno', V: 'Vertic' };
const DRAINAGE = { VR: 'Very rapidly drained', R: 'Rapidly drained', W: 'Well drained', MW: 'Moderately well drained', I: 'Imperfectly drained', P: 'Poorly drained', VP: 'Very poorly drained' };
const DEPOSIT = { ANTH: 'Anthropogenic', COLL: 'Colluvial', EOLI: 'Eolian (wind-laid)', FLEO: 'Fluvioeolian', FLLC: 'Fluviolacustrine', FLUV: 'Fluvial (river-laid)', FNPT: 'Fen peat', FOPT: 'Forest peat', GLFL: 'Glaciofluvial', GLLC: 'Glaciolacustrine', LACU: 'Lacustrine (lake-laid)', LATL: 'Lacustro-till', RESD: 'Residual', SPPT: 'Sphagnum peat', SEPT: 'Sedimentary peat', TILL: 'Till (glacial)', UNDM: 'Undifferentiated mineral', UNDO: 'Undifferentiated organic', RKUD: 'Undifferentiated rock' };
const PM_TEX = { VC: 'very coarse', C: 'coarse', MC: 'moderately coarse', M: 'medium', MF: 'moderately fine', F: 'fine', VF: 'very fine', FI: 'fibric', ME: 'mesic', HU: 'humic', CS: 'coarse skeletal', UD: 'undifferentiated' };
const PM_CHEM = { VC: 'calcareous', WC: 'weakly calcareous', SA: 'saline', AN: 'acid' };
const RESTRICT = { SA: 'saline layer (over 4 dS/m)', BN: 'Solonetzic B horizon', LI: 'lithic (bedrock)', CT: 'compact till', OR: 'ortstein', UN: 'undifferentiated' };
/** the Thematic layer's slope and water-erosion classes, in order */
const SLOPES = ['0 - 2%', '2 - 5%', '5 - 9%', '9 - 15%', '15 - 30%', '30 - 45%'];
const EROSION = ['Very Low', 'Low', 'Moderate', 'High', 'Very High'];
/** SALSYM's first character: the share of the polygon affected; the second its degree (a lone digit is derived, taken as moderate) */
const SALT_EXTENT = ['none', 'under 3%', '3–10%', '10–20%', '20–40%', '40–70%', 'over 70%'];
const SALT_DEGREE = { W: 'weakly saline (2–4 dS/m)', M: 'moderately saline (4–8 dS/m)', S: 'strongly saline (8–16 dS/m)', V: 'very strongly saline (over 16 dS/m)' };
const SALT_WHERE = { A: 'bottoms of depressions and sloughs', D: 'bottoms of dissections and runways', I: 'knolls and upper slopes (saline parent material near the surface)', P: 'edges of depressions, sloughs and runways', S: 'sides of hills and slopes' };

// ------------------------------------------------------------------------------------------------
// GeoPackage geometry: a GPB header and an envelope, then WKB (MultiPolygon of Polygons). Rings stay flat Float64Arrays.

function gpkgPolys(buf) {
  const flags = buf[3];
  let o = 8 + [0, 32, 48, 48, 64][(flags >> 1) & 7];
  const out = [];
  const read = () => {
    const le = buf[o] === 1; o++;
    const u32 = () => { const v = le ? buf.readUInt32LE(o) : buf.readUInt32BE(o); o += 4; return v; };
    const f64 = () => { const v = le ? buf.readDoubleLE(o) : buf.readDoubleBE(o); o += 8; return v; };
    const type = u32() % 1000;
    if (type === 6) { const n = u32(); for (let i = 0; i < n; i++) read(); return; }
    if (type !== 3) throw new Error(`soil GeoPackage: geometry type ${type}, expected polygons`);
    const rings = [];
    for (let r = u32(); r > 0; r--) { const n = u32(); const ring = new Float64Array(n * 2); for (let k = 0; k < n * 2; k++) ring[k] = f64(); rings.push(ring); }
    out.push(rings);
  };
  read();
  return out;
}
const ringArea = (r) => { let s = 0; for (let k = 0; k < r.length - 2; k += 2) s += r[k] * r[k + 3] - r[k + 2] * r[k + 1]; return s / 2; };
const pipRings = (rings, x, y) => {
  let inside = false;
  for (const r of rings)
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
};
/** a point inside a polygon: the middle of the widest span across its largest part, on the part's middle latitude */
function interior(parts) {
  let best = parts[0], ba = -1;
  for (const p of parts) { const a = Math.abs(ringArea(p[0])); if (a > ba) { ba = a; best = p; } }
  const r0 = best[0];
  let y0 = Infinity, y1 = -Infinity;
  for (let k = 1; k < r0.length; k += 2) { if (r0[k] < y0) y0 = r0[k]; if (r0[k] > y1) y1 = r0[k]; }
  for (const f of [0.5, 0.37, 0.63, 0.25, 0.75]) {
    const y = y0 + (y1 - y0) * f;
    const xs = [];
    for (const r of best) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const yi = r[i + 1], yj = r[j + 1];
      if ((yi > y) !== (yj > y)) xs.push(r[i] + ((r[j] - r[i]) * (y - yi)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    let w = 0, x = null;
    for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > w) { w = xs[k + 1] - xs[k]; x = (xs[k] + xs[k + 1]) / 2; }
    if (x != null) return [x, y];
  }
  return [r0[0], r0[1]];
}

/** A spatial index over polygons (Web Mercator metres): a grid of cells, each listing the polygons whose box meets it. */
function polyIndex(items, CELL = 10000) {
  const grid = new Map();
  items.forEach((it, i) => {
    const [x0, y0, x1, y1] = it.box;
    for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
      for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) { const k = gx * 100000 + gy; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(i); }
  });
  return {
    candidates: (x, y) => grid.get(Math.floor(x / CELL) * 100000 + Math.floor(y / CELL)) ?? [],
    find(x, y) {
      for (const i of this.candidates(x, y)) {
        const it = items[i], b = it.box;
        if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
        for (const rings of it.parts) if (pipRings(rings, x, y)) return i;
      }
      return -1;
    },
  };
}
const boxOf = (parts) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of parts) for (const r of p) for (let k = 0; k < r.length; k += 2) { const x = r[k], y = r[k + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
};

// ------------------------------------------------------------------------------------------------

export default async function soil() {
  const { clipFeature } = await getProvince();
  const places = await getPlaces();
  const small = await getSmallPlaces();
  const num = (v) => { const n = +v; return v == null || v === '' || !Number.isFinite(n) || n === -9 ? null : n; };

  // --- the survey's tables
  const csv = async (name) => parseCSV(await fs.readFile(await cachedFile(`soil/${name}`, `${CSV}${name}`), 'utf8'));
  const [polyRows, cmpRows, snfRows, slfRows] = await Promise.all(['sk_dtl_100k.csv', 'sk_dtl_cmp.csv', 'sk_dtl_snf.csv', 'sk_dtl_slf.csv'].map(csv));
  if (polyRows.length < 60000 || cmpRows.length < 100000 || snfRows.length < 3000 || slfRows.length < 10000) throw new Error(`soil survey tables look short: ${polyRows.length} polygons, ${cmpRows.length} components, ${snfRows.length} soils, ${slfRows.length} horizons`);
  const polyAttr = new Map(polyRows.map((r) => [r.MAPUNIT, r]));
  const snf = new Map(snfRows.map((r) => [r.SOILTYPE, r]));
  const layers = new Map();
  for (const r of slfRows) { let l = layers.get(r.SOILTYPE); if (!l) layers.set(r.SOILTYPE, (l = [])); l.push(r); }
  const comps = new Map();
  for (const r of cmpRows) { let l = comps.get(r.MAPUNIT); if (!l) comps.set(r.MAPUNIT, (l = [])); l.push(r); }

  // soils, kept once each, as the app reads them
  const types = [], typeIdx = new Map();
  const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());
  const typeOf = (code) => {
    if (typeIdx.has(code)) return typeIdx.get(code);
    const s = snf.get(code);
    if (!s) return -1;
    const series = titleCase((s.SOILNAME ?? '').split(/\s+/)[0] ?? '');
    const g = s.G_GROUP3?.trim(), sg = s.S_GROUP3?.trim(), o = s.ORDER3?.trim();
    const hz = (layers.get(code) ?? []).sort((a, b) => +a.LAYER_NO - +b.LAYER_NO).map((h) => {
      const lit = h.HZN_LIT?.trim() === '2' ? 'II' : h.HZN_LIT?.trim() === '3' ? 'III' : '';
      const lab = `${lit}${h.HZN_MAS?.trim() ?? ''}${h.HZN_SUF?.trim() ?? ''}${h.HZN_MOD?.trim() ?? ''}`;
      // label, top and bottom (cm), sand, silt, clay (%), organic carbon (%), pH (CaCl₂), EC (dS/m), CaCO₃ equivalent (%)
      return [lab, num(h.UDEPTH), num(h.LDEPTH), num(h.TSAND), num(h.TSILT), num(h.TCLAY), num(h.ORGCARB), num(h.PHCA), num(h.EC), num(h.CACO3)];
    }).filter((h) => h[0] && h[1] != null && h[2] != null);
    const t = {
      n: series || code, k: s.KIND?.trim() || null,
      o: ORDERS[o] ? o : null, g: GROUPS[g] ? g : null, sg: SUBGROUPS[sg] ? sg : null,
      d: DRAINAGE[s.DRAINAGE?.trim()] ? s.DRAINAGE.trim() : null,
      m: [s.MDEP1, s.MDEP2, s.MDEP3].map((x) => x?.trim()).filter((x) => DEPOSIT[x]),
      pt: PM_TEX[s.PMTEX1?.trim()] ? s.PMTEX1.trim() : null, pc: PM_CHEM[s.PMCHEM1?.trim()] ? s.PMCHEM1.trim() : null,
      r: RESTRICT[s.RESTR_TYPE?.trim()] ? s.RESTR_TYPE.trim() : null,
      n0: s.LU_FLAG?.trim() === 'N', h: hz,
    };
    typeIdx.set(code, types.length);
    types.push(t);
    return types.length - 1;
  };
  // map units (a polygon's soils and their shares), kept once per distinct mix
  const units = [], unitIdx = new Map();
  const unitOf = (mapunit) => {
    const cs = (comps.get(mapunit) ?? []).filter((c) => +c.PERCENT > 0).sort((a, b) => +b.PERCENT - +a.PERCENT || +a.CMP - +b.CMP);
    if (!cs.length) return -1;
    const u = cs.map((c) => [typeOf(c.SOILTYPE), +c.PERCENT, Math.max(0, TEX_CODES.indexOf(c.TEXTURE?.trim()))]).filter((c) => c[0] >= 0);
    if (!u.length) return -1;
    const key = JSON.stringify(u);
    if (!unitIdx.has(key)) { unitIdx.set(key, units.length); units.push(u); }
    return unitIdx.get(key);
  };

  // --- the survey's polygons
  const gpkgFile = await cachedFile('soil/sk_dtl_soil.gpkg', GPKG);
  const db = new DatabaseSync(gpkgFile, { readOnly: true });
  const polys = [];
  for (const row of db.prepare('SELECT MAPUNIT, SHAPE FROM sk_dtl_100k').iterate()) {
    const parts = gpkgPolys(Buffer.from(row.SHAPE)).filter((p) => p[0]?.length >= 8);
    if (!parts.length) continue;
    let a = 0;
    for (const p of parts) p.forEach((r, i) => (a += i ? -Math.abs(ringArea(r)) : Math.abs(ringArea(r))));
    const box = boxOf(parts);
    const k = Math.cos((latOf((box[1] + box[3]) / 2) * Math.PI) / 180) ** 2;
    polys.push({ mapunit: row.MAPUNIT, parts, box, a3857: a, km2: (a * k) / 1e6, at: polyAttr.get(row.MAPUNIT) ?? null });
  }
  db.close();
  if (polys.length < 60000) throw new Error(`only ${polys.length} polygons in the soil GeoPackage`);
  log(`  ${polys.length} survey polygons, ${polyRows.length} rows in the polygon table`);
  const index = polyIndex(polys);

  // --- capability, slope and water erosion: the Thematic layer, matched to the survey polygons (centroid, then area)
  const thematic = [];
  for (let offset = 0; ;) {
    const q = new URLSearchParams({ where: '1=1', outFields: 'OBJECTID,AGCAP_CODE,SLOPE_CODE,EROSION_CODE,Shape__Area', returnGeometry: 'false', returnCentroid: 'true', outSR: '3857', orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: '2000', f: 'json' });
    const page = await cachedJSON(`arcgis/sk-soil-thematic-${offset}.json`, `${THEMATIC}/query?${q}`, { timeout: 300_000, check: (j) => { if (!Array.isArray(j.features)) throw new Error(`thematic soil maps: ${JSON.stringify(j.error ?? j).slice(0, 200)}`); } });
    thematic.push(...page.features);
    offset += page.features.length;
    if (!page.features.length || (page.features.length < 2000 && !page.exceededTransferLimit)) break;
  }
  const near = (a, b) => Math.abs(a - b) / Math.max(a, b);
  let byArea = 0, byPoint = 0, unmatched = 0;
  const taken = new Uint8Array(polys.length);
  for (const f of thematic) {
    const c = f.centroid, at = f.attributes;
    if (!c) { unmatched++; continue; }
    // the survey polygon of the same area among those whose box holds the centroid; else the one the centroid is in
    let best = -1, bd = 0.002;
    for (const i of index.candidates(c.x, c.y)) {
      const b = polys[i].box;
      if (taken[i] || c.x < b[0] || c.x > b[2] || c.y < b[1] || c.y > b[3]) continue;
      const d = near(polys[i].a3857, at.Shape__Area);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) byArea++;
    else { best = index.find(c.x, c.y); if (best >= 0 && !taken[best]) byPoint++; else { unmatched++; continue; } }
    taken[best] = 1;
    const p = polys[best];
    p.cap = CAP_CODES.indexOf(at.AGCAP_CODE?.trim()) + 1; // 0 not rated, 1–7, 8 organic
    p.slope = SLOPES.indexOf(at.SLOPE_CODE?.trim()) + 1;
    p.ero = EROSION.indexOf(at.EROSION_CODE?.trim()) + 1;
  }
  log(`  thematic layer: ${thematic.length} records, ${byArea} matched by area, ${byPoint} by point, ${unmatched} unmatched`);
  if (byArea + byPoint < polys.length * 0.9) throw new Error(`only ${byArea + byPoint} of ${polys.length} polygons matched a capability rating`);

  // --- the soil zones: AAFC's polygons (Western Canada), simplified, filed for point tests in Web Mercator
  const zfc = JSON.parse(await fs.readFile(await cachedFile('soil/wc_soil_zone.geojson', ZONES), 'utf8'));
  const zones = [];
  for (const f of zfc.features ?? []) {
    const z = ZONE_NAMES.indexOf(f.properties?.ZONE_EN);
    if (z < 0) continue;
    const g = f.geometry, ps = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const p of ps) {
      const parts = [p.map((ring) => Float64Array.from(dpRing(ring, 0.002).flatMap(([x, y]) => [mx(x), my(y)])))].filter((q) => q[0].length >= 8);
      if (parts.length) zones.push({ z, parts, box: boxOf(parts) });
    }
  }
  if (new Set(zones.map((z) => z.z)).size < 5) throw new Error(`the soil zone file has ${new Set(zones.map((z) => z.z)).size} of 5 zones`);
  const zIndex = polyIndex(zones, 50000);
  const zoneAt = (x, y) => { const i = zIndex.find(x, y); return i < 0 ? -1 : zones[i].z; };

  // --- per polygon: its map unit, zone, salinity
  for (const p of polys) {
    const [x, y] = interior(p.parts);
    p.pt = [x, y];
    p.u = unitOf(p.mapunit);
    p.z = zoneAt(x, y) + 1; // 0 outside the zones
    const s = p.at?.SALSYM?.trim() ?? '';
    const m = /^([0-6])([0WMSV])?([ADIPS]{0,2})$/.exec(s);
    p.salt = m ? +m[1] + 1 : 0; // 0 not rated, 1 none … 7 over 70%
    p.sd = m && m[2] && m[2] !== '0' ? 'WMSV'.indexOf(m[2]) + 1 : m && +m[1] > 0 ? 2 : 0; // a lone digit: derived, moderate
    p.sw = m?.[3] ? [...m[3]].map((ch) => 'ADIPS'.indexOf(ch)).filter((v) => v >= 0) : [];
    p.non = p.at?.NONSOIL?.trim() || null;
  }

  // --- province figures (km², ground)
  const zoneKm2 = new Array(6).fill(0), capKm2 = new Array(9).fill(0), zoneCap = ZONE_NAMES.map(() => new Array(9).fill(0));
  const orderKm2 = {}, texKm2 = new Array(TEX_CODES.length).fill(0), saltKm2 = new Array(8).fill(0);
  let total = 0;
  for (const p of polys) {
    total += p.km2;
    zoneKm2[p.z] += p.km2;
    capKm2[p.cap ?? 0] += p.km2;
    if (p.z) zoneCap[p.z - 1][p.cap ?? 0] += p.km2;
    saltKm2[p.salt] += p.km2;
    if (p.u >= 0) for (const [t, pct, tex] of units[p.u]) { const o = types[t].o ?? '-'; orderKm2[o] = (orderKm2[o] ?? 0) + (p.km2 * pct) / 100; texKm2[tex] += (p.km2 * pct) / 100; }
  }
  const pct1 = (v) => Math.round((v / total) * 1000) / 10;

  // --- What grows here, by capability class: the Annual Crop Inventory's latest map, cell by cell
  let crops = null;
  try {
    const C = await readOut('crops');
    const g = C.grid, last = C.years.length - 1;
    const a = new Uint8Array(g.w * g.h);
    let k = 0;
    for (const [, n, ch] of C.maps[last].matchAll(/(\d*)([a-z])/g)) a.fill(ch.charCodeAt(0) - 97, k, (k += n ? +n : 1));
    const byCap = Array.from({ length: 9 }, () => new Array(C.classes.length).fill(0));
    for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) {
      const v = a[r * g.w + c];
      if (!v) continue;
      const i = index.find(g.x0 + (c + 0.5) * g.px, g.y1 - (r + 0.5) * g.px);
      if (i >= 0) byCap[polys[i].cap ?? 0][v - 1]++;
    }
    // per class: cropped (cereals, canola, pulses, other crops), pasture and forage, grassland and shrub, the rest (% of its cells)
    crops = { year: C.years[last], byCap: byCap.map((row) => { const n = row.reduce((s, v) => s + v, 0); return n < 20 ? null : [row[0] + row[1] + row[2] + row[3], row[4], row[5], n - row[0] - row[1] - row[2] - row[3] - row[4] - row[5]].map((v) => Math.round((v / n) * 100)); }) };
  } catch (e) { log(`  crops.json not read (${e.message}): no comparison with What grows here`); }

  // --- per place: the zone at its centre, the soil there, and the land within 10 km by capability class
  const diggable = (p) => p.u >= 0 && !p.non && units[p.u].some(([t]) => types[t].h.length && types[t].k !== 'N');
  const placeSoil = (p) => {
    const cx = mx(p.lon), cy = my(p.lat), sc = 1 / Math.cos((p.lat * Math.PI) / 180), rr = RADIUS_KM * 1000 * sc, step = 500 * sc;
    const cap = new Array(9).fill(0);
    let n = 0, mapped = 0, near = -1, nd = Infinity;
    for (let dx = -rr; dx <= rr; dx += step) for (let dy = -rr; dy <= rr; dy += step) {
      if (dx * dx + dy * dy > rr * rr) continue;
      n++;
      const i = index.find(cx + dx, cy + dy);
      if (i < 0) continue;
      mapped++;
      cap[polys[i].cap ?? 0]++;
      const d = dx * dx + dy * dy;
      if (d < nd && diggable(polys[i])) { nd = d; near = i; }
    }
    const z = zoneAt(cx, cy);
    const here = index.find(cx, cy);
    const rated = cap.slice(1, 8).reduce((s, v) => s + v, 0);
    const out = { z: z >= 0 ? z : null, sv: Math.round((mapped / n) * 100) };
    if (mapped >= n / 4 && rated) {
      out.cap = cap.slice(1).map((v) => Math.round((v / mapped) * 100)); // classes 1–7, then organic (% of the surveyed land)
      out.good = Math.round(((cap[1] + cap[2] + cap[3]) / rated) * 100); // class 1–3 share of the rated land
      out.dom = cap.slice(1, 8).reduce((b, v, i, arr) => (v > arr[b] ? i : b), 0) + 1;
    }
    // the soil to dig: the polygon at the centre, or (a town mapped as urban land, a lake) the nearest one with a
    // surveyed profile, `nk` km away
    if (here >= 0 && diggable(polys[here])) out.i = here;
    else if (near >= 0) { out.i = near; out.nk = round((Math.sqrt(nd) / sc) / 1000, 1); }
    return out;
  };
  const towns = Object.fromEntries(places.map((p) => [p.key, placeSoil(p)]));
  const smallT = Object.fromEntries(small.map((p) => [p.key, placeSoil(p)]));

  // --- the zones as a picture for province scale: a 2 km Web Mercator grid clipped to the province, run-length coded
  const PX = 2000;
  const x0 = Math.floor(mx(-110.05) / PX) * PX, x1 = Math.ceil(mx(-101.3) / PX) * PX;
  const zb = zones.reduce((b, z) => [Math.min(b[0], z.box[1]), Math.max(b[1], z.box[3])], [Infinity, -Infinity]);
  const y0 = Math.floor(Math.max(my(48.95), zb[0]) / PX) * PX, y1 = Math.ceil(Math.min(my(60), zb[1]) / PX) * PX;
  const W = (x1 - x0) / PX, H = (y1 - y0) / PX;
  const { default: pip } = await import('@turf/boolean-point-in-polygon');
  let rle = '', run = 0, prev = '';
  for (let r = 0; r < H; r++) {
    const y = y1 - (r + 0.5) * PX, lat = latOf(y);
    for (let c = 0; c < W; c++) {
      const x = x0 + (c + 0.5) * PX;
      const z = zoneAt(x, y);
      const ch = z >= 0 && pip([lonOf(x), lat], clipFeature) ? String.fromCharCode(98 + z) : 'a';
      if (ch === prev) run++;
      else { if (prev) rle += (run > 1 ? run : '') + prev; prev = ch; run = 1; }
    }
  }
  rle += (run > 1 ? run : '') + prev;

  // --- each map unit's colouring classes, from its largest component: the soil (Chernozems by great group, the rest by
  // order) and the surface texture group
  const unitClass = units.map((u) => { const t = types[u[0][0]]; return t.o === 'CH' ? Math.max(0, ['BC', 'DBC', 'BLC', 'DGC'].indexOf(t.g)) + 1 : (SOIL_ORDER_CLASS[t.o] ?? SOIL_CLASSES.length - 1); });
  const unitTex = units.map((u) => TEX_GROUP[TEX_CODES[u[0][2]]] ?? 0);
  const b36 = (v) => v.toString(36);
  // per polygon, one character a column (base 36), the map unit in three: what the tiles' `i` indexes
  const col = (f) => polys.map(f).map(b36).join('');
  const cols = {
    u: polys.map((p) => b36(p.u + 1).padStart(3, '0')).join(''),
    c: col((p) => p.cap ?? 0), z: col((p) => p.z), s: col((p) => p.salt), d: col((p) => p.sd),
    w: col((p) => (p.sw.length ? p.sw[0] + 1 : 0)), p: col((p) => p.slope ?? 0), e: col((p) => p.ero ?? 0), n: col((p) => (p.non ? 1 : 0)),
  };

  // --- province scale: 3 km Web Mercator cells, each sampled 6 × 6 (500 m), taking the most common class (as What grows
  // here does), one run-length map a colouring
  const all = boxOf(polys.map((p) => [Float64Array.from(p.box)]));
  const bounds = [lonOf(all[0]), latOf(all[1]), lonOf(all[2]), latOf(all[3])];
  const CPX = 3000, SUB = 6;
  const gx0 = Math.floor(all[0] / CPX) * CPX, gx1 = Math.ceil(all[2] / CPX) * CPX, gy0 = Math.floor(all[1] / CPX) * CPX, gy1 = Math.ceil(all[3] / CPX) * CPX;
  const GW = (gx1 - gx0) / CPX, GH = (gy1 - gy0) / CPX;
  const classOf = {
    soil: (p) => (p.u >= 0 ? unitClass[p.u] : 0), cap: (p) => p.cap ?? 0, tex: (p) => (p.u >= 0 ? unitTex[p.u] : 0), salt: (p) => p.salt,
  };
  const grids = Object.fromEntries(Object.keys(classOf).map((k) => [k, new Uint8Array(GW * GH)]));
  const tally = new Uint16Array(32);
  const samples = new Int32Array(SUB * SUB);
  for (let r = 0; r < GH; r++)
    for (let c = 0; c < GW; c++) {
      let hit = 0;
      for (let i = 0; i < SUB; i++) for (let j = 0; j < SUB; j++) {
        const q = index.find(gx0 + c * CPX + ((j + 0.5) * CPX) / SUB, gy1 - r * CPX - ((i + 0.5) * CPX) / SUB);
        samples[i * SUB + j] = q;
        if (q >= 0) hit++;
      }
      if (hit < (SUB * SUB) / 2) continue;
      for (const [k, f] of Object.entries(classOf)) {
        tally.fill(0);
        for (const q of samples) if (q >= 0) { const v = f(polys[q]); if (v > 0) tally[v]++; }
        let best = 0, bn = 0;
        for (let v = 1; v < tally.length; v++) if (tally[v] > bn) { bn = tally[v]; best = v; }
        grids[k][r * GW + c] = best;
      }
    }
  const rleOf = (g) => {
    let s = '', n = 0, last = '';
    for (let k = 0; k < g.length; k++) {
      const ch = String.fromCharCode(97 + g[k]);
      if (ch === last) n++;
      else { if (last) s += (n > 1 ? n : '') + last; last = ch; n = 1; }
    }
    return s + (n > 1 ? n : '') + last;
  };

  // --- tiles: each polygon carries only its index `i` (the columns above say the rest)
  const SIMPLIFY_M = 8; // Web Mercator metres (~5 m on the ground): below what the highest zoom can show
  const features = polys.map((p, i) => ({
    type: 'Feature',
    properties: { i },
    geometry: {
      type: 'MultiPolygon',
      coordinates: p.parts.map((rings) => rings.map((r) => {
        const pts = [];
        for (let k = 0; k < r.length; k += 2) pts.push([r[k], r[k + 1]]);
        return (pts.length > 16 ? dpRing(pts, SIMPLIFY_M) : pts).map(([x, y]) => [round(lonOf(x), 6), round(latOf(y), 6)]);
      }).filter((ring) => ring.length >= 4)).filter((rings) => rings.length),
    },
  }));
  const idx = new GeoJSONVT({ type: 'FeatureCollection', features }, { maxZoom: MAX_Z + 1, indexMaxZoom: MIN_Z, tolerance: TOLERANCE, extent: 4096, buffer: 16 });
  features.length = 0;
  const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
  const tiles = [];
  let biggest = 0;
  const perZoom = {};
  for (let z = MIN_Z; z <= MAX_Z; z++) {
    let bytes = 0;
    for (let x = lon2x(bounds[0], z); x <= lon2x(bounds[2], z); x++)
      for (let y = lat2y(bounds[3], z); y <= lat2y(bounds[1], z); y++) {
        const t = idx.getTile(z, x, y);
        if (!t?.features.length) continue;
        const data = Buffer.from(vtpbf.fromGeojsonVt({ soil: t }, { version: 2, extent: 4096 }));
        biggest = Math.max(biggest, data.length);
        bytes += data.length;
        tiles.push({ z, x, y, data });
      }
    perZoom[z] = Math.round(bytes / 1024);
  }
  const pm = writePMTiles(tiles, {
    bounds, center: [-105.6, 51.7, 8],
    meta: {
      name: 'Living Skies Atlas soil', attribution: 'Saskatchewan detailed soil survey (SKSIDv4) and Thematic Soil Maps of Saskatchewan, Agriculture and Agri-Food Canada (OGL – Canada)',
      vector_layers: [{ id: 'soil', minzoom: MIN_Z, maxzoom: MAX_Z, fields: { i: 'Number' } }],
    },
  });
  log(`  ${tiles.length} tiles (raw KB by zoom ${JSON.stringify(perZoom)}, largest ${(biggest / 1024).toFixed(0)} KB), ${FILE} ${(pm.length / 1048576).toFixed(1)} MB`);
  if (pm.length > MAX_TILES_MB * 1048576) throw new Error(`${FILE} is ${(pm.length / 1048576).toFixed(1)} MB, over the ${MAX_TILES_MB} MB budget`);

  const out = {
    source: 'Agriculture and Agri-Food Canada, Saskatchewan Detailed Soil Survey (SKSIDv4, 1:100,000)',
    sourceUrl: 'https://open.canada.ca/data/en/dataset/3734623c-25c5-4e69-936d-26f764a2807f',
    capSource: 'Agriculture and Agri-Food Canada, Thematic Soil Maps of Saskatchewan (capability for agriculture, slope, water erosion)',
    capUrl: 'https://open.canada.ca/data/en/dataset/ed36f4f3-2fb9-4241-8e29-6741e8b9e400',
    zoneSource: 'Agriculture and Agri-Food Canada, Prairie Soil Zones of Canada',
    zoneUrl: 'https://open.canada.ca/data/en/dataset/ac6a1e51-9c70-43ab-889f-106838410473',
    licence: 'Open Government Licence – Canada', licenceUrl: 'https://open.canada.ca/en/open-government-licence-canada',
    asOf: new Date().toISOString().slice(0, 10),
    file: FILE, bytes: pm.length, minzoom: MIN_Z, maxzoom: MAX_Z, bounds: bounds.map((v) => round(v, 4)), radiusKm: RADIUS_KM,
    // the lookups the tiles' integers index
    zones: ZONE_NAMES, caps: CAP_CODES, slopes: SLOPES, erosion: EROSION, saltExtent: SALT_EXTENT, saltDegree: Object.values(SALT_DEGREE), saltWhere: Object.values(SALT_WHERE),
    textures: TEX_CODES.map((k) => [k, TEXTURES[k]]),
    orders: ORDERS, groups: GROUPS, subgroups: SUBGROUPS, drainage: DRAINAGE, deposits: DEPOSIT, pmTex: PM_TEX, pmChem: PM_CHEM, restrict: RESTRICT,
    // soils: name, kind, order, great group, subgroup, drainage, modes of deposition, parent material texture and
    // chemistry, root-restricting layer and its depth (cm), whether it is the native (uncultivated) profile, horizons
    types,
    // map units: [soil, percent, surface texture] per component, largest first; each unit's colouring classes (base 36)
    units, soilClasses: SOIL_CLASSES, texGroups: TEX_GROUPS,
    unitClass: unitClass.map(b36).join(''), unitTex: unitTex.map(b36).join(''),
    // per polygon (the tiles' `i`), base 36: u map unit + 1 (three characters, 0 none), c capability (0 not rated,
    // 1–7, 8 organic), z zone (0 outside, 1… ZONE_NAMES), s salinity extent (0 not rated, 1… saltExtent), d its degree
    // (0 none, 1… saltDegree), w where it occurs (0 not said, 1… saltWhere), p slope (0 not rated, 1… slopes),
    // e water erosion risk (0 not rated, 1… erosion), n a non-soil polygon (a lake, a gravel pit)
    cols,
    // province scale: the most common class in each 3 km cell, per colouring (an optional count, then a letter: a none, b… class 1…)
    grid: { x0: gx0, y1: gy1, px: CPX, w: GW, h: GH, bounds: [lonOf(gx0), latOf(gy0), lonOf(gx1), latOf(gy1)].map((v) => round(v, 5)), maps: Object.fromEntries(Object.entries(grids).map(([k, g]) => [k, rleOf(g)])) },
    // the zones, for province scale
    zoneGrid: { x0, y1, px: PX, w: W, h: H, bounds: [lonOf(x0), latOf(y0), lonOf(x1), latOf(y1)].map((v) => round(v, 5)), map: rle },
    // the surveyed land, km² and %
    prov: {
      km2: Math.round(total), polys: polys.length,
      zone: zoneKm2.map(pct1), cap: capKm2.map(pct1), salt: saltKm2.map(pct1),
      zoneCap: zoneCap.map((row) => { const s = row.reduce((a, v) => a + v, 0); return row.map((v) => (s ? Math.round((v / s) * 1000) / 10 : 0)); }),
      zoneKm2: zoneKm2.map(Math.round),
      order: Object.fromEntries(Object.entries(orderKm2).map(([k, v]) => [k, pct1(v)])),
      texture: texKm2.map(pct1),
    },
    crops,
    towns, small: smallT,
  };
  const text = JSON.stringify(out);
  if (text.length > MAX_JSON_MB * 1048576) throw new Error(`soil.json would be ${(text.length / 1048576).toFixed(1)} MB, over the ${MAX_JSON_MB} MB budget`);
  // checked before anything is written, so the archive and soil.json are only ever replaced together
  await fs.mkdir(path.join(OUT, 'tiles'), { recursive: true });
  await writeAtomic(path.join(OUT, FILE), pm);
  await writeOut('soil', out);
  log(`  ${types.length} soils, ${units.length} map units; zones ${zoneKm2.slice(1).map((v, i) => `${ZONE_NAMES[i]} ${pct1(v)}%`).join(', ')}; class 1–3 ${pct1(capKm2[1] + capKm2[2] + capKm2[3])}%`);
}
