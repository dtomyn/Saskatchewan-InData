import { OGC } from '../lib/config.mjs';
import { asJSON, fetchBuf, log, readOut, round, writeNow } from '../lib/io.mjs';

// ---- Right now: live readings, rebuilt hourly by .github/workflows/live.yml and never committed (public/data/now/ is
// in .gitignore). Nothing here is cached: each run reads the feeds as they are. `asOf` is the newest reading's time
// (for hotspots and alerts, which are lists of what is in effect, the moment the list was read).

// ECCC real-time hydrometric data: the latest level and discharge at each gauge in rivers.json, from the last 24 hours.
export default async function nowRivers() {
  const { stations } = await readOut('rivers');
  const want = new Map(stations.map((s) => [s.id, s]));
  const since = new Date(Date.now() - 864e5).toISOString().slice(0, 19) + 'Z';
  const PAGE = 10000;
  const best = new Map(); // station → newest row with a discharge, else newest row with a level
  for (let offset = 0; offset < 200_000; offset += PAGE) {
    const q = new URLSearchParams({
      f: 'json', limit: String(PAGE), offset: String(offset), PROV_TERR_STATE_LOC: 'SK', datetime: `${since}/..`, skipGeometry: 'true',
      properties: 'STATION_NUMBER,DATETIME,LEVEL,DISCHARGE,LEVEL_SYMBOL_EN,DISCHARGE_SYMBOL_EN', sortby: '-DATETIME',
    });
    const page = asJSON(await fetchBuf(`${OGC}/hydrometric-realtime/items?${q}`, { timeout: 120_000 }), 'hydrometric-realtime');
    for (const f of page.features ?? []) {
      const p = f.properties;
      if (!want.has(p.STATION_NUMBER) || (p.LEVEL == null && p.DISCHARGE == null)) continue;
      const prev = best.get(p.STATION_NUMBER);
      if (!prev || (prev.DISCHARGE == null && p.DISCHARGE != null)) best.set(p.STATION_NUMBER, p);
    }
    if ((page.features ?? []).length < PAGE) break;
  }
  // HYDAT's symbols: B ice conditions (backwater), E estimated, A partial day, D dry
  const flag = (...ss) => {
    const s = ss.filter(Boolean).join(' ');
    return /\bice\b|^B\b|\bB$/i.test(s) ? 'ice' : /estim|^E\b|\bE$/i.test(s) ? 'est' : /dry|^D\b/i.test(s) ? 'dry' : s ? 'other' : null;
  };
  const rows = [];
  for (const [id, p] of best) {
    const s = want.get(id);
    const q = p.DISCHARGE == null ? null : round(p.DISCHARGE, 3);
    // [id, time, level m, discharge m³/s, discharge ÷ the station's median annual peak, flag]
    rows.push([id, p.DATETIME.slice(0, 16) + 'Z', round(p.LEVEL, 3), q, q == null || !s.median ? null : round(q / s.median, 3), flag(p.LEVEL_SYMBOL_EN, p.DISCHARGE_SYMBOL_EN)]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  if (!rows.length) throw new Error('no real-time readings in the last 24 hours for any gauge in rivers.json');
  const asOf = rows.reduce((a, r) => (r[1] > a ? r[1] : a), rows[0][1]);
  log(`  ${rows.length} of ${stations.length} gauges reported in the last 24 h (${rows.filter((r) => r[3] != null).length} with discharge), newest ${asOf}`);
  await writeNow('rivers', {
    asOf, fetched: new Date().toISOString(),
    source: 'Environment and Climate Change Canada, real-time hydrometric data (provisional, api.weather.gc.ca)',
    sourceUrl: 'https://wateroffice.ec.gc.ca/', licence: 'Open Government Licence – Canada', licenceUrl: 'https://open.canada.ca/en/open-government-licence-canada',
    rows,
  });
}
