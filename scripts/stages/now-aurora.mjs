import { asJSON, fetchBuf, log, writeNow } from '../lib/io.mjs';

// The aurora right now: NOAA SWPC's OVATION model, a short-range forecast of the chance
// of aurora overhead on a 1° grid of the whole globe, re-run every few minutes from the solar wind measured upstream of
// Earth. Kept: a window over western Canada wide enough to show the oval north of the province. Also the latest
// planetary Kp (a 3-hour observed index) and the Kp NOAA predicts for the coming day and a half. A Kp part that cannot
// be read is left out, never zero.
const SWPC = 'https://services.swpc.noaa.gov';
/** west, south, east, north in whole degrees: Saskatchewan with room for the oval over the territories */
const WIN = { w: -125, s: 44, e: -85, n: 75 };

export default async function nowAurora() {
  const fetched = new Date().toISOString();
  const j = asJSON(await fetchBuf(`${SWPC}/json/ovation_aurora_latest.json`, { timeout: 60_000 }), 'ovation_aurora_latest');
  const observed = j['Observation Time'], valid = j['Forecast Time'];
  if (!Number.isFinite(Date.parse(observed)) || !Number.isFinite(Date.parse(valid))) throw new Error('no observation or forecast time in the aurora file');
  if (!Array.isArray(j.coordinates) || j.coordinates.length < 60_000) throw new Error('the aurora grid is not the 1° global grid expected');

  // rows south to north, each west to east; the feed's longitudes run 0–359 east
  const nx = WIN.e - WIN.w + 1, ny = WIN.n - WIN.s + 1;
  const v = new Array(nx * ny).fill(null);
  for (const [lon360, lat, a] of j.coordinates) {
    const lon = lon360 > 180 ? lon360 - 360 : lon360;
    if (lon < WIN.w || lon > WIN.e || lat < WIN.s || lat > WIN.n || !Number.isInteger(lon) || !Number.isInteger(lat)) continue;
    v[(lat - WIN.s) * nx + (lon - WIN.w)] = Math.max(0, Math.min(100, Math.round(a)));
  }
  if (v.some((x) => x == null || Number.isNaN(x))) throw new Error('the aurora grid has holes over western Canada');
  log(`  aurora for ${valid} (solar wind seen ${observed}): highest ${Math.max(...v)} % in the window`);

  // planetary Kp: the newest finished 3-hour value. The product has been both rows of objects and a header row plus arrays.
  let kp = null;
  try {
    const rows = asJSON(await fetchBuf(`${SWPC}/products/noaa-planetary-k-index.json`, { timeout: 60_000 }), 'noaa-planetary-k-index');
    const last = rows.at(-1);
    const head = Array.isArray(rows[0]) ? rows[0] : null;
    const t = head ? last[head.indexOf('time_tag')] : last.time_tag;
    const raw = head ? last[head.indexOf('Kp')] : last.Kp;
    const k = raw == null || raw === '' ? NaN : Number(raw); // Number(null) is 0, a false quiet sky
    const iso = `${String(t).trim().replace(' ', 'T').slice(0, 19)}Z`;
    if (!Number.isFinite(k) || k < 0 || k > 9 || !Number.isFinite(Date.parse(iso))) throw new Error('no Kp value in the last row');
    kp = { t: iso, v: Math.round(k * 100) / 100, hours: 3 };
    log(`  planetary Kp ${kp.v} for the 3 h from ${kp.t}`);
  } catch (e) { log(`  planetary Kp failed: ${e.message}`); }

  // the Kp NOAA predicts for the 3-hour windows still to come, to about 36 hours out (left out when it cannot be read)
  let kpNext = null;
  try {
    const rows = asJSON(await fetchBuf(`${SWPC}/products/noaa-planetary-k-index-forecast.json`, { timeout: 60_000 }), 'noaa-planetary-k-index-forecast');
    const head = Array.isArray(rows[0]) ? rows[0] : null;
    const get = (r, k) => (head ? r[head.indexOf(k)] : r[k]);
    const now = Date.now();
    const out = [];
    for (const r of head ? rows.slice(1) : rows) {
      if (get(r, 'observed') !== 'predicted') continue;
      const raw = get(r, 'kp');
      const t = Date.parse(`${String(get(r, 'time_tag')).trim().replace(' ', 'T').slice(0, 19)}Z`), k = raw == null || raw === '' ? NaN : Number(raw);
      if (!Number.isFinite(t) || !Number.isFinite(k) || k < 0 || k > 9) continue;
      if (t + 3 * 36e5 > now && t < now + 36 * 36e5) out.push([new Date(t).toISOString(), Math.round(k * 100) / 100]);
    }
    if (!out.length) throw new Error('no predicted rows for the coming day');
    kpNext = { hours: 3, rows: out };
    log(`  Kp forecast: ${out.length} windows, up to Kp ${Math.max(...out.map((r) => r[1]))}`);
  } catch (e) { log(`  Kp forecast failed: ${e.message}`); }

  await writeNow('aurora', {
    asOf: new Date(observed).toISOString(), fetched,
    observed: new Date(observed).toISOString(), valid: new Date(valid).toISOString(),
    grid: { w: WIN.w, s: WIN.s, nx, ny, step: 1, v },
    ...(kp ? { kp } : {}),
    ...(kpNext ? { kpNext } : {}),
    source: 'NOAA Space Weather Prediction Center, OVATION aurora forecast, planetary K index and its forecast',
    sourceUrl: 'https://www.swpc.noaa.gov/products/aurora-30-minute-forecast',
    licence: 'Public domain (U.S. Government work)', licenceUrl: 'https://www.weather.gov/disclaimer',
  });
}
