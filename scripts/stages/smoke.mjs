import fs from 'node:fs/promises';
import path from 'node:path';
import { CACHE, UA } from '../lib/config.mjs';
import { asJSON, fetchBuf, log, pool, round, writeOut } from '../lib/io.mjs';
import { getProvince, inSask } from '../lib/places.mjs';

// ECCC National Air Pollution Surveillance (NAPS): hourly PM2.5, one CSV per year for all of Canada (~10 MB).
// Each file is streamed and only its Saskatchewan rows are cached. A smoke day is a calendar day (local
// standard time) whose 24-hour mean PM2.5 is above 25 µg/m³ (the WHO 2005 24-hour guideline; Canada's
// 2020 CAAQS is 27). A day needs 18 of 24 valid hours (75 %), and a station-year counts only with 75 % of
// its days valid overall and 75 % of its May–September (wildfire season) days valid.
export default async function smoke() {
  const API = 'https://data-donnees.az.ec.gc.ca/api';
  const DIR = '/air/monitor/national-air-pollution-surveillance-naps-program/Data-Donnees';
  await getProvince();
  const LIMIT = 25, MIN_HOURS = 18, MIN_SHARE = 0.75, FIRST = 2000;
  const list = async (p) => asJSON(await fetchBuf(`${API}/path_contents?path=${encodeURIComponent(p)}`), p).path_contents ?? [];
  const years = (await list(DIR)).filter((c) => c.is_directory && /^\d{4}$/.test(c.name) && +c.name >= FIRST).map((c) => +c.name);
  // only years with a published hourly PM2.5 file (the current year has none yet)
  const files = (await pool(years, 4, async (y) => {
    const hp = `${DIR}/${y}/ContinuousData-DonneesContinu/HourlyData-DonneesHoraires`;
    const f = (await list(hp).catch(() => [])).find((c) => /^PM25_\d{4}\.csv$/i.test(c.name));
    return f ? { y, path: `${hp}/${f.name}` } : null;
  })).filter(Boolean);
  log(`  ${files.length} yearly PM2.5 files (${files[0]?.y}–${files.at(-1)?.y})`);

  const skRows = async ({ y, path: p }) => {
    const file = path.join(CACHE, 'naps', `PM25_${y}_SK.csv`);
    try { return (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean); } catch { /* not cached */ }
    log(`  streaming PM25_${y}.csv …`);
    const res = await fetch(`${API}/file?path=${encodeURIComponent(p)}`, { headers: UA, signal: AbortSignal.timeout(600_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for NAPS PM25_${y}`);
    const dec = new TextDecoder();
    const keep = [];
    let rest = '';
    const take = (l) => { if (l.startsWith('PM2.5,') && l.split(',')[4] === 'SK') keep.push(l.replace(/\r$/, '')); };
    for await (const chunk of res.body) {
      const lines = (rest + dec.decode(chunk, { stream: true })).split('\n');
      rest = lines.pop();
      lines.forEach(take);
    }
    take(rest + dec.decode());
    // an empty year (Saskatchewan not yet submitted) is not cached, so a later run picks it up
    if (keep.length) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, keep.join('\n') + '\n');
    }
    return keep;
  };

  const sites = new Map(); // one site per city: Regina's station moved (080110 → 080111) but is the same record
  const smokeSeason = (d) => d.slice(5, 7) >= '05' && d.slice(5, 7) <= '09';
  for (const f of files) {
    const rows = await skRows(f);
    // station → method → date → 24 hourly values (null = missing)
    const byStation = new Map();
    for (const l of rows) {
      const c = l.split(',');
      const [, method, id, city, , lat, lon, date] = c;
      if (!date?.startsWith(String(f.y))) continue;
      const st = byStation.get(id) ?? { id, city: city.trim(), lat: +lat, lon: +lon, methods: new Map() };
      byStation.set(id, st);
      const m = st.methods.get(method) ?? new Map();
      st.methods.set(method, m);
      m.set(date, c.slice(8, 32).map((v) => { const n = +v; return v === '' || Number.isNaN(n) || n <= -999 ? null : n; }));
    }
    const leap = (f.y % 4 === 0 && f.y % 100 !== 0) || f.y % 400 === 0;
    const nDays = leap ? 366 : 365, nSeason = 153;
    for (const st of byStation.values()) {
      // where instruments overlap, each hour comes from the method with the most valid hours that year
      const methods = [...st.methods.values()].sort((a, b) => count(b) - count(a));
      function count(m) { let n = 0; for (const h of m.values()) for (const v of h) if (v != null) n++; return n; }
      const dates = new Set(methods.flatMap((m) => [...m.keys()]));
      let valid = 0, validSeason = 0, smoke = 0, peak = null, peakDate = null;
      const months = new Array(12).fill(0);
      for (const d of dates) {
        let s = 0, n = 0;
        for (let h = 0; h < 24; h++) {
          const v = methods.map((m) => m.get(d)?.[h]).find((x) => x != null);
          if (v != null) { s += v; n++; }
        }
        if (n < MIN_HOURS) continue;
        valid++;
        if (smokeSeason(d)) validSeason++;
        const mean = s / n;
        if (peak == null || mean > peak) { peak = mean; peakDate = d; }
        if (mean > LIMIT) { smoke++; months[+d.slice(5, 7) - 1]++; }
      }
      if (valid < MIN_SHARE * nDays || validSeason < MIN_SHARE * nSeason) continue;
      const key = st.city.toLowerCase();
      const site = sites.get(key) ?? { name: st.city, ids: [], lon: st.lon, lat: st.lat, last: 0, days: {}, valid: {}, peak: {}, peakDate: {}, months: new Array(12).fill(0) };
      sites.set(key, site);
      if (!site.ids.includes(st.id)) site.ids.push(st.id);
      if (f.y >= site.last) { site.last = f.y; site.lon = round(st.lon); site.lat = round(st.lat); }
      // two stations in one city in the same year: keep the one with more valid days
      if (site.valid[f.y] != null && site.valid[f.y] >= valid) continue;
      if (site.days[f.y] != null) for (let i = 0; i < 12; i++) site.months[i] -= site.monthsBy?.[f.y]?.[i] ?? 0;
      site.days[f.y] = smoke; site.valid[f.y] = valid; site.peak[f.y] = round(peak, 1); site.peakDate[f.y] = peakDate;
      (site.monthsBy ??= {})[f.y] = months;
      for (let i = 0; i < 12; i++) site.months[i] += months[i];
    }
  }
  const stations = [...sites.values()]
    .map(({ last, monthsBy, ...s }) => s)
    .filter((s) => inSask(s.lon, s.lat, 0.05) && Object.keys(s.days).length)
    .sort((a, b) => b.lat - a.lat);
  log(`  ${stations.length} stations, ${stations.reduce((a, s) => a + Object.keys(s.days).length, 0)} station-years`);
  if (!stations.length) throw new Error('no Saskatchewan PM2.5 station-years passed the completeness rules');
  await writeOut('smoke', {
    source: 'Environment and Climate Change Canada, National Air Pollution Surveillance (NAPS) program, hourly PM2.5 (data-donnees.az.ec.gc.ca)',
    sourceUrl: 'https://data-donnees.az.ec.gc.ca/data/air/monitor/national-air-pollution-surveillance-naps-program/',
    licence: 'Open Government Licence – Canada', licenceUrl: 'https://open.canada.ca/en/open-government-licence-canada',
    limit: LIMIT, minHours: MIN_HOURS, minShare: MIN_SHARE,
    filesTo: files.at(-1)?.y ?? null,
    stations,
  });
}
