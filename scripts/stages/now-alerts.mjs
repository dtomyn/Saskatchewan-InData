import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { BBOX, OGC } from '../lib/config.mjs';
import { polys } from '../lib/geo.mjs';
import { asJSON, fetchBuf, log, writeNow } from '../lib/io.mjs';
import { getPlaces } from '../lib/places.mjs';

// ECCC public weather alerts in effect whose area is in Saskatchewan: one row per alert, with every forecast region it
// covers (simplified outlines) and the atlas's places inside them.
export default async function nowAlerts() {
  const places = await getPlaces();
  const fetched = new Date().toISOString();
  const res = asJSON(await fetchBuf(`${OGC}/weather-alerts/items?${new URLSearchParams({ f: 'json', limit: '10000', bbox: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}` })}`), 'weather-alerts');
  const now = Date.now();
  const groups = new Map();
  for (const f of res.features ?? []) {
    const p = f.properties;
    if (!/\bSK\b/.test(p.province ?? '') || /ended|cancel/i.test(p.status_en ?? '') || !f.geometry) continue;
    if (p.expiration_datetime && Date.parse(p.expiration_datetime) < now) continue;
    const key = `${p.alert_code}|${p.alert_type}|${p.alert_text_en}`;
    const g = groups.get(key) ?? {
      code: p.alert_code, type: p.alert_type, name: p.alert_name_en, short: p.alert_short_name_en, colour: p.risk_colour_en ?? null,
      status: p.status_en ?? null, issued: p.publication_datetime, ends: p.event_end_datetime ?? null, expires: p.expiration_datetime ?? null,
      text: (p.alert_text_en ?? '').trim(), areas: [], places: new Set(), polys: [],
    };
    groups.set(key, g);
    if (p.publication_datetime > g.issued) g.issued = p.publication_datetime;
    if (p.event_end_datetime && (!g.ends || p.event_end_datetime > g.ends)) g.ends = p.event_end_datetime;
    if (!g.areas.includes(p.feature_name_en)) g.areas.push(p.feature_name_en);
    for (const pl of places) if (booleanPointInPolygon([pl.lon, pl.lat], f)) g.places.add(pl.key);
    g.polys.push(...polys(f.geometry, 0.01, 3));
  }
  const ORDER = { warning: 0, watch: 1, advisory: 2, statement: 3 };
  const alerts = [...groups.values()]
    .map((g) => ({ ...g, places: [...g.places].sort() }))
    .sort((a, b) => (ORDER[a.type] ?? 9) - (ORDER[b.type] ?? 9) || (a.issued < b.issued ? 1 : -1));
  log(`  ${alerts.length} alerts in effect over Saskatchewan (${alerts.map((a) => a.short ?? a.name).join(', ') || 'none'})`);
  await writeNow('alerts', {
    asOf: fetched, fetched,
    source: 'Environment and Climate Change Canada, public weather alerts (api.weather.gc.ca)',
    sourceUrl: 'https://weather.gc.ca/?province=sk', licence: 'Open Government Licence – Canada', licenceUrl: 'https://open.canada.ca/en/open-government-licence-canada',
    alerts,
  });
}
