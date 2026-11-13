import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { BBOX, OGC } from '../lib/config.mjs';
import { asJSON, fetchBuf, log, pool, round, writeNow } from '../lib/io.mjs';
import { getPlaces, getProvince } from '../lib/places.mjs';

// Short-range outlooks (plans/digital-twin/3-forecasts-and-what-ifs.md, 3c): published forecasts at each place, each
// with the time it was issued and the time it is valid for. Thunderstorm outlook (MSC, May–October; none out of season),
// today's fire danger class (CWFIS, from the SCRIBE weather forecast) and tomorrow's highest wildfire-smoke PM2.5
// (ECCC's RAQDPS, which carries FireWork). AQHI forecasts come with `now-air`. A part that fails is left out, never zero.
export default async function nowOutlooks() {
  await getProvince();
  const places = await getPlaces();
  const fetched = new Date().toISOString();
  const inside = (geom, pl) => { try { return booleanPointInPolygon([pl.lon, pl.lat], geom); } catch { return false; } };
  const out = { asOf: fetched.slice(0, 16) + 'Z', fetched, sources: [] };

  // thunderstorm outlook: every outlook polygon in effect, and the places inside each
  try {
    const res = asJSON(await fetchBuf(`${OGC}/thunderstorm_outlook/items?${new URLSearchParams({ f: 'json', limit: '1000', bbox: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}` })}`), 'thunderstorm_outlook');
    const now = Date.now();
    const v = (o) => (o && typeof o === 'object' ? o.value ?? null : o ?? null);
    const items = (res.features ?? []).filter((f) => f.geometry && Date.parse(f.properties.expiration_datetime ?? f.properties.validity_datetime) > now).map((f) => {
      const p = f.properties, mo = p.metobject ?? {};
      return {
        issued: p.publication_datetime, valid: p.validity_datetime, expires: p.expiration_datetime ?? null,
        thunder: v(mo.thunderstorm), severity: v(mo.severity), risk: v(mo.risk_swo), tornado: v(mo.tornado_risk) === true || v(mo.tornado_risk) === 'true',
        hail: mo.hail?.value != null ? `${mo.hail.value} ${mo.hail.unit ?? ''}`.trim() : null, gust: mo.gust?.value != null ? `${mo.gust.value} ${mo.gust.unit ?? ''}`.trim() : null,
        places: places.filter((pl) => inside(f.geometry, pl)).map((pl) => pl.key),
      };
    }).filter((it) => it.places.length);
    out.thunder = { items };
    out.sources.push({ name: 'Thunderstorm outlook', by: 'Environment and Climate Change Canada (MSC GeoMet, experimental)', url: 'https://api.weather.gc.ca/collections/thunderstorm_outlook', licence: 'ECCC Data Servers End-use Licence' });
    log(`  thunderstorm outlook: ${items.length} area(s) covering a place`);
  } catch (e) { log(`  thunderstorm outlook failed: ${e.message}`); }

  // fire danger: CWFIS's "current" classes (0 low … 4 extreme), for the day its map service names
  try {
    const caps = (await fetchBuf('https://cwfis.cfs.nrcan.gc.ca/geoserver/public/fdr_current/wms?service=WMS&request=GetCapabilities&version=1.3.0', { timeout: 60_000 })).toString('utf8');
    const valid = caps.match(/<Title>[^<]*Fire Danger[^<]*?(\d{4}-\d{2}-\d{2})<\/Title>/)?.[1];
    if (!valid) throw new Error('no date in the fire danger layer title');
    const q = new URLSearchParams({ service: 'WFS', version: '1.0.0', request: 'GetFeature', typeName: 'public:fdr_current_shp', bbox: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north},EPSG:4326`, srsName: 'EPSG:4326', outputFormat: 'application/json' });
    const fc = asJSON(await fetchBuf(`https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs?${q}`, { timeout: 120_000 }), 'fdr_current');
    const towns = {};
    for (const pl of places) {
      const f = (fc.features ?? []).find((x) => x.geometry && inside(x.geometry, pl));
      if (f && f.properties.GRIDCODE >= 0 && f.properties.GRIDCODE <= 4) towns[pl.key] = f.properties.GRIDCODE;
    }
    out.fire = { valid, model: 'SCRIBE', towns };
    out.sources.push({ name: 'Fire danger', by: 'Natural Resources Canada, Canadian Wildland Fire Information System', url: 'https://cwfis.cfs.nrcan.gc.ca/maps/fw', licence: 'Open Government Licence – Canada' });
    log(`  fire danger for ${valid}: ${Object.keys(towns).length} places classed`);
  } catch (e) { log(`  fire danger failed: ${e.message}`); }

  // wildfire smoke: RAQDPS's daily highest surface PM2.5 from fire plumes, for the next day it covers
  try {
    const WMS = 'https://geo.weather.gc.ca/geomet';
    const LAYER = 'RAQDPS.Sfc_PM2.5-WildireSmokePlume-DMax'; // sic: ECCC's own spelling
    const caps = (await fetchBuf(`${WMS}?service=WMS&version=1.3.0&request=GetCapabilities&layer=${LAYER}`, { timeout: 60_000 })).toString('utf8');
    const times = caps.match(/<Dimension name="time"[^>]*>([^<]+)<\/Dimension>/)?.[1].split(',') ?? [];
    const ref = caps.match(/<Dimension name="reference_time"[^>]*default="([^"]+)"/)?.[1];
    const valid = times.find((t) => Date.parse(t) > Date.now());
    if (!valid || !ref) throw new Error('no forecast time in the smoke layer');
    const towns = {};
    await pool(places, 4, async (pl) => {
      const b = `${pl.lat - 0.05},${pl.lon - 0.05},${pl.lat + 0.05},${pl.lon + 0.05}`;
      const q = new URLSearchParams({ service: 'WMS', version: '1.3.0', request: 'GetFeatureInfo', layers: LAYER, query_layers: LAYER, crs: 'EPSG:4326', bbox: b, width: '3', height: '3', i: '1', j: '1', info_format: 'application/json', time: valid, dim_reference_time: ref });
      try {
        const r = asJSON(await fetchBuf(`${WMS}?${q}`, { timeout: 60_000 }), 'smoke GFI');
        const v = r.features?.[0]?.properties?.value;
        if (v != null && v >= 0 && v < 1) towns[pl.key] = round(v * 1e9, 1); // kg/m³ → µg/m³
      } catch { /* a place with no answer is left out */ }
    });
    out.smoke = { issued: ref, valid, towns };
    out.sources.push({ name: 'Wildfire smoke forecast', by: 'Environment and Climate Change Canada, RAQDPS (FireWork), MSC GeoMet', url: 'https://eccc-msc.github.io/open-data/msc-data/nwp_raqdps/readme_raqdps_en/', licence: 'ECCC Data Servers End-use Licence' });
    log(`  smoke forecast to ${valid} (run ${ref}): ${Object.keys(towns).length} places`);
  } catch (e) { log(`  smoke forecast failed: ${e.message}`); }

  if (!out.thunder && !out.fire && !out.smoke) throw new Error('no outlook could be read');
  await writeNow('outlooks', { ...out, source: out.sources.map((s) => s.by).join('; '), sourceUrl: 'https://api.weather.gc.ca', licence: 'ECCC Data Servers End-use Licence; Open Government Licence – Canada (CWFIS)' });
}
