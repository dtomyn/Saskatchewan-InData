import { BBOX } from '../lib/config.mjs';
import { polys } from '../lib/geo.mjs';
import { asJSON, fetchBuf, log, round, writeNow } from '../lib/io.mjs';
import { getProvince, inSask } from '../lib/places.mjs';

// CWFIS satellite hotspots of the last 24 hours, and the perimeters it estimates from them (season to date; kept while heat
// was seen within 7 days).
export default async function nowFires() {
  await getProvince();
  const WFS = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs';
  // WFS 1.0.0 takes the box as lon,lat (2.0.0 with EPSG:4326 swaps the axes)
  const wfs = async (layer) => asJSON(await fetchBuf(`${WFS}?${new URLSearchParams({ service: 'WFS', version: '1.0.0', request: 'GetFeature', typeName: layer, outputFormat: 'application/json', srsName: 'EPSG:4326', bbox: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north},EPSG:4326` })}`, { timeout: 180_000 }), layer);
  const fetched = new Date().toISOString();
  const hs = await wfs('public:hotspots_last24hrs');
  const hotspots = [];
  for (const f of hs.features ?? []) {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lon) || !inSask(lon, lat, 0.01)) continue;
    const p = f.properties;
    // [lon, lat, time, fire radiative power MW, sensor]
    hotspots.push([round(lon, 3), round(lat, 3), String(p.rep_date).slice(0, 16) + 'Z', round(p.frp, 1), p.sensor ?? null]);
  }
  hotspots.sort((a, b) => (a[2] < b[2] ? -1 : 1));
  const KEEP_DAYS = 7;
  const m3 = await wfs('public:m3_polygons_current');
  const perimeters = [];
  for (const f of m3.features ?? []) {
    const p = f.properties;
    if (!f.geometry || !p.lastdate || Date.now() - Date.parse(p.lastdate) > KEEP_DAYS * 864e5) continue;
    const ps = polys(f.geometry, 0.002);
    if (!ps.some((poly) => poly[0].some(([x, y]) => inSask(x, y, 0.01)))) continue;
    perimeters.push({ first: p.firstdate.slice(0, 16) + 'Z', last: p.lastdate.slice(0, 16) + 'Z', ha: round(p.area, 0), n: p.hcount, polys: ps });
  }
  log(`  ${hotspots.length} hotspots in the last 24 h, ${perimeters.length} estimated perimeters with heat in the last ${KEEP_DAYS} days`);
  await writeNow('fires', {
    asOf: fetched, fetched, hours: 24, keepDays: KEEP_DAYS,
    source: 'Natural Resources Canada, Canadian Wildland Fire Information System: satellite hotspots (last 24 hours) and fire perimeters estimated from them (M3)',
    sourceUrl: 'https://cwfis.cfs.nrcan.gc.ca/maps/fm3', licence: 'Open Government Licence – Canada', licenceUrl: 'https://open.canada.ca/en/open-government-licence-canada',
    hotspots, perimeters,
  });
}
