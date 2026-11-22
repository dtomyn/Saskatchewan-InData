// A small ESRI shapefile reader for zipped national files (Elections Canada's boundaries): the attribute table first,
// then only the polygons a stage keeps, unprojected from Lambert conformal conic (the parameters read from the .prj).
// Not a general reader: polygons (type 5) in a 2-standard-parallel LCC on GRS 1980 only.

import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import fs from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { ringArea } from './geo.mjs';

/** Inverse Lambert conformal conic (2SP) on GRS 1980, from a .prj's PARAMETERs. */
export function lccFromPrj(prj) {
  if (!/Lambert_Conformal_Conic/i.test(prj) || !/GRS_1980/i.test(prj)) throw new Error(`unsupported projection: ${prj.slice(0, 120)}`);
  const par = (name) => { const m = prj.match(new RegExp(`PARAMETER\\["${name}",(-?[\\d.]+)\\]`, 'i')); if (!m) throw new Error(`no ${name} in .prj`); return +m[1]; };
  const A = 6378137, FL = 1 / 298.257222101, E = Math.sqrt(FL * (2 - FL)), D2R = Math.PI / 180;
  const LAM0 = par('Central_Meridian') * D2R, PHI0 = par('Latitude_Of_Origin') * D2R, P1 = par('Standard_Parallel_1') * D2R, P2 = par('Standard_Parallel_2') * D2R;
  const FE = par('False_Easting'), FN = par('False_Northing');
  const mF = (p) => Math.cos(p) / Math.sqrt(1 - (E * Math.sin(p)) ** 2);
  const tF = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2);
  const NN = (Math.log(mF(P1)) - Math.log(mF(P2))) / (Math.log(tF(P1)) - Math.log(tF(P2)));
  const FF = mF(P1) / (NN * tF(P1) ** NN), RHO0 = A * FF * tF(PHI0) ** NN;
  return (x, y) => {
    const dx = x - FE, dy = RHO0 - (y - FN);
    const rho = Math.sign(NN) * Math.hypot(dx, dy);
    const t = (rho / (A * FF)) ** (1 / NN);
    let phi = Math.PI / 2 - 2 * Math.atan(t);
    for (let i = 0; i < 8; i++) phi = Math.PI / 2 - 2 * Math.atan(t * ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2));
    return [(Math.atan2(dx, dy) / NN + LAM0) / D2R, phi / D2R];
  };
}

/** The rows of a .dbf (field names as written, values trimmed text). */
export function readDbf(dbf, encoding = 'latin1') {
  const nRec = dbf.readUInt32LE(4), hLen = dbf.readUInt16LE(8), rLen = dbf.readUInt16LE(10);
  const fields = [];
  for (let i = 32; dbf[i] !== 0x0d; i += 32) fields.push({ name: dbf.toString('latin1', i, i + 11).replace(/\0.*$/, ''), len: dbf[i + 16] });
  const rows = [];
  for (let r = 0; r < nRec; r++) {
    let o = hLen + r * rLen + 1;
    const a = {};
    for (const f of fields) { a[f.name] = dbf.toString(encoding, o, o + f.len).trim(); o += f.len; }
    rows.push(a);
  }
  return rows;
}

/**
 * The features of a zipped shapefile whose attributes pass `keep`: { attrs, geom } with geom a lon/lat MultiPolygon
 * (outer rings counter-clockwise, GeoJSON's way). Records are found through the .shx, so the shapes not kept are never
 * read. Clockwise rings are outer, counter-clockwise ones holes in the outer that holds them.
 */
export async function readShapefile(zipFile, keep) {
  const zip = unzipSync(new Uint8Array(await fs.readFile(zipFile)), { filter: (f) => /\.(shp|shx|dbf|prj|cpg)$/i.test(f.name) });
  const part = (ext) => { const k = Object.keys(zip).find((n) => n.toLowerCase().endsWith(ext)); if (!k) throw new Error(`no ${ext} in ${zipFile}`); return Buffer.from(zip[k]); };
  const cpg = Object.keys(zip).find((n) => n.toLowerCase().endsWith('.cpg'));
  const utf8 = cpg && /utf-?8/i.test(Buffer.from(zip[cpg]).toString('latin1'));
  const rows = readDbf(part('.dbf'), utf8 ? 'utf8' : 'latin1');
  const shp = part('.shp'), shx = part('.shx');
  const unproject = lccFromPrj(part('.prj').toString('latin1'));
  const out = [];
  rows.forEach((attrs, i) => {
    if (!keep(attrs)) return;
    const o = shx.readInt32BE(100 + i * 8 + 0) * 2, s = o + 8;
    if (shp.readInt32LE(s) !== 5) return;
    const nParts = shp.readInt32LE(s + 36), nPts = shp.readInt32LE(s + 40);
    const starts = Array.from({ length: nParts }, (_, k) => shp.readInt32LE(s + 44 + k * 4));
    const p0 = s + 44 + nParts * 4;
    const rings = starts.map((st, k) => {
      const end = k + 1 < nParts ? starts[k + 1] : nPts;
      const ring = [];
      for (let q = st; q < end; q++) ring.push(unproject(shp.readDoubleLE(p0 + q * 16), shp.readDoubleLE(p0 + q * 16 + 8)));
      return ring;
    });
    const outers = rings.filter((r) => ringArea(r) < 0).map((r) => [r]);
    for (const h of rings.filter((r) => ringArea(r) >= 0)) {
      const host = outers.find((p) => booleanPointInPolygon(h[0], { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [p[0]] } }));
      if (host) host.push(h);
    }
    out.push({ attrs, geom: { type: 'MultiPolygon', coordinates: outers.map((p) => p.map((r) => [...r].reverse())) } });
  });
  return out;
}
