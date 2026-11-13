import { arcgisAll } from '../lib/apis.mjs';
import { polys, ringArea } from '../lib/geo.mjs';
import { log, writeOut } from '../lib/io.mjs';

// ECCC Adjusted & Homogenized Canadian Climate Data.
// Flood-prone land (plans/digital-twin/3-forecasts-and-what-ifs.md, 3d): the Water Security Agency's published flood
// hazard mapping, never modelled here. The 1:500-year flood extent for the communities it has studied, and where the
// Flood Damage Reduction Program split it, the floodway (deep, fast water) and the flood fringe. The historic 1978
// Radville extent is a record, not a return period, and is left out.
export default async function floods() {
  const B = 'https://services1.arcgis.com/7MBdlVpjqbfBhQer/arcgis/rest/services';
  const title = (s) => (s ?? '').replace(/\s+/g, ' ').replace(/Qu' Appelle/i, 'Qu’Appelle').replace(/Ile-A-La-Crosse/i, 'Île-à-la-Crosse').trim();
  const zones = [];
  const add = (f, kind, extra = {}) => {
    const ps = polys(f.geometry ?? { type: 'none' }, 0.0002, 5).filter((p) => Math.abs(ringArea(p[0])) > 1e-7);
    if (ps.length) zones.push({ kind, place: title(f.properties.Location ?? f.properties.Community), ...extra, polys: ps });
  };
  const ext = await arcgisAll(`${B}/1_500yr_Flood/FeatureServer/2`, { where: '1=1', outFields: 'Location,Line_Type' }, 'wsa-flood-500');
  for (const f of ext) {
    const t = f.properties.Line_Type ?? '';
    if (/500/.test(t)) add(f, '500'); else if (/protected/i.test(t)) add(f, 'protected');
  }
  const fh = await arcgisAll(`${B}/Flood_Hazard_All/FeatureServer/33`, { where: '1=1', outFields: 'Location,Community,Line_Type,Water_body,Year,Program,Hlink_PDF' }, 'wsa-flood-hazard');
  for (const f of fh) {
    const p = f.properties, t = p.Line_Type ?? '';
    const kind = /floodway/i.test(t) ? 'floodway' : /fringe/i.test(t) ? 'fringe' : null;
    if (!kind) continue;
    const pdf = /^https?:\/\//.test(p.Hlink_PDF ?? '') ? p.Hlink_PDF : null;
    add(f, kind, { water: p.Water_body ? title(p.Water_body) : null, year: p.Year ? +p.Year || null : null, program: p.Program || null, pdf });
  }
  if (!zones.some((z) => z.kind === '500')) throw new Error('no 1:500-year flood extents in the answer');
  const count = (k) => zones.filter((z) => z.kind === k).length;
  log(`  ${count('500')} 1:500-year extents in ${new Set(zones.filter((z) => z.kind === '500').map((z) => z.place)).size} places; ${count('floodway')} floodway, ${count('fringe')} fringe, ${count('protected')} protected`);
  await writeOut('floods', {
    source: 'Water Security Agency, Flood Hazard and 1:500 Year Flood mapping (Saskatchewan GeoHub)',
    sourceUrl: 'https://geohub-wsask.hub.arcgis.com',
    licence: 'Government of Saskatchewan Standard Unrestricted Use Data Licence v2.0',
    returnPeriod: 500,
    asOf: new Date().toISOString().slice(0, 10),
    zones,
  });
}
