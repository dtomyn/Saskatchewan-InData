#!/usr/bin/env node
// Living Skies Atlas data pipeline.
// Pulls open data for Saskatchewan from public government APIs (and OpenStreetMap), clips it to the
// province, and writes compact JSON files to public/data/ for the static web app.
//
//   node scripts/fetch-data.mjs                 # all stages
//   node scripts/fetch-data.mjs fires crime     # selected stages
//
// Raw downloads are cached in .cache/ so re-runs are quick. Delete it to force a refresh.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { PLACES_LIST, PLACE_KEYS, normalizeName } from './places.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data');
const CACHE = path.join(ROOT, '.cache');

// Saskatchewan (lon/lat), with a little slack.
const BBOX = { west: -110.1, south: 48.9, east: -101.3, north: 60.1 };
const OGC = 'https://api.weather.gc.ca/collections';
const OSRM = 'https://router.project-osrm.org';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const UA = { 'User-Agent': 'LivingSkiesAtlas/0.1 (open-data atlas build script)' };

// ---------------------------------------------------------------------------------------------
// helpers

const log = (...a) => console.log('·', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v, d = 4) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/** Great-circle distance in km. */
function distKm(aLon, aLat, bLon, bLat) {
  const r = Math.PI / 180;
  const s = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

async function cached(name, producer) {
  const file = path.join(CACHE, name);
  try {
    return await fs.readFile(file);
  } catch {
    const buf = await producer();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buf);
    return buf;
  }
}

