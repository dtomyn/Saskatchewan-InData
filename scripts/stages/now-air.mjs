import { BBOX, OGC } from '../lib/config.mjs';
import { distKm } from '../lib/geo.mjs';
import { asJSON, fetchBuf, log, round, writeNow } from '../lib/io.mjs';
import { getPlaces, getProvince, inSask } from '../lib/places.mjs';

// ECCC AQHI: the latest hourly observation and the latest forecast's highest value for each community near Saskatchewan;
// each place borrows the nearest community within 150 km (the smoke layer's rule).
export default async function nowAir() {
  await getProvince();
  const places = await getPlaces();
  const REACH = 150;
  const box = `${BBOX.west - 1.5},${BBOX.south - 0.4},${BBOX.east + 1.3},${BBOX.north + 0.4}`;
  const obs = asJSON(await fetchBuf(`${OGC}/aqhi-observations-realtime/items?${new URLSearchParams({ f: 'json', limit: '1000', latest: 'true', bbox: box })}`), 'aqhi-observations');
  const now = Date.now();
  const fc = [];
  for (let offset = 0; offset < 50_000; offset += 10000) {
    const page = asJSON(await fetchBuf(`${OGC}/aqhi-forecasts-realtime/items?${new URLSearchParams({ f: 'json', limit: '10000', offset: String(offset), bbox: box })}`), 'aqhi-forecasts');
    fc.push(...(page.features ?? []));
    if ((page.features ?? []).length < 10000) break;
  }
  // each location's newest forecast, and its highest hourly value from now on
  const pub = new Map();
  for (const f of fc) { const p = f.properties; if (!pub.has(p.location_id) || p.publication_datetime > pub.get(p.location_id)) pub.set(p.location_id, p.publication_datetime); }
  const fmax = new Map();
  for (const f of fc) {
    const p = f.properties;
    if (p.publication_datetime !== pub.get(p.location_id) || p.aqhi == null || Date.parse(p.forecast_datetime) < now - 36e5) continue;
    const m = fmax.get(p.location_id);
    if (!m || p.aqhi > m.v) fmax.set(p.location_id, { v: p.aqhi, t: p.forecast_datetime, last: m?.last ?? p.forecast_datetime });
    const mm = fmax.get(p.location_id);
    if (p.forecast_datetime > mm.last) mm.last = p.forecast_datetime;
  }
  const all = (obs.features ?? []).filter((f) => f.geometry && f.properties.aqhi != null).map((f) => {
    const p = f.properties, [lon, lat] = f.geometry.coordinates, m = fmax.get(p.location_id);
    return {
      id: p.location_id, name: p.location_name_en, lon: round(lon), lat: round(lat), sk: inSask(lon, lat, 0.05),
      t: p.observation_datetime.slice(0, 16) + 'Z', v: round(p.aqhi, 1),
      ...(m ? { fv: round(m.v, 1), ft: m.t.slice(0, 16) + 'Z', fto: m.last.slice(0, 16) + 'Z', pub: pub.get(p.location_id).slice(0, 16) + 'Z' } : {}),
    };
  });
  // a place's community: the nearest within REACH; communities outside Saskatchewan stay only if some place borrows them
  const nearest = (pl) => {
    let b = null;
    for (const c of all) { const d = distKm(pl.lon, pl.lat, c.lon, c.lat); if (d <= REACH && (!b || d < b.d)) b = { c, d }; }
    return b;
  };
  const picks = places.map((pl) => [pl.key, nearest(pl)]);
  const used = new Set(picks.filter(([, b]) => b).map(([, b]) => b.c));
  const communities = all.filter((c) => c.sk || used.has(c)).sort((a, b) => b.lat - a.lat);
  const towns = Object.fromEntries(picks.filter(([, b]) => b).map(([k, b]) => [k, [communities.indexOf(b.c), round(b.d, 0)]]));
  if (!communities.length) throw new Error('no AQHI observations near Saskatchewan');
  const asOf = communities.reduce((a, c) => (c.t > a ? c.t : a), communities[0].t);
  log(`  ${communities.length} AQHI communities (${communities.filter((c) => c.sk).length} in Saskatchewan), ${Object.keys(towns).length} of ${places.length} places within ${REACH} km of one`);
  await writeNow('air', {
    asOf, fetched: new Date().toISOString(), reachKm: REACH,
    source: 'Environment and Climate Change Canada, Air Quality Health Index: real-time observations and forecasts (api.weather.gc.ca)',
    sourceUrl: 'https://weather.gc.ca/airquality/pages/provincial_summary/sk_e.html', licence: 'Open Government Licence – Canada', licenceUrl: 'https://open.canada.ca/en/open-government-licence-canada',
    communities: communities.map(({ sk, ...c }) => ({ ...c, ...(sk ? {} : { out: true }) })), towns,
  });
}
