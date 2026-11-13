// Accumulated state (plans/digital-twin/2-accumulated-state.md): a compact daily record of the live feeds, so the
// timeline runs from each archive's last year up to today and point-in-time layers gain a history.
//
//   npm run data history            # roll today's readings into public/data/history/<feed>/<YYYY-MM>.json
//   npm run data history-backfill   # also reach back as far as each feed allows (run once, then hourly)
//
// The files live on the `data-history` branch, not on main: .github/workflows/live.yml checks it out into
// public/data/history/ before this runs and its `archive` job commits the result back. Every step is safe to run twice
// in the same hour: rivers and air are recomputed for whole days from the feed itself, hotspots are de-duplicated by
// position and time, alerts and advisories are keyed, and a run hour is counted once.
//
// Days are Saskatchewan days (CST, UTC−6 all year). A missed run is a gap, never a zero: a day is only "covered" when
// readings or runs exist for it. Live readings here are provisional and are never joined to the official archives.

import fs from 'node:fs/promises';
import path from 'node:path';

const SK = 6 * 36e5;
/** 'YYYY-MM-DD' of the Saskatchewan day holding this instant (ms or ISO). */
export const skDay = (t) => new Date((typeof t === 'number' ? t : Date.parse(t)) - SK).toISOString().slice(0, 10);
const skHour = (ms) => new Date(ms - SK).getUTCHours();
const dayStart = (day) => Date.parse(`${day}T06:00:00Z`);
const addDays = (day, n) => skDay(dayStart(day) + n * 864e5 + 1);
/** Days from a to b inclusive. */
function daysBetween(a, b) { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; }
const FEW_RUNS = 12;
const ALERT_GAP_H = 6;