async function fetchBuf(url, { retries = 3, timeout = 180_000, method, body, headers } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { method, body, headers: { ...UA, ...(headers ?? {}) }, signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url.slice(0, 140)}`), { status: res.status });
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= retries) throw e;
      await sleep((e.status === 429 ? 10000 : 1500) * attempt);
    }
  }
}

/** Parses JSON and refuses HTML error pages, so a bad answer is never cached. */
const asJSON = (buf, what) => {
  const s = buf.toString('utf8');
  if (/^\s*</.test(s)) throw new Error(`${what}: got HTML, not JSON`);
  return JSON.parse(s);
};
const cachedJSON = async (name, url, opts) => asJSON(await cached(name, async () => { const b = await fetchBuf(url, opts); asJSON(b, name); return b; }), name);

async function writeOut(name, data) {
  await fs.mkdir(OUT, { recursive: true });
  const text = JSON.stringify(data);
  await fs.writeFile(path.join(OUT, `${name}.json`), text);
  log(`wrote ${name}.json (${(text.length / 1024).toFixed(0)} KB)`);
}
const readOut = async (name) => JSON.parse(await fs.readFile(path.join(OUT, `${name}.json`), 'utf8'));

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

/** Page through an MSC GeoMet OGC API collection. */
async function ogcAll(collection, params, cacheKey) {
  const features = [];
  const limit = 10000;
  for (let offset = 0; ; offset += limit) {
    const q = new URLSearchParams({ f: 'json', limit: String(limit), offset: String(offset), ...params });
    const page = await cachedJSON(`ogc/${cacheKey}-${offset}.json`, `${OGC}/${collection}/items?${q}`);
    features.push(...page.features);
    if (page.features.length < limit) break;
  }
  return features;
}

/** Page through an ArcGIS REST layer's query endpoint as GeoJSON. */
async function arcgisAll(layerUrl, params, cacheKey, pageSize = 1000) {
  const features = [];
  for (let offset = 0; ; offset += pageSize) {
    const q = new URLSearchParams({ f: 'geojson', outSR: '4326', resultOffset: String(offset), resultRecordCount: String(pageSize), ...params });
    const page = await cachedJSON(`arcgis/${cacheKey}-${offset}.json`, `${layerUrl}/query?${q}`, { timeout: 300_000 });
    if (!Array.isArray(page.features)) throw new Error(`${cacheKey}: ${JSON.stringify(page.error ?? page).slice(0, 200)}`);
    features.push(...page.features);
    if (page.features.length < pageSize && !page.properties?.exceededTransferLimit && !page.exceededTransferLimit) break;
  }
  return features;
}

/** An Overpass query: tries each mirror (POST, then GET) and caches the answer once it is real, complete JSON. */
async function overpass(cacheFile, query) {
  return asJSON(await cached(`osm/${cacheFile}`, async () => {
    let last;
    for (let r = 0; r < 4; r++)
      for (const url of OVERPASS) {
        try {
          const buf = r % 2
            ? await fetchBuf(`${url}?data=${encodeURIComponent(query)}`, { retries: 1, timeout: 300_000 })
            : await fetchBuf(url, { method: 'POST', body: new URLSearchParams({ data: query }), retries: 1, timeout: 300_000 });
          let j;
          try { j = JSON.parse(buf.toString('utf8')); } catch { throw new Error('busy (not JSON)'); }
          if (!Array.isArray(j.elements) || /runtime error|timed out|out of memory/i.test(j.remark ?? '')) throw new Error(`busy (${j.remark ?? 'no elements'})`);
          return buf;
        } catch (e) { last = e; log(`  overpass ${cacheFile}: ${e.message}, trying again`); await sleep(8000); }
      }
    throw last;
  }), cacheFile);
}

const parseCSVLine = (l) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')).slice(0, -1);
const parseCSV = (text) => {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const h = parseCSVLine(lines[0]).map((x) => x.trim());
  return lines.slice(1).map((l) => Object.fromEntries(parseCSVLine(l).map((v, i) => [h[i], v.trim()])));
};

const fracYear = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return null;
  const y = d.getUTCFullYear();
  return y + (d - Date.UTC(y, 0, 1)) / (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1));
};
const ymdFrac = (y, m, d) => (m ? fracYear(`${y}-${String(m).padStart(2, '0')}-${String(d || 15).padStart(2, '0')}T12:00:00Z`) : y + 0.55);

/** Douglas–Peucker on a lon/lat ring, tolerance in degrees. */
function dp(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-12;
    let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
/** Douglas–Peucker for a closed ring: split at the point farthest from the start so neither half is degenerate. */
function dpRing(ring, tol) {
  if (ring.length < 5) return ring;
  let k = 1, bd = -1;
  for (let i = 1; i < ring.length - 1; i++) { const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (d > bd) { bd = d; k = i; } }
  const a = dp(ring.slice(0, k + 1), tol), b = dp(ring.slice(k), tol);
  return [...a, ...b.slice(1)];
}
/** Simplifies and rounds a GeoJSON Polygon/MultiPolygon to an array of polygons (rings of [lon, lat]). */
function polys(geom, tol, d = 4) {
  const ps = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return ps.map((p) => p.map((ring) => dpRing(ring, tol).map(([x, y]) => [round(x, d), round(y, d)])).filter((r) => r.length >= 4)).filter((p) => p.length);
}

// ---------------------------------------------------------------------------------------------
// the province outline: used for clipping and for the glowing border in the app

let outline;
async function getProvince() {
  if (outline) return outline;
  const fc = await cachedJSON('statcan/province-47.json', `https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/0/query?${new URLSearchParams({ where: "PRUID='47'", outFields: 'PRUID,PRENAME', outSR: '4326', f: 'geojson', maxAllowableOffset: '0.002' })}`, { timeout: 300_000 });
  const g = fc.features?.[0]?.geometry;
  if (!g) throw new Error('province outline missing from the StatCan boundary service');
  const display = polys(g, 0.004);
  const clip = polys(g, 0.02, 3).filter((p) => Math.abs(ringArea(p[0])) > 0.05);
  const clipFeature = { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: clip } };
  outline = { display, clipFeature };
  return outline;
}
function ringArea(r) { let s = 0; for (let i = 1; i < r.length; i++) s += (r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1]); return s / 2; }

/** Inside Saskatchewan (or within ~`tol` degrees of its border). */
function inSask(lon, lat, tol = 0) {
  if (lon < BBOX.west || lon > BBOX.east || lat < BBOX.south || lat > BBOX.north) return false;
  const f = outline.clipFeature;
  if (booleanPointInPolygon([lon, lat], f)) return true;
  if (!tol) return false;
  for (const [dx, dy] of [[tol, 0], [-tol, 0], [0, tol], [0, -tol]]) if (booleanPointInPolygon([lon + dx, lat + dy], f)) return true;
  return false;
}

/** The atlas's places, with coordinates (from the `places` stage's output). */
let placesMemo;
async function getPlaces() {
  if (!placesMemo) placesMemo = await readOut('municipalities');
  return placesMemo;
}

// ---------------------------------------------------------------------------------------------
// drive times (OSRM demo server): one `table` call ranks candidates, then one `route` per kept trip

async function osrm(name, url) {
  return asJSON(await cached(`osrm/${name}.json`, async () => {
    await sleep(1100); // the public demo server asks for at most one request a second
    return fetchBuf(url, { timeout: 60_000 });
  }), name);
}

/**
 * For every place, the fastest few `targets` by road: [{ f: target index, min, km, line }]. Candidates are the
 * `pre` nearest in a straight line; only the best `keep` get a routed line. Falls back to straight lines.
 */
async function driveTimes(places, targets, tag, { pre = 6, keep = 2 } = {}) {
  const out = {};
  let routed = true;
  for (const p of places) {
    const near = targets.map((t, j) => ({ j, d: distKm(p.lon, p.lat, t.lon, t.lat) })).sort((a, b) => a.d - b.d).slice(0, pre);
    let cand = near.map((c) => ({ f: c.j, min: null, km: round(c.d, 1) }));
    if (routed) {
      try {
        const coords = [p, ...near.map((c) => targets[c.j])].map((x) => `${x.lon},${x.lat}`).join(';');
        const tb = await osrm(`${tag}-table-${p.key.replace(/ /g, '_')}-${near.map((c) => c.j).join('_')}`, `${OSRM}/table/v1/driving/${coords}?sources=0&annotations=duration,distance`);
        if (tb.code !== 'Ok') throw new Error(tb.message ?? tb.code);
        cand = near.map((c, i) => ({ f: c.j, min: tb.durations[0][i + 1] == null ? null : tb.durations[0][i + 1] / 60, km: tb.distances[0][i + 1] == null ? null : tb.distances[0][i + 1] / 1000 }))
          .filter((c) => c.min != null)
          .sort((a, b) => a.min - b.min);
        if (!cand.length) cand = near.map((c) => ({ f: c.j, min: null, km: round(c.d, 1) }));
      } catch (e) {
        log(`  OSRM unavailable (${e.message}); straight-line distances from here on`);
        routed = false;
      }
    }
    const trips = [];
    for (const c of cand.slice(0, keep)) {
      const t = targets[c.f];
      const trip = { f: c.f, min: c.min == null ? null : Math.round(c.min), km: round(c.km, 1) };
      if (routed && c.min != null) {
        try {
          const r = await osrm(`${tag}-route-${p.key.replace(/ /g, '_')}-${t.lon},${t.lat}`, `${OSRM}/route/v1/driving/${p.lon},${p.lat};${t.lon},${t.lat}?overview=simplified&geometries=geojson`);
          const rt = r.routes?.[0];
          if (rt) {
            trip.min = Math.round(rt.duration / 60);
            trip.km = round(rt.distance / 1000, 1);
            const line = [];
            for (const [x, y] of rt.geometry.coordinates) {
              const q = [round(x, 3), round(y, 3)];
              if (!line.length || q[0] !== line.at(-1)[0] || q[1] !== line.at(-1)[1]) line.push(q);
            }
            trip.line = line;
          }
        } catch (e) { log(`  route ${p.name} -> ${t.name ?? tag} failed: ${e.message}`); }
      }
      trips.push(trip);
    }
    out[p.key] = trips;
  }
  return { towns: out, routed };
}

// ---------------------------------------------------------------------------------------------

const SOURCES = {
  // Statistics Canada 2021 cartographic boundary file: Saskatchewan's outline.
  async province() {
    const { display } = await getProvince();
    await writeOut('province', { type: 'Feature', properties: { name: 'Saskatchewan' }, geometry: { type: 'MultiPolygon', coordinates: display } });
  },

  // The place list (scripts/places.mjs), located with the Canadian Geographical Names Database.
  async places() {
    await getProvince();
    const KINDS = ['CITY', 'TOWN', 'VILG', 'NV', 'UNP', 'HAM', 'MUN1', 'MUN2'];
    const out = [];
    for (const p of PLACES_LIST) {
      const q = p.geo ?? p.name;
      const res = await cachedJSON(`cgndb/${normalizeName(q).replace(/ /g, '_')}.json`, `https://geogratis.gc.ca/services/geoname/en/geonames.json?${new URLSearchParams({ q, province: '47' })}`);
      const want = normalizeName(q);
      const hits = (res.items ?? []).filter((i) => normalizeName(i.name) === want && KINDS.includes(i.concise?.code));
      hits.sort((a, b) => KINDS.indexOf(a.concise.code) - KINDS.indexOf(b.concise.code));
      const h = hits[0];
      if (!h) { log(`  ✖ ${p.name}: no populated place in the CGNDB`); continue; }
      const lon = round(h.longitude), lat = round(h.latitude);
      if (!inSask(lon, lat, 0.05)) { log(`  ✖ ${p.name}: located outside Saskatchewan (${lon}, ${lat})`); continue; }
      const kind = { CITY: 'City', TOWN: 'Town', VILG: 'Village', NV: 'Northern village' }[h.concise.code] ?? 'Community';
      // a coarse region from latitude: the populated south, the parkland centre, the boreal north
      const rd = lat >= 54.3 ? 'North' : lat >= 51.6 ? 'Central' : 'South';
      out.push({ key: normalizeName(p.name), name: p.name, rd, kind, lon, lat, cgndb: h.id });
    }
    log(`  ${out.length} of ${PLACES_LIST.length} places located`);
    placesMemo = out;
    await writeOut('municipalities', out);
  },

  // Canadian National Fire Database (CWFIS, Natural Resources Canada): every reported fire's start point.
  async fires() {
    await getProvince();
    const zip = await cached('raw/nfdb-points.zip', () => fetchBuf('https://cwfis.cfs.nrcan.gc.ca/downloads/nfdb/fire_pnt/current_version/NFDB_point_txt.zip', { timeout: 600_000 }));
    const files = unzipSync(new Uint8Array(zip), { filter: (f) => /\.txt$/i.test(f.name) });
    const name = Object.keys(files)[0];
    const lines = strFromU8(files[name]).replace(/^﻿/, '').split(/\r?\n/);
    const h = lines[0].split(',');
    const I = (k) => h.indexOf(k);
    const iLat = I('LATITUDE'), iLon = I('LONGITUDE'), iY = I('YEAR'), iM = I('MONTH'), iD = I('DAY'), iHa = I('SIZE_HA'), iC = I('CAUSE'), iAg = I('SRC_AGENCY'), iT = I('FIRE_TYPE'), iName = I('FIRENAME');
    // CNFDB causes: N natural (lightning), H human, H-PB prescribed burn, U unknown, RE reburn
    const cause = (c) => (c === 'N' || c === 'L' ? 0 : /^H/.test(c) ? 1 : 2);
    const points = [];
    let skipped = 0;
    for (const line of lines.slice(1)) {
      if (!line) continue;
      const c = line.split(',');
      if (c[iAg] !== 'SK' && c[iAg] !== 'PC') continue;
      const lon = +c[iLon], lat = +c[iLat], y = +c[iY];
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || !(y >= 1900) || !inSask(lon, lat, 0.01)) { skipped++; continue; }
      if ((c[iT] && /prescribed/i.test(c[iT])) || c[iC] === 'H-PB' || c[iC] === 'RE') continue;
      const ha = Math.max(0, +c[iHa] || 0);
      // compact row: lon, lat, time (fractional year), hectares, cause (0 lightning, 1 human, 2 unknown)
      points.push([round(lon, 3), round(lat, 3), round(ymdFrac(y, +c[iM], +c[iD]), 3), round(ha, 1), cause(c[iC])]);
      const nm = c[iName]?.trim();
      if (ha >= 20000 && nm) points.at(-1).push(nm);
    }
    points.sort((a, b) => a[2] - b[2]);
    log(`  ${points.length} Saskatchewan fires (${skipped} rows off the map or undated), ${points[0]?.[2] | 0}–${points.at(-1)?.[2] | 0}`);
    await writeOut('fires', { source: 'Natural Resources Canada, Canadian Wildland Fire Information System: Canadian National Fire Database, fire points (NFDB_point)', perimeters: [], points });
  },

  // ECCC Canadian National Tornado Database: verified events 1980–2009, with track end points where known.
  async tornadoes() {
    await getProvince();
    const base = 'https://data-donnees.az.ec.gc.ca/api/file?path=%2Fweather%2Fproducts%2Fcanadian-national-tornado-database-verified-events-1980-2009-public%2Fcanadian-national-tornado-database-verified-events-1980-2009-public-gis-en%2F';
    const csv = (await cached('raw/tornado-events.csv', () => fetchBuf(`${base}GIS_CAN_VerifiedTornadoes_1980-2009.csv`))).toString('latin1');
    if (/^\s*</.test(csv)) throw new Error('tornado database answered with a web page');
    const rows = parseCSV(csv);
    const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > -998 ? n : null; };
    const out = [];
    for (const r of rows) {
      if (r.PROVINCE !== 'SK') continue;
      const y = num(r.YYYY_LOCAL), m = num(r.MM_LOCAL), d = num(r.DD_LOCAL);
      const lat = num(r.START_LAT_), lon = num(r.START_LON_);
      if (y == null || lat == null || lon == null) continue;
      const lat2 = num(r.END_LAT_N), lon2 = num(r.END_LON_W);
      const f = num(r.FUJITA);
      // row: lon, lat, t, Fujita (null unknown), end lon, end lat, length m, width m, deaths, injuries, damage $K, nearest community
      // … source (0 ECCC, 1 NTP), flags (bit 0: default rating, seen but no damage to rate; bit 1: end point estimated)
      out.push([round(lon, 3), round(lat, 3), round(ymdFrac(y, m, d) + (num(r.HHMM_LOCAL) ?? 1200) / 2400 / 365, 4), f, lon2 == null ? null : round(lon2, 3), lat2 == null ? null : round(lat2, 3), num(r.LENGTH_M), num(r.WIDTH_MAX_), num(r.HUMAN_FATA) ?? 0, num(r.HUMAN_INJ) ?? 0, num(r.DMG_THOUS), r.NEAR_CMMTY || null, 0, 0]);
    }
    const eccc = out.length;

    // Northern Tornadoes Project (Western University): every tornado it has investigated since 2017, from its public
    // event-summary feature service. Re-fetched each month, since the project adds and revises events through the season.
    const NTP = 'https://services.arcgis.com/rGKxabTU9mcXMw7k/arcgis/rest/services/NTP_Event_Summaries_stakeholder/FeatureServer/0';
    const month = new Date().toISOString().slice(0, 7);
    const ntp = await arcgisAll(NTP, { where: "province='Saskatchewan' AND event_type LIKE 'tornado%'", outFields: 'Year,month,day,time,event_name,damage,track_length,max_path_width,mean_motion_from,fatalities_text,injuries,damage_cost_text,event_description' }, `ntp-${month}`);
    let estimatedEnds = 0;
    for (const f of ntp) {
      const p = f.properties;
      const [lon, lat] = f.geometry?.coordinates ?? [];
      if (lon == null || !p.Year || !inSask(lon, lat, 0.05)) continue;
      const ef = /ef(\d)/.exec(p.damage ?? '');
      const flags = /^default/.test(p.damage ?? '') ? 1 : 0;
      // NTP gives the start of the track, its length and the direction the tornado came from: walk the length the other
      // way for an approximate end point (marked as estimated)
      let lon2 = null, lat2 = null, est = 0;
      if (p.track_length > 0 && p.mean_motion_from != null) {
        const toward = ((p.mean_motion_from + 180) * Math.PI) / 180;
        lat2 = round(lat + (p.track_length * Math.cos(toward)) / 111.2, 3);
        lon2 = round(lon + (p.track_length * Math.sin(toward)) / (111.2 * Math.cos((lat * Math.PI) / 180)), 3);
        est = 2;
        estimatedEnds++;
      }
      const n = (v) => (/^\d+$/.test(String(v ?? '').trim()) ? Number(v) : 0);
      out.push([round(lon, 3), round(lat, 3), round(ymdFrac(p.Year, p.month, p.day) + (p.time ?? 1200) / 2400 / 365, 4), ef ? Number(ef[1]) : null, lon2, lat2,
        p.track_length > 0 ? Math.round(p.track_length * 1000) : null, p.max_path_width || null, n(p.fatalities_text), n(p.injuries), null, (p.event_name || '').trim() || null, 1, flags | est]);
    }
    out.sort((a, b) => a[2] - b[2]);
    log(`  ${eccc} tornadoes from ECCC (1980–2009), ${out.length - eccc} from the Northern Tornadoes Project (${estimatedEnds} with an estimated track end)`);
    await writeOut('tornadoes', {
      source: 'Environment and Climate Change Canada, Canadian National Tornado Database: Verified Events (1980–2009); Northern Tornadoes Project, Western University, Event Summaries (2017 →), CC BY-NC 4.0',
      sources: [
        { name: 'ECCC Canadian National Tornado Database', from: 1980, to: 2009, scale: 'F' },
        { name: 'Northern Tornadoes Project', from: 2017, to: new Date().getFullYear(), scale: 'EF' },
      ],
      rows: out,
    });
  },

  // ECCC HYDAT annual peak discharge at every Saskatchewan hydrometric station with 8+ years.
  async rivers() {
    await getProvince();
    const stations = (await ogcAll('hydrometric-stations', { bbox: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}` }, 'hydro-stations'))
      .filter((f) => f.geometry && f.properties.PROV_TERR_STATE_LOC === 'SK' && inSask(...f.geometry.coordinates, 0.02));
    log(`  ${stations.length} hydrometric stations in Saskatchewan`);
    const out = [];
    await pool(stations, 6, async (s) => {
      const id = s.properties.STATION_NUMBER;
      const peaks = await ogcAll('hydrometric-annual-peaks', { STATION_NUMBER: id }, `peaks-${id}`);
      const byYear = {}, dates = {};
      for (const f of peaks) {
        const p = f.properties;
        if (!/discharge/i.test(p.DATA_TYPE_EN) || !/max/i.test(p.PEAK_CODE_EN) || p.PEAK == null || !p.DATE) continue;
        const y = String(p.DATE).slice(0, 4);
        byYear[y] = round(p.PEAK, 2);
        dates[y] = String(p.DATE).slice(0, 10);
      }
      if (Object.keys(byYear).length < 8) return;
      const sorted = Object.values(byYear).sort((a, b) => a - b);
      out.push({
        id,
        name: s.properties.STATION_NAME.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()),
        lon: round(s.geometry.coordinates[0]), lat: round(s.geometry.coordinates[1]),
        area: round(s.properties.DRAINAGE_AREA_GROSS, 1),
        median: sorted[Math.floor(sorted.length / 2)],
        peaks: byYear, peakDates: dates,
      });
    });
    out.sort((a, b) => a.id.localeCompare(b.id));
    log(`  ${out.length} stations with ≥8 years of peak flow`);
    await writeOut('rivers', { source: 'Environment and Climate Change Canada, HYDAT annual peaks (api.weather.gc.ca)', stations: out });
  },

  // ECCC Adjusted & Homogenized Canadian Climate Data.
  async climate() {
    await getProvince();
    const stations = (await ogcAll('ahccd-stations', { bbox: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}` }, 'ahccd-stations'))
      .filter((f) => f.properties.measurement_type__type_mesure === 'temp_mean' && inSask(...f.geometry.coordinates, 0.05));
    log(`  ${stations.length} AHCCD temperature stations`);
    const out = [];
    await pool(stations, 6, async (s) => {
      const id = s.properties.station_id__id_station;
      const rows = await ogcAll('ahccd-annual', { station_id__id_station: id }, `ahccd-${id}`);
      const temp = {}, precip = {};
      for (const f of rows) {
        const p = f.properties;
        if (p.period_group__groupe_periode !== 'Annual') continue;
        if (p.temp_mean__temp_moyenne != null && p.temp_mean__temp_moyenne > -50) temp[p.year__annee] = p.temp_mean__temp_moyenne;
        if (p.total_precip__precip_totale != null && p.total_precip__precip_totale >= 0) precip[p.year__annee] = round(p.total_precip__precip_totale, 0);
      }
      const base = Object.entries(temp).filter(([y]) => y >= 1961 && y <= 1990).map(([, v]) => v);
      if (Object.keys(temp).length < 20 || base.length < 15) return;
      out.push({
        id,
        name: s.properties.station_name__nom_station.replace(/_+/g, ' ').trim().replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()),
        lon: round(s.geometry.coordinates[0]), lat: round(s.geometry.coordinates[1]),
        baseline: round(base.reduce((a, b) => a + b, 0) / base.length, 2),
        temp, precip,
      });
    });
    out.sort((a, b) => b.lat - a.lat);
    await writeOut('climate', { source: 'ECCC Adjusted and Homogenized Canadian Climate Data (AHCCD) via api.weather.gc.ca', baselinePeriod: '1961–1990', stations: out });
  },

  // ECCC Canadian Climate Normals: 30-year averages of everyday weather per station.
  async normals() {
    await getProvince();
    const bbox = `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`;
    const ANNUAL = { 102: 'sun', 69: 'wetDays', 41: 'frostDays', 54: 'snow', 56: 'precip', 1: 'tMean' };
    const annual = await ogcAll('climate-normals', { bbox, MONTH: '13' }, 'normals-annual');
    const monthlyT = await ogcAll('climate-normals', { bbox, NORMAL_ID: '1' }, 'normals-temp-monthly');
    const monthlyP = await ogcAll('climate-normals', { bbox, NORMAL_ID: '56' }, 'normals-precip-monthly');
    const title = (s) => s.toLowerCase().split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ').replace(/\bCda\b/, 'CDA');
    const byStn = new Map();
    const stn = (f) => {
      const p = f.properties;
      const [lon, lat] = f.geometry.coordinates;
      if (!byStn.has(p.CLIMATE_IDENTIFIER)) byStn.set(p.CLIMATE_IDENTIFIER, { id: p.CLIMATE_IDENTIFIER, name: title(p.STATION_NAME), lon: round(lon), lat: round(lat), yrs: 99, period: `${p.PERIOD_BEGIN}–${p.PERIOD_END}`, wet: null });
      return byStn.get(p.CLIMATE_IDENTIFIER);
    };
    const usable = (p) => p.VALUE != null && (p.YEAR_COUNT_NORMAL_PERIOD ?? 0) >= 10;
    for (const f of annual) {
      const p = f.properties, field = ANNUAL[p.NORMAL_ID];
      if (!field || !usable(p) || !f.geometry) continue;
      const s = stn(f);
      s[field] = round(p.VALUE, 1);
      s.yrs = Math.min(s.yrs, p.YEAR_COUNT_NORMAL_PERIOD);
    }
    for (const f of monthlyT) {
      const p = f.properties;
      if (!usable(p) || !f.geometry || (p.MONTH !== 1 && p.MONTH !== 7)) continue;
      stn(f)[p.MONTH === 1 ? 'tJan' : 'tJul'] = round(p.VALUE, 1);
    }
    for (const f of monthlyP) {
      const p = f.properties;
      if (!usable(p) || !f.geometry || p.MONTH > 12) continue;
      const s = stn(f);
      if (!s.wet || p.VALUE > s.wet[1]) s.wet = [p.MONTH, round(p.VALUE, 0)];
    }
    const stations = [...byStn.values()]
      .filter((s) => inSask(s.lon, s.lat, 0.05))
      .filter((s) => ['sun', 'wetDays', 'frostDays', 'snow'].some((k) => s[k] != null))
      .sort((a, b) => b.lat - a.lat);
    for (const s of stations) if (!s.wet) delete s.wet;
    const periods = [...new Set(stations.map((s) => s.period))];
    log(`  ${stations.length} normals stations, period ${periods.join(', ')}`);
    await writeOut('normals', {
      source: 'Environment and Climate Change Canada, Canadian Climate Normals (api.weather.gc.ca climate-normals collection)',
      period: periods.length === 1 ? periods[0] : periods.join(', '),
      stations: stations.map(({ period, ...s }) => s),
    });
  },

  // Statistics Canada Table 17-10-0155-01: population estimates, 1 July, by census subdivision (2021 boundaries).
  async population() {
    const csv = await statcanTable('17100155');
    const rows = parseCSV(csv);
    const munis = {};
    const seen = {};
    for (const r of rows) {
      const geo = r.GEO ?? '';
      if (!/Saskatchewan/.test(geo) || r.VALUE === '' || (r.Gender && !/^Total/i.test(r.Gender)) || (r['Age group'] && !/^All ages/i.test(r['Age group']))) continue;
      // e.g. "Regina (CY), Saskatchewan" or "Lloydminster (Part) (CY), Saskatchewan"
      const name = geo.split(',')[0].replace(/\((part|partie)\)/i, '');
      const type = (name.match(/\(([A-Z]+)\)\s*$/) ?? [])[1] ?? '';
      if (/^(RM|IRI|S-E|TP|NO|SNO|RV)$/.test(type)) continue;
      const key = normalizeName(name.replace(/\([A-Z]+\)\s*$/, ''));
      if (!PLACE_KEYS.has(key)) continue;
      seen[key] = geo;
      const y = r.REF_DATE.slice(0, 4);
      ((munis[key] ??= { pop: {}, s65: {}, firstProjection: null }).pop[y] = (munis[key].pop[y] ?? 0) + Number(r.VALUE));
    }
    const missing = PLACES_LIST.filter((p) => !munis[normalizeName(p.name)]).map((p) => p.name);
    if (missing.length) log('  population: no match for', missing.join(', '));
    log(`  ${Object.keys(munis).length} places matched`);
    await writeOut('population', { source: 'Statistics Canada, Table 17-10-0155-01, Population estimates, July 1, by census subdivision, 2021 boundaries', munis });
  },

  // Statistics Canada Table 35-10-0061-01: Crime Severity Index and weighted clearance rates, police services in Saskatchewan.
  async crime() {
    const csv = await statcanTable('35100061');
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const header = parseCSVLine(lines[0]).map((h) => h.replace(/^﻿/, ''));
    const iDate = header.indexOf('REF_DATE'), iGeo = header.indexOf('GEO'), iStat = header.indexOf('Statistics'), iVal = header.indexOf('VALUE');
    const STATS = { 'Crime severity index': 'csi', 'Violent crime severity index': 'vcsi', 'Non-violent crime severity index': 'nvcsi', 'Weighted clearance rate': 'clear' };
    const byGeo = {};
    const prov = {};
    const services = new Set();
    for (const line of lines.slice(1)) {
      const c = parseCSVLine(line);
      const stat = STATS[c[iStat]];
      // A service lists years before it existed (or after it stopped reporting) as 0: no real service has an index of 0.
      if (!stat || c[iVal] === '' || Number(c[iVal]) === 0) continue;
      const geo = c[iGeo], year = c[iDate].slice(0, 4);
      if (/^Saskatchewan/.test(geo)) { (prov[stat] ??= {})[year] = Number(c[iVal]); continue; }
      services.add(geo);
      // "Regina, Saskatchewan, municipal [47xxx]" or "Melfort, Saskatchewan, Royal Canadian Mounted Police, municipal [..]";
      // rural detachments end in "rural".
      const parts = geo.replace(/\s*\[.*\]$/, '').split(/,\s*/);
      const key = normalizeName(parts[0]);
      if (!PLACE_KEYS.has(key)) continue;
      const level = parts.at(-1);
      if (level !== 'municipal' && level !== 'rural') continue;
      const rcmp = parts.includes('Royal Canadian Mounted Police');
      const g = (byGeo[geo] ??= { key, level, rcmp, stats: {} });
      (g.stats[stat] ??= {})[year] = Number(c[iVal]);
    }
    // Each place takes one police service's series: its own municipal one while that is still reported, otherwise the
    // rural RCMP detachment of the same name (small towns' municipal RCMP series stop in 2011 and carry on as part of the
    // rural detachment, which covers the surrounding area too). Series are never spliced across services.
    const munis = {}, service = {};
    const lastYear = (g) => Math.max(...Object.keys(g.stats.csi ?? { 0: 0 }).map(Number));
    const latest = Math.max(...Object.values(byGeo).map(lastYear));
    const current = (g) => lastYear(g) >= latest - 3;
    const pick = {};
    for (const [geo, g] of Object.entries(byGeo)) {
      const p = pick[g.key];
      const better = !p
        || (current(g) && !current(p[1]))
        || (current(g) === current(p[1]) && g.level === 'municipal' && p[1].level === 'rural')
        || (current(g) === current(p[1]) && g.level === p[1].level && lastYear(g) > lastYear(p[1]));
      if (better) pick[g.key] = [geo, g];
    }
    for (const [key, [geo, g]] of Object.entries(pick)) {
      munis[key] = g.stats;
      service[key] = { level: g.level, rcmp: g.rcmp, name: geo.replace(/\s*\[.*\]$/, '').replace(', Saskatchewan', '') };
    }
    log('  rural detachment used for:', Object.entries(service).filter(([, s]) => s.level === 'rural').map(([k]) => k).join(', '));
    const missing = PLACES_LIST.filter((p) => !munis[normalizeName(p.name)]).map((p) => p.name);
    log(`  ${services.size} police services in the table; ${Object.keys(munis).length} places matched`);
    if (missing.length) log('  crime: no own police series for', missing.join(', '));
    await writeOut('crime', { source: 'Statistics Canada, Table 35-10-0061-01 (Crime severity index and weighted clearance rates, police services in Saskatchewan)', prov, munis, service, services: services.size });
  },

  // Courthouses, police detachments and correctional centres from OpenStreetMap, and the drive from each place to
  // its nearest court and police.
  async justice() {
    await getProvince();
    const places = await getPlaces();
    const osm = await overpass('sk-justice.json', `[out:json][timeout:240];(nwr["amenity"~"^(courthouse|police|prison)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center tags qt;`);
    const KIND = { courthouse: 'court', police: 'police', prison: 'corrections' };
    const sites = [];
    const seen = new Set();
    for (const e of osm.elements) {
      const t = e.tags ?? {};
      const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
      if (lon == null || !inSask(lon, lat, 0.01)) continue;
      const kind = KIND[t.amenity];
      // OSM's police tag also covers offices and kiosks; a building with no name is usually a detail of a bigger site
      const name = (t.name ?? t['official_name'] ?? '').trim();
      const op = (t.operator ?? '').trim();
      const rcmp = /rcmp|royal canadian mounted/i.test(`${name} ${op}`);
      const label = name || (kind === 'police' ? (rcmp ? 'RCMP detachment' : 'Police station') : kind === 'court' ? 'Courthouse' : 'Correctional facility');
      const dupe = `${kind}:${round(lon, 2)}:${round(lat, 2)}:${label}`;
      if (seen.has(dupe)) continue;
      seen.add(dupe);
      const city = t['addr:city'] ?? null;
      sites.push({ kind, name: label, op: op || null, rcmp, city, lon: round(lon, 4), lat: round(lat, 4), osm: `${e.type}/${e.id}`, ...(t.website ? { web: t.website } : {}) });
    }
    sites.sort((a, b) => a.kind.localeCompare(b.kind) || b.lat - a.lat);
    const count = (k) => sites.filter((s) => s.kind === k).length;
    log(`  ${count('court')} courthouses, ${count('police')} police sites, ${count('corrections')} correctional sites`);
    const courts = sites.map((s, i) => ({ ...s, i })).filter((s) => s.kind === 'court');
    const police = sites.map((s, i) => ({ ...s, i })).filter((s) => s.kind === 'police');
    const remap = (r, list) => Object.fromEntries(Object.entries(r.towns).map(([k, v]) => [k, v.map((t) => ({ ...t, f: list[t.f].i }))]));
    const c = await driveTimes(places, courts, 'court');
    const p = await driveTimes(places, police, 'police', { keep: 1 });
    const towns = {};
    for (const pl of places) towns[pl.key] = { court: remap(c, courts)[pl.key] ?? [], police: remap(p, police)[pl.key] ?? [] };
    await writeOut('justice', {
      source: 'OpenStreetMap contributors (amenity=courthouse, police, prison; ODbL), via Overpass',
      routing: c.routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line',
      routingSource: c.routed ? 'Drive times: OSRM demo server, © OpenStreetMap contributors (ODbL)' : null,
      asOf: new Date().toISOString().slice(0, 10),
      sites, towns,
    });
  },

  // Statistics Canada Open Database of Healthcare Facilities: Saskatchewan hospitals; drive times from each place.
  async hospitals() {
    await getProvince();
    const places = await getPlaces();
    const csv = (await cached('raw/odhf.csv', () => fetchBuf('https://ftp.maps.canada.ca/pub/statcan_statcan/Health-care-facilities_Etablissement-de-sante/ODHF_BDOES/odhf_bdoes_v1.csv'))).toString('latin1');
    const rows = parseCSV(csv).filter((r) => r.province === 'sk' && r.odhf_facility_type === 'Hospitals' && r.latitude && r.longitude);
    // capitalise words (not the letter after an apostrophe: "Children's"), keep short joining words low
    const title = (s) => s.replace(/(^|[\s(\-/&[])([a-z])/g, (_, a, c) => a + c.toUpperCase()).replace(/\bAnd\b/g, 'and').replace(/\bOf\b/g, 'of').replace(/\(Ruh\)/, '(RUH)');
    // ODHF files health centres, clinics and primary-care teams under "Hospitals" too; many rural Saskatchewan "district
    // health centres" are acute-care hospitals, so the source's type decides, and psychiatric and primary-care sites
    // don't count as somewhere to go in an emergency. The source's own type is kept so the app can show it.
    const isHospital = (r) => /hospital|hosptial|general|regional|tertiary|acute|integrated|district|emerg/i.test(`${r.source_facility_type} ${r.facility_name}`)
      && !/psychiatric/i.test(`${r.source_facility_type} ${r.facility_name}`)
      && !/primary health (care|team)|clinic|wellness|youth lodge/i.test(r.facility_name);
    const facilities = [];
    for (const r of rows) {
      const f = { name: title(r.facility_name), city: title(r.city), lon: round(+r.longitude), lat: round(+r.latitude), hospital: isHospital(r), ed: null, hours: null, type: r.source_facility_type || null };
      if (!inSask(f.lon, f.lat, 0.02)) continue;
      // the source lists some sites twice (a hospital and its integrated care centre): keep one, a hospital if either is
      const dup = facilities.find((g) => distKm(g.lon, g.lat, f.lon, f.lat) < 0.3);
      if (dup) { if (f.hospital && !dup.hospital) Object.assign(dup, f); continue; }
      facilities.push(f);
    }
    facilities.sort((a, b) => b.lat - a.lat);
    const hosp = facilities.map((f, i) => ({ ...f, i })).filter((f) => f.hospital);
    log(`  ${facilities.length} facilities, ${hosp.length} counted as hospitals`);
    const d = await driveTimes(places, hosp, 'hosp', { keep: 2 });
    const towns = Object.fromEntries(Object.entries(d.towns).map(([k, v]) => [k, v.map((t) => ({ ...t, f: hosp[t.f].i }))]));
    await writeOut('hospitals', {
      source: 'Statistics Canada, Open Database of Healthcare Facilities (ODHF v1), Saskatchewan rows',
      routing: d.routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line',
      routingSource: d.routed ? 'Drive times: OSRM demo server, © OpenStreetMap contributors (ODbL)' : null,
      facilities, towns,
    });
  },

  // Indigenous Services Canada historic treaty areas, and the Canada Lands Survey System's reserve boundaries.
  async treaties() {
    await getProvince();
    const T = 'https://geo.sac-isc.gc.ca/geomatics/rest/services/Donnees_Ouvertes-Open_Data/Historic_Treaty_E/MapServer/0';
    const fs1 = await arcgisAll(T, { where: "ENAME LIKE 'Treaty%'", outFields: 'TAG_ID,ENAME,SUBTYPE_ENAME', maxAllowableOffset: '0.01', geometry: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' }, 'treaties');
    const treaties = fs1.filter((f) => f.geometry).map((f) => {
      const nm = f.properties.ENAME;
      const yrs = (nm.match(/\((\d{4})(?:-(\d{4}))?\)/) ?? []);
      return { name: nm.replace(/\s*\(.*\)$/, ''), label: nm, year: +yrs[1], end: yrs[2] ? +yrs[2] : null, polys: polys(f.geometry, 0.02, 3) };
    })
      // keep treaties with a real share of the province, not ones that only meet it along the border (Treaty 7)
      .filter((t) => {
        // sample a 0.1° grid over the treaty area: count points inside both the treaty and Saskatchewan, at least
        // 0.1° from the provincial border, so a treaty that only meets the border (Treaty 7) doesn't count
        const pts = t.polys.flatMap((p) => p[0]);
        const x0 = Math.max(BBOX.west, Math.min(...pts.map((p) => p[0]))), x1 = Math.min(BBOX.east, Math.max(...pts.map((p) => p[0])));
        const y0 = Math.max(BBOX.south, Math.min(...pts.map((p) => p[1]))), y1 = Math.min(BBOX.north, Math.max(...pts.map((p) => p[1])));
        let hit = 0;
        for (let x = x0; x <= x1; x += 0.1) for (let y = y0; y <= y1; y += 0.1) {
          if (inSask(x, y) && inSask(x + 0.1, y) && inSask(x - 0.1, y) && t.polys.some((p) => booleanPointInPolygon([x, y], { type: 'Polygon', coordinates: p }))) hit++;
        }
        log(`  ${t.label}: ${hit} sample points inside Saskatchewan`);
        return hit >= 3;
      })
      .sort((a, b) => a.year - b.year);
    log(`  ${treaties.length} historic treaty areas in Saskatchewan: ${treaties.map((t) => t.label).join(', ')}`);

    const R = 'https://proxyinternet.nrcan-rncan.gc.ca/arcgis/rest/services/CLSS-SATC/CLSS_Administrative_Boundaries/MapServer/0';
    const fs2 = await arcgisAll(R, { where: '1=1', outFields: 'adminAreaNameEng,adminAreaId,jurisdictionEng,webReference', maxAllowableOffset: '0.0015', geometry: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' }, 'reserves', 500);
    const reserves = [];
    for (const f of fs2) {
      if (!f.geometry) continue;
      const ps = polys(f.geometry, 0.0015);
      if (!ps.length) continue;
      const ring = ps[0][0];
      const c = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
      if (!inSask(c[0], c[1], 0.01)) continue;
      const areaKm2 = ps.reduce((a, p) => a + Math.abs(ringArea(p[0])) * 111.32 * 111.32 * Math.cos((c[1] * Math.PI) / 180), 0);
      // the survey lists names in capitals: title-case them, keeping "I.R." and "No."
      const name = (f.properties.adminAreaNameEng ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
        .replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bI\.r\./g, 'I.R.').replace(/\bIr\b/g, 'IR');
      reserves.push({ name, c: [round(c[0], 3), round(c[1], 3)], km2: round(areaKm2, 1), polys: ps });
    }
    reserves.sort((a, b) => b.km2 - a.km2);
    log(`  ${reserves.length} reserve parcels in Saskatchewan, ${Math.round(reserves.reduce((a, r) => a + r.km2, 0))} km²`);
    await writeOut('treaties', {
      source: 'Indigenous Services Canada, Historic Treaties (ArcGIS REST); Natural Resources Canada, Canada Lands Survey System: Aboriginal Lands of Canada Legislative Boundaries',
      treaties, reserves,
    });
  },
};

/** Downloads a full Statistics Canada table (CSV inside a zip) through the WDS API, cached. */
async function statcanTable(pid) {
  const zip = await cached(`statcan/${pid}.zip`, async () => {
    const meta = asJSON(await fetchBuf(`https://www150.statcan.gc.ca/t1/wds/rest/getFullTableDownloadCSV/${pid}/en`), `table ${pid}`);
    const b = await fetchBuf(meta.object, { timeout: 900_000 });
    if (b[0] !== 0x50 || b[1] !== 0x4b) throw new Error('Statistics Canada returned a non-zip response (site may be down for maintenance)');
    return b;
  });
  const files = unzipSync(new Uint8Array(zip), { filter: (f) => /^\d+\.csv$/.test(f.name) });
  return strFromU8(files[Object.keys(files)[0]]);
}

// ---------------------------------------------------------------------------------------------

const wanted = process.argv.slice(2);
const order = ['province', 'places', 'fires', 'tornadoes', 'rivers', 'climate', 'normals', 'population', 'crime', 'treaties', 'justice', 'hospitals'];
const run = wanted.length ? order.filter((n) => wanted.includes(n)) : order;

let manifest = {};
try { manifest = JSON.parse(await fs.readFile(path.join(OUT, 'manifest.json'), 'utf8')); } catch { /* first run */ }

let failures = 0;
for (const name of run) {
  const t0 = Date.now();
  console.log(`\n▶ ${name}`);
  try {
    await SOURCES[name]();
    manifest[name] = { ok: true, updated: new Date().toISOString() };
    log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    failures++;
    manifest[name] = { ...(manifest[name] ?? {}), ok: manifest[name]?.ok ?? false, lastError: e.message, lastAttempt: new Date().toISOString() };
    console.error(`✖ ${name} failed: ${e.message}`);
  }
}
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(failures ? `\nFinished with ${failures} failed source(s).` : '\nAll sources fetched.');