export async function history(h, { backfill = false } = {}) {
  const { log, fetchBuf, asJSON, OGC, BBOX, OUT, readOut, inSask, getProvince, round } = h;
  const DIR = path.join(OUT, 'history');
  const now = Date.now();
  const today = skDay(now);
  const yesterday = addDays(today, -1);
  const runAt = new Date(now).toISOString();

  // ---- month files
  const file = (feed, month) => path.join(DIR, feed, `${month}.json`);
  const memo = new Map(); // `${feed}/${month}` → { j, was } (`was`: the text as read, so unchanged files are not rewritten)
  async function month(feed, m, init) {
    const k = `${feed}/${m}`;
    if (memo.has(k)) return memo.get(k).j;
    let j, was = null;
    try { was = await fs.readFile(file(feed, m), 'utf8'); j = JSON.parse(was); } catch { j = { feed, month: m, ...init(), first: null, last: null, runs: {}, backfilled: [] }; }
    memo.set(k, { j, was: was ?? JSON.stringify(j) });
    return j;
  }
  /** Counts this run once in the month file of every day it touched (a run hour already counted is not counted again). */
  function stamp(j, days) {
    j.first ??= runAt;
    if (!j.last || runAt > j.last) j.last = runAt;
    for (const d of days) {
      if (d.slice(0, 7) !== j.month || d !== today) continue;
      const dd = d.slice(8);
      const hs = (j.runs[dd] ??= []);
      const hr = skHour(now);
      if (!hs.includes(hr)) { hs.push(hr); hs.sort((a, b) => a - b); }
    }
  }
  const markBackfill = (j, dd) => { if (!j.backfilled.includes(dd)) { j.backfilled.push(dd); j.backfilled.sort(); } };
  async function writeAll() {
    for (const { j, was } of memo.values()) {
      const text = JSON.stringify(j);
      if (text === was) continue;
      await fs.mkdir(path.join(DIR, j.feed), { recursive: true });
      await fs.writeFile(file(j.feed, j.month), text);
      log(`  wrote history/${j.feed}/${j.month}.json (${(text.length / 1024).toFixed(0)} KB)`);
    }
  }
  const OGL = { licence: 'Open Government Licence – Canada', licenceUrl: 'https://open.canada.ca/en/open-government-licence-canada' };
  const failures = [];
  const step = async (name, fn) => { try { await fn(); } catch (e) { failures.push(`${name}: ${e.message}`); log(`  ✖ ${name}: ${e.message}`); } };

  // ---- rivers: daily min, max and mean discharge per gauge, recomputed for whole days from the real-time feed
  await step('rivers', async () => {
    const { stations } = await readOut('rivers');
    const want = new Set(stations.map((s) => s.id));
    // the feed keeps ~30 days; a normal run redoes yesterday and today
    const from = backfill ? addDays(today, -29) : yesterday;
    const acc = new Map(); // `${id}|${day}` → {min, max, sum, n, flags}
    const PAGE = 10000;
    const iso = (ms) => `${new Date(ms).toISOString().slice(0, 19)}Z`;
    // one day at a time, so paging never reaches deep offsets (the service slows to a crawl past a few hundred thousand)
    for (const day of daysBetween(from, today)) for (let offset = 0; offset < 500_000; offset += PAGE) {
      const q = new URLSearchParams({
        f: 'json', limit: String(PAGE), offset: String(offset), PROV_TERR_STATE_LOC: 'SK', datetime: `${iso(dayStart(day))}/${iso(dayStart(day) + 864e5 - 1000)}`,
        skipGeometry: 'true', properties: 'STATION_NUMBER,DATETIME,DISCHARGE,DISCHARGE_SYMBOL_EN', sortby: 'DATETIME',
      });
      const page = asJSON(await fetchBuf(`${OGC}/hydrometric-realtime/items?${q}`, { timeout: 120_000 }), 'hydrometric-realtime');
      if (backfill && offset === 0) log(`    ${day}: ${page.numberMatched ?? '?'} readings`);
      for (const f of page.features ?? []) {
        const p = f.properties;
        if (!want.has(p.STATION_NUMBER) || p.DISCHARGE == null) continue;
        const k = `${p.STATION_NUMBER}|${skDay(p.DATETIME)}`;
        const a = acc.get(k) ?? { min: Infinity, max: -Infinity, sum: 0, n: 0, flag: null };
        acc.set(k, a);
        a.min = Math.min(a.min, p.DISCHARGE); a.max = Math.max(a.max, p.DISCHARGE); a.sum += p.DISCHARGE; a.n++;
        const s = p.DISCHARGE_SYMBOL_EN ?? '';
        if (/\bice\b|^B\b/i.test(s)) a.flag = 'ice'; else if (!a.flag && /estim|^E\b/i.test(s)) a.flag = 'est';
      }
      if ((page.features ?? []).length < PAGE) break;
    }
    const days = daysBetween(from, today);
    const r = (v) => round(v, v < 10 ? 3 : v < 100 ? 2 : 1);
    for (const day of days) {
      const j = await month('rivers', day.slice(0, 7), () => ({ source: 'Environment and Climate Change Canada, real-time hydrometric data (provisional), daily roll-up', ...OGL, unit: 'm³/s', row: '[day, min, max, mean, readings, flag]', stations: {} }));
      const dd = +day.slice(8);
      // the whole day is redone: drop its old rows, then add what the feed holds now (a gauge with none is a gap)
      for (const id of Object.keys(j.stations)) j.stations[id] = j.stations[id].filter((row) => row[0] !== dd);
      for (const id of want) {
        const a = acc.get(`${id}|${day}`);
        if (!a) continue;
        (j.stations[id] ??= []).push([dd, r(a.min), r(a.max), r(a.sum / a.n), a.n, a.flag]);
        j.stations[id].sort((x, y) => x[0] - y[0]);
      }
      for (const id of Object.keys(j.stations)) if (!j.stations[id].length) delete j.stations[id];
      if (backfill && day < yesterday) markBackfill(j, day.slice(8));
      stamp(j, [day]);
    }
    log(`  rivers: ${acc.size} gauge-days from ${from} to ${today}`);
  });

  // ---- air: each community's highest AQHI per day and the hours it reported, recomputed from the observations feed
  await step('air', async () => {
    await getProvince();
    const from = backfill ? addDays(today, -4) : yesterday;
    const box = `${BBOX.west - 1.5},${BBOX.south - 0.4},${BBOX.east + 1.3},${BBOX.north + 0.4}`;
    const feats = [];
    for (let offset = 0; offset < 200_000; offset += 10000) {
      const q = new URLSearchParams({ f: 'json', limit: '10000', offset: String(offset), bbox: box, datetime: `${new Date(dayStart(from)).toISOString().slice(0, 19)}Z/..` });
      const page = asJSON(await fetchBuf(`${OGC}/aqhi-observations-realtime/items?${q}`), 'aqhi-observations');
      feats.push(...(page.features ?? []));
      if ((page.features ?? []).length < 10000) break;
    }
    const acc = new Map(); // `${id}|${day}` → {max, hours:Set}
    const meta = {};
    for (const f of feats) {
      const p = f.properties;
      if (p.aqhi == null || !f.geometry) continue;
      const [lon, lat] = f.geometry.coordinates;
      meta[p.location_id] ??= { name: p.location_name_en, lon: round(lon), lat: round(lat), ...(inSask(lon, lat, 0.05) ? {} : { out: true }) };
      const k = `${p.location_id}|${skDay(p.observation_datetime)}`;
      const a = acc.get(k) ?? { max: -Infinity, hours: new Set() };
      acc.set(k, a);
      a.max = Math.max(a.max, p.aqhi);
      a.hours.add(p.observation_datetime.slice(0, 13));
    }
    for (const day of daysBetween(from, today)) {
      const j = await month('air', day.slice(0, 7), () => ({ source: 'Environment and Climate Change Canada, Air Quality Health Index observations, daily roll-up', ...OGL, row: '[day, highest AQHI, hours reported]', communities: {}, days: {} }));
      Object.assign(j.communities, meta);
      const dd = +day.slice(8);
      for (const id of Object.keys(j.days)) j.days[id] = j.days[id].filter((row) => row[0] !== dd);
      for (const id of Object.keys(meta)) {
        const a = acc.get(`${id}|${day}`);
        if (!a) continue;
        (j.days[id] ??= []).push([dd, round(a.max, 1), a.hours.size]);
        j.days[id].sort((x, y) => x[0] - y[0]);
      }
      for (const id of Object.keys(j.days)) if (!j.days[id].length) delete j.days[id];
      if (backfill && day < yesterday) markBackfill(j, day.slice(8));
      stamp(j, [day]);
    }
    log(`  air: ${acc.size} community-days from ${from} to ${today}`);
  });

  // ---- fires: every hotspot seen, by day, de-duplicated by position and time (the feed's ids are not stable)
  await step('fires', async () => {
    await getProvince();
    const init = () => ({ source: 'Natural Resources Canada, CWFIS satellite hotspots, by day (heat seen from space, not confirmed fires)', ...OGL, row: '[lon, lat, fire radiative power MW, minute of the day UTC−6]', days: {} });
    const seen = new Map(); // day → Set of `lon,lat,minute`
    const add = async (lon, lat, iso, frp) => {
      const ms = Date.parse(iso), day = skDay(ms);
      const j = await month('fires', day.slice(0, 7), init);
      const list = (j.days[day.slice(8)] ??= []);
      if (!seen.has(day)) seen.set(day, new Set(list.map((x) => `${x[0]},${x[1]},${x[3]}`)));
      const min = Math.round(((ms - SK) % 864e5) / 6e4);
      const row = [round(lon, 3), round(lat, 3), frp == null ? null : round(frp, 1), min];
      const key = `${row[0]},${row[1]},${row[3]}`;
      if (!seen.get(day).has(key)) { seen.get(day).add(key); list.push(row); }
      return j;
    };
    if (backfill) {
      // CWFIS keeps every season's hotspots; read this year's in Saskatchewan's box (WFS 2.0 paging, CRS:84 = lon, lat)
      const WFS = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs';
      const since = `${today.slice(0, 4)}-01-01`;
      const PAGE = 10000;
      let n = 0;
      for (let start = 0; start < 1_000_000; start += PAGE) {
        const q = new URLSearchParams({
          service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: 'public:hotspots', outputFormat: 'application/json', srsName: 'CRS:84',
          count: String(PAGE), startIndex: String(start), sortBy: 'rep_date', propertyName: 'rep_date,frp,geometry',
          CQL_FILTER: `rep_date >= '${since}' AND BBOX(geometry,${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north},'EPSG:4326')`,
        });
        const page = asJSON(await fetchBuf(`${WFS}?${q}`, { timeout: 300_000 }), 'public:hotspots');
        for (const f of page.features ?? []) {
          const [lon, lat] = f.geometry?.coordinates ?? [];
          if (!Number.isFinite(lon) || !inSask(lon, lat, 0.01)) continue;
          const j = await add(lon, lat, f.properties.rep_date, f.properties.frp);
          const dd = skDay(f.properties.rep_date).slice(8);
          if (skDay(f.properties.rep_date) < yesterday) markBackfill(j, dd);
          n++;
        }
        log(`    hotspots ${start + (page.features ?? []).length} of ${page.numberMatched ?? '?'} read`);
        if ((page.features ?? []).length < PAGE) break;
      }
      // a backfilled day with no hotspot is a day the archive covered, not a gap
      for (const day of daysBetween(since, yesterday)) { const j = await month('fires', day.slice(0, 7), init); j.days[day.slice(8)] ??= []; markBackfill(j, day.slice(8)); }
      log(`  fires: ${n} hotspots in Saskatchewan since ${since}`);
    }
    // the live file: hotspots of the 24 hours before it was read
    let live = null;
    try { live = JSON.parse(await fs.readFile(path.join(OUT, 'now', 'fires.json'), 'utf8')); } catch { /* no live file */ }
    if (!live) throw new Error('no public/data/now/fires.json: run npm run data now-fires first');
    for (const [lon, lat, iso, frp] of live.hotspots) await add(lon, lat, iso, frp);
    // the run covers the day it was read (and the day before, for its first hours); stamp today, and make sure today has a list
    const j = await month('fires', today.slice(0, 7), init);
    j.days[today.slice(8)] ??= [];
    stamp(j, [today]);
    log(`  fires: ${live.hotspots.length} hotspots in the live file merged`);
  });

  // ---- alerts: one row per alert, from first seen to last seen in effect
  await step('alerts', async () => {
    let live = null;
    try { live = JSON.parse(await fs.readFile(path.join(OUT, 'now', 'alerts.json'), 'utf8')); } catch { /* none */ }
    if (!live) throw new Error('no public/data/now/alerts.json: run npm run data now-alerts first');
    const init = () => ({ source: 'Environment and Climate Change Canada, public weather alerts, as seen by each run', ...OGL, alerts: [] });
    const thisM = await month('alerts', today.slice(0, 7), init);
    const prevM = await month('alerts', addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7), init);
    for (const a of live.alerts) {
      const key = `${a.code}|${a.type}|${[...a.places].sort().join(',')}|${a.areas.length}`;
      // the same alert continuing: same key, seen within the last few hours
      const open = [...thisM.alerts, ...prevM.alerts].find((x) => x.key === key && now - Date.parse(x.seen) <= ALERT_GAP_H * 36e5 + 6e4);
      if (open) {
        if (runAt > open.seen) open.seen = runAt;
        if (a.ends && (!open.ends || a.ends > open.ends)) open.ends = a.ends;
        continue;
      }
      const start = a.issued < runAt ? a.issued : runAt;
      const m = await month('alerts', skDay(start).slice(0, 7), init);
      m.alerts.push({ key, code: a.code, type: a.type, name: a.short ?? a.name, colour: a.colour, start, seen: runAt, ends: a.ends ?? null, areas: a.areas.length, places: a.places });
    }
    stamp(thisM, [today]);
    log(`  alerts: ${live.alerts.length} in effect merged`);
  });

  // ---- drinking water: one row per advisory per month, with the first and last day it was seen listed
  await step('water', async () => {
    const w = await readOut('water');
    const j = await month('water', today.slice(0, 7), () => ({ source: 'Water Security Agency, Saskatchewan Health Authority and Indigenous Services Canada advisory lists, as seen each day', licence: 'Crown copyright (Sask.), non-commercial; Government of Canada terms, non-commercial', advisories: [] }));
    const all = [...w.sites.map((s) => ({ ...s, placed: true })), ...w.unplaced.map((s) => ({ ...s, placed: false }))];
    for (const s of all) {
      const key = `${s.src}|${s.n}|${s.reg ?? ''}|${s.d ?? ''}`;
      const row = j.advisories.find((x) => x.key === key);
      if (row) { if (today > row.last) row.last = today; continue; }
      j.advisories.push({ key, n: s.n, src: s.src, k: s.k, d: s.d ?? null, reg: s.reg ?? null, ...(s.placed ? { lon: s.lon, lat: s.lat } : {}), first: today, last: today });
    }
    stamp(j, [today]);
    log(`  water: ${all.length} advisories listed today (list as of ${w.asOf})`);
  });

  await writeAll();

  // ---- index: what each history holds, for the app (fetched only when the timeline reaches it) and the sources view
  const index = { updated: runAt, fewRuns: FEW_RUNS, feeds: {} };
  for (const feed of ['rivers', 'air', 'fires', 'alerts', 'water']) {
    let months = [];
    try { months = (await fs.readdir(path.join(DIR, feed))).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 7)).sort(); } catch { continue; }
    if (!months.length) continue;
    const covered = new Set(), few = new Set();
    let first = null, last = null, bytes = 0;
    for (const m of months) {
      const raw = await fs.readFile(file(feed, m), 'utf8');
      bytes += raw.length;
      const j = JSON.parse(raw);
      // rivers and air are covered only where the feed held readings; the others wherever a run (or the backfill) looked
      const days = new Set(feed === 'rivers' || feed === 'air' ? [] : [...Object.keys(j.runs ?? {}), ...(j.backfilled ?? [])]);
      if (feed === 'rivers') for (const rows of Object.values(j.stations)) for (const r of rows) days.add(String(r[0]).padStart(2, '0'));
      if (feed === 'air') for (const rows of Object.values(j.days)) for (const r of rows) days.add(String(r[0]).padStart(2, '0'));
      for (const dd of days) {
        const day = `${m}-${dd}`;
        covered.add(day);
        if ((feed === 'fires' || feed === 'alerts' || feed === 'water') && !(j.backfilled ?? []).includes(dd) && (j.runs?.[dd]?.length ?? 0) < FEW_RUNS && day < today) few.add(day);
      }
    }
    const sorted = [...covered].sort();
    first = sorted[0] ?? null; last = sorted.at(-1) ?? null;
    const gaps = first ? daysBetween(first, last).filter((d) => !covered.has(d)) : [];
    index.feeds[feed] = { months, first, last, days: covered.size, gaps: gaps.length, gapDays: gaps.slice(-60), few: few.size, kb: Math.round(bytes / 1024) };
  }
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, 'index.json'), JSON.stringify(index));
  log(`  index: ${Object.entries(index.feeds).map(([k, v]) => `${k} ${v.first}→${v.last} (${v.days} days, ${v.gaps} gaps, ${v.kb} KB)`).join('; ')}`);
  if (failures.length) throw new Error(`history: ${failures.join('; ')}`);
}
