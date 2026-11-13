#!/usr/bin/env node
// Living Skies Atlas data pipeline.
// Pulls open data for Saskatchewan from public government APIs (and OpenStreetMap), clips it to the
// province, and writes compact JSON files to public/data/ for the static web app.
//
//   node scripts/fetch-data.mjs                 # all stages
//   node scripts/fetch-data.mjs fires crime     # selected stages
//   node scripts/fetch-data.mjs now             # the four live stages (now-rivers, now-fires, now-air, now-alerts)
//   node scripts/fetch-data.mjs now history     # …and roll them into the daily record (public/data/history/)
//
// Raw downloads are cached in .cache/ so re-runs are quick. Delete it to force a refresh.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { unzipSync, unzlibSync, strFromU8, Unzip, UnzipInflate } from 'fflate';
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

/** A large download streamed straight to a file in the cache (not held in memory); returns its path. */
async function cachedFile(name, url, { timeout = 1_800_000 } = {}) {
  const file = path.join(CACHE, name);
  try { await fs.access(file); return file; } catch { /* not cached yet */ }
  await fs.mkdir(path.dirname(file), { recursive: true });
  log(`  downloading ${url} …`);
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${file}.part`));
  await fs.rename(`${file}.part`, file);
  return file;
}

/** Streams the text files in a zip whose names pass `want`, line by line, without unpacking it to memory or disk. */
function zipLines(file, want, onLine) {
  return new Promise((resolve, reject) => {
    const uz = new Unzip();
    uz.register(UnzipInflate);
    let open = 0, ended = false, failed = false;
    const fail = (e) => { if (!failed) { failed = true; rs.destroy(); reject(e); } };
    const settle = () => { if (ended && !open && !failed) resolve(); };
    uz.onfile = (f) => {
      if (!want(f.name)) return;
      open++;
      const dec = new TextDecoder();
      let rest = '';
      f.ondata = (err, chunk, final) => {
        if (err) return fail(err);
        const lines = (rest + dec.decode(chunk, { stream: !final })).split('\n');
        rest = final ? '' : lines.pop();
        try { for (const l of lines) if (l.trim()) onLine(l.replace(/\r$/, ''), f.name); } catch (e) { return fail(e); }
        if (final) { open--; settle(); }
      };
      f.start();
    };
    const rs = createReadStream(file, { highWaterMark: 1 << 20 });
    rs.on('data', (c) => { try { uz.push(new Uint8Array(c.buffer, c.byteOffset, c.length)); } catch (e) { fail(e); } });
    rs.on('end', () => { try { uz.push(new Uint8Array(0), true); } catch (e) { return fail(e); } ended = true; settle(); });
    rs.on('error', fail);
  });
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
/** Joins polylines (e.g. a route's OSM ways) that meet end to end into longer ones, flipping pieces as needed. */
function joinPaths(paths) {
  const k = ([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`;
  const left = paths.map((p) => p.slice());
  const out = [];
  while (left.length) {
    let cur = left.pop();
    for (let grew = true; grew;) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const p = left[i];
        const [a, b, c, d] = [k(cur[0]), k(cur.at(-1)), k(p[0]), k(p.at(-1))];
        if (b === c) cur = [...cur, ...p.slice(1)];
        else if (b === d) cur = [...cur, ...p.slice(0, -1).reverse()];
        else if (a === d) cur = [...p, ...cur.slice(1)];
        else if (a === c) cur = [...p.slice(1).reverse(), ...cur];
        else continue;
        left.splice(i, 1); grew = true; break;
      }
    }
    out.push(cur);
  }
  return out;
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
/** Distance (km) from a point to a Polygon / MultiPolygon's edges, in a local flat projection. */
function edgeKm(lon, lat, geom) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
  let best = Infinity;
  const ps = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const p of ps) for (const ring of p)
    for (let i = 1; i < ring.length; i++) {
      const ax = (ring[i - 1][0] - lon) * kx, ay = (ring[i - 1][1] - lat) * ky, bx = (ring[i][0] - lon) * kx, by = (ring[i][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const u = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
      best = Math.min(best, Math.hypot(ax + u * dx, ay + u * dy));
    }
  return best;
}

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
// Census 2021 profile (Statistics Canada's census SDMX API). It answers HTTP 500 unless asked for English.

const CENSUS_SDMX = 'https://api.statcan.gc.ca/census-recensement/profile/sdmx/rest';
async function censusCSV(name, url) {
  const buf = await cached(`census/${name}.csv`, async () => {
    const b = await fetchBuf(url, { headers: { Accept: 'application/vnd.sdmx.data+csv', 'Accept-Language': 'en' }, timeout: 300_000 });
    if (!/^\s*DATAFLOW,/.test(b.toString('utf8'))) throw new Error(`census profile ${name}: not a CSV answer`);
    return b;
  });
  return parseCSV(buf.toString('utf8'));
}
/** The atlas's places as Saskatchewan census subdivisions (city, town, village, northern village/town/hamlet). */
let csdMemo;
async function censusCSDs() {
  if (csdMemo) return csdMemo;
  // "Regina, City [Census subdivision], Saskatchewan"
  const desc = (await cached('census/CL_DESC_CSD.xml', () => fetchBuf(`${CENSUS_SDMX}/codelist/STC_CP/CL_DESC_CSD/latest`, { headers: { 'Accept-Language': 'en' }, timeout: 300_000 }))).toString('utf8');
  const csd = {};
  for (const m of desc.matchAll(/<structure:Code id="(2021A000547\d{5})">\s*<common:Name xml:lang="en">([^<]+)<\/common:Name>/g)) {
    const [, id, label] = m;
    const [, name, type] = label.match(/^(.*), ([^,]+) \[Census subdivision\], Saskatchewan$/) ?? [];
    if (!name || !/^(City|Town|Village|Northern village|Northern town|Northern hamlet)$/i.test(type)) continue;
    const key = normalizeName(name.replace(/\((part|partie)\)/i, ''));
    if (PLACE_KEYS.has(key) && !csd[key]) csd[key] = { id, name: label.replace(/ \[Census subdivision\], Saskatchewan$/, '') };
  }
  return (csdMemo = csd);
}
/**
 * Census 2021 profile characteristics (ids from the CL_CHARACTERISTIC codelist) for the atlas's places and the province:
 * `places[key] = { csd, v: { charId: value } }`, `prov = { charId: value }`. Suppressed values are left out.
 * `tag` keeps each stage's cached answers apart (they ask for different characteristics).
 */
async function censusProfile(tag, chars) {
  const csd = await censusCSDs();
  const charKey = chars.join('+');
  const vals = (rows) => {
    const o = {};
    for (const r of rows) if (chars.includes(String(r.CHARACTERISTIC)) && r.OBS_VALUE !== '' && !Number.isNaN(Number(r.OBS_VALUE))) o[r.CHARACTERISTIC] = Number(r.OBS_VALUE);
    return o;
  };
  const keys = Object.keys(csd).sort();
  const places = {};
  for (let i = 0; i < keys.length; i += 20) {
    const part = keys.slice(i, i + 20);
    const rows = await censusCSV(`${tag}csd-${part.map((k) => csd[k].id.slice(-7)).join('_').slice(0, 120)}`, `${CENSUS_SDMX}/data/STC_CP,DF_CSD/A5.${part.map((k) => csd[k].id).join('+')}.1.${charKey}.1`);
    for (const k of part) places[k] = { csd: csd[k].name, v: vals(rows.filter((r) => r.REF_AREA === csd[k].id)) };
  }
  const prov = vals(await censusCSV(`${tag}province-47`, `${CENSUS_SDMX}/data/STC_CP,DF_PR/A5.2021A000247.1.${charKey}.1`));
  return { places, prov };
}

// ---------------------------------------------------------------------------------------------
// Daily needs in OpenStreetMap (shared by the `needs` and `doctors` stages, so their pharmacy and clinic tests agree).
// Order matters: the app reads needs.json's `kinds` by index.
const NEEDS_KINDS = [
  { id: 'grocery', test: (t) => /^(supermarket|grocery)$/.test(t.shop) },
  { id: 'pharmacy', test: (t) => t.amenity === 'pharmacy' || t.healthcare === 'pharmacy' },
  { id: 'school', test: (t) => t.amenity === 'school' },
  { id: 'bank', test: (t) => t.amenity === 'bank' },
  { id: 'fuel', test: (t) => t.amenity === 'fuel' && t.access !== 'private' },
  { id: 'library', test: (t) => t.amenity === 'library' },
  { id: 'post', test: (t) => t.amenity === 'post_office' },
  { id: 'clinic', test: (t) => /^(clinic|doctors)$/.test(t.amenity) || /^(clinic|doctor)$/.test(t.healthcare) },
];
const needsOSM = () => overpass('sk-needs.json', `[out:json][timeout:300];(nwr["shop"~"^(supermarket|grocery)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});nwr["amenity"~"^(pharmacy|school|bank|fuel|library|post_office|clinic|doctors)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});nwr["healthcare"~"^(pharmacy|clinic|doctor)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center tags qt;`);

// Statistics Canada's Open Database of Healthcare Facilities (shared by `hospitals` and `doctors`).
const odhfRows = async () => parseCSV((await cached('raw/odhf.csv', () => fetchBuf('https://ftp.maps.canada.ca/pub/statcan_statcan/Health-care-facilities_Etablissement-de-sante/ODHF_BDOES/odhf_bdoes_v1.csv'))).toString('latin1')).filter((r) => r.province === 'sk');
// ODHF files health centres, clinics and primary-care teams under "Hospitals" too; many rural Saskatchewan "district
// health centres" are acute-care hospitals, so the source's type decides, and psychiatric and primary-care sites
// don't count as somewhere to go in an emergency.
const odhfIsHospital = (r) => /hospital|hosptial|general|regional|tertiary|acute|integrated|district|emerg/i.test(`${r.source_facility_type} ${r.facility_name}`)
  && !/psychiatric/i.test(`${r.source_facility_type} ${r.facility_name}`)
  && !/primary health (care|team)|clinic|wellness|youth lodge/i.test(r.facility_name);
// ODHF names are lower case: capitalise words (not the letter after an apostrophe: "Children's"), keep short joining words low
const odhfTitle = (s) => s.replace(/(^|[\s(\-/&[])([a-z])/g, (_, a, c) => a + c.toUpperCase()).replace(/\bAnd\b/g, 'and').replace(/\bOf\b/g, 'of').replace(/\(Ruh\)/, '(RUH)');

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

  // Northern Hail Project (Western University): its radar hail swaths (MESH, the radar's Maximum Expected Size of Hail)
  // for 2022–2024, and the hailstorms in its research database, which it investigated on the ground. CC BY-NC 4.0.
  async hail() {
    await getProvince();
    const places = await getPlaces();
    const B = 'https://services.arcgis.com/rGKxabTU9mcXMw7k/arcgis/rest/services';
    const env = { where: '1=1', outFields: '*', geometry: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' };
    const SWATHS = [
      [2022, `${B}/MESH_Hailswaths_2022_and_2023_WFL1(copy)/FeatureServer/0`],
      [2023, `${B}/MESH_Hailswaths_2022_and_2023_WFL1(copy)/FeatureServer/1`],
      [2024, `${B}/MESH_Hailswaths_2024_Lines_WFL1/FeatureServer/0`],
    ];
    // a storm's local (CST) hour as a fraction of a year, from the date's noon
    const at = (y, m, d, localHour) => round(ymdFrac(y, m, d) + ((localHour ?? 12) - 12) / 24 / 365, 4);
    const utcHour = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s ?? '').trim()); return m ? (+m[1] + +m[2] / 60 - 6 + 24) % 24 : null; };
    // "1Wawota-2Lemberg-3Davidson, SK" (one storm, several numbered places) → "Wawota / Lemberg / Davidson";
    // "Unity SK-2Glaslyn SK_(1)64" → "Unity / Glaslyn"; places outside Saskatchewan keep their province
    const tidy = (s) => String(s ?? '').replace(/_\(.*$/, '').replace(/,\s*(SK|AB|MB)\b.*$/, '').replace(/-\d+(?=\p{Lu})/gu, ' / ').replace(/^\d+(?=\p{Lu})/u, '')
      .replace(/\s+SK\b/g, '').replace(/\s+(AB|MB)\b/g, ' ($1)').trim() || null;
    const out = [];
    let pieces = 0;
    for (const [year, url] of SWATHS) {
      const feats = await arcgisAll(url, env, `nhp-mesh-${year}`);
      // a swath with bends is stored as one feature per straight piece (start → bend → … → end), each carrying the whole
      // swath's attributes: put the pieces back together, in order along the track
      const swaths = new Map();
      for (const f of feats) {
        const p = f.properties, g = f.geometry;
        const lines = !g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
        const key = [p.File_Name, utcHour(p.Start_Time_of_Hailswath__UTC_), utcHour(p.End_Time_of_Hailswath__UTC_ ?? p.End_Time_of_Hailswath), p.Max_MESH_Value_in_the_Hailswath, p.Hailswath_Length__To_Nearest_ha].join('|');
        const s = swaths.get(key) ?? { p, segs: [], pieceKm: 0 };
        for (const l of lines) if (l.length >= 2) s.segs.push(l.filter((c) => Number.isFinite(c[0])));
        s.pieceKm += p.Swat_Length_km > 0 ? p.Swat_Length_km : 0; // 2022 gives each piece its own length
        swaths.set(key, s);
      }
      let kept = 0;
      for (const { p, segs, pieceKm } of swaths.values()) {
        if (!segs.length) continue;
        pieces += segs.length - 1;
        const near = (a, b) => Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3;
        // start from the piece no other piece runs into, then follow end → start
        const rest = segs.slice();
        let cur = rest.find((s) => !rest.some((o) => o !== s && near(o.at(-1), s[0]))) ?? rest[0];
        const pts = [];
        while (cur) {
          rest.splice(rest.indexOf(cur), 1);
          pts.push(...(pts.length ? cur.slice(1) : cur));
          cur = rest.find((s) => near(s[0], pts.at(-1))) ?? rest[0];
        }
        if (pts.length < 2 || !pts.some(([x, y]) => inSask(x, y, 0.02))) continue;
        const fm = /^(\d{4})(\d{2})(\d{2})_(.*)$/.exec(p.File_Name ?? '');
        if (!fm) continue;
        const path = dp(pts, 0.01).map(([x, y]) => [round(x, 3), round(y, 3)]);
        const mesh = p.Max_MESH_Value_in_the_Hailswath > 0 ? p.Max_MESH_Value_in_the_Hailswath : null;
        const len = p.Hailswath_Length__To_Nearest_ha ?? (pieceKm || null);
        const wid = p.Max_width_of_swath__To_Nearest_ ?? null;
        // row: lon, lat (swath start), t, largest hail mm (radar MESH; null when not given), source (0 radar swath),
        // place name, swath centre line, length km, widest km, hail size word, confirmed on the ground
        out.push([path[0][0], path[0][1], at(+fm[1], +fm[2], +fm[3], utcHour(p.Start_Time_of_Hailswath__UTC_)), mesh, 0, tidy(fm[4]), path, len > 0 ? round(len, 1) : null, wid > 0 ? round(wid, 1) : null, null, 0]);
        kept++;
      }
      log(`  ${year}: ${kept} radar hail swaths over Saskatchewan`);
    }

    // research database: one point per investigated storm, with measured, estimated and reported hail sizes (mm, though
    // some 2025 rows are in cm) and a size word ("golfball")
    const WORD = { pea: 6, marble: 13, penny: 19, nickel: 21, quarter: 24, mothball: 25, walnut: 32, pingpong: 40, golfball: 43, hen: 50, egg: 50, tennisball: 64, baseball: 70, teacup: 76, softball: 100, grapefruit: 102 };
    const nhp = await arcgisAll(`${B}/NHP_Research_Database_(Public_Layer)/FeatureServer/0`, { where: "province_name='saskatchewan'", outFields: 'year,month,day,local_time,event,maximum_measured_hailsize,max_measured_hailsize,maximum_estimated_hailsize,max_estimated_hailsize,maximum_reported_hailsize,max_reported_hailsize,confirmation' }, 'nhp-research');
    let placedByName = 0, dropped = 0;
    for (const f of nhp) {
      const p = f.properties;
      if (!p.year) continue;
      let [lon, lat] = f.geometry?.coordinates ?? [];
      if (!(lon && lat && inSask(lon, lat, 0.05))) {
        // a point off the map (0, 0 or in Alberta): fall back to the first place named in the event, when it is one of ours
        const first = String(p.event ?? '').split(/[/,(]/)[0].trim().toLowerCase();
        const pl = places.find((m) => m.key === first);
        if (!pl) { dropped++; continue; }
        [lon, lat] = [pl.lon, pl.lat];
        placedByName++;
      }
      let best = null, word = null;
      for (const [n, w] of [['maximum_measured_hailsize', 'max_measured_hailsize'], ['maximum_estimated_hailsize', 'max_estimated_hailsize'], ['maximum_reported_hailsize', 'max_reported_hailsize']]) {
        const wmm = WORD[String(p[w] ?? '').toLowerCase().replace(/\s+/g, '')] ?? null;
        let v = p[n] > 0 ? p[n] : null;
        if (v != null && v < 12 && wmm >= 15) v *= 10; // given in cm
        const mm = v ?? wmm;
        if (mm != null && (best == null || mm > best)) { best = mm; word = p[w] || null; }
      }
      const lt = p.local_time > 0 ? Math.floor(p.local_time / 100) + (p.local_time % 100) / 60 : null;
      out.push([round(lon, 3), round(lat, 3), at(p.year, p.month, p.day, lt), best == null ? null : Math.round(best), 1, String(p.event ?? '').trim() || null, null, null, null, word, p.confirmation === 'yes' ? 1 : 0]);
    }
    log(`  ${nhp.length} research-database storms (${placedByName} placed by name, ${dropped} with no usable location); ${pieces} swath pieces joined`);
    out.sort((a, b) => a[2] - b[2]);
    await writeOut('hail', {
      source: 'Northern Hail Project, Western University: MESH hail swaths (2022–2024) and NHP Research Database, CC BY-NC 4.0',
      sources: [{ name: 'Radar hail swaths (MESH)', from: 2022, to: 2024 }, { name: 'NHP Research Database', from: Math.min(...out.filter((r) => r[4] === 1).map((r) => Math.floor(r[2]))), to: Math.max(...out.filter((r) => r[4] === 1).map((r) => Math.floor(r[2]))) }],
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

  // ECCC National Air Pollution Surveillance (NAPS): hourly PM2.5, one CSV per year for all of Canada (~10 MB).
  // Each file is streamed and only its Saskatchewan rows are cached. A smoke day is a calendar day (local
  // standard time) whose 24-hour mean PM2.5 is above 25 µg/m³ (the WHO 2005 24-hour guideline; Canada's
  // 2020 CAAQS is 27). A day needs 18 of 24 valid hours (75 %), and a station-year counts only with 75 % of
  // its days valid overall and 75 % of its May–September (wildfire season) days valid.
  async smoke() {
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
  },

  // AAFC Canadian Drought Monitor: the monthly D0–D4 drought map, read from AAFC's image service as raw categories on a
  // 10 km Web Mercator grid over Saskatchewan (one small request a month, cached), clipped to the province and
  // run-length encoded. Each place takes the category of the grid cell its centre is in.
  async drought() {
    const { clipFeature } = await getProvince();
    const places = await getPlaces();
    const SVC = 'https://agriculture.canada.ca/imagery-images/rest/services/canadian_drought_monitor/ImageServer';
    const day = new Date().toISOString().slice(0, 10);
    const cat = await cachedJSON(`drought/catalog-${day}.json`, `${SVC}/query?${new URLSearchParams({ where: '1=1', outFields: 'OBJECTID,Name', returnGeometry: 'false', orderByFields: 'Name', f: 'json' })}`);
    const items = (cat.features ?? []).map((f) => ({ id: f.attributes.OBJECTID, name: String(f.attributes.Name).toLowerCase() }))
      .map((r) => ({ ...r, m: /^cdm_(\d{4})_(\d{2})_\d{2}$/.exec(r.name) })).filter((r) => r.m)
      .map((r) => ({ id: r.id, name: r.name, ym: `${r.m[1]}-${r.m[2]}` }))
      .sort((a, b) => a.ym.localeCompare(b.ym));
    if (items.length < 100) throw new Error(`drought catalogue has only ${items.length} monthly maps`);
    // the grid: 10 km cells in Web Mercator (the service's own projection), snapped to whole cells
    const R = 6378137, PX = 10000;
    const mx = (lon) => (R * lon * Math.PI) / 180, my = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const ulon = (x) => (x / R) * (180 / Math.PI), ulat = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
    const x0 = Math.floor(mx(-110.05) / PX) * PX, x1 = Math.ceil(mx(-101.3) / PX) * PX;
    const y0 = Math.floor(my(48.95) / PX) * PX, y1 = Math.ceil(my(60.05) / PX) * PX;
    const W = (x1 - x0) / PX, H = (y1 - y0) / PX;
    // which cells are in the province, and each one's ground area (a Mercator cell shrinks by cos² of its latitude)
    const inside = new Uint8Array(W * H), area = new Float64Array(W * H);
    for (let r = 0; r < H; r++) {
      const lat = ulat(y1 - (r + 0.5) * PX);
      for (let c = 0; c < W; c++) {
        const lon = ulon(x0 + (c + 0.5) * PX);
        if (booleanPointInPolygon([lon, lat], clipFeature)) { inside[r * W + c] = 1; area[r * W + c] = Math.cos((lat * Math.PI) / 180) ** 2; }
      }
    }
    const total = area.reduce((a, b) => a + b, 0);
    const cell = (lon, lat) => {
      const c = Math.floor((mx(lon) - x0) / PX), r = Math.floor((y1 - my(lat)) / PX);
      return c >= 0 && c < W && r >= 0 && r < H ? r * W + c : -1;
    };
    // pixel values: -1 no drought, 0–4 D0–D4, 5 not analyzed (the early maps covered farmland only)
    const CH = { [-1]: 'a', 0: 'b', 1: 'c', 2: 'd', 3: 'e', 4: 'f', 5: 'n' };
    const months = [], maps = [], share = [];
    const towns = Object.fromEntries(places.map((p) => [p.key, '']));
    const raw = await pool(items, 4, async (it) => {
      const mosaic = JSON.stringify({ mosaicMethod: 'esriMosaicLockRaster', lockRasterIds: [it.id] });
      const q = new URLSearchParams({ bbox: `${x0},${y0},${x1},${y1}`, bboxSR: '3857', imageSR: '3857', size: `${W},${H}`, format: 'bsq', pixelType: 'S8', interpolation: 'RSP_NearestNeighbor', mosaicRule: mosaic, f: 'image' });
      // band-sequential bytes, followed by a 1-bit validity mask
      const buf = await cached(`drought/${it.name}-${PX / 1000}km.bin`, async () => {
        const b = await fetchBuf(`${SVC}/exportImage?${q}`, { timeout: 120_000 });
        if (b.length < W * H) throw new Error(`drought ${it.name}: got ${b.length} bytes, expected ${W * H}`);
        return b;
      });
      return new Int8Array(buf.buffer, buf.byteOffset, W * H);
    });
    items.forEach((it, i) => {
      const px = raw[i];
      let rle = '', run = 0, prev = '';
      const s = [0, 0, 0, 0, 0, 0]; // D0+, D1+, D2+, D3+, D4, not analyzed
      for (let k = 0; k < W * H; k++) {
        const v = px[k];
        const ch = inside[k] ? (CH[v] ?? 'a') : 'a';
        if (inside[k]) { if (v === 5) s[5] += area[k]; else for (let d = 0; d <= Math.min(v, 4); d++) s[d] += area[k]; }
        if (ch === prev) run++;
        else { if (prev) rle += (run > 1 ? run : '') + prev; prev = ch; run = 1; }
      }
      rle += (run > 1 ? run : '') + prev;
      months.push(it.ym);
      maps.push(rle);
      share.push(s.map((v) => Math.round((v / total) * 1000) / 10));
      for (const p of places) { const k = cell(p.lon, p.lat); towns[p.key] += k < 0 ? 'a' : (CH[px[k]] ?? 'a'); }
    });
    log(`${months.length} monthly maps, ${months[0]} to ${months.at(-1)}; grid ${W}×${H}`);
    await writeOut('drought', {
      source: 'Agriculture and Agri-Food Canada, Canadian Drought Monitor (monthly drought areas, image service canadian_drought_monitor)',
      sourceUrl: 'https://open.canada.ca/data/en/dataset/292646cd-619f-4200-afb1-8b2c52f984a2',
      serviceUrl: SVC,
      licence: 'Open Government Licence – Canada', licenceUrl: 'https://open.canada.ca/en/open-government-licence-canada',
      // Web Mercator grid: top-left corner (metres), cell size, columns and rows; bounds in degrees for drawing
      grid: { x0, y1, px: PX, w: W, h: H, bounds: [ulon(x0), ulat(y0), ulon(x1), ulat(y1)].map((v) => round(v, 5)) },
      // per month: the map (run-length: an optional count, then a letter: a none, b–f D0–D4, n not analyzed) and the
      // share of the province's area at D0 or worse, D1+, D2+, D3+, D4, and not analyzed (%)
      months, maps, share,
      // per place, one letter a month: the category of the grid cell its centre is in
      towns,
    });
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

  // Home costs. Census 2021 profile by census subdivision (Statistics Canada's census SDMX API): dwelling values, shelter
  // costs and the share of households spending 30 %+ of income on shelter, for every place. CMHC's Rental Market Survey
  // (average rents and vacancy rates, as Statistics Canada republishes it) for the surveyed centres, year by year.
  async housing() {
    const CHARS = { 1474: 'value', 1472: 'ownCost', 1480: 'rentCost', 1451: 'hh', 1453: 'hh30', 1470: 'own30', 1478: 'rent30', 1401: 'owners', 1402: 'renters' };
    const pick = (vals) => Object.fromEntries(Object.entries(vals).filter(([c]) => CHARS[c]).map(([c, v]) => [CHARS[c], v]));
    const cp = await censusProfile('', Object.keys(CHARS));
    const keys = Object.keys(cp.places).sort();
    const census = {};
    for (const k of keys) {
      const o = pick(cp.places[k].v);
      if (o.hh && o.hh30 != null) o.stir30 = round((o.hh30 / o.hh) * 100, 1);
      delete o.hh30;
      census[k] = { csd: cp.places[k].csd, ...o };
    }
    const prov = pick(cp.prov);
    if (prov.hh && prov.hh30 != null) prov.stir30 = round((prov.hh30 / prov.hh) * 100, 1);
    delete prov.hh30;
    const missing = PLACES_LIST.filter((p) => !census[normalizeName(p.name)]).map((p) => p.name);
    log(`  census: ${keys.length} places matched${missing.length ? `; no CSD for ${missing.join(', ')}` : ''}`);
    const noValue = keys.filter((k) => census[k].value == null);
    if (noValue.length) log('  census: dwelling value suppressed for', noValue.join(', '));

    // CMHC Rental Market Survey (October), row and apartment structures of three units and over, via Statistics Canada
    const rent = {};
    const geoKey = (geo) => normalizeName(geo.split(',')[0]);
    const rentRows = parseCSV(await statcanTable('34100133'));
    for (const r of rentRows) {
      if (!/Saskatchewan/.test(r.GEO) || r['Type of structure'] !== 'Row and apartment structures of three units and over') continue;
      const unit = { 'One bedroom units': 'r1', 'Two bedroom units': 'r2' }[r['Type of unit']];
      const y = Number(r.REF_DATE.slice(0, 4));
      if (!unit || y < 2000 || r.VALUE === '' || r.STATUS === 'F') continue;
      const key = geoKey(r.GEO);
      if (!PLACE_KEYS.has(key)) continue;
      const e = (rent[key] ??= { centre: r.GEO.replace(/, Saskatchewan(\/Alberta)?$/, '').replace(/, Saskatchewan part$/, ' (Saskatchewan part)'), r1: {}, r2: {}, vac: {} });
      e[unit][y] = Number(r.VALUE);
    }
    // vacancy: census metropolitan areas (Regina, Saskatoon) and census agglomerations 10,000+, same structure type
    for (const pid of ['34100130', '34100132']) {
      for (const r of parseCSV(await statcanTable(pid))) {
        const y = Number(r.REF_DATE.slice(0, 4));
        if (!/Saskatchewan/.test(r.GEO) || y < 2000 || r.VALUE === '' || r.STATUS === 'F') continue;
        const key = geoKey(r.GEO);
        if (rent[key]) {
          rent[key].vac[y] = Number(r.VALUE);
          if (/Alberta/.test(r.GEO)) rent[key].vacArea = 'whole census agglomeration (Saskatchewan and Alberta sides)';
        }
      }
    }
    for (const [k, e] of Object.entries(rent)) if (!Object.keys(e.vac).length) { delete e.vac; log(`  CMHC: no vacancy series for ${k}`); }
    const years = Object.values(rent).flatMap((e) => Object.keys(e.r2).map(Number));
    log(`  CMHC: ${Object.keys(rent).length} surveyed centres, ${Math.min(...years)}–${Math.max(...years)}`);
    await writeOut('housing', {
      source: 'Statistics Canada, Census of Population 2021, Census Profile (98-401-X2021006) by census subdivision, via the census SDMX API',
      rentSource: 'CMHC Rental Market Survey via Statistics Canada Tables 34-10-0133-01 (average rents), 34-10-0130-01 and 34-10-0132-01 (vacancy rates); row and apartment structures of three units and over, October',
      prov, census, rent,
    });
  },

  // Property tax. The Ministry of Government Relations' Mill Rate Survey Results (Publications Centre product 72573, one
  // workbook a year, Crown copyright): every city, town, village and northern municipality's uniform municipal mill
  // rate, its residential mill rate factor, whether it uses base or minimum tax, and the school (education) levy on
  // residential assessment. The Publications Centre is sometimes down (HTTP 502); then the product list and workbook come
  // from the Internet Archive's copy of the same URLs. Columns are found by their header text, as the sheets differ.
  // The indicative tax on each place's 2021 census median home: value × 80 % (residential percentage of value) ×
  // (factored residential municipal mill rate + residential education mill rate) ÷ 1000. Base tax, minimum tax, library
  // and special levies are not added. Reads housing.json for the median value.
  async tax() {
    const PRODUCT = 'https://publications.saskatchewan.ca/api/v1/products/72573';
    const PAGE = 'https://www.saskatchewan.ca/government/municipal-administration/taxation-and-service-fees/mill-rate-returns';
    const POV = 0.8;
    const POV_SRC = 'https://www.saskatchewan.ca/government/news-and-media/2020/december/04/property-tax-percentages-of-value-updated-for-2021';
    const { gunzipSync } = await import('node:zlib');
    const wayback = (u) => `https://web.archive.org/web/2026id_/${u}`;
    const unz = (b) => (b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b);
    let product, via = 'Publications Centre';
    try { product = asJSON(await fetchBuf(PRODUCT, { retries: 2, timeout: 60_000, headers: { Accept: 'application/json' } }), 'mill rate product'); } catch (e) {
      log(`  Publications Centre unavailable (${e.message}); using the Internet Archive's copy of the product list`);
      product = asJSON(unz(await fetchBuf(wayback(PRODUCT), { timeout: 120_000 })), 'archived mill rate product');
      via = 'Internet Archive copy of the Publications Centre';
    }
    const fmts = product.productFormats
      .map((f) => ({ id: f.productFormatId, year: Number(/^(\d{4})/.exec(f.description ?? '')?.[1]), file: f.digitalAttributes?.fileName }))
      .filter((f) => f.year && /\.xlsx$/i.test(f.file ?? ''))
      .sort((a, b) => b.year - a.year);
    if (!fmts.length) throw new Error('no yearly workbooks listed in the mill rate product');
    const latest = fmts[0];
    const DL = `${PRODUCT}/formats/${latest.id}/download`;
    const isZip = (b) => b[0] === 0x50 && b[1] === 0x4b;
    const book = await cached(`tax/${latest.file}`, async () => {
      for (const u of [DL, wayback(DL)]) {
        try { const b = unz(await fetchBuf(u, { retries: 2, timeout: 300_000 })); if (isZip(b)) return b; log(`  ${u.slice(0, 60)}… did not return a workbook`); } catch (e) { log(`  ${u.slice(0, 60)}… ${e.message}`); }
      }
      throw new Error(`could not download ${latest.file}`);
    });
    log(`  ${latest.year} survey: ${latest.file} (${(book.length / 1e6).toFixed(1)} MB)`);

    // --- a minimal xlsx reader: shared strings plus each sheet's rows as { column index: text }
    const z = unzipSync(new Uint8Array(book), { filter: (f) => /^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml)$/.test(f.name) });
    const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    const ss = [...strFromU8(z['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
    const rels = Object.fromEntries([...strFromU8(z['xl/_rels/workbook.xml.rels']).matchAll(/<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map((m) => [m[1], m[2].replace(/^\/?(xl\/)?/, 'xl/')]));
    const sheets = [...strFromU8(z['xl/workbook.xml']).matchAll(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)].map((m) => ({ name: dec(m[1]), file: rels[m[2]] }));
    const colIx = (s) => [...s].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
    const readSheet = (file) => {
      const rows = {};
      for (const r of strFromU8(z[file]).matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
        const o = {};
        for (const c of r[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const t = /t="(\w+)"/.exec(c[2])?.[1];
          const v = /<v>([\s\S]*?)<\/v>/.exec(c[3] ?? '')?.[1];
          const val = t === 's' ? ss[+v] : t === 'inlineStr' ? /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3] ?? '')?.[1] : v;
          if (val != null && String(val).trim() !== '') o[colIx(c[1])] = dec(String(val)).trim();
        }
        rows[+r[1]] = o;
      }
      return rows;
    };
    const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

    // municipal sheets: Cities, Towns, Villages, North (row 2 = section headers, row 3 = column headers, col C status, col D name)
    const norm = (s) => normalizeName(s.replace(/\(SK Only\)/i, '').replace(/^city of /i, '').replace(/^town of /i, '')).replace(/[^a-z]/g, '');
    const places = await getPlaces();
    const want = new Map(places.map((p) => [norm(p.name), p]));
    const found = {};
    const STATUS = new Set(['C', 'T', 'NT', 'V', 'NV']);
    for (const sh of sheets.filter((s) => /^(city|cities|towns?|villages?|north)/i.test(s.name))) {
      const rows = readSheet(sh.file);
      const sec = Object.entries(rows[2] ?? {}).map(([k, v]) => [+k, v]).sort((a, b) => a[0] - b[0]);
      const hdr = rows[3] ?? {};
      const col = (section, sub) => {
        const i = sec.findIndex(([, v]) => v.toLowerCase().startsWith(section.toLowerCase()));
        if (i < 0) return null;
        const lo = sec[i][0], hi = sec[i + 1]?.[0] ?? Infinity;
        const hit = Object.entries(hdr).find(([k, v]) => +k >= lo && +k < hi && v.toLowerCase().startsWith(sub.toLowerCase()));
        return hit ? +hit[0] : null;
      };
      const C = {
        uniform: +Object.entries(hdr).find(([, v]) => /^uniform municipal mill rate/i.test(v))?.[0],
        base: +Object.entries(hdr).find(([, v]) => /^base tax$/i.test(v))?.[0],
        min: +Object.entries(hdr).find(([, v]) => /^min tax$/i.test(v))?.[0],
        mrf: col('Municipal Mill Rate Factors', 'Residential'),
        fac: col('Factored Municipal Mill Rate', 'Residential'),
        sA: col('School Taxable Assessment', 'Residential'),
        sL: col('School Tax Levy', 'Residential'),
        mA: col('Municipal Taxable Assessment', 'Residential'),
      };
      if (!C.uniform || !C.sA || !C.sL) { log(`  sheet ${sh.name}: columns not found, skipped`); continue; }
      for (const [n, r] of Object.entries(rows)) {
        if (+n <= 3 || !r[4] || !STATUS.has(r[3])) continue;
        const p = want.get(norm(r[4]));
        if (!p || found[p.key]) continue;
        const uniform = num(r[C.uniform]);
        if (uniform == null || uniform <= 0) continue;
        const f = num(r[C.mrf]);
        const factored = num(r[C.fac]) || (f ? uniform * f : uniform);
        const sA = num(r[C.sA]), sL = num(r[C.sL]);
        found[p.key] = {
          n: r[4], s: r[3], mr: round(uniform, 4), f: f && f !== 1 ? round(f, 4) : undefined, r: round(factored, 4),
          e: sA && sL ? round((sL / sA) * 1000, 2) : null,
          bt: /^y/i.test(r[C.base] ?? '') || undefined, mt: /^y/i.test(r[C.min] ?? '') || undefined,
        };
      }
    }
    const missing = places.filter((p) => !found[p.key]).map((p) => p.name);
    log(`  ${Object.keys(found).length} of ${places.length} places matched${missing.length ? `; not found: ${missing.join(', ')}` : ''}`);

    // the province sets the residential education mill rate: the typical per-place school levy ÷ assessment
    const eds = Object.values(found).map((o) => o.e).filter((v) => v != null).sort((a, b) => a - b);
    const edu = eds[Math.floor(eds.length / 2)];
    let housing = null;
    try { housing = await readOut('housing'); } catch { log('  housing.json missing: no indicative tax'); }
    for (const [k, o] of Object.entries(found)) {
      // Lloydminster is assessed under its own charter (Alberta-style, its own education rate): not comparable
      if (k === 'lloydminster') { o.x = 1; continue; }
      if (o.e != null && Math.abs(o.e - edu) > 0.3) log(`  ${o.n}: residential school levy works out to ${o.e} mills (province ${edu})`);
      const v = housing?.census?.[k]?.value;
      if (v) { o.v = v; o.tax = Math.round((v * POV * (o.r + edu)) / 1000); }
    }
    await writeOut('tax', {
      source: `Government of Saskatchewan, Ministry of Government Relations, ${latest.year} Municipal Mill Rate Survey Results (${latest.file}), via the ${via}`,
      sourceUrl: PAGE, year: latest.year, edu, pov: POV, povSource: POV_SRC,
      places: found,
    });
  },

  // Jobs & income. Labour Force Survey, annual, by economic region (Statistics Canada Table 14-10-0464-01, which replaced the archived 14-10-0393-01): unemployment
  // and employment rates year by year. The LFS publishes Prince Albert (4750) and Northern (4760) only as one combined
  // region, so they share one series and one tinted area. Economic-region outlines: the 2021 cartographic boundary file;
  // each place takes the region its centre lies in. Census 2021 profile per place: median household income and the
  // labour force by industry (NAICS sectors).
  async jobs() {
    await getProvince();
    const places = await getPlaces();
    // --- LFS
    const STATS = { 'Unemployment rate': 'ur', 'Employment rate': 'er', 'Participation rate': 'pr' };
    const lfs = {}, prov = {};
    for (const r of parseCSV(await statcanTable('14100464'))) {
      const stat = STATS[r['Labour force characteristics']];
      if (!stat || !/Saskatchewan$/.test(r.GEO)) continue;
      const y = Number(r.REF_DATE.slice(0, 4));
      // blank or "F" (too unreliable to publish) stays a gap; never filled in
      const v = r.VALUE === '' || r.STATUS === 'F' || r.STATUS === '..' ? null : Number(r.VALUE);
      if (r.GEO === 'Saskatchewan') { if (v != null) (prov[stat] ??= {})[y] = v; continue; }
      const name = r.GEO.replace(/, Saskatchewan$/, '').replace(/-/g, '–');
      const e = (lfs[name] ??= { name, ur: {}, er: {}, pr: {}, gaps: 0 });
      if (v == null) e.gaps++; else e[stat][y] = v;
    }
    const names = Object.keys(lfs);
    if (!names.length) throw new Error('no Saskatchewan economic regions in Table 14-10-0464-01');
    // --- boundaries: Saskatchewan's economic regions 4710–4760
    const ER = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/2';
    const ers = await arcgisAll(ER, { where: "PRUID='47'", outFields: 'ERUID,ERNAME', maxAllowableOffset: '0.002' }, 'er-47', 50);
    const erName = (n) => String(n).split(' / ')[0].replace(/--|-/g, '–');
    const regions = [];
    const regionOfER = {};
    for (const n of names) {
      const e = lfs[n];
      // "Prince Albert and Northern" is two economic regions; every other LFS region is one, matched by name
      const parts = ers.filter((f) => f.geometry && n.split(' and ').some((p) => erName(f.properties.ERNAME) === p));
      if (!parts.length) { log(`  jobs: no boundary for LFS region ${n}`); continue; }
      const idx = regions.length;
      for (const f of parts) regionOfER[f.properties.ERUID] = idx;
      const ps = parts.flatMap((f) => polys(f.geometry, 0.004, 3));
      // label at the largest part's ring centre
      const big = ps.map((p) => p[0]).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
      regions.push({
        name: n, ers: parts.map((f) => `${f.properties.ERUID} ${erName(f.properties.ERNAME)}`).sort(), combined: parts.length > 1,
        ur: e.ur, er: e.er, pr: e.pr,
        c: [round(big.reduce((a, p) => a + p[0], 0) / big.length, 2), round(big.reduce((a, p) => a + p[1], 0) / big.length, 2)],
        polys: ps,
      });
      if (e.gaps) log(`  jobs: ${n} has ${e.gaps} suppressed values`);
    }
    const unmatched = ers.filter((f) => regionOfER[f.properties.ERUID] == null).map((f) => f.properties.ERNAME);
    if (unmatched.length) log(`  jobs: economic regions with no LFS series: ${unmatched.join(', ')}`);
    // each place's region, from the outlines; a centre just outside (on the provincial border) takes the nearest
    const towns = {};
    const inER = (p) => ers.find((f) => f.geometry && booleanPointInPolygon([p.lon, p.lat], { type: 'Feature', properties: {}, geometry: f.geometry }));
    for (const p of places) {
      let f = inER(p);
      if (!f) {
        for (const d of [0.02, 0.05, 0.1]) { f = [[d, 0], [-d, 0], [0, d], [0, -d]].map(([dx, dy]) => inER({ lon: p.lon + dx, lat: p.lat + dy })).find(Boolean); if (f) break; }
        if (f) log(`  jobs: ${p.name} sits just outside the outlines; took ${f.properties.ERNAME}`);
      }
      if (!f) { log(`  jobs: ${p.name} is in no economic region`); continue; }
      towns[p.key] = { r: regionOfER[f.properties.ERUID] ?? null };
    }

    // --- Census 2021: median total household income (2020 incomes), unemployment rate (May 2021), labour force by industry
    const NAICS = { 2262: 'Agriculture, forestry, fishing & hunting', 2263: 'Mining, oil & gas', 2264: 'Utilities', 2265: 'Construction', 2266: 'Manufacturing', 2267: 'Wholesale trade', 2268: 'Retail trade', 2269: 'Transportation & warehousing', 2270: 'Information & culture', 2271: 'Finance & insurance', 2272: 'Real estate', 2273: 'Professional & technical services', 2274: 'Management of companies', 2275: 'Admin & support services', 2276: 'Education', 2277: 'Health care & social assistance', 2278: 'Arts, entertainment & recreation', 2279: 'Accommodation & food', 2280: 'Other services', 2281: 'Public administration' };
    const nIds = Object.keys(NAICS);
    const cp = await censusProfile('jobs-', ['229', '2230', '2261', ...nIds]);
    const profile = (v) => {
      const o = {};
      if (v[229] != null) o.inc = v[229];
      if (v[2230] != null) o.cur = v[2230];
      const all = v[2261];
      if (all) {
        o.lf = all;
        o.ind = nIds.filter((c) => v[c] != null).map((c) => [nIds.indexOf(c), round((v[c] / all) * 100, 1)]).sort((a, b) => b[1] - a[1]).slice(0, 3);
      }
      return o;
    };
    for (const [k, p] of Object.entries(cp.places)) if (towns[k]) Object.assign(towns[k], { csd: p.csd }, profile(p.v));
    const sk = profile(cp.prov);
    const noInc = Object.keys(towns).filter((k) => towns[k].inc == null);
    if (noInc.length) log('  jobs: no census income for', noInc.join(', '));
    const ys = Object.values(lfs).flatMap((e) => Object.keys(e.ur).map(Number));
    log(`  LFS: ${regions.length} regions (${regions.filter((r) => r.combined).map((r) => r.name).join(', ') || 'none'} combined), ${Math.min(...ys)}–${Math.max(...ys)}; ${Object.keys(towns).length} places placed`);
    await writeOut('jobs', {
      source: 'Statistics Canada, Table 14-10-0464-01, Labour force characteristics by province, territory and economic region, annual (Labour Force Survey)',
      censusSource: 'Statistics Canada, Census of Population 2021, Census Profile (98-401-X2021006) by census subdivision, via the census SDMX API',
      areaSource: 'Statistics Canada, 2021 Census Cartographic Boundary Files, economic regions',
      naics: Object.values(NAICS),
      prov: { ur: prov.ur ?? {}, er: prov.er ?? {}, pr: prov.pr ?? {}, ...sk },
      regions, towns,
    });
  },

  // Daily needs: grocery stores, pharmacies, schools, banks and credit unions, gas stations, libraries, post offices and
  // clinics mapped in OpenStreetMap, counted for each place inside its municipal limits (its 2021 census subdivision,
  // Statistics Canada's cartographic boundary) or up to NEEDS_SLACK_KM outside them. A place with no matching census
  // subdivision falls back to a radius around its centre.
  async needs() {
    await getProvince();
    const places = await getPlaces();
    const SLACK_KM = 1, FALLBACK_KM = 3;
    const KINDS = NEEDS_KINDS;

    // municipal limits: Saskatchewan's city, town, village and northern municipality census subdivisions
    const CSD = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/9';
    const csds = await arcgisAll(CSD, { where: "PRUID='47' AND CSDTYPE IN ('CY','T','VL','NV','NT','NH')", outFields: 'CSDUID,CSDNAME,CSDTYPE', maxAllowableOffset: '0.0002' }, 'csd-47-municipal', 500);
    const TYPE = { CY: 'City', T: 'Town', VL: 'Village', NV: 'Northern village', NT: 'Northern town', NH: 'Northern hamlet' };
    const area = {};
    for (const f of csds) {
      const key = normalizeName(String(f.properties.CSDNAME).replace(/\((part|partie)\)/i, ''));
      if (PLACE_KEYS.has(key) && !area[key] && f.geometry) area[key] = { name: `${String(f.properties.CSDNAME).replace(/ \((part|partie)\)$/i, ' (Saskatchewan part)')}, ${TYPE[f.properties.CSDTYPE] ?? f.properties.CSDTYPE}`, geom: f.geometry };
    }
    const bboxOf = (geom) => {
      const b = [Infinity, Infinity, -Infinity, -Infinity];
      const ps = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
      for (const p of ps) for (const [x, y] of p[0]) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
      return [b[0] - 0.03, b[1] - 0.02, b[2] + 0.03, b[3] + 0.02];
    };

    const osm = await needsOSM();
    const all = [];
    for (const e of osm.elements) {
      const t = e.tags ?? {};
      const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
      if (lon == null || !inSask(lon, lat, 0.05)) continue;
      const k = KINDS.findIndex((x) => x.test(t));
      if (k < 0) continue;
      const name = (t.name ?? t.brand ?? '').trim();
      // the same place mapped twice (a point inside its building outline): same kind, close, same name or one unnamed
      const dup = all.find((s) => s.k === k && distKm(s.lon, s.lat, lon, lat) < 0.15 && (!s.name || !name || normalizeName(s.name) === normalizeName(name)));
      if (dup) { if (!dup.name && name) dup.name = name; continue; }
      all.push({ lon, lat, k, name, osm: `${e.type[0]}${e.id}` });
    }

    const towns = {}, areas = {}, used = new Set();
    for (const p of places) {
      const a = area[p.key];
      const n = KINDS.map(() => 0);
      const take = (s, i) => { n[s.k]++; used.add(i); };
      if (a) {
        const f = { type: 'Feature', properties: {}, geometry: a.geom };
        const [w, s0, e0, n0] = bboxOf(a.geom);
        all.forEach((s, i) => {
          if (s.lon < w || s.lon > e0 || s.lat < s0 || s.lat > n0) return;
          if (booleanPointInPolygon([s.lon, s.lat], f) || edgeKm(s.lon, s.lat, a.geom) <= SLACK_KM) take(s, i);
        });
        towns[p.key] = { n, how: 'csd', csd: a.name };
        areas[p.key] = polys(a.geom, 0.0004, 4);
      } else {
        all.forEach((s, i) => { if (distKm(p.lon, p.lat, s.lon, s.lat) <= FALLBACK_KM) take(s, i); });
        towns[p.key] = { n, how: 'radius', r: FALLBACK_KM };
      }
    }
    // keep only the sites that count for some place: [lon, lat, kind, name, osm id]
    const sites = [];
    all.forEach((s, i) => { if (used.has(i)) sites.push([round(s.lon, 5), round(s.lat, 5), s.k, s.name || null, s.osm]); });
    const radius = places.filter((p) => towns[p.key].how === 'radius').map((p) => p.name);
    log(`  ${all.length} sites in Saskatchewan, ${sites.length} inside the atlas's places; ${places.length - radius.length} places by municipal limits${radius.length ? `, by ${FALLBACK_KM} km radius: ${radius.join(', ')}` : ''}`);
    const met = Object.values(towns).map((t) => t.n.filter((x) => x > 0).length);
    log(`  needs met: ${met.filter((x) => x === KINDS.length).length} places have all ${KINDS.length}, fewest ${Math.min(...met)}`);
    await writeOut('needs', {
      source: 'OpenStreetMap contributors (shop=supermarket, grocery; amenity=pharmacy, school, bank, fuel, library, post_office, clinic, doctors; healthcare=pharmacy, clinic, doctor; ODbL), via Overpass',
      areaSource: 'Statistics Canada, 2021 Census Cartographic Boundary Files, census subdivisions (municipal limits)',
      asOf: new Date().toISOString().slice(0, 10),
      kinds: KINDS.map((k) => k.id), slackKm: SLACK_KM, fallbackKm: FALLBACK_KM,
      sites, towns, areas,
    });
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
    const rows = (await odhfRows()).filter((r) => r.odhf_facility_type === 'Hospitals' && r.latitude && r.longitude);
    const title = odhfTitle;
    // the source's own type is kept so the app can show it
    const isHospital = odhfIsHospital;
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

  // Doctors & clinics: places to see a family doctor or nurse outside an emergency department, from Statistics Canada's
  // ODHF (the Saskatchewan Health Authority's clinics and primary health care centres, the file the hospitals stage
  // reads) and OpenStreetMap (medical clinics and doctors' offices, nurses); pharmacies from OpenStreetMap (the same
  // test as Daily needs). For each place: the drive to the nearest clinic and pharmacy, and how many are in town.
  async doctors() {
    await getProvince();
    const places = await getPlaces();
    // not somewhere to see a family doctor: imaging, labs, dentists, eyes, chiropractors, therapy, mental health and
    // addictions, public health and home care offices, specialists, and school and student sites (for their students only)
    const NOT_PRIMARY = /imaging|\bmri\b|ultrasound|radiolog|x-ray|chiropract|denture|dental|eye ?care|eye institute|optom|lasik|laser|skin|esthetic|hair|audiolog|hearing|counc?sel|mental health|psychiatr|diagnostic|bayshore|home care|home health|\bsha office\b|spmi|public health|laborator|labratory|\blab\b|addiction|alcohol|drug services|therap|physio|massage|kidney|youth services|youth service centre|community health services|cancer|dialysis|cardiology|obstetric|gyn(a)?ecolog|specialist|planned parenthood|fertility|women'?s (clinic|health)|autism|sexual health|student|collegiate|high school|community school/i;
    const SPECIALIST = /radiology|ultrasound|chiropractic|ophthalmology|optometry|plastic_surgery|psychiatry|fertility|orthopaedics|cardiology|gynaecology|dermatology/;
    const kindOf = (name, extra = '') => (/nurse practitioner|nursing station/i.test(`${name} ${extra}`) ? 'np'
      : /primary (health|care)|health (cent(re|er)|complex|facility|clinic|department|services)|community health|wellness|union health/i.test(`${name} ${extra}`) ? 'phc' : 'md');
    const walkIn = (s) => /walk-?\s?in|minor emergency|urgent care/i.test(s);
    const near = (a, b, km) => distKm(a.lon, a.lat, b.lon, b.lat) < km;
    const word = (s) => normalizeName(s).split(' ').find((w) => w.length > 2 && !/^(the|dr)$/.test(w)) ?? '';

    // --- ODHF (Saskatchewan Health Authority sites)
    const byKey = new Map(places.map((p) => [p.key, p]));
    const clinics = [];
    let odhfNoPoint = 0, odhfPlaced = 0;
    for (const r of await odhfRows()) {
      const type = r.source_facility_type ?? '';
      const amb = r.odhf_facility_type === 'Ambulatory health care services';
      const hospLike = r.odhf_facility_type === 'Hospitals' && !odhfIsHospital(r);
      if (!amb && !hospLike) continue;
      if (NOT_PRIMARY.test(`${r.facility_name} ${type}`) || /psychiatric|youth lodge/i.test(r.facility_name)) continue;
      if (amb && !/clinic|primary|medical|medicenter|health cent|health complex|health facility|community health|nursing station|walk-in|emergency/i.test(`${r.facility_name} ${type}`)) continue;
      const f = { n: odhfTitle(r.facility_name), city: r.city ? odhfTitle(r.city) : null, k: kindOf(r.facility_name, type), src: 's' };
      if (walkIn(`${r.facility_name} ${type}`)) f.w = 1;
      if (r.latitude && r.longitude) {
        f.lon = +r.longitude; f.lat = +r.latitude;
        if (!inSask(f.lon, f.lat, 0.02)) continue;
      } else {
        // no point in the file: put it at its town's centre when the town is one of the atlas's places
        odhfNoPoint++;
        const p = byKey.get(normalizeName(r.city ?? ''));
        if (!p) continue;
        Object.assign(f, { lon: p.lon, lat: p.lat, approx: 1 });
        odhfPlaced++;
      }
      // the same site listed twice
      const dup = clinics.find((g) => near(g, f, 0.3) && (normalizeName(g.n) === normalizeName(f.n) || word(g.n) === word(f.n)));
      if (dup) { if (dup.approx && !f.approx) Object.assign(dup, { lon: f.lon, lat: f.lat, approx: undefined }); continue; }
      clinics.push(f);
    }
    const nOdhf = clinics.length;

    // --- OpenStreetMap: clinics and doctors (Daily needs' test), plus nurses and health centres
    const osm = await needsOSM();
    const extra = await overpass('sk-doctors.json', `[out:json][timeout:180];(nwr["healthcare"~"^(nurse|centre)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center tags qt;`);
    const isClinic = NEEDS_KINDS.find((k) => k.id === 'clinic').test, isPharmacy = NEEDS_KINDS.find((k) => k.id === 'pharmacy').test;
    const pharmacies = [];
    let osmClinics = 0, merged = 0;
    for (const e of [...osm.elements, ...extra.elements]) {
      const t = e.tags ?? {};
      const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
      if (lon == null || !inSask(lon, lat, 0.05)) continue;
      const name = (t.name ?? t.brand ?? '').trim();
      const city = t['addr:city'] ?? null;
      if (isPharmacy(t)) {
        if (pharmacies.some((s) => near(s, { lon, lat }, 0.15) && (!s.n || !name || normalizeName(s.n) === normalizeName(name)))) continue;
        pharmacies.push({ n: name || 'Pharmacy', city, k: 'rx', lon, lat, src: 'o', osm: `${e.type}/${e.id}` });
        continue;
      }
      const nurse = t.healthcare === 'nurse';
      if (!isClinic(t) && !nurse && t.healthcare !== 'centre') continue;
      const spec = t['healthcare:speciality'] ?? '';
      if (NOT_PRIMARY.test(name) || (SPECIALIST.test(spec) && !/general|family|community/.test(spec))) continue;
      const f = { n: name || (nurse ? 'Nurse' : t.amenity === 'doctors' ? 'Doctor’s office' : 'Clinic'), city, k: nurse ? 'np' : kindOf(name, spec), lon, lat, src: 'o', osm: `${e.type}/${e.id}` };
      if (walkIn(name) || t.walk_in === 'yes') f.w = 1;
      // the same site in ODHF or mapped twice in OSM: close by, and the same first word or one unnamed
      const dup = clinics.find((g) => near(g, f, 0.12) || (name && near(g, f, 0.6) && word(g.n) === word(f.n)));
      if (dup) {
        if (dup.src === 's') { dup.src = 'os'; dup.osm = f.osm; merged++; if (dup.approx) Object.assign(dup, { lon, lat, approx: undefined }); }
        if (f.w) dup.w = 1;
        continue;
      }
      osmClinics++;
      clinics.push(f);
    }
    for (const s of [...clinics, ...pharmacies]) { s.lon = round(s.lon, 5); s.lat = round(s.lat, 5); for (const k of Object.keys(s)) if (s[k] === undefined || s[k] === null) delete s[k]; }
    const tally = (k) => clinics.filter((c) => c.k === k).length;
    log(`  ODHF: ${nOdhf} SHA clinics and health centres (${odhfNoPoint} without a point in the file, ${odhfPlaced} of them put at their town's centre); OSM: ${merged} of them matched, ${osmClinics} more; ${tally('md')} medical clinics or doctors' offices, ${tally('phc')} primary health care or health centres, ${tally('np')} nurse sites, ${clinics.filter((c) => c.w).length} walk-in; ${pharmacies.length} pharmacies`);

    // --- in town: inside the place's limits (needs.json) or within the same slack, like Daily needs
    let needs = null;
    try { needs = await readOut('needs'); } catch { log('  needs.json missing: run the needs stage for town limits'); }
    const inTown = (p, s) => {
      const a = needs?.areas?.[p.key];
      if (a?.length) {
        const geom = { type: 'MultiPolygon', coordinates: a };
        return booleanPointInPolygon([s.lon, s.lat], { type: 'Feature', properties: {}, geometry: geom }) || edgeKm(s.lon, s.lat, geom) <= (needs.slackKm ?? 1);
      }
      return distKm(p.lon, p.lat, s.lon, s.lat) <= (needs?.fallbackKm ?? 3);
    };

    // --- drives
    const sites = [...clinics.sort((a, b) => b.lat - a.lat), ...pharmacies.sort((a, b) => b.lat - a.lat)];
    const idx = sites.map((s, i) => ({ ...s, i }));
    // a site placed at its town's centre counts in town, but is not a drive target (the drive would be a guess)
    const sets = { c: idx.filter((s) => s.k !== 'rx' && !s.approx), p: idx.filter((s) => s.k === 'rx') };
    const towns = Object.fromEntries(places.map((p) => [p.key, {
      nc: clinics.filter((s) => inTown(p, s)).length, np: pharmacies.filter((s) => inTown(p, s)).length,
    }]));
    let routed = true;
    for (const [k, list] of Object.entries(sets)) {
      const d = await driveTimes(places, list, `doctors-${k}`, { keep: 1 });
      routed &&= d.routed;
      for (const [key, v] of Object.entries(d.towns)) if (v[0]) towns[key][k] = { ...v[0], f: list[v[0].f].i };
    }
    const none = places.filter((p) => !towns[p.key].nc).map((p) => p.name);
    log(`  ${places.length - none.length} of ${places.length} places have a clinic in town${none.length ? `; none: ${none.join(', ')}` : ''}`);
    // Neither list has most private family practices, so a regional centre like Yorkton can show no clinic. INFERRED: a
    // place with no clinic mapped but a hospital in town (hospitals.json) gets `h`, that hospital and its drive, since
    // its doctors usually practise at or beside it. The app says so.
    let hosp = null;
    try { hosp = await readOut('hospitals'); } catch { log('  hospitals.json missing: run the hospitals stage for the in-town hospital rule'); }
    const withHosp = [];
    for (const p of places) {
      if (towns[p.key].nc || !hosp) continue;
      const tr = (hosp.towns[p.key] ?? []).find((t) => hosp.facilities[t.f]?.hospital && inTown(p, hosp.facilities[t.f]));
      if (!tr) continue;
      const f = hosp.facilities[tr.f];
      towns[p.key].h = { n: f.name, min: tr.min, km: tr.km, lon: f.lon, lat: f.lat };
      withHosp.push(p.name);
    }
    if (withHosp.length) log(`  no clinic mapped but a hospital in town (inferred doctors): ${withHosp.join(', ')}`);

    await writeOut('doctors', {
      source: 'Statistics Canada, Open Database of Healthcare Facilities (ODHF v1), Saskatchewan ambulatory health care services and non-hospital health centres',
      osmSource: 'OpenStreetMap contributors (amenity=clinic, doctors; healthcare=clinic, doctor, nurse, centre; amenity=pharmacy, healthcare=pharmacy; ODbL), via Overpass',
      areaSource: needs?.areaSource ?? null,
      routing: routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line',
      routingSource: routed ? 'Drive times: OSRM demo server, © OpenStreetMap contributors (ODbL)' : null,
      // The Saskatchewan Health Authority posts temporary emergency-department and service disruptions only as notices
      // on a web page (saskhealthauthority.ca/news-events/service-disruptions), with no feed or data file, so none are mapped.
      disruptions: null,
      disruptionsUrl: 'https://www.saskhealthauthority.ca/news-events/service-disruptions',
      asOf: new Date().toISOString().slice(0, 10),
      slackKm: needs?.slackKm ?? 1, fallbackKm: needs?.fallbackKm ?? 3,
      sites, towns,
    });
  },

  // Childcare: the Ministry of Education's regulated child care facilities, as listed on saskatchewan.ca's "Find a child
  // care provider" page. The page is plain HTML: one <li> per facility (type and options, name, address, phone) and a
  // `window.pageList = [{lat, lng}, …]` array in the same order. Both are read as text, never run. Centres keep their
  // name and point; family child care homes are people's homes, so only a count per community is kept, at a rounded
  // point. The list gives no licensed capacity (spaces). Crown copyright: non-commercial reproduction only.
  async childcare() {
    await getProvince();
    const places = await getPlaces();
    const URL_ = 'https://www.saskatchewan.ca/residents/family-and-social-support/child-care/find-a-child-care-provider-in-my-community';
    const html = (await cached('childcare/find-a-child-care-provider.html', async () => {
      const b = await fetchBuf(URL_, { headers: { 'User-Agent': 'Mozilla/5.0 (LivingSkiesAtlas open-data build script)', Accept: 'text/html' } });
      if (!/window\.pageList\s*=/.test(b.toString('utf8'))) throw new Error('child care page: no facility list found');
      return b;
    })).toString('utf8');
    const decode = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
      .replace(/�/g, '–').replace(/\s+/g, ' ').trim();
    const list = html.slice(html.indexOf('class="map-result"'));
    const items = [...list.matchAll(/<li>\s*([\s\S]*?)<br \/>\s*<strong>([\s\S]*?)<\/strong><br \/>\s*([\s\S]*?)<br \/>/g)]
      .map((m) => ({ tags: decode(m[1]), name: decode(m[2]), addr: decode(m[3]) }));
    const pts = JSON.parse(html.match(/window\.pageList\s*=\s*(\[[\s\S]*?\]);/)[1]);
    if (!items.length || items.length !== pts.length) throw new Error(`child care page: ${items.length} facilities but ${pts.length} points`);
    // the community: the address part before ", SK"
    // (a few addresses have no comma before the community: keep what follows the last street word)
    const STREET = /^.*\b(street|st|avenue|ave|crescent|cres|drive|dr|road|rd|boulevard|blvd|way|lane|place|court|bay|highway|hwy|trail|terrace|green|close)\.?\s+(?=[A-Z])/i;
    const cityOf = (a) => {
      const m = a.replace(/\s*\(.*?\)/g, '').match(/([^,]+),?\s+SK\b/i);
      if (!m) return null;
      const c = m[1].replace(/^(box|po box|p\.o\. box)\s+\d+\s*/i, '').trim();
      const city = (/\d/.test(c) ? c.replace(STREET, '').replace(/^.*\d\S*\s+/, '') : c).trim();
      // a street with no community after it ("Delainey Road, SK") is no community
      return !city || /\b(street|st|avenue|ave|crescent|cres|drive|dr|road|rd|boulevard|blvd|way|lane|place|court|bay|trail|terrace|green|close)\.?$/i.test(city) ? null : city;
    };
    // centre or home: the listed type; when the page gives none, a name like an organisation is a centre, a person's name a home (inferred)
    const ORG = /cent(re|er)|day ?care|child|early|learn|kid|tot|preschool|nursery|montessori|academy|school|inc\b|ltd|corp|society|association|co-?op|ymca|ywca|program|head ?start|nation|band|club|play|little|sunshine|rainbow|daycare|care\b|families|family centre|university|college/i;
    const centres = [], homes = [];
    let inferred = 0, noPoint = 0;
    items.forEach((it, i) => {
      const t = it.tags.toLowerCase();
      const isCentre = /\bcentre\b/.test(t.replace(/teen parent infant centre/, 'centre')) ? true : /\bhome\b/.test(t) ? false : (inferred++, ORG.test(it.name));
      let lon = pts[i]?.lng, lat = pts[i]?.lat;
      if (lon == null || lat == null || !inSask(lon, lat, 0.05)) { noPoint++; lon = lat = null; }
      const flags = {};
      if (/infants/.test(t)) flags.i = 1;
      if (/francophone/.test(t)) flags.f = 1;
      if (/24 hours|extended hours/.test(t)) flags.x = 1;
      if (/teen parent/.test(t)) flags.t = 1;
      const city = cityOf(it.addr);
      if (isCentre) centres.push({ n: it.name.replace(/\s+\.$/, ''), city, lon, lat, ...flags });
      else homes.push({ city, lon, lat, g: /group family/.test(t) ? 1 : 0, ...flags });
    });
    log(`  ${items.length} regulated facilities: ${centres.length} centres, ${homes.length} family child care homes (${inferred} with no type listed, classed by name), ${noPoint} with no point`);

    // --- in town: inside the place's limits (needs.json) or within its slack, like Daily needs
    let needs = null;
    try { needs = await readOut('needs'); } catch { log('  needs.json missing: run the needs stage for town limits'); }
    const inTown = (p, s) => {
      const a = needs?.areas?.[p.key];
      if (a?.length) {
        const geom = { type: 'MultiPolygon', coordinates: a };
        return booleanPointInPolygon([s.lon, s.lat], { type: 'Feature', properties: {}, geometry: geom }) || edgeKm(s.lon, s.lat, geom) <= (needs.slackKm ?? 1);
      }
      return distKm(p.lon, p.lat, s.lon, s.lat) <= (needs?.fallbackKm ?? 3);
    };
    // The ministry's points are approximate and some are far off (Unity's daycare sits 39 km north of town). A facility
    // whose address is in one of the atlas's places but whose point is outside it, or missing, moves to that place's
    // centre (`approx`). Others with no point are dropped.
    const byKey = new Map(places.map((p) => [p.key, p]));
    let snapped = 0;
    for (const f of [...centres, ...homes]) {
      const p = f.city ? byKey.get(normalizeName(f.city)) : null;
      if (p && (f.lon == null || !inTown(p, f))) { Object.assign(f, { lon: p.lon, lat: p.lat, approx: 1 }); snapped++; }
    }
    for (const list of [centres, homes]) for (let j = list.length - 1; j >= 0; j--) if (list[j].lon == null) list.splice(j, 1);
    for (const c of centres) { c.lon = round(c.lon, 5); c.lat = round(c.lat, 5); }
    log(`  ${snapped} facilities in the atlas's places moved to their town's centre (point outside town or missing); ${centres.length} centres and ${homes.length} homes kept`);

    // homes, grouped by community at a point rounded to 0.02° (about 2 km), so no home address is published
    const groups = new Map();
    for (const h of homes) {
      const k = normalizeName(h.city ?? `${round(h.lon, 1)},${round(h.lat, 1)}`);
      const g = groups.get(k) ?? { city: h.city, lons: [], lats: [], n: 0, g: 0, i: 0 };
      g.lons.push(h.lon); g.lats.push(h.lat); g.n++; g.g += h.g; g.i += h.i ?? 0;
      groups.set(k, g);
    }
    const r2 = (v) => Math.round(v * 50) / 50, mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const homeSites = [...groups.values()].map((g) => ({ city: g.city, lon: r2(mean(g.lons)), lat: r2(mean(g.lats)), n: g.n, g: g.g, i: g.i }));
    log(`  homes grouped into ${homeSites.length} communities (${homeSites.filter((h) => !h.city).length} with no community in the address)`);
    centres.sort((a, b) => b.lat - a.lat);
    const towns = Object.fromEntries(places.map((p) => {
      const c = centres.filter((s) => inTown(p, s)), h = homes.filter((s) => inTown(p, s)); // homes at their own points, never published
      return [p.key, { nc: c.length, nh: h.length, ni: c.filter((s) => s.i).length + h.filter((s) => s.i).length }];
    }));
    // drives: the nearest centre (`c`), and the nearest licensed care of any kind (`a`: a centre or a community's homes)
    // A centre moved to its town's centre is not a drive target (the drive would be a guess); a place whose only centres
    // in town were moved gets one of them as "in town" (0 min) instead.
    const real = centres.map((s, i) => ({ lon: s.lon, lat: s.lat, i, approx: s.approx })).filter((s) => !s.approx);
    const any = [...real.map((s) => ({ ...s, h: 0 })), ...homeSites.map((s, i) => ({ lon: s.lon, lat: s.lat, i, h: 1 }))];
    let routed = true;
    const dc = await driveTimes(places, real, 'childcare-c', { keep: 1 });
    routed &&= dc.routed;
    for (const [key, v] of Object.entries(dc.towns)) if (v[0]) towns[key].c = { ...v[0], f: real[v[0].f].i };
    const da = await driveTimes(places, any, 'childcare-a', { keep: 1 });
    routed &&= da.routed;
    for (const [key, v] of Object.entries(da.towns)) if (v[0]) { const t = any[v[0].f]; towns[key].a = { ...v[0], f: t.i, h: t.h }; }
    for (const p of places) {
      if (centres.some((s) => !s.approx && inTown(p, s))) continue;
      const j = centres.findIndex((s) => s.approx && inTown(p, s));
      if (j >= 0) { towns[p.key].c = { f: j, min: 0, km: 0 }; towns[p.key].a = { f: j, min: 0, km: 0, h: 0 }; }
    }
    const none = places.filter((p) => !towns[p.key].nc).map((p) => p.name);
    log(`  ${places.length - none.length} of ${places.length} places have a licensed centre in town${none.length ? `; none: ${none.join(', ')}` : ''}`);

    await writeOut('childcare', {
      source: 'Government of Saskatchewan, Ministry of Education: regulated child care facilities (saskatchewan.ca, “Find a child care provider in my community”)',
      sourceUrl: URL_,
      licence: '© Government of Saskatchewan (Crown copyright). Materials may be reproduced for non-commercial purposes, accurately and not as an official version; information identifying private citizens may not be used without their permission',
      licenceUrl: 'https://www.saskatchewan.ca/copyright',
      areaSource: needs?.areaSource ?? null,
      routing: routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line',
      routingSource: routed ? 'Drive times: OSRM demo server, © OpenStreetMap contributors (ODbL)' : null,
      // the provincial list has no licensed capacity; spaces are published only as provincial totals
      spaces: null,
      asOf: new Date().toISOString().slice(0, 10),
      slackKm: needs?.slackKm ?? 1, fallbackKm: needs?.fallbackKm ?? 3,
      centres, homes: homeSites, towns,
    });
  },

  // HIDDEN NEIGHBOURS: the industry an acreage buyer may not notice. Oil and gas wells, oil and gas facilities and
  // provincially licensed pipelines come from the Ministry of Energy and Resources' GeoHub layers; producing mines from
  // the Saskatchewan Mineral Deposit Index (GeoHub); industrial emitters and their releases from ECCC's National
  // Pollutant Release Inventory (latest year published). The Canada Energy Regulator publishes no open geometry for the
  // federally regulated lines, so those are the OpenStreetMap pipelines whose name or operator is a CER-regulated system.
  // Wells (over 100,000) and facilities are binned into ~4 km hexagons for the map; each place counts the real points.
  async industry() {
    await getProvince();
    const places = await getPlaces();
    let needs = null;
    try { needs = await readOut('needs'); } catch { log('  needs.json missing: run the needs stage for town limits'); }
    const EC = 'https://gis.saskatchewan.ca/arcgis/rest/services/Economy';
    const WELL_KM = 5, PIPE_KM = 2, MINE_KM = 25, NPRI_KM = 5, HEX_KM = 4;

    // --- wells: one per surface well id; planned, cancelled and preset licences were never drilled
    const wellRows = await arcgisAll(`${EC}/Petroleum/MapServer/0`, {
      where: "WELLSTATUS NOT LIKE 'Planned%' AND WELLSTATUS <> 'Preset'", outFields: 'WELL_CWI,WELLSTATUS,SURFACELATITUDE,SURFACELONGITUDE',
      returnGeometry: 'false', orderByFields: 'OBJECTID',
    }, 'sk-wells', 2000);
    // 0 active (producing, injecting, drilling, completed or cased), 1 suspended, 2 abandoned (incl. downhole abandoned)
    const wellClass = (s) => (/abandon/i.test(s) ? 2 : /^suspend/i.test(s) ? 1 : 0);
    const wellById = new Map();
    for (const f of wellRows) {
      const p = f.properties, lon = p.SURFACELONGITUDE, lat = p.SURFACELATITUDE;
      if (!p.WELL_CWI || wellById.has(p.WELL_CWI) || !Number.isFinite(lon) || !Number.isFinite(lat) || !inSask(lon, lat, 0.05)) continue;
      wellById.set(p.WELL_CWI, { lon, lat, c: wellClass(p.WELLSTATUS ?? '') });
    }
    const wells = [...wellById.values()];
    const wellTally = [0, 1, 2].map((c) => wells.filter((w) => w.c === c).length);
    log(`  ${wellRows.length} well records, ${wells.length} wells: ${wellTally[0]} active, ${wellTally[1]} suspended, ${wellTally[2]} abandoned`);
    if (wells.length < 10000) throw new Error(`only ${wells.length} wells came back from the GeoHub`);

    // --- oil and gas facilities (batteries, satellites, injection, compression, gas plants): operating or built
    const facRows = await arcgisAll(`${EC}/Petroleum/MapServer/17`, {
      where: "INFRSTATUS IN ('Operating','Constructed')", outFields: 'LICTYPE', maxAllowableOffset: '0.005', orderByFields: 'OBJECTID',
    }, 'sk-og-facilities', 1000);
    const facilities = facRows.flatMap((f) => {
      const ring = f.geometry?.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates[0][0] : null;
      if (!ring?.length) return [];
      const xs = ring.map((c) => c[0]), ys = ring.map((c) => c[1]);
      const lon = (Math.min(...xs) + Math.max(...xs)) / 2, lat = (Math.min(...ys) + Math.max(...ys)) / 2;
      return inSask(lon, lat, 0.05) ? [{ lon, lat, t: f.properties.LICTYPE ?? '' }] : [];
    });
    log(`  ${facilities.length} operating oil and gas facilities`);

    // --- hexagons (pointy-top, HEX_KM centre to corner) on a sinusoidal projection about 106° W
    const LON0 = -106, KY = 110.574;
    const kxAt = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180);
    const hexes = new Map();
    const hexOf = (lon, lat) => {
      const x = (lon - LON0) * kxAt(lat), y = lat * KY;
      const qf = ((Math.sqrt(3) / 3) * x - y / 3) / HEX_KM, rf = ((2 / 3) * y) / HEX_KM, sf = -qf - rf;
      let q = Math.round(qf), r = Math.round(rf); const s = Math.round(sf);
      const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
      if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
      const k = `${q},${r}`;
      if (!hexes.has(k)) {
        const cy = HEX_KM * 1.5 * r, clat = cy / KY, cx = HEX_KM * Math.sqrt(3) * (q + r / 2);
        hexes.set(k, [round(LON0 + cx / kxAt(clat), 3), round(clat, 3), 0, 0, 0, 0]);
      }
      return hexes.get(k);
    };
    for (const w of wells) hexOf(w.lon, w.lat)[2 + w.c]++;
    for (const f of facilities) hexOf(f.lon, f.lat)[5]++;
    log(`  ${hexes.size} hexagons`);

    // --- provincially licensed pipelines (not flowlines: ~95,000 short lines from wells to batteries)
    const pipeRows = await arcgisAll(`${EC}/Pipelines/MapServer/0`, {
      where: "SEGMENTSTATUS <> 'Removed'", outFields: 'LICENCENUMBER,PIPELINENAME,OWNERNAME,SUBSTANCE,SEGMENTSTATUS', maxAllowableOffset: '0.0005', orderByFields: 'OBJECTID',
    }, 'sk-pipelines', 1000);
    const substanceOf = (s) => (/sour/i.test(s) ? 'sour' : /gas/i.test(s) ? 'gas' : /crude|oil|lvp|hvp|liquid/i.test(s) ? 'oil' : /water/i.test(s) ? 'water' : 'other');
    const lineParts = (g) => (g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : []);
    const pipeBy = new Map();
    for (const f of pipeRows) {
      const p = f.properties;
      const live = /operating|construct/i.test(p.SEGMENTSTATUS ?? '');
      const k = `${p.LICENCENUMBER}|${live}`;
      if (!pipeBy.has(k)) pipeBy.set(k, { n: String(p.PIPELINENAME ?? '').trim(), o: String(p.OWNERNAME ?? '').trim(), s: substanceOf(p.SUBSTANCE ?? ''), live, parts: [] });
      pipeBy.get(k).parts.push(...lineParts(f.geometry).filter((l) => l.length >= 2));
    }
    const pipes = [...pipeBy.values()].filter((p) => p.parts.length);
    log(`  ${pipeRows.length} pipeline segments, ${pipes.length} licensed lines (${pipes.filter((p) => p.live).length} operating or being built)`);

    // --- federally regulated (CER) transmission lines, as mapped in OpenStreetMap
    const CER = /alliance|enbridge|lakehead|line 3|keystone|tc energy|transcanada|foothills|northern border|express|cochin|dakota gas|souris valley|westspur|many islands|bakken/i;
    const osm = await overpass('sk-pipelines.json', '[out:json][timeout:240];area["ISO3166-2"="CA-SK"]->.sk;way["man_made"="pipeline"](area.sk);out tags geom qt;');
    const fedBy = new Map();
    for (const e of osm.elements) {
      const t = e.tags ?? {};
      if (!CER.test(`${t.name ?? ''} ${t.operator ?? ''}`) || !e.geometry?.length) continue;
      const name = t.name || t.operator;
      if (!fedBy.has(name)) fedBy.set(name, { n: name, o: t.operator ?? '', s: /gas/i.test(t.substance ?? '') ? 'gas' : /oil/i.test(t.substance ?? '') ? 'oil' : /carbon/i.test(t.substance ?? '') ? 'co2' : 'other', parts: [] });
      // a way that crosses the border is cut to its Saskatchewan runs
      let run = [];
      for (const g of e.geometry) {
        if (inSask(g.lon, g.lat, 0.02)) run.push([g.lon, g.lat]);
        else { if (run.length >= 2) fedBy.get(name).parts.push(run); run = []; }
      }
      if (run.length >= 2) fedBy.get(name).parts.push(run);
    }
    const fed = [...fedBy.values()];
    log(`  OpenStreetMap: ${fed.length} federally regulated lines (${fed.map((f) => f.n).join(', ')})`);

    // --- NPRI: the latest year's file, Saskatchewan facilities, total releases (air, water, land) in tonnes
    const NPRI_DIR = '/substances/plansreports/reporting-facilities-pollutant-release-and-transfer-data/single-year-data-tables-by-facility-releases-transfers-and-disposals';
    let npriFile = null, npriYear = null;
    for (let y = new Date().getFullYear() - 1; y >= new Date().getFullYear() - 4 && !npriFile; y--) {
      try {
        npriFile = await cachedFile(`npri/NPRI-INRP_DataDonnees_${y}.csv`, `https://data-donnees.az.ec.gc.ca/api/file?path=${encodeURIComponent(`${NPRI_DIR}/NPRI-INRP_DataDonnées_${y}.csv`)}`, { timeout: 600_000 });
        npriYear = y;
      } catch (e) { log(`  NPRI ${y}: ${e.message}`); }
    }
    if (!npriFile) throw new Error('no NPRI single-year file found');
    const npriLines = (await fs.readFile(npriFile, 'latin1')).split(/\r?\n/).filter(Boolean);
    const nh = parseCSVLine(npriLines[0]);
    const col = (en) => { const i = nh.findIndex((h) => h.trim().endsWith(`/ ${en}`)); if (i < 0) throw new Error(`NPRI column "${en}" missing`); return i; };
    const C = { id: col('NPRI ID'), co: col('Company Name'), fn: col('Facility Name'), city: col('City'), prov: col('Province'), lat: col('Latitude'), lon: col('Longitude'), n4: col('NAICS 4 Code'), s4: col('NAICS 4 Sector Name (English)'), n6: col('NAICS 6 Code'), s6: col('NAICS 6 Sector Name (English)'), sub: col('Substance Name (English)'), u: col('Units'), tot: col('Total Releases - Total Releases (Excluding Road Dust)') };
    const toT = { tonnes: 1, kg: 1e-3, grams: 1e-6 };
    const tidy = (s) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s(\-/.])([a-z])/g, (_, a, c) => a + c.toUpperCase()) : t; };
    const npriBy = new Map();
    for (const l of npriLines.slice(1)) {
      const r = parseCSVLine(l);
      if (r[C.prov] !== 'SK') continue;
      const lat = Number(r[C.lat]), lon = Number(r[C.lon]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !lat) continue;
      if (!npriBy.has(r[C.id])) npriBy.set(r[C.id], { id: r[C.id], n: tidy(r[C.fn]), c: tidy(r[C.co]), city: tidy(r[C.city]), lon: round(lon, 4), lat: round(lat, 4), n4: r[C.n4], k: r[C.s4], k6: r[C.n6], t: 0, subs: new Map() });
      const f = npriBy.get(r[C.id]);
      const t = (Number(r[C.tot]) || 0) * (toT[r[C.u]] ?? 0);
      f.subs.set(r[C.sub], (f.subs.get(r[C.sub]) ?? 0) + t);
      f.t += t;
    }
    const npri = [...npriBy.values()].map(({ subs, ...f }) => {
      const top = [...subs].sort((a, b) => b[1] - a[1])[0];
      return { ...f, t: round(f.t, 2), ns: subs.size, top: top && top[1] > 0 ? [top[0].replace(/ - .*$/, '').replace(/\s*\(.*\)$/, ''), round(top[1], 2)] : null };
    }).sort((a, b) => b.t - a.t);
    log(`  NPRI ${npriYear}: ${npri.length} Saskatchewan facilities, ${Math.round(npri.reduce((a, f) => a + f.t, 0))} t released`);

    // --- producing mines: the Mineral Deposit Index, plus NPRI-reporting mines it lacks (new and project sites)
    const COMMODITY = { Pot: ['Potash', 'potash'], U: ['Uranium', 'uranium'], Cl: ['Coal', 'coal'], Sal: ['Salt', 'other'], Ss: ['Sodium sulphate', 'other'], Ksu: ['Potassium sulphate', 'other'], Ka: ['Kaolin clay', 'other'], Ben: ['Bentonite', 'other'], Cu: ['Copper and zinc', 'metal'], Au: ['Gold', 'metal'], Ci: ['Clinker shale', 'other'], Pe: ['Peat', 'other'], Ln: ['Leonardite', 'other'], SiS: ['Silica sand', 'other'] };
    const smdi = await arcgisAll(`${EC}/Mineral_Exploration/MapServer/1`, { where: "STATUS = 'Producing Mine'", outFields: 'NAME,COMMODITY,WEBLINK' }, 'sk-mines');
    const mineName = (s) => { let n = String(s ?? '').split(/[,;{]/)[0].trim(); if (/ or /.test(n)) n = n.split(' or ').at(-1).trim(); return n.replace(/\s+Deposit$/, ''); };
    const mines = [];
    for (const f of smdi) {
      const [lon, lat] = f.geometry?.coordinates ?? [];
      const code = f.properties.COMMODITY;
      if (!Number.isFinite(lon) || code === 'He' || mines.some((m) => distKm(m.lon, m.lat, lon, lat) < 2)) continue;
      const [cn, g] = COMMODITY[code] ?? [code, 'other'];
      mines.push({ n: mineName(f.properties.NAME), cm: cn, g, lon: round(lon, 4), lat: round(lat, 4), src: 'smdi', url: /^https:\/\//.test(f.properties.WEBLINK ?? '') ? f.properties.WEBLINK : null });
    }
    const N6 = { 212396: ['Potash', 'potash'], 212291: ['Uranium', 'uranium'], 212116: ['Coal', 'coal'], 212114: ['Coal', 'coal'], 212220: ['Gold', 'metal'], 212233: ['Copper and zinc', 'metal'], 212393: ['Salt', 'other'] };
    let fromNpri = 0;
    for (const f of npri) {
      if (!/^212[123]/.test(f.n4) || !N6[f.k6] || mines.some((m) => distKm(m.lon, m.lat, f.lon, f.lat) < 10)) continue;
      const [cn, g] = N6[f.k6];
      mines.push({ n: f.n, cm: cn, g, lon: f.lon, lat: f.lat, src: 'npri', url: null });
      fromNpri++;
    }
    log(`  ${mines.length} producing mines (${fromNpri} added from NPRI)`);

    // --- per place, measured from the town limits (needs.json) or, without them, from a circle round the centre
    const fallbackKm = needs?.fallbackKm ?? 3;
    const kmFrom = (p) => {
      const a = needs?.areas?.[p.key];
      if (a?.length) {
        const geom = { type: 'MultiPolygon', coordinates: a };
        const feat = { type: 'Feature', properties: {}, geometry: geom };
        return (lon, lat) => (booleanPointInPolygon([lon, lat], feat) ? 0 : edgeKm(lon, lat, geom));
      }
      return (lon, lat) => Math.max(0, distKm(p.lon, p.lat, lon, lat) - fallbackKm);
    };
    const bboxOf = (p) => {
      const a = needs?.areas?.[p.key];
      const pts = a?.length ? a.flat(2) : [[p.lon, p.lat]];
      const xs = pts.map((c) => c[0]), ys = pts.map((c) => c[1]);
      const pad = a?.length ? 0 : fallbackKm;
      return { w: Math.min(...xs), e: Math.max(...xs), s: Math.min(...ys), n: Math.max(...ys), pad };
    };
    const near = (b, lon, lat, km) => {
      const dy = (km + b.pad) / KY, dx = (km + b.pad) / kxAt(lat);
      return lon >= b.w - dx && lon <= b.e + dx && lat >= b.s - dy && lat <= b.n + dy;
    };
    // a line comes within `km` of the town: sample each segment every ~250 m (lines are pre-filtered by bounding box)
    const lineWithin = (parts, b, d, km) => parts.some((l) => l.some((c, i) => {
      if (!i) return near(b, c[0], c[1], km) && d(c[0], c[1]) <= km;
      const [x0, y0] = l[i - 1], steps = Math.max(1, Math.ceil(distKm(x0, y0, c[0], c[1]) / 0.25));
      for (let s = 1; s <= steps; s++) {
        const x = x0 + ((c[0] - x0) * s) / steps, y = y0 + ((c[1] - y0) * s) / steps;
        if (near(b, x, y, km) && d(x, y) <= km) return true;
      }
      return false;
    }));
    const towns = {};
    for (const p of places) {
      const d = kmFrom(p), b = bboxOf(p);
      const w = [0, 0, 0];
      for (const x of wells) if (near(b, x.lon, x.lat, WELL_KM) && d(x.lon, x.lat) <= WELL_KM) w[x.c]++;
      const f = facilities.filter((x) => near(b, x.lon, x.lat, WELL_KM) && d(x.lon, x.lat) <= WELL_KM).length;
      const livePipes = pipes.filter((x) => x.live && lineWithin(x.parts, b, d, PIPE_KM));
      const fedNear = fed.flatMap((x, i) => (lineWithin(x.parts, b, d, PIPE_KM) ? [i] : []));
      let np = null, n5 = 0;
      npri.forEach((x, i) => { const k = d(x.lon, x.lat); if (k <= NPRI_KM) n5++; if (!np || k < np.km) np = { i, km: k }; });
      let mn = null;
      mines.forEach((x, i) => { const k = d(x.lon, x.lat); if (k <= MINE_KM && (!mn || k < mn.km)) mn = { i, km: k }; });
      towns[p.key] = {
        w, f, pl: livePipes.length, sour: livePipes.filter((x) => x.s === 'sour').length, fed: fedNear,
        np: np && { i: np.i, km: round(np.km, 1) }, n5, mn: mn && { i: mn.i, km: round(mn.km, 1) },
      };
    }

    // --- the map's lines: simplified (~300 m) and rounded; abandoned and discontinued lines are counted, not drawn (size)
    const simplify = (parts) => parts.map((l) => dp(l, 0.003).map(([x, y]) => [round(x, 3), round(y, 3)])).filter((l) => l.length >= 2 && !(l.length === 2 && l[0][0] === l[1][0] && l[0][1] === l[1][1]));
    const owners = [...new Set(pipes.filter((p) => p.live).map((p) => p.o))].sort();
    await writeOut('industry', {
      source: 'Government of Saskatchewan, Ministry of Energy and Resources: Petroleum (wells, facilities), Pipelines and Mineral Deposit Index layers, Saskatchewan GeoHub (gis.saskatchewan.ca); Environment and Climate Change Canada, National Pollutant Release Inventory; OpenStreetMap (federally regulated pipelines)',
      licence: 'Government of Saskatchewan Standard Unrestricted Use Data Licence v2.0; Open Government Licence – Canada; ODbL',
      licenceUrl: 'https://gisappl.saskatchewan.ca/Html5Ext/Resources/GOS_Standard_Unrestricted_Use_Data_Licence_v2.0.pdf',
      npriUrl: 'https://data-donnees.az.ec.gc.ca/data/substances/plansreports/reporting-facilities-pollutant-release-and-transfer-data/single-year-data-tables-by-facility-releases-transfers-and-disposals',
      asOf: new Date().toISOString().slice(0, 10), npriYear,
      wellKm: WELL_KM, pipeKm: PIPE_KM, mineKm: MINE_KM, npriKm: NPRI_KM, hexKm: HEX_KM, fallbackKm,
      totals: { wells: wellTally, facilities: facilities.length, pipes: pipes.filter((p) => p.live).length, oldPipes: pipes.filter((p) => !p.live).length, sour: pipes.filter((p) => p.live && p.s === 'sour').length },
      hexes: [...hexes.values()].sort((a, b) => b[1] - a[1] || a[0] - b[0]),
      pipes: pipes.filter((p) => p.live).map((p) => ({ n: p.n && p.n !== p.o ? p.n : null, o: owners.indexOf(p.o), s: p.s, p: simplify(p.parts) })).filter((p) => p.p.length),
      owners,
      fed: fed.map((p) => ({ n: p.n, o: p.o, s: p.s, p: simplify(p.parts) })),
      npri: npri.map(({ id, n4, k6, ...f }) => ({ ...f, lon: round(f.lon, 3), lat: round(f.lat, 3) })),
      mines, towns,
    });
  },

  // DRINKING WATER: the advisories in effect today. The province publishes no data feed, only two PDF reports linked
  // from saskatchewan.ca: waterworks regulated by the Water Security Agency or the Ministry of Environment (town and
  // village systems, rural pipelines, provincial parks) and public water supplies regulated by the Saskatchewan Health
  // Authority (lodges, campgrounds, restaurants, small wells). Neither gives a location, so each is placed by its name
  // with the Canadian Geographical Names Database (a town, park or reserve named in it, else a named lake), and the rest
  // are listed, not mapped. First Nations advisories come from Indigenous Services Canada: the long-term ones from its
  // map's data file (with coordinates) and the short-term ones from its web table, placed at their community.
  async water() {
    await getProvince();
    const places = await getPlaces();
    const NEAR_KM = 25;
    const today = new Date().toISOString().slice(0, 10);
    const GOC = 'https://waterquality.saskatchewan.ca/GoCReports';
    const ISC_ST = 'https://www.sac-isc.gc.ca/eng/1562856509704/1562856530304';
    const ISC_LT = 'https://www.sac-isc.gc.ca/DAM/DAM-ISC-SAC/DAM-WTR/STAGING/texte-text/lTDWA_map_data_1572010201618_eng.txt';
    // advisories change daily, so the cache is per day
    const envPdf = await cached(`water/EnvActive-${today}.pdf`, () => fetchBuf(`${GOC}/EnvActive.pdf`));
    const rhaPdf = await cached(`water/RhaActive-${today}.pdf`, () => fetchBuf(`${GOC}/RhaActive.pdf`));
    const stHtml = (await cached(`water/isc-short-term-${today}.html`, () => fetchBuf(ISC_ST))).toString('utf8');
    const noBom = (b) => b.toString('utf8').replace(/^﻿/, '');
    const lt = JSON.parse(noBom(await cached(`water/isc-long-term-${today}.json`, async () => { const b = await fetchBuf(ISC_LT); JSON.parse(noBom(b)); return b; })));

    // --- gazetteer: every populated place, reserve and park in Saskatchewan (CGNDB), one feature type at a time (a
    // query mixing types pages unreliably and drops names)
    const KINDS = ['CITY', 'TOWN', 'VILG', 'NV', 'MUN1', 'MUN2', 'UNP', 'HAM', 'IR', 'PARK'];
    const gaz = new Map();
    for (const code of KINDS) {
      for (let skip = 0; skip < 10000; skip += 1000) {
        const res = await cachedJSON(`cgndb/sk-${code}-${skip}.json`, `https://geogratis.gc.ca/services/geoname/en/geonames.json?province=47&concise=${code}&num=1000&skip=${skip}`);
        for (const i of res.items ?? []) {
          const k = normalizeName(i.name);
          const prev = gaz.get(k);
          if (!prev || KINDS.indexOf(code) < KINDS.indexOf(prev.code)) gaz.set(k, { name: i.name, code, lon: i.longitude, lat: i.latitude });
        }
        if ((res.items ?? []).length < 1000) break;
      }
    }
    log(`  ${gaz.size} named places, reserves and parks in the gazetteer`);
    // single words that are place names but also ordinary words in a title
    const COMMON = new Set(['success', 'plenty', 'prairie', 'service', 'central', 'union', 'marsh', 'lodge', 'colony', 'spring', 'valley', 'island', 'beach', 'point', 'park', 'resort', 'well', 'lake', 'water', 'church', 'school', 'station', 'store', 'farm', 'camp', 'north', 'south', 'east', 'west', 'bay', 'river', 'creek', 'hill', 'hills', 'main', 'centre', 'center', 'grand', 'summer', 'fishing', 'forest', 'pleasant', 'regional', 'provincial', 'national', 'staff', 'residence', 'unity', 'leader', 'frontier', 'herbert', 'macoun', 'rural', 'bench', 'churchill', 'thunder', 'eagle', 'garden', 'sunrise', 'heartland']);
    const gazNames = [...gaz.keys()].filter((k) => k.length >= 4).sort((a, b) => b.length - a.length);
    const tidy = (s) => s
      .replace(/\[\s*\d+\s*\]|#\s*\d+/g, ' ')
      .replace(/\bPROV(?:INCIAL)?\.?\s*PK\.?|\bProv\.?\s*(?:Pk\.?|Park)/gi, ' Provincial Park ')
      .replace(/\bCAMPGD\.?/gi, ' Campground ')
      .replace(/\bREG(?:IONAL)?\.?\s*PK\.?/gi, ' Regional Park ')
      .replace(/\s+/g, ' ').trim();
    const sysName = (s) => tidy(s).replace(/\b(WATERWORKS|PIPELINE|WATER DISTRIBUTION SYSTEM|DISTRIBUTION SYSTEM)\b/gi, ' ').replace(/[-\s]+$/, '').replace(/\s+/g, ' ').trim();
    const inBox = (g) => g && Number.isFinite(g.lon) && inSask(g.lon, g.lat, 0.1);
    const scan = (text) => {
      const t = ` ${normalizeName(tidy(text))} `;
      for (const k of gazNames) {
        if (!k.includes(' ') && COMMON.has(k)) continue;
        // "Scott Lake Lodge" is on Scott Lake, not in the town of Scott
        if (t.includes(` ${k} `) && !t.includes(` ${k} lake `) && !t.includes(` ${k} river `)) {
          // a single-word name must be written with a capital in the original
          if (!k.includes(' ') && !new RegExp(`\\b${k[0].toUpperCase()}`, '').test(text)) continue;
          const g = gaz.get(k);
          if (inBox(g)) return g;
        }
      }
      return null;
    };
    const lakeHit = async (text) => {
      const names = [...tidy(text).matchAll(/((?:[A-Z][\w'.]*\s){1,3})Lake\b|\b(?:Lake|Lac)\s((?:[A-Z][\w'.]*\s?){1,3})/g)].map((m) => (m[1] ? `${m[1].trim()} Lake` : `${/^Lac/.test(m[0]) ? 'Lac' : 'Lake'} ${m[2].trim()}`));
      for (const n of names) {
        if (/^(Regional|Provincial|Park|Resort|Lodge|The|Of|And|Site|PDWA|EBWO)\b/.test(n)) continue;
        const res = await cachedJSON(`cgndb/lake-${normalizeName(n).replace(/ /g, '_')}.json`, `https://geogratis.gc.ca/services/geoname/en/geonames.json?${new URLSearchParams({ q: n, province: '47', concise: 'LAKE' })}`);
        const g = (res.items ?? []).find((i) => normalizeName(i.name) === normalizeName(n));
        if (g && inSask(g.longitude, g.latitude, 0.1)) return { name: g.name, lon: g.longitude, lat: g.latitude };
      }
      return null;
    };
    const locate = async (name, area, title) => {
      const own = name ? gaz.get(normalizeName(sysName(name))) ?? gaz.get(`the ${normalizeName(sysName(name))}`) : null;
      if (inBox(own)) return { g: own, loc: 'name' };
      for (const t of [name, area, title]) { if (!t) continue; const g = scan(t); if (g) return { g, loc: 'text' }; }
      for (const t of [name, title]) { if (!t) continue; const g = await lakeHit(t); if (g) return { g, loc: 'lake' }; }
      return null;
    };
    const MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const isoDate = (d) => { const m = d?.match(/^(\d{2})-([A-Z][a-z]{2})-(\d{2})$/); return m ? `${+m[3] > 70 ? 19 : 20}${m[3]}-${MON[m[2]]}-${m[1]}` : null; };
    const kindOf = (k, title) => (/do not (consume|drink|use)/i.test(title ?? '') ? 'dnc' : k === 'EBWO' ? 'boil' : 'pdwa');
    const createdOn = (buf) => { const t = pdfText(buf).find((i) => /^Created on:/.test(i.s))?.s; const d = t && new Date(t.replace(/^Created on:\s*/, '').replace(/ CST/, ' GMT-0600')); return d && !Number.isNaN(+d) ? d.toISOString().slice(0, 10) : today; };

    const sites = [], unplaced = [];
    const add = (s, hit) => {
      if (hit) sites.push({ ...s, lon: round(hit.g.lon, 3), lat: round(hit.g.lat, 3), loc: hit.loc, at: hit.loc === 'name' ? null : hit.g.name });
      else unplaced.push(s);
    };
    // --- provincial lists (PDF)
    for (const [src, buf] of [['wsa', envPdf], ['sha', rhaPdf]]) {
      const rows = advisoryRows(buf);
      if (!rows.length) throw new Error(`${src} advisory PDF: no rows read (has its layout changed?)`);
      for (const r of rows) {
        // the WSA list prints the system in capitals and, below it, the part of the system affected
        const caps = src === 'wsa' ? r.nameLines.filter((l) => l === l.toUpperCase()) : r.nameLines;
        const name = caps.join(' ').replace(/\s+-\s*$/, '').replace(/\s+/g, ' ').trim();
        const area = src === 'wsa' ? r.nameLines.filter((l) => l !== l.toUpperCase()).join(' ').trim() || null : null;
        const title = r.title || null;
        const part = src !== 'wsa' ? null : area && normalizeName(area) !== normalizeName(name) && !/^\(|\b(corp|inc|utility|association)\b/i.test(area) ? area : /\bportion\b|only affects/i.test(title ?? '') ? 'part of the system' : null;
        // a row printed without a system name is named by its title
        const shown = name ? (src === 'wsa' ? sysName(name).replace(/\b([A-Z])([A-Z'.]+)\b/g, (_, a, b) => a + b.toLowerCase()) : tidy(name)) : (title ?? 'Unnamed system');
        const s = {
          n: shown, sys: src === 'wsa' && name ? normalizeName(sysName(name)) : null,
          src, k: kindOf(r.kind, title), d: isoDate(r.date), t: title, why: r.quality || r.operational || null, reg: r.region, part,
        };
        add(s, await locate(name, area, title));
      }
    }
    const provAsOf = createdOn(envPdf);
    // --- First Nations: long-term (with coordinates)
    const comms = (lt.data ?? []).filter((c) => c.ProvinceAcronym === 'SK');
    const iscType = (t) => (/do not (consume|use)/i.test(t ?? '') ? 'dnc' : 'boil');
    for (const c of comms) for (const a of c.LTDWACurrent ?? []) {
      add({ n: (a.WaterSystemName ?? '').trim(), sys: null, src: 'isc', lt: true, k: iscType(a.AdvisoryType), d: a.DateSet || null, t: `${a.AdvisoryType}${a.CorrectiveMeasure ? `. Planned fix: ${a.CorrectiveMeasure.trim()}` : ''}`, why: null, reg: c.CommunityName, pop: a.PopulatioEstimated ?? null, part: null },
        { g: { name: c.CommunityName, lon: a.Longitude ?? +c.Longitude, lat: a.Lattitude ?? +c.Latitude }, loc: 'fn' });
    }
    // --- First Nations: short-term (web table), placed at the community
    const html = stHtml.replace(/<!--[\s\S]*?-->/g, '');
    const sec = html.match(/<section id="sask"[\s\S]*?<\/section>/)?.[0] ?? '';
    const cell = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/\s+/g, ' ').trim();
    const stRows = (sec.split(/<\/tr>/).map((r) => [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cell(m[1]))).filter((c) => c.length >= 6));
    const fnKey = (s) => normalizeName(s).replace(/\b(cree|first|dakota|nation|band|no|indian|reserve|ir)\b|\b\d+[a-z]?\b/g, ' ').replace(/\s+/g, ' ').trim();
    const STT = { BWA: 'boil', DNC: 'dnc', DNU: 'dnc' };
    for (const [fn, community, system, type, set, , pop] of stRows) {
      const c = comms.find((x) => fnKey(x.CommunityName) === fnKey(fn)) ?? comms.find((x) => fnKey(x.CommunityName) === fnKey(community));
      const hit = c ? { g: { name: c.CommunityName, lon: +c.Longitude, lat: +c.Latitude }, loc: 'fn' } : await locate(system, community, fn);
      add({ n: system, sys: null, src: 'isc', lt: false, k: STT[type] ?? 'boil', d: set?.replace(/\//g, '-') || null, t: `${{ BWA: 'Boil water advisory', DNC: 'Do not consume', DNU: 'Do not use' }[type] ?? type}`, why: null, reg: fn, pop: pop ?? null, part: null }, hit);
    }
    const stAsOf = (() => { const m = stHtml.match(/As of <span[^>]*>([^<]+)<\/span>/); const d = m && new Date(m[1].replace(/&nbsp;/g, ' ')); return d && !Number.isNaN(+d) ? d.toISOString().slice(0, 10) : today; })();
    log(`  ${sites.length} advisories placed, ${unplaced.length} not placed (${sites.filter((s) => s.src === 'isc').length} on First Nations; ${stRows.length} short-term)`);
    for (const k of ['name', 'text', 'lake', 'fn']) log(`    placed by ${k}: ${sites.filter((s) => s.loc === k).length}`);

    // --- per place: the town system's own advisories, and every advisory within NEAR_KM of the town centre
    const towns = {};
    for (const p of places) {
      const sys = sites.flatMap((s, i) => (s.src === 'wsa' && s.sys === p.key ? [i] : []));
      const nb = sites.flatMap((s, i) => { const k = distKm(p.lon, p.lat, s.lon, s.lat); return k <= NEAR_KM ? [[i, round(k, 1)]] : []; }).sort((a, b) => a[1] - b[1]);
      const sysUnplaced = unplaced.filter((s) => s.src === 'wsa' && s.sys === p.key).length;
      towns[p.key] = { sys, nb, ...(sysUnplaced ? { su: sysUnplaced } : {}) };
    }
    await writeOut('water', {
      source: 'Water Security Agency / Ministry of Environment and Saskatchewan Health Authority, “PDWA and EBWO currently in effect” reports (waterquality.saskatchewan.ca); Indigenous Services Canada, short-term and long-term drinking water advisories; Natural Resources Canada, Canadian Geographical Names Database (locations)',
      licence: 'Crown copyright, Government of Saskatchewan (non-commercial reproduction); Government of Canada terms (non-commercial reproduction); CGNDB OGL – Canada',
      licenceUrl: 'https://www.saskatchewan.ca/copyright',
      pageUrl: 'https://www.saskatchewan.ca/residents/environment-public-health-and-safety/environmental-health/water-and-wastewater-management/advisories-and-warnings',
      wsaUrl: `${GOC}/EnvActive.pdf`, shaUrl: `${GOC}/RhaActive.pdf`, iscUrl: ISC_ST, iscLtUrl: 'https://www.sac-isc.gc.ca/eng/1506514143353/1533317130660',
      wellUrl: 'https://wsask.ca/drinking-water-wastewater/groundwater/domestic-water-well-management/',
      asOf: today, provAsOf, stAsOf, nearKm: NEAR_KM,
      sites: sites.map(({ sys, ...s }) => s), unplaced: unplaced.map(({ sys, ...s }) => s), towns,
    });
  },

  // Radon: Health Canada's Cross-Canada Survey of Radon Concentrations in Homes (long-term tests in volunteer homes,
  // 2009–2011), one row per home with its 2007 health region and postal FSA. Summarised as the share of tested homes at or
  // above Canada's guideline (200 Bq/m³) for each health region (on StatCan's matching 2007 health region boundaries) and
  // each postal area (FSA, on StatCan's 2021 FSA boundaries), and for each place: its health region and its own FSAs.
  async radon() {
    await getProvince();
    const places = await getPlaces();
    let needs = null;
    try { needs = await readOut('needs'); } catch { log('  needs.json missing: places fall back to the FSA at their centre'); }
    const GUIDE = 200, OLD_GUIDE = 600, FEW = 20;
    const DATASET = 'https://open.canada.ca/data/en/dataset/b3bad1b0-32d4-4656-8a64-59b43900d482';
    const CSV = 'https://open.canada.ca/data/dataset/b3bad1b0-32d4-4656-8a64-59b43900d482/resource/1bf4724b-8f38-4932-9c32-e11a45011dcf/download/radon-concentration.csv';
    const HR_ZIP = 'https://www150.statcan.gc.ca/n1/pub/82-402-x/2011001/data-donnees/boundary-limites/arcinfo/hr047b06-eng.zip';

    // --- the survey: Saskatchewan homes. "<15" (below the detection limit) counts as under every threshold.
    const rows = parseCSV(await fs.readFile(await cachedFile('radon/radon-concentration.csv', CSV), 'latin1')).filter((r) => r.ProvinceTerritory === 'SK');
    if (rows.length < 500) throw new Error(`only ${rows.length} Saskatchewan rows in the radon survey CSV`);
    const tally = () => ({ n: 0, hi: 0, vhi: 0, vals: [] });
    const add = (t, v) => { t.n++; if (v >= GUIDE) t.hi++; if (v >= OLD_GUIDE) t.vhi++; t.vals.push(v); };
    const byHR = {}, byFSA = {}, hrOfFSA = {}, prov = tally();
    for (const r of rows) {
      const raw = r.AverageRadonConcentrationInBqPerM3;
      const v = /^</.test(raw) ? 0 : Number(raw);
      if (!Number.isFinite(v)) continue;
      add(prov, v);
      add(byHR[r.HealthRegionCode2007] ??= tally(), v);
      const f = r.ForwardSortationAreaCodes;
      if (/^S\d[A-Z]$/.test(f)) { add(byFSA[f] ??= tally(), v); ((hrOfFSA[f] ??= {})[r.HealthRegionCode2007] = (hrOfFSA[f][r.HealthRegionCode2007] ?? 0) + 1); }
    }
    const median = (vals) => { const s = [...vals].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
    const summary = (t) => ({ n: t.n, hi: t.hi, vhi: t.vhi, med: median(t.vals) });

    // --- 2007 health region boundaries (StatCan 82-402-X, 2006 census geography; the same Saskatchewan RHAs as in 2007),
    // an ESRI shapefile in Statistics Canada Lambert, read and unprojected here.
    const zip = unzipSync(new Uint8Array(await fs.readFile(await cachedFile('radon/hr047b06-eng.zip', HR_ZIP))));
    const part = (ext) => { const k = Object.keys(zip).find((n) => n.toLowerCase().endsWith(ext)); if (!k) throw new Error(`no ${ext} in the health region zip`); return Buffer.from(zip[k]); };
    const dbf = part('.dbf'), shp = part('.shp');
    const nRec = dbf.readUInt32LE(4), hLen = dbf.readUInt16LE(8), rLen = dbf.readUInt16LE(10);
    const fields = [];
    for (let i = 32; dbf[i] !== 0x0d; i += 32) fields.push({ name: dbf.toString('latin1', i, i + 11).replace(/\0.*$/, ''), len: dbf[i + 16] });
    const attrs = [];
    for (let r = 0; r < nRec; r++) {
      let o = hLen + r * rLen + 1;
      const a = {};
      for (const f of fields) { a[f.name] = dbf.toString('latin1', o, o + f.len).trim(); o += f.len; }
      attrs.push(a);
    }
    // inverse Lambert conformal conic (2SP) on GRS 1980, Statistics Canada's parameters (from the .prj)
    const A = 6378137, FL = 1 / 298.257222101, E = Math.sqrt(FL * (2 - FL)), D2R = Math.PI / 180;
    const LAM0 = -91.86666666666666 * D2R, PHI0 = 63.390675 * D2R, P1 = 49 * D2R, P2 = 77 * D2R, FE = 6200000, FN = 3000000;
    const mF = (p) => Math.cos(p) / Math.sqrt(1 - (E * Math.sin(p)) ** 2);
    const tF = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2);
    const NN = (Math.log(mF(P1)) - Math.log(mF(P2))) / (Math.log(tF(P1)) - Math.log(tF(P2)));
    const FF = mF(P1) / (NN * tF(P1) ** NN), RHO0 = A * FF * tF(PHI0) ** NN;
    const unproject = (x, y) => {
      const dx = x - FE, dy = RHO0 - (y - FN);
      const rho = Math.sign(NN) * Math.hypot(dx, dy);
      const t = (rho / (A * FF)) ** (1 / NN);
      let phi = Math.PI / 2 - 2 * Math.atan(t);
      for (let i = 0; i < 8; i++) phi = Math.PI / 2 - 2 * Math.atan(t * ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2));
      return [(Math.atan2(dx, dy) / NN + LAM0) / D2R, phi / D2R];
    };
    // polygon records: rings in order; clockwise rings are outer, counter-clockwise ones holes in the outer around them
    const shapes = [];
    for (let o = 100; o + 8 <= shp.length;) {
      const len = shp.readInt32BE(o + 4) * 2, s = o + 8;
      o = s + len;
      if (shp.readInt32LE(s) !== 5) { shapes.push(null); continue; }
      const nParts = shp.readInt32LE(s + 36), nPts = shp.readInt32LE(s + 40);
      const starts = Array.from({ length: nParts }, (_, i) => shp.readInt32LE(s + 44 + i * 4));
      const p0 = s + 44 + nParts * 4;
      const rings = starts.map((st, i) => {
        const end = i + 1 < nParts ? starts[i + 1] : nPts;
        const ring = [];
        for (let k = st; k < end; k++) ring.push(unproject(shp.readDoubleLE(p0 + k * 16), shp.readDoubleLE(p0 + k * 16 + 8)));
        return ring;
      });
      const outers = rings.filter((r) => ringArea(r) < 0).map((r) => [r]);
      for (const h of rings.filter((r) => ringArea(r) >= 0)) {
        const host = outers.find((p) => booleanPointInPolygon(h[0], { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [p[0]] } }));
        if (host) host.push(h);
      }
      shapes.push({ type: 'MultiPolygon', coordinates: outers.map((p) => p.map((r) => [...r].reverse())) });
    }
    // the survey merged Mamawetan Churchill River, Keewatin Yatthé and Athabasca (4711–4713) into one region, 4714
    const surveyHR = (uid) => (['4711', '4712', '4713'].includes(uid) ? '4714' : uid);
    const NAMES = { 4714: 'Mamawetan Churchill River, Keewatin Yatthé and Athabasca' };
    const hrGeoms = {};
    attrs.forEach((a, i) => { if (shapes[i]) (hrGeoms[surveyHR(a.HRUID2007)] ??= { names: [], parts: [] }).parts.push(shapes[i]), hrGeoms[surveyHR(a.HRUID2007)].names.push(a.ENG_LABEL); });
    const centre = (ps) => {
      const big = ps.map((p) => p[0]).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
      return [round(big.reduce((s, p) => s + p[0], 0) / big.length, 2), round(big.reduce((s, p) => s + p[1], 0) / big.length, 2)];
    };
    const keepBig = (ps, min) => ps.filter((p) => Math.abs(ringArea(p[0])) > min);
    const regions = Object.keys(byHR).sort().map((id) => {
      const g = hrGeoms[id];
      if (!g) throw new Error(`no boundary for health region ${id}`);
      const ps = keepBig(g.parts.flatMap((geom) => polys(geom, 0.004, 3)), 0.002);
      const name = NAMES[id] ?? g.names[0].replace(/ Regional Health Authority$| Health Authority$/, '').replace('Yatth�', 'Yatthé');
      return { id, name, ...summary(byHR[id]), c: centre(ps), polys: ps };
    });
    const hrFeat = regions.map((r) => ({ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: hrGeoms[r.id].parts.flatMap((g) => g.coordinates) } }));

    // --- FSA boundaries (Statistics Canada 2021): only the postal areas the survey has homes in
    const FSA = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/14';
    const fsaFeats = (await arcgisAll(FSA, { where: "PRUID='47'", outFields: 'CFSAUID', maxAllowableOffset: '0.001' }, 'fsa-47', 200)).filter((f) => f.geometry && byFSA[f.properties.CFSAUID]);
    const fsas = fsaFeats.map((f) => {
      const id = f.properties.CFSAUID;
      const hrs = Object.entries(hrOfFSA[id] ?? {}).sort((a, b) => b[1] - a[1]);
      return { id, ...summary(byFSA[id]), hr: hrs[0]?.[0] ?? null, urban: id[1] !== '0', polys: keepBig(polys(f.geometry, id[1] === '0' ? 0.004 : 0.0015, 3), id[1] === '0' ? 0.002 : 0.00002) };
    }).sort((a, b) => a.id.localeCompare(b.id));
    const missing = Object.keys(byFSA).filter((id) => !fsas.some((f) => f.id === id));
    if (missing.length) log(`  radon: FSAs in the survey with no 2021 boundary: ${missing.join(', ')}`);

    // --- per place: its health region (centre in the 2007 outline) and its postal areas: urban FSAs that cover a
    // quarter or more of the town limits' outline points (or hold its centre), else the rural FSA its centre is in
    const inFeat = (pt, geom) => booleanPointInPolygon(pt, { type: 'Feature', properties: {}, geometry: geom });
    const towns = {};
    for (const p of places) {
      let ri = hrFeat.findIndex((f) => booleanPointInPolygon([p.lon, p.lat], f));
      if (ri < 0) ri = hrFeat.map((f, i) => ({ i, d: edgeKm(p.lon, p.lat, f.geometry) })).sort((a, b) => a.d - b.d)[0].i;
      const area = needs?.areas?.[p.key];
      const pts = area?.length ? area.flatMap((poly) => poly[0]) : [];
      const own = fsaFeats.filter((f) => f.properties.CFSAUID[1] !== '0').filter((f) => inFeat([p.lon, p.lat], f.geometry) || (pts.length && pts.filter((pt) => inFeat(pt, f.geometry)).length >= pts.length / 4) || (() => {
        // a small urban FSA wholly inside the town: its own points fall inside the limits
        if (!area?.length) return false;
        const ring = (f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates[0])[0];
        const lim = { type: 'MultiPolygon', coordinates: area };
        return ring.filter((pt) => inFeat(pt, lim)).length >= ring.length / 2;
      })()).map((f) => f.properties.CFSAUID);
      const f = own.length ? own : fsaFeats.filter((g) => inFeat([p.lon, p.lat], g.geometry)).map((g) => g.properties.CFSAUID);
      const t = tally();
      for (const id of f) { const b = byFSA[id]; t.n += b.n; t.hi += b.hi; t.vhi += b.vhi; t.vals.push(...b.vals); }
      towns[p.key] = { r: ri, f, ...(f.length ? { fn: t.n, fhi: t.hi } : {}) };
    }
    const few = Object.entries(towns).filter(([, t]) => t.fn != null && t.fn < FEW).length;
    log(`  ${prov.n} Saskatchewan homes: ${regions.length} health regions, ${fsas.length} FSAs; ${Object.keys(towns).length} places (${few} on fewer than ${FEW} FSA tests)`);
    await writeOut('radon', {
      source: 'Health Canada, Cross-Canada Survey of Radon Concentrations in Homes (2009–2011; final report 2012), open data',
      licence: 'Open Government Licence – Canada',
      areaSource: 'Statistics Canada, Health Regions: Boundaries and Correspondence with Census Geography (82-402-X), Saskatchewan health regions in effect December 2007 (2006 census geography); 2021 Census Cartographic Boundary Files, forward sortation areas',
      url: DATASET, reportUrl: 'https://www.canada.ca/en/health-canada/services/environmental-workplace-health/reports-publications/radiation/cross-canada-survey-radon-concentrations-homes-final-report-health-canada-2012.html',
      testUrl: 'https://www.canada.ca/en/health-canada/services/health-risks-safety/radiation/radon/test-your-home.html',
      guide: GUIDE, oldGuide: OLD_GUIDE, few: FEW, years: '2009–2011',
      prov: summary(prov), regions, fsas, towns,
    });
  },

  // Light & dark: day length from each place's latitude (NOAA's solar position equations, with refraction), aurora
  // odds from geomagnetic latitude (centred dipole of the latest IGRF-14 epoch, read from the IAGA coefficient file;
  // NOAA SWPC's rule for the auroral oval's equatorward edge), and RASC's dark-sky sites, drawn with the park outlines
  // the `camping` stage already built, with the drive from each place to the nearest campground inside one.
  async light() {
    const places = await getPlaces();
    const outline = await readOut('province');
    const camping = await readOut('camping');
    const year = new Date().getUTCFullYear();
    const R = Math.PI / 180;

    // --- the sun (NOAA Solar Calculator equations: declination at local solar noon)
    const declination = (y, mo, d, lon) => {
      const jd = Date.UTC(y, mo - 1, d, 12) / 864e5 + 2440587.5 - lon / 360;
      const T = (jd - 2451545) / 36525;
      const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
      const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
      const C = Math.sin(M * R) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * R) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * R) * 0.000289;
      const om = 125.04 - 1934.136 * T;
      const lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * R);
      const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
      const eps = eps0 + 0.00256 * Math.cos(om * R);
      return Math.asin(Math.sin(eps * R) * Math.sin(lam * R));
    };
    // hours the sun is above `zenith` (90.833°: sunrise to sunset, with refraction and the sun's radius; 96°: civil dawn to dusk)
    const hoursAbove = (lat, dec, zenith) => {
      const cosH = (Math.cos(zenith * R) - Math.sin(lat * R) * Math.sin(dec)) / (Math.cos(lat * R) * Math.cos(dec));
      if (cosH <= -1) return 24;
      if (cosH >= 1) return 0;
      return round((2 * Math.acos(cosH)) / R / 15, 3);
    };
    const DATES = [{ id: 'dec', label: 'Dec 21', m: 12, d: 21 }, { id: 'mar', label: 'Mar 20', m: 3, d: 20 }, { id: 'jun', label: 'Jun 21', m: 6, d: 21 }];
    const day = (lat, lon) => DATES.map((x) => hoursAbove(lat, declination(year, x.m, x.d, lon), 90.833));
    const civil = (lat, lon) => DATES.map((x) => hoursAbove(lat, declination(year, x.m, x.d, lon), 96));

    // --- geomagnetic latitude: IGRF-14 dipole (g10, g11, h11) at the newest main-field epoch
    const IGRF_URL = 'https://www.ngdc.noaa.gov/IAGA/vmod/coeffs/igrf14coeffs.txt';
    const igrfText = (await cached('light/igrf14coeffs.txt', () => fetchBuf(IGRF_URL))).toString('utf8');
    const lines = igrfText.split(/\r?\n/);
    const hdr = lines.find((l) => /^g\/h\s+n\s+m\s/.test(l));
    const kinds = lines.find((l) => /^c\/s\s+deg\s+ord\s/.test(l));
    if (!hdr || !kinds) throw new Error('IGRF coefficient file: header not found');
    const cols = hdr.trim().split(/\s+/), kcols = kinds.trim().split(/\s+/);
    // newest IGRF (main field) column; the last column is the secular variation
    let ci = -1;
    for (let i = 3; i < cols.length; i++) if (/^\d{4}(\.\d)?$/.test(cols[i]) && kcols[i] === 'IGRF') ci = i;
    if (ci < 0) throw new Error('IGRF coefficient file: no IGRF epoch column');
    const epoch = Number(cols[ci]);
    const coef = (gh, n, m) => {
      const l = lines.find((x) => new RegExp(`^${gh}\\s+${n}\\s+${m}\\s`).test(x));
      if (!l) throw new Error(`IGRF coefficient ${gh}${n}${m} missing`);
      return Number(l.trim().split(/\s+/)[ci]);
    };
    const g10 = coef('g', 1, 0), g11 = coef('g', 1, 1), h11 = coef('h', 1, 1);
    const B0 = Math.hypot(g10, g11, h11);
    const poleLat = 90 - Math.acos(-g10 / B0) / R;
    const poleLon = Math.atan2(-h11, -g11) / R;
    const mlat = (lat, lon) => round(Math.asin(Math.sin(lat * R) * Math.sin(poleLat * R) + Math.cos(lat * R) * Math.cos(poleLat * R) * Math.cos((lon - poleLon) * R)) / R, 2);
    log(`  IGRF-14 ${epoch}: g10 ${g10}, g11 ${g11}, h11 ${h11} → north geomagnetic pole ${poleLat.toFixed(2)}°N ${(-poleLon).toFixed(2)}°W`);
    // NOAA SWPC: the oval's equatorward edge sits near 66° geomagnetic at Kp 0 and moves ~2° equatorward per Kp step
    const KP = { k0: 66, perKp: 2, url: 'https://www.swpc.noaa.gov/content/tips-viewing-aurora' };
    // rounded up, so the Kp shown always agrees with the band
    const kpOverhead = (ml) => Math.max(0, Math.ceil(((KP.k0 - ml) / KP.perKp) * 10 - 1e-9) / 10);
    // often: overhead on quiet nights (Kp ≤ 2); sometimes: at Kp 3–4 (unsettled to active); rarely: only in a storm (Kp 5+, NOAA G1+)
    const band = (ml) => (ml >= KP.k0 - 2 * KP.perKp ? 'often' : ml >= KP.k0 - 4 * KP.perKp ? 'sometimes' : 'rarely');

    // --- rows (0.25° of latitude) and aurora cells (0.5° of longitude), clipped to the province outline row by row
    const ring = outline.geometry.coordinates[0][0];
    const xRange = (y) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
        if ((y1 <= y && y2 >= y) || (y2 <= y && y1 >= y)) {
          const x = y1 === y2 ? Math.min(x1, x2) : x1 + ((y - y1) / (y2 - y1)) * (x2 - x1);
          const xx = y1 === y2 ? Math.max(x1, x2) : x;
          lo = Math.min(lo, x); hi = Math.max(hi, xx);
        }
      }
      return [lo, hi];
    };
    const rows = [], cells = [];
    const S = 49, N = 60, STEP = 0.25, LSTEP = 0.5;
    for (let s = S; s < N - 1e-9; s += STEP) {
      const n = s + STEP, yc = s + STEP / 2;
      const [w, e] = xRange(yc);
      if (!Number.isFinite(w)) continue;
      const lonC = (w + e) / 2;
      rows.push({ s: round(s, 3), n: round(n, 3), w: round(w, 3), e: round(e, 3), d: day(yc, lonC), c: civil(yc, lonC) });
      for (let x = w; x < e - 1e-9; x += LSTEP) {
        const x2 = Math.min(e, x + LSTEP);
        cells.push([round(x, 3), round(s, 3), round(x2, 3), round(n, 3), mlat(yc, (x + x2) / 2)]);
      }
    }
    // a year of day length at each whole degree of latitude, one value a week (for the panel's chart)
    const curves = [];
    for (let lat = S; lat <= N; lat++) {
      const y = [];
      for (let doy = 1; doy <= 365; doy += 7) {
        const dt = new Date(Date.UTC(year, 0, doy));
        y.push(round(hoursAbove(lat, declination(year, dt.getUTCMonth() + 1, dt.getUTCDate(), -106), 90.833), 2));
      }
      curves.push({ lat, y });
    }

    // --- RASC's designated dark-sky sites in Saskatchewan, matched to park outlines by name
    const RASC_URL = 'https://rasc.ca/lpa/dark-sky-sites';
    const html = (await cached('light/rasc-dark-sky-sites.html', async () => {
      const b = await fetchBuf(RASC_URL, { headers: { Accept: 'text/html' } });
      if (!/Dark-Sky Site/i.test(b.toString('utf8'))) throw new Error('RASC page: no dark-sky table');
      return b;
    })).toString('utf8');
    const text = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;/g, '’').replace(/&nbsp;|&#13;/g, ' ').replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+([),])/g, (_, p) => p).trim();
    const table = html.match(/<table class="sortable">([\s\S]*?)<\/table>/)?.[1];
    if (!table) throw new Error('RASC page: sortable table not found');
    const GENERIC = new Set(['park', 'national', 'provincial', 'interprovincial', 'historic', 'site', 'recreation', 'regional', 'and', 'of', 'the']);
    const words = (s) => s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w && !GENERIC.has(w));
    const sites = [];
    for (const tr of table.split(/<tr>/).slice(1)) {
      const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      if (tds.length < 5) continue;
      const [name, prov, yr, type] = tds.slice(0, 4).map(text);
      if (!/\bSK\b/.test(prov)) continue;
      const info = tds[4].match(/href="([^"]+)"/)?.[1] ?? RASC_URL;
      const site = words(name);
      const parks = camping.parks.map((p, i) => ({ p, i })).filter(({ p }) => { const w = words(p.name); return w.length && w.every((x) => site.includes(x)); });
      sites.push({ name, prov, year: Number(yr) || null, type, info, parks: parks.map((x) => x.i) });
    }
    if (!sites.length) throw new Error('RASC page: no Saskatchewan sites');
    const preserves = sites.filter((s) => s.parks.length).map((s) => ({
      name: s.name.replace(/\s*\(.*\)$/, ''), full: s.name, year: s.year, type: s.type, info: s.info, prov: s.prov,
      parks: s.parks.map((i) => ({ name: camping.parks[i].name, c: camping.parks[i].c, ha: camping.parks[i].ha, polys: camping.parks[i].polys })),
    }));
    const unmapped = sites.filter((s) => !s.parks.length).map(({ parks, ...s }) => s);
    log(`  RASC: ${sites.length} Saskatchewan sites; mapped ${preserves.map((p) => `${p.name} (${p.parks.map((x) => x.name).join(', ')})`).join('; ')}${unmapped.length ? `; no outline for ${unmapped.map((s) => s.name).join(', ')}` : ''}`);

    // --- the drive from each place to the nearest campground (not backcountry) inside a dark-sky preserve
    const parkToPreserve = new Map();
    sites.forEach((s) => { const k = preserves.findIndex((p) => p.full === s.name); if (k >= 0) for (const i of s.parks) parkToPreserve.set(i, k); });
    const targets = camping.camps.filter((c) => c.p != null && parkToPreserve.has(c.p) && c.kind === 'campground').map((c) => ({ name: c.name, lon: c.lon, lat: c.lat, k: parkToPreserve.get(c.p) }));
    if (!targets.length) throw new Error('no campgrounds inside a dark-sky preserve');
    const dr = await driveTimes(places, targets, 'darksky', { pre: targets.length, keep: 1 }); // few targets: rank them all by road

    const towns = {};
    for (const p of places) {
      const ml = mlat(p.lat, p.lon);
      const t = dr.towns[p.key]?.[0];
      towns[p.key] = { d: day(p.lat, p.lon), c: civil(p.lat, p.lon), ml, kp: kpOverhead(ml), a: band(ml), ...(t ? { dk: { f: t.f, min: t.min, km: t.km } } : {}) };
    }
    const dec = places.map((p) => towns[p.key].d[0]);
    log(`  ${places.length} places: Dec 21 daylight ${Math.min(...dec).toFixed(2)}–${Math.max(...dec).toFixed(2)} h; geomagnetic ${Math.min(...places.map((p) => towns[p.key].ml))}–${Math.max(...places.map((p) => towns[p.key].ml))}°; ${targets.length} preserve campgrounds`);
    await writeOut('light', {
      source: 'Computed: NOAA Global Monitoring Laboratory solar position equations (sunrise/sunset at 90.833°, civil twilight at 96°); IAGA IGRF-14 dipole coefficients; NOAA SWPC Kp–latitude rule; RASC Dark-Sky Sites in Canada',
      year, dates: DATES.map(({ id, label }) => ({ id, label })),
      solarUrl: 'https://gml.noaa.gov/grad/solcalc/calcdetails.html',
      igrf: { model: 'IGRF-14', epoch, g10, g11, h11, poleLat: round(poleLat, 2), poleLon: round(poleLon, 2), url: IGRF_URL },
      kp: KP,
      rasc: { url: RASC_URL, sites: sites.map(({ parks, ...s }) => s) },
      routing: dr.routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line distance (OSRM unavailable)',
      preserves, unmapped, targets, rows, cells, curves, towns,
    });
  },

  // Parks and campgrounds: the province's park, recreation site and regional park boundaries (Ministry of Parks, Culture
  // and Sport), Parks Canada's campsites, and OpenStreetMap's camp sites; then the drive from each place to its nearest
  // campground.
  async camping() {
    await getProvince();
    const places = await getPlaces();
    const now = Date.now();
    // capitalise each word; after an apostrophe only a longer run ("Qu'Appelle", not "Rowan'S")
    const title = (s) => s.toLowerCase().replace(/(^|[\s(\-/.'’])([a-z])([a-z]*)/g, (m, a, c, rest) => ((a === "'" || a === '’') && !rest ? m : a + c.toUpperCase() + rest))
      .replace(/\b(Of|And|The|At)\b(?!$)/g, (w, _, i) => (i ? w.toLowerCase() : w)).replace(/\bSt\b/g, 'St.');

    // --- parks (Saskatchewan's ParksAsTitled service: national, provincial, recreation sites, historic sites, regional)
    const PT = 'https://gis.saskatchewan.ca/arcgis/rest/services/ParksAsTitled/MapServer';
    const SUB = { NE: 'natural environment', RP: 'recreation', WP: 'wilderness', HP: 'historic' };
    const geo = { maxAllowableOffset: '0.002' };
    const parks = [];
    const addPark = (f, type, name, extra = {}) => {
      if (!f.geometry) return;
      const ps = polys(f.geometry, 0.002);
      if (!ps.length) return;
      const ring = ps.map((p) => p[0]).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
      const c = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
      if (!inSask(c[0], c[1], 0.05)) return;
      const ha = ps.reduce((a, p) => a + Math.abs(ringArea(p[0])) * 111.32 * 111.32 * Math.cos((c[1] * Math.PI) / 180) * 100, 0);
      parks.push({ name, type, ...extra, c: [round(c[0], 3), round(c[1], 3)], ha: Math.round(ha), polys: ps });
    };
    for (const f of await arcgisAll(`${PT}/0`, { where: '1=1', outFields: 'PARKNM', ...geo }, 'parks-national'))
      addPark(f, /HISTORIC/.test(f.properties.PARKNM) ? 'historic' : 'national', title(f.properties.PARKNM), { by: 'Parks Canada' });
    for (const f of await arcgisAll(`${PT}/1`, { where: '1=1', outFields: 'PARKNM,PARKTYPE', ...geo }, 'parks-provincial'))
      addPark(f, 'provincial', title(f.properties.PARKNM), { sub: SUB[f.properties.PARKTYPE] ?? null });
    for (const f of await arcgisAll(`${PT}/2`, { where: '1=1', outFields: 'PARKNM', ...geo }, 'parks-recsites'))
      addPark(f, 'recreation', title(f.properties.PARKNM));
    for (const f of await arcgisAll(`${PT}/5`, { where: '1=1', outFields: 'PARKNM', ...geo }, 'parks-historic'))
      addPark(f, 'historic', title(f.properties.PARKNM));
    let dissolved = 0;
    for (const f of await arcgisAll(`${PT}/6`, { where: '1=1', outFields: 'PARK_NAME,SECONDARY_NAME,EXPIRY_DATE,SRPA_CONTACT', ...geo }, 'parks-regional')) {
      const p = f.properties;
      // regional parks that have been dissolved keep their record with an expiry date: leave those out
      if (p.EXPIRY_DATE && p.EXPIRY_DATE < now) { dissolved++; continue; }
      addPark(f, 'regional', p.PARK_NAME.trim(), p.SRPA_CONTACT && /^https?:\/\//.test(p.SRPA_CONTACT) ? { web: p.SRPA_CONTACT.trim() } : {});
    }
    parks.sort((a, b) => b.ha - a.ha);
    const count = (k) => parks.filter((p) => p.type === k).length;
    log(`  parks: ${count('national')} national, ${count('provincial')} provincial, ${count('recreation')} recreation sites, ${count('historic')} historic, ${count('regional')} regional (${dissolved} dissolved left out)`);
    const parkAt = (lon, lat) => {
      // smallest park containing the point, so a rec site inside a bigger park wins
      let best = -1;
      parks.forEach((p, i) => {
        if (p.polys.some((poly) => booleanPointInPolygon([lon, lat], { type: 'Polygon', coordinates: poly })) && (best < 0 || p.ha < parks[best].ha)) best = i;
      });
      return best < 0 ? null : best;
    };

    // --- Parks Canada: individual campsites, grouped here into campgrounds
    const PC = 'https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services';
    const env = { geometry: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' };
    const sites = (await arcgisAll(`${PC}/vw_Accommodation_Hebergement_V2_FGP/FeatureServer/0`, { where: '1=1', outFields: 'Name_e,URL_f,Accommodation_Type', ...env }, 'pc-accommodation'))
      .filter((f) => f.geometry && inSask(...f.geometry.coordinates, 0.01));
    const facil = (await arcgisAll(`${PC}/vw_Facilities_Installations_Point_V2_FGP/FeatureServer/0`, { where: "Facility_Type_Installation LIKE 'Front%'", outFields: 'Name_e,Facility_Type_Installation', ...env }, 'pc-campgrounds'))
      .filter((f) => f.geometry && f.properties.Name_e);
    // a site's code is park-campground-site ("PA-BG-A12"): group by park-campground and name, then split far-apart sites
    const groups = new Map();
    for (const f of sites) {
      const p = f.properties;
      const code = (p.URL_f ?? '').replace(/-[^-]*$/, '');
      const k = `${code}|${p.Name_e ?? ''}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(f);
    }
    const pcCamps = [];
    for (const [k, fs] of groups) {
      const clusters = [];
      for (const f of fs) {
        const [lon, lat] = f.geometry.coordinates;
        const c = clusters.find((c) => c.some((g) => distKm(lon, lat, ...g.geometry.coordinates) < 1.5));
        if (c) c.push(f); else clusters.push([f]);
      }
      for (const c of clusters) {
        const lon = c.reduce((a, f) => a + f.geometry.coordinates[0], 0) / c.length, lat = c.reduce((a, f) => a + f.geometry.coordinates[1], 0) / c.length;
        const types = c.map((f) => f.properties.Accommodation_Type ?? '');
        const back = /-BC$/.test(k.split('|')[0]) || types.some((t) => /backcountry/i.test(t));
        const group = types.every((t) => /group/i.test(t));
        const near = facil.map((f) => ({ f, d: distKm(lon, lat, ...f.geometry.coordinates) })).sort((a, b) => a.d - b.d)[0];
        pcCamps.push({
          // a backcountry site only takes a front-country campground's name when it is right at it
          name: c[0].properties.Name_e?.trim() || (near && near.d < (back ? 0.3 : 1.5) ? near.f.properties.Name_e.trim() : null),
          kind: back ? 'backcountry' : group ? 'group' : 'campground',
          sites: c.length, otentik: types.filter((t) => /otentik/i.test(t)).length || undefined,
          lon: round(lon, 4), lat: round(lat, 4), src: 'pc',
        });
      }
    }
    // oTENTiks are their own group in the source: fold them into the campground they stand in
    for (const c of pcCamps.filter((c) => c.otentik && c.otentik === c.sites)) {
      const host = pcCamps.find((h) => h !== c && h.kind === 'campground' && !h.otentik && distKm(c.lon, c.lat, h.lon, h.lat) < 1.5);
      if (host) { host.otentik = c.otentik; host.sites += c.sites; c.drop = true; }
    }
    // one campground filed under two codes (Rock Creek's accessible site): fold the smaller into the larger
    for (const c of [...pcCamps].sort((a, b) => a.sites - b.sites)) {
      if (c.drop || !c.name) continue;
      const host = pcCamps.find((h) => h !== c && !h.drop && h.name === c.name && h.kind === c.kind && h.sites >= c.sites && distKm(c.lon, c.lat, h.lon, h.lat) < 1.5);
      if (host) { host.sites += c.sites; if (c.otentik) host.otentik = (host.otentik ?? 0) + c.otentik; c.drop = true; }
    }
    log(`  Parks Canada: ${sites.length} campsites in ${pcCamps.filter((c) => !c.drop).length} campgrounds and backcountry sites`);

    // --- OpenStreetMap camp sites and RV parks
    const osm = await overpass('sk-camping.json', `[out:json][timeout:240];(nwr["tourism"~"^(camp_site|caravan_site)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center tags qt;`);
    const osmCamps = [];
    for (const e of osm.elements) {
      const t = e.tags ?? {};
      const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
      if (lon == null || !inSask(lon, lat, 0.01)) continue;
      if (/^(private|no)$/.test(t.access ?? '')) continue;
      const name = (t.name ?? '').trim() || null;
      const dupe = osmCamps.find((c) => distKm(lon, lat, c.lon, c.lat) < (name && c.name === name ? 2 : 0.15));
      if (dupe) continue;
      const kind = t.backcountry === 'yes' ? 'backcountry' : t.group_only === 'yes' ? 'group' : t.tourism === 'caravan_site' ? 'rv' : 'campground';
      const cap = Number.parseInt(t.capacity, 10);
      const web = [t.website, t['contact:website'], t.url].find((u) => u && /^https?:\/\//.test(u.trim()));
      osmCamps.push({
        name, kind, sites: Number.isFinite(cap) && cap > 0 ? cap : undefined,
        op: (t.operator ?? '').trim() || undefined,
        power: t.power_supply ? t.power_supply !== 'no' : undefined,
        fee: t.fee ? t.fee !== 'no' : undefined,
        web: web?.trim(), lon: round(lon, 4), lat: round(lat, 4), src: 'osm', osm: `${e.type}/${e.id}`,
      });
    }
    // where both sources have a campground, keep Parks Canada's (it counts the sites) and borrow OSM's name and link
    let merged = 0;
    for (const c of pcCamps) {
      if (c.drop) continue;
      const o = osmCamps.find((o) => !o.drop && distKm(c.lon, c.lat, o.lon, o.lat) < (c.kind === 'backcountry' ? 0.3 : 1.2));
      if (!o) continue;
      c.name ??= o.name;
      if (o.web) c.web ??= o.web;
      c.osm = o.osm;
      o.drop = true;
      merged++;
    }
    const camps = [...pcCamps, ...osmCamps].filter((c) => !c.drop).map(({ drop, ...c }) => c);
    for (const c of camps) {
      const p = parkAt(c.lon, c.lat);
      if (p != null) c.p = p;
      if (!c.name) c.name = c.kind === 'backcountry' ? 'Backcountry campsite' : c.kind === 'rv' ? 'RV park' : 'Campground';
      for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
    }
    camps.sort((a, b) => b.lat - a.lat);
    log(`  OSM: ${osmCamps.length} camp sites (${merged} matched to Parks Canada); ${camps.length} on the map, ${camps.filter((c) => c.p != null).length} inside a park`);

    // --- drive from each place to its nearest campground you can drive to
    const driveable = camps.map((c, i) => ({ ...c, i })).filter((c) => c.kind !== 'backcountry');
    const d = await driveTimes(places, driveable, 'camp', { keep: 1 });
    const towns = Object.fromEntries(Object.entries(d.towns).map(([k, v]) => [k, v.map((t) => ({ ...t, f: driveable[t.f].i }))]));

    // --- Weekend reach: from each place, the drive to every campground within REACH_MIN, in one OSRM table call per place
    // (the demo server takes up to 100 coordinates, so the 99 nearest in a straight line are the candidates; the farthest
    // of those is checked against REACH_MIN so a place never silently loses campgrounds it could reach)
    const REACH_MIN = 240;
    const reach = {};
    let reachRouted = d.routed, clipped = 0;
    const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
    for (const p of places) {
      // nothing more than 4 h away can be closer than ~400 km in a straight line
      const near = driveable.map((c) => ({ c, d: distKm(p.lon, p.lat, c.lon, c.lat) })).filter((n) => n.d <= 400).sort((a, b) => a.d - b.d);
      let rows = null;
      if (reachRouted) {
        try {
          rows = [];
          // pages of 99 destinations, nearest first, until a page's farthest campground is already out of reach
          for (let at = 0; at < near.length; at += 99) {
            const page = near.slice(at, at + 99);
            const coords = [p, ...page.map((n) => n.c)].map((x) => `${x.lon},${x.lat}`).join(';');
            const tb = await osrm(`campreach-${p.key.replace(/ /g, '_')}-${hash(coords)}`, `${OSRM}/table/v1/driving/${coords}?sources=0&annotations=duration`);
            if (tb.code !== 'Ok') throw new Error(tb.message ?? tb.code);
            const got = page.map((n, j) => [n.c.i, tb.durations[0][j + 1] == null ? null : Math.round(tb.durations[0][j + 1] / 60)]);
            rows.push(...got.filter((r) => r[1] != null && r[1] <= REACH_MIN));
            if (!got.some((r) => r[1] != null && r[1] <= REACH_MIN)) break;
            if (at + 99 < near.length) clipped++;
          }
        } catch (e) { log(`  reach: OSRM unavailable (${e.message}); straight-line reach from here on`); reachRouted = false; rows = null; }
      }
      // without routing, a rough reach: 80 km/h along a road 1.3× the straight line
      rows ??= near.map((n) => [n.c.i, Math.round((n.d * 1.3) / 80 * 60)]).filter((r) => r[1] <= REACH_MIN);
      reach[p.key] = rows.sort((a, b) => a[1] - b[1]);
    }
    const medReach = Object.values(reach).map((r) => r.filter((x) => x[1] <= 120).length).sort((a, b) => a - b);
    log(`  reach: median place has ${medReach[medReach.length >> 1]} campgrounds within 2 h (${clipped} extra table pages for places with more than 99 candidates)`);

    await writeOut('camping', {
      source: 'Government of Saskatchewan, Ministry of Parks, Culture and Sport: ParksAsTitled (provincial and national parks, recreation sites, historic sites, regional parks); Parks Canada, Accommodation and Facilities (Open Government Licence – Canada); OpenStreetMap contributors (tourism=camp_site, caravan_site; ODbL)',
      routing: d.routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line',
      routingSource: d.routed ? 'Drive times: OSRM demo server, © OpenStreetMap contributors (ODbL)' : null,
      asOf: new Date().toISOString().slice(0, 10),
      reachRouted, reachMax: REACH_MIN,
      parks, camps, towns, reach,
    });
  },

  // Schools & learning: the Ministry of Education's K-12 schools (public, separate, Fransaskois and First Nations band
  // schools) and the Ministry of Advanced Education's post-secondary institutions, both from the Saskatchewan GeoHub,
  // with Saskatchewan Polytechnic and university campuses the ministry list lacks added from OpenStreetMap. Then the drive
  // from each place to its nearest elementary school, high school, French-language or French immersion school and
  // post-secondary campus. Reads needs.json for the town limits behind "schools in town".
  async schools() {
    await getProvince();
    const places = await getPlaces();
    const ED = 'https://gis.saskatchewan.ca/arcgis/rest/services/Education';
    const fixName = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/�/g, '’').trim();

    // --- K-12. The ministry layers state no grades except for band schools, so a provincial school's grades come from
    // its name: "High", "Collegiate", "Composite", "Comprehensive", "Secondary", "secondaire" → high school; "Elementary",
    // "Middle", "Junior", "Primary", "Junior High" → elementary or middle. A name that says neither is '?' (grades not
    // stated) and counts as an elementary school; it also counts as a high school (inferred K-12, `gi`) when no school
    // that states high-school grades is within INFER_KM, as in most small towns with one school.
    const INFER_KM = 10;
    const LAYERS = [{ id: 2, s: 'pub' }, { id: 3, s: 'sep' }, { id: 4, s: 'fr' }, { id: 5, s: 'fn' }];
    const level = (name) => (/\bjunior high\b|\b(elementary|middle|primary|junior)\b|\bél[ée]mentaire\b/i.test(name) ? 'e'
      : /\b(high|collegiate|composite|comprehensive|secondary)\b|\bsecondaire\b/i.test(name) ? 'h' : '?');
    const bandLevel = (lo, hi) => {
      const g = (x) => (x === 'K' || x === 'P' ? 0 : Number(x));
      const a = g(lo), b = g(hi);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return '?';
      return b >= 12 ? (a <= 6 ? 'k' : 'h') : 'e';
    };
    const schools = [];
    for (const L of LAYERS) {
      const fs_ = await arcgisAll(`${ED}/SchoolsAndDivisions/MapServer/${L.id}`, { where: '1=1', outFields: '*' }, `ed-schools-${L.id}`);
      for (const f of fs_) {
        const a = f.properties ?? {};
        const [lon, lat] = f.geometry?.coordinates ?? [];
        if (lon == null || !inSask(lon, lat, 0.05)) continue;
        const n = fixName(a.SCH_NAME);
        if (!n) continue;
        const prog = String(a.PROG_TYPE ?? '');
        const imm = [...prog.matchAll(/(\w+) Immersion/g)].map((m) => m[1]);
        const sc = { n, s: a.SCH_INDEPENDENT === 'Y' ? 'ind' : L.s, lon: round(lon, 5), lat: round(lat, 5) };
        if (L.s === 'fn') {
          sc.g = bandLevel(a.ENROL_GR_LOWEST, a.ENROL_GR_HIGHEST);
          if (a.ENROL_GR_LOWEST && a.ENROL_GR_HIGHEST) sc.gr = `${a.ENROL_GR_LOWEST}–${a.ENROL_GR_HIGHEST}`;
          sc.div = fixName(a.BAND_PARTNER_NAME || a.TC_PARTNER_NAME) || null;
          if (a.GEO_NAME) sc.at = fixName(a.GEO_NAME);
        } else {
          sc.g = level(n);
          sc.div = fixName(a.SD_NAME) || null;
          if (a.SCH_HUTTERITE === 'Y') sc.col = 1;
          if (imm.length) sc.imm = imm;
          if (L.s === 'fr') sc.fr = 1;
        }
        const e = Number(a.ENROL_K_12);
        if (Number.isFinite(e) && e > 0) sc.e = e;
        schools.push(sc);
      }
    }
    // --- schools in town: inside the place's limits (needs.json) or within the same slack, like Daily needs
    let needs = null;
    try { needs = await readOut('needs'); } catch { log('  needs.json missing: run the needs stage for "schools in town"'); }
    const inTown = (p, s) => {
      const a = needs?.areas?.[p.key];
      if (a?.length) {
        const geom = { type: 'MultiPolygon', coordinates: a };
        return booleanPointInPolygon([s.lon, s.lat], { type: 'Feature', properties: {}, geometry: geom }) || edgeKm(s.lon, s.lat, geom) <= (needs.slackKm ?? 1);
      }
      return distKm(p.lon, p.lat, s.lon, s.lat) <= (needs?.fallbackKm ?? 3);
    };

    // The ministry's GeoHub layers place about a third of schools 1–20 km from the building (rural ones often at a
    // land-survey or post-office point) and miss many (Estevan has none; Kindersley, Rosetown and Unity lack their high
    // schools). So: a listed school takes the position of the OpenStreetMap school with the same name within 30 km; and
    // OpenStreetMap schools that match no listed school, lie inside one of the atlas's places (its town limits, as Daily
    // needs counts them) and 300 m or more from every school already kept are added, named or not; outside the towns,
    // OpenStreetMap's many mapped one-room schoolhouses of the homestead era would pass for schools. Their sector is 'osm' (not stated) unless the operator or name says Catholic / separate; they never
    // count as French. Private, religious, colony, college and pre-school sites are left out.
    const official = schools.length;
    const osmS = await overpass('sk-schools.json', `[out:json][timeout:240];(nwr["amenity"="school"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center tags qt;`);
    const SKIP = /colony|bible|islamic|christian|adventist|mennonite|montessori|academy|refuge|ranch ehrlo|success cent|college|polytech|university|pre-?school|daycare|nursery|driving|education centre|learning centre|alternate|alternative|youth|correctional/i;
    const key_ = (n) => normalizeName(n).replace(/[^a-z0-9 ]/g, ' ').replace(/(school|elementary|elementry|high|composite|composit|community|central|public|the|ecole)/g, '').replace(/\s+/g, ' ').trim();
    const osmList = [];
    for (const e of osmS.elements) {
      const t = e.tags ?? {};
      const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
      const n = fixName(t.name);
      if (lon == null || !inSask(lon, lat, 0.02) || (n && SKIP.test(n)) || /^(private|religious)$/.test(t['operator:type'] ?? '')) continue;
      if (t.historic || t.disused || t.abandoned || /^(ruins|historic)$/.test(t.building ?? '') || /historic|former|old /i.test(n)) continue;
      osmList.push({ t, n, k: n ? key_(n) : null, lon, lat, id: `${e.type}/${e.id}`, used: false });
    }
    let snapped = 0;
    for (const s of schools.slice(0, official)) {
      const k = key_(s.n);
      const m = k ? osmList.filter((o) => o.k === k).map((o) => ({ o, d: distKm(o.lon, o.lat, s.lon, s.lat) })).filter((x) => x.d < 30).sort((a, b) => a.d - b.d)[0] : null;
      if (!m) continue;
      m.o.used = true;
      if (m.d > 0.3) { s.lon = round(m.o.lon, 5); s.lat = round(m.o.lat, 5); snapped++; }
    }
    for (const o of osmList.sort((a, b) => (b.n ? 1 : 0) - (a.n ? 1 : 0))) {
      if (o.used || !places.some((p) => inTown(p, o)) || schools.some((s) => distKm(s.lon, s.lat, o.lon, o.lat) < 0.3)) continue;
      const n = o.n || 'School (unnamed in OpenStreetMap)';
      const g = /^k-?12$|^0-12$/i.test(o.t.grades ?? '') ? 'k' : /^(7|8|9|10)-12$/.test(o.t.grades ?? '') ? 'h' : o.n ? level(n) : '?';
      const sep = /catholic|separate/i.test(`${o.t.operator ?? ''} ${o.n}`);
      schools.push({ n, s: sep ? 'sep' : 'osm', g, lon: round(o.lon, 5), lat: round(o.lat, 5), div: fixName(o.t.operator) || null, osm: o.id });
    }
    log(`  ${snapped} listed schools moved to their OpenStreetMap position; ${schools.length - official} schools added from OpenStreetMap (${schools.filter((s) => s.osm && s.n.startsWith('School (unnamed')).length} unnamed)`);
    // schools any family in town can attend: not Hutterite colony schools (for colony children), not band schools
    // (on reserve, for the band's children) and not independent schools
    const open = (s) => !s.col && (s.s === 'pub' || s.s === 'sep' || s.s === 'fr' || s.s === 'osm');
    const statesHigh = schools.filter((s) => open(s) && (s.g === 'h' || s.g === 'k'));
    for (const s of schools) if (s.g === '?' && open(s) && !statesHigh.some((h) => distKm(s.lon, s.lat, h.lon, h.lat) <= INFER_KM)) s.gi = 1;
    schools.sort((a, b) => b.lat - a.lat);
    const tally = (pred) => schools.filter(pred).length;
    log(`  ${schools.length} K-12 schools: ${tally((s) => s.s === 'osm')} OpenStreetMap only, ${tally((s) => s.s === 'pub')} public, ${tally((s) => s.s === 'sep')} separate, ${tally((s) => s.s === 'fr')} Fransaskois, ${tally((s) => s.s === 'fn')} First Nations, ${tally((s) => s.s === 'ind')} independent; ${tally((s) => s.col)} Hutterite colony schools`);
    log(`  grades: ${tally((s) => s.g === 'e')} elementary/middle, ${tally((s) => s.g === 'h')} high, ${tally((s) => s.g === 'k')} K-12 (stated), ${tally((s) => s.g === '?')} not stated (${tally((s) => s.gi)} inferred K-12); ${tally((s) => s.imm?.includes('French'))} French immersion`);

    // --- post-secondary (Ministry of Advanced Education institutions), by governing institution
    const KIND = { University: 'uni', 'Federated College': 'uni', 'Affiliated College': 'uni', FNUC: 'uni', 'Sask Polytechnic': 'poly', SIIT: 'poly', 'GDI/DTI': 'poly', 'Post Secondary': 'col' };
    const inst = await arcgisAll(`${ED}/AdvancedEducation/MapServer/0`, { where: '1=1', outFields: 'FACILITY_N,GOVERNANCE,CITY,PSETYPE' }, 'ae-institutions');
    const pse = [];
    for (const f of inst) {
      const a = f.properties ?? {};
      const [lon, lat] = f.geometry?.coordinates ?? [];
      if (lon == null || !inSask(lon, lat, 0.1)) continue;
      const k = KIND[a.PSETYPE] ?? 'col';
      const name = fixName(a.GOVERNANCE).replace(/^SIIT$/, 'Saskatchewan Indian Institute of Technologies (SIIT)') || (a.PSETYPE === 'University' ? 'University of Regina' : fixName(a.PSETYPE));
      const city = fixName(a.CITY).replace(/^Lloydminister AB$/, 'Lloydminster').replace(/^Moosimin$/, 'Moosomin').replace(/^Munester$/, 'Muenster') || null;
      if (pse.some((p) => p.n === name && distKm(p.lon, p.lat, lon, lat) < 0.3)) continue;
      pse.push({ n: name, k, city, lon: round(lon, 5), lat: round(lat, 5), src: 'ae' });
    }
    const aeCount = pse.length;
    // campuses the ministry list lacks (it has one Saskatchewan Polytechnic campus): OpenStreetMap's universities and
    // colleges named for Saskatchewan Polytechnic or the two universities, unless a listed site is already there
    const osm = await overpass('sk-pse.json', `[out:json][timeout:240];(nwr["amenity"~"^(university|college)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center tags qt;`);
    const BODIES = [
      { re: /saskatchewan polytechnic|sask ?polytech|siast/i, n: 'Saskatchewan Polytechnic', k: 'poly' },
      { re: /^university of regina\b/i, n: 'University of Regina', k: 'uni' },
      { re: /^university of saskatchewan\b/i, n: 'University of Saskatchewan', k: 'uni' },
    ];
    for (const e of osm.elements) {
      const t = e.tags ?? {};
      const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
      if (lon == null || !inSask(lon, lat, 0.05)) continue;
      const b = BODIES.find((x) => x.re.test(t.name ?? ''));
      // the same body within 2 km (a second outline of one campus), or any listed site within 600 m
      if (!b || pse.some((p) => (p.n === b.n && distKm(p.lon, p.lat, lon, lat) < 2) || distKm(p.lon, p.lat, lon, lat) < 0.6)) continue;
      pse.push({ n: b.n, campus: fixName(t.name) || null, k: b.k, city: t['addr:city'] ?? null, lon: round(lon, 5), lat: round(lat, 5), src: 'osm', osm: `${e.type}/${e.id}` });
    }
    log(`  ${pse.length} post-secondary sites (${aeCount} from the ministry list, ${pse.length - aeCount} campuses added from OpenStreetMap)`);

    // --- drives
    const openIdx = schools.map((s, i) => ({ ...s, i })).filter(open);
    const sets = {
      e: openIdx.filter((s) => s.g === 'e' || s.g === 'k' || s.g === '?'),
      h: openIdx.filter((s) => s.g === 'h' || s.g === 'k' || s.gi),
      f: openIdx.filter((s) => s.fr || s.imm?.includes('French')),
    };
    const towns = Object.fromEntries(places.map((p) => [p.key, { n: schools.filter((s) => open(s) && inTown(p, s)).length }]));
    let routed = true;
    for (const [k, list] of Object.entries(sets)) {
      const d = await driveTimes(places, list, `school-${k}`, { keep: 1 });
      routed &&= d.routed;
      for (const [key, v] of Object.entries(d.towns)) if (v[0]) towns[key][k] = { ...v[0], f: list[v[0].f].i };
    }
    const dp_ = await driveTimes(places, pse, 'pse', { keep: 1 });
    routed &&= dp_.routed;
    for (const [key, v] of Object.entries(dp_.towns)) if (v[0]) towns[key].p = v[0];

    await writeOut('schools', {
      source: 'Government of Saskatchewan, Ministry of Education, K-12 schools (SchoolsAndDivisions: public, separate, Francophone and band schools), Saskatchewan GeoHub; schools it lacks from OpenStreetMap contributors (amenity=school; ODbL), via Overpass',
      pseSource: 'Government of Saskatchewan, Ministry of Advanced Education, post-secondary institutions (AdvancedEducation), Saskatchewan GeoHub; Saskatchewan Polytechnic and university campuses it lacks from OpenStreetMap contributors (amenity=university, college; ODbL), via Overpass',
      routing: routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line',
      routingSource: routed ? 'Drive times: OSRM demo server, © OpenStreetMap contributors (ODbL)' : null,
      asOf: new Date().toISOString().slice(0, 10),
      inferKm: INFER_KM,
      schools, pse, towns,
    });
  },

  // Internet & mobile: ISED's National Broadband Data. Every pseudo-household (PHH: ISED's representative points for
  // where people live, with the 2021 census households behind each) carries the top fixed speed tier offered there, by any
  // wired or fixed-wireless service and by wire alone, and whether LTE mobile service reaches it. The national files
  // (~300 MB zipped) are streamed once, kept to Saskatchewan's points in .cache/, then summed into ISED's own 25 km²
  // hexagons (the map) and into each place's town limits (needs.json). ISED's hexagon table adds which providers and
  // technologies serve each hexagon, which gives the mobile carriers. 5G is not in the open data.
  async internet() {
    await getProvince();
    const places = await getPlaces();
    const API = 'https://ised-isde.canada.ca/app/scr/sittibc/web/api/openData';
    const TIERS = ['', '<5_1', '5_1', '10_2', '25_5', '50_10'];
    const tierOf = (s) => Math.max(0, TIERS.indexOf(s.replace(/"/g, '').trim()));
    const cells = (line) => line.split(',').map((s) => s.replace(/^"|"$/g, '').trim());

    // --- Saskatchewan's pseudo-households with their speeds: id, lon, lat, households, hexagon, combined tier, wired tier, LTE
    const skFile = path.join(CACHE, 'internet', 'sk-phh-speeds.tsv');
    let rows;
    try {
      rows = (await fs.readFile(skFile, 'utf8')).split('\n').filter(Boolean).map((l) => l.split('\t'));
    } catch {
      const phhZip = await cachedFile('internet/PHH_2021_CSV.zip', `${API}/PHH_2021_CSV.zip`);
      const spdZip = await cachedFile('internet/NBD_PHH_Speeds.zip', `${API}/NBD_PHH_Speeds.zip`);
      const sk = new Map();
      let hdr = null;
      await zipLines(phhZip, (n) => /PHH-SK\.csv$/i.test(n), (line) => {
        const c = cells(line);
        if (!hdr) { hdr = Object.fromEntries(c.map((h, i) => [h.replace(/^﻿/, ''), i])); return; }
        // only points with households behind them (most are empty road points)
        const hh = Number(c[hdr.URDwell2021_RH2021]);
        if (c[hdr.Pruid_Pridu] !== '47' || !(hh > 0)) return;
        sk.set(c[hdr.PHH_ID], [c[hdr.PHH_ID], Number(c[hdr.Longitude]).toFixed(5), Number(c[hdr.Latitude]).toFixed(5), round(hh, 2), c[hdr.HEXUID_IdUHEX], 0, 0, 0]);
      });
      if (!sk.size) throw new Error('no Saskatchewan pseudo-households in the PHH file (has its layout changed?)');
      log(`  ${sk.size} Saskatchewan pseudo-households with households`);
      let sh = null, matched = 0;
      // current service only (not funded projects or announced expansions), Saskatchewan's file
      await zipLines(spdZip, (n) => /^PHH_Speeds_Current-[^/]*_SK\.csv$/i.test(n), (line) => {
        const c = cells(line);
        if (!sh) {
          const find = (re) => { const i = c.findIndex((h) => re.test(h.replace(/^﻿/, ''))); if (i < 0) throw new Error(`speeds file has no column like ${re}`); return i; };
          sh = { id: find(/^PHH_ID$/), comb: find(/^Combined_Max/), wired: find(/^Wired_Max/), lte: find(/LTE/) };
          return;
        }
        const r = sk.get(c[sh.id]);
        if (!r) return;
        r[5] = tierOf(c[sh.comb]); r[6] = tierOf(c[sh.wired]); r[7] = c[sh.lte] === '1' ? 1 : 0;
        matched++;
      });
      log(`  speeds matched for ${matched} of them`);
      if (!matched) throw new Error('no speeds matched Saskatchewan pseudo-households');
      rows = [...sk.values()].map((r) => r.map(String));
      await fs.writeFile(skFile, rows.map((r) => r.join('\t')).join('\n'));
    }
    const phh = rows.map((r) => ({ lon: +r[1], lat: +r[2], hh: +r[3], hex: r[4], comb: +r[5], wired: +r[6], lte: +r[7] }));

    // --- ISED's hexagon table: centres, and the providers and technologies serving each Saskatchewan hexagon
    const mapZip = await cached('internet/Map_Data_CSV.zip', () => fetchBuf(`${API}/Map_Data_CSV.zip`, { timeout: 600_000 }));
    const chxZip = await cached('internet/CHX_EXO_CSV.zip', () => fetchBuf(`${API}/CHX_EXO_CSV.zip`, { timeout: 600_000 }));
    const mapFiles = unzipSync(new Uint8Array(mapZip), { filter: (f) => /^ISP_Hex/i.test(f.name) });
    const ispCsv = strFromU8(Object.values(mapFiles)[0] ?? new Uint8Array());
    const chxCsv = strFromU8(Object.values(unzipSync(new Uint8Array(chxZip), { filter: (f) => /\.csv$/i.test(f.name) }))[0] ?? new Uint8Array());
    const centre = new Map();
    for (const line of chxCsv.split('\n')) {
      const c = cells(line.replace(/^﻿/, ''));
      if (c[0]?.startsWith('SK')) centre.set(c[0], [+c[2], +c[1]]);
    }
    if (!centre.size || !ispCsv) throw new Error('ISED hexagon files missing or empty');
    const MOBILE = 'Mobile Wireless';
    const TECH = { 'Fibre to the home': 'fibre', 'Coaxial Cable': 'cable', DSL: 'dsl', 'Fixed Wireless': 'fw', Satellite: 'sat', [MOBILE]: 'mob' };
    const hexIsp = new Map(); // hex → { mob: Set(carrier), tech: Set, isp: Set(name) }
    for (const line of ispCsv.split('\n')) {
      const c = cells(line);
      if (!c[0]?.startsWith('SK') || !TECH[c[2]]) continue;
      const h = hexIsp.get(c[0]) ?? { mob: new Set(), tech: new Set(), isp: new Set() };
      h.tech.add(TECH[c[2]]);
      if (c[2] === MOBILE) h.mob.add(c[1]);
      else if (c[2] !== 'Satellite') h.isp.add(`${c[1]}|${TECH[c[2]]}`);
      hexIsp.set(c[0], h);
    }

    // --- per hexagon: households, and the share of them offered 50/10 by any fixed service / by wire, and reached by LTE
    const agg = new Map();
    for (const p of phh) {
      const a = agg.get(p.hex) ?? { hh: 0, f50: 0, w50: 0, lte: 0 };
      a.hh += p.hh;
      if (p.comb === 5) a.f50 += p.hh;
      if (p.wired === 5) a.w50 += p.hh;
      if (p.lte) a.lte += p.hh;
      agg.set(p.hex, a);
    }
    const pc = (x, n) => (n ? Math.round((100 * x) / n) : null);
    const hexes = [];
    for (const [id, [lon, lat]] of centre) {
      const a = agg.get(id), h = hexIsp.get(id);
      if (!a?.hh && !h) continue;
      if (!inSask(lon, lat, 0.08)) continue;
      // [lon, lat, households, % 50/10 any fixed, % 50/10 by wire, % LTE, mobile carriers]
      hexes.push([round(lon, 3), round(lat, 3), Math.round(a?.hh ?? 0), a?.hh ? pc(a.f50, a.hh) : null, a?.hh ? pc(a.w50, a.hh) : null, a?.hh ? pc(a.lte, a.hh) : null, h?.mob.size ?? 0]);
    }

    // --- per place: the households inside its town limits (as Daily needs counts them)
    let needs = null;
    try { needs = await readOut('needs'); } catch { log('  needs.json missing: run the needs stage for town limits'); }
    const towns = {};
    for (const p of places) {
      const a = needs?.areas?.[p.key];
      const geom = a?.length ? { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: a } } : null;
      const near = phh.filter((q) => Math.abs(q.lat - p.lat) < 0.25 && Math.abs(q.lon - p.lon) < 0.4);
      const inside = near.filter((q) => (geom ? booleanPointInPolygon([q.lon, q.lat], geom) : distKm(p.lon, p.lat, q.lon, q.lat) <= (needs?.fallbackKm ?? 3)));
      const hh = inside.reduce((s, q) => s + q.hh, 0);
      if (!inside.length) { log(`  ✖ ${p.name}: no pseudo-households inside its limits`); continue; }
      // share of households whose top tier is each tier (index 0–5), any fixed and by wire
      const dist = (k) => { const d = [0, 0, 0, 0, 0, 0]; for (const q of inside) d[q[k]] += q.hh; return d.map((v) => pc(v, hh) ?? 0); };
      const best = (k) => Math.max(...inside.map((q) => q[k]));
      // the town centre: the pseudo-household nearest it
      const c = inside.reduce((b, q) => (distKm(p.lon, p.lat, q.lon, q.lat) < distKm(p.lon, p.lat, b.lon, b.lat) ? q : b));
      const hs = new Set(inside.map((q) => q.hex));
      const mob = new Set(), tech = new Set(), isp = new Set();
      for (const id of hs) { const h = hexIsp.get(id); if (!h) continue; h.mob.forEach((x) => mob.add(x)); h.tech.forEach((x) => tech.add(x)); h.isp.forEach((x) => isp.add(x)); }
      const ispList = {};
      for (const s of isp) { const [n, t] = s.split('|'); (ispList[n] ??= []).push(t); }
      towns[p.key] = {
        hh: Math.round(hh), n: inside.length,
        comb: dist('comb'), wired: dist('wired'), lte: pc(inside.filter((q) => q.lte).reduce((s, q) => s + q.hh, 0), hh),
        best: best('comb'), bestW: best('wired'), centre: [c.comb, c.wired, c.lte],
        mob: [...mob].sort(), tech: [...tech].sort(), isp: Object.entries(ispList).map(([n, t]) => [n, t.sort()]).sort((x, y) => x[0].localeCompare(y[0])),
      };
    }
    const sum = (k) => phh.reduce((s, q) => s + (k(q) ? q.hh : 0), 0);
    const allHh = sum(() => true);
    const prov = { hh: Math.round(allHh), f50: pc(sum((q) => q.comb === 5), allHh), w50: pc(sum((q) => q.wired === 5), allHh), lte: pc(sum((q) => q.lte), allHh) };
    log(`  ${hexes.length} hexagons; Saskatchewan: ${prov.f50}% of households offered 50/10 (${prov.w50}% by wire), ${prov.lte}% reached by LTE; ${Object.keys(towns).length} places`);
    await writeOut('internet', {
      source: 'Innovation, Science and Economic Development Canada, National Broadband Data (NBD PHH Speeds, NBD Map hexagon data) and Pseudo-Household Demographic Distribution 2021, open.canada.ca',
      licence: 'Open Government Licence – Canada',
      asOf: new Date().toISOString().slice(0, 10),
      tiers: ['none', 'under 5/1', '5/1', '10/2', '25/5', '50/10'],
      prov, hexes, towns,
    });
  },

  // Who lives here. Census 2021 profile per place (Statistics Canada's census SDMX API): immigrants and recent immigrants
  // (2016–2021), where immigrants were born, the non-official languages spoken most often at home, French (mother tongue
  // and knowledge), Indigenous identity. Places of worship mapped in OpenStreetMap inside or just outside each place's
  // town limits (needs.json), coloured by religion. Counts are as published: randomly rounded to a multiple of 5.
  async community() {
    await getProvince();
    const places = await getPlaces();
    // the characteristic codelist, for the names and the tree under "place of birth" and "home language"
    const xml = (await cached('census/CL_CHARACTERISTIC.xml', () => fetchBuf(`${CENSUS_SDMX}/codelist/STC_CP/CL_CHARACTERISTIC/latest`, { headers: { 'Accept-Language': 'en' }, timeout: 300_000 }))).toString('utf8');
    const code = {}, kids = {};
    for (const m of xml.matchAll(/<structure:Code id="(\d+)">([\s\S]*?)<\/structure:Code>/g)) {
      const name = m[2].match(/<common:Name xml:lang="en">([^<]*)</)?.[1]?.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '’') ?? '';
      const parent = m[2].match(/<structure:Parent>\s*<Ref id="(\d+)"/)?.[1] ?? null;
      code[m[1]] = { name, parent };
      if (parent) (kids[parent] ??= []).push(m[1]);
    }
    const leaves = (id) => (kids[id] ?? []).flatMap((c) => (kids[c] ? leaves(c) : [c]));
    const want = (id, re) => { if (!code[id] || !re.test(code[id].name)) throw new Error(`census characteristic ${id} is no longer "${re.source}"`); return id; };
    const C = {
      hhPop: want('1513', /^Total - Immigrant status/), imm: want('1515', /^Immigrants$/), rec: want('1522', /^2016 to 2021$/), npr: want('1523', /^Non-permanent residents$/),
      birthTot: want('1530', /^Total - Place of birth for the immigrant/),
      homeTot: want('721', /^Total - Language spoken most often at home/), nonOff: want('726', /^Non-official languages$/),
      mtTot: want('379', /^Total - Mother tongue/), frMT: want('383', /^French$/),
      knTot: want('369', /^Total - Knowledge of official languages/), frOnly: want('371', /^French only$/), enFr: want('372', /^English and French$/),
      indTot: want('1388', /^Total - Indigenous identity/), ind: want('1389', /^Indigenous identity$/),
    };
    // named countries only: "Other places of birth in Asia" is a remainder, not a place
    const BIRTH = leaves(C.birthTot).filter((id) => !/^Other|^Oceania and other/.test(code[id].name));
    const LANG = leaves(C.nonOff);
    const cp = await censusProfile('community-', [...new Set([...Object.values(C), ...BIRTH, ...LANG])]);
    const top = (v, ids, n) => ids.filter((id) => v[id] > 0).sort((a, b) => v[b] - v[a]).slice(0, n).map((id) => [code[id].name.replace(/, n\.o\.s\.$/, '').replace(/^Korea, South$/, 'South Korea').replace(/^Congo, Democratic Republic of the$/, 'DR Congo').replace(/^South Africa, Republic of$/, 'South Africa'), v[id]]);
    const profile = (v) => {
      const o = {};
      for (const k of ['hhPop', 'imm', 'rec', 'npr', 'homeTot', 'nonOff', 'mtTot', 'frMT', 'knTot', 'indTot', 'ind']) if (v[C[k]] != null) o[k] = v[C[k]];
      if (v[C.frOnly] != null && v[C.enFr] != null) o.frKn = v[C.frOnly] + v[C.enFr];
      o.birth = top(v, BIRTH, 5);
      o.lang = top(v, LANG, 5);
      return o;
    };
    const census = {};
    for (const [k, p] of Object.entries(cp.places)) census[k] = { csd: p.csd, ...profile(p.v) };
    const prov = profile(cp.prov);
    const noImm = places.filter((p) => census[p.key]?.imm == null).map((p) => p.name);
    if (noImm.length) log(`  community: immigrant counts suppressed or no CSD for ${noImm.join(', ')}`);

    // --- places of worship, inside a place's town limits (needs.json) or within the same slack, like Daily needs
    let needs = null;
    try { needs = await readOut('needs'); } catch { log('  needs.json missing: run the needs stage for town limits'); }
    const RELIGIONS = ['christian', 'muslim', 'sikh', 'hindu', 'buddhist', 'jewish', 'other', 'unstated'];
    const relOf = (t) => (!t.religion ? 'unstated' : RELIGIONS.includes(t.religion) ? t.religion : 'other');
    const osm = await overpass('sk-worship.json', `[out:json][timeout:240];(nwr["amenity"="place_of_worship"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center tags qt;`);
    const all = [];
    for (const e of osm.elements) {
      const t = e.tags ?? {};
      const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
      if (lon == null || !inSask(lon, lat, 0.05)) continue;
      const r = relOf(t), name = (t.name ?? '').trim();
      // a building mapped twice (a point inside its outline)
      const dup = all.find((s) => s.r === r && distKm(s.lon, s.lat, lon, lat) < 0.1 && (!s.name || !name || normalizeName(s.name) === normalizeName(name)));
      if (dup) { if (!dup.name && name) dup.name = name; continue; }
      all.push({ lon, lat, r, name, den: t.denomination ? t.denomination.replace(/_/g, ' ') : (r === 'other' ? t.religion.replace(/_/g, ' ') : ''), osm: `${e.type[0]}${e.id}` });
    }
    const sites = [], towns = {};
    for (const p of places) {
      const a = needs?.areas?.[p.key];
      const geom = a?.length ? { type: 'MultiPolygon', coordinates: a } : null;
      const n = RELIGIONS.map(() => 0);
      for (const s of all) {
        if (s.k != null || Math.abs(s.lat - p.lat) > 0.3 || Math.abs(s.lon - p.lon) > 0.45) continue;
        const inside = geom
          ? booleanPointInPolygon([s.lon, s.lat], { type: 'Feature', properties: {}, geometry: geom }) || edgeKm(s.lon, s.lat, geom) <= (needs.slackKm ?? 1)
          : distKm(p.lon, p.lat, s.lon, s.lat) <= (needs?.fallbackKm ?? 3);
        if (!inside) continue;
        s.k = p.key;
        n[RELIGIONS.indexOf(s.r)]++;
      }
      towns[p.key] = { ...(census[p.key] ?? {}), pw: n };
    }
    // [lon, lat, religion index, name, denomination, osm id, place key]
    for (const s of all) if (s.k != null) sites.push([round(s.lon, 5), round(s.lat, 5), RELIGIONS.indexOf(s.r), s.name || null, s.den || null, s.osm, s.k]);
    log(`  ${all.length} places of worship in Saskatchewan, ${sites.length} inside the atlas's places (${RELIGIONS.map((r, i) => `${r} ${sites.filter((s) => s[2] === i).length}`).join(', ')})`);
    await writeOut('community', {
      source: 'Statistics Canada, Census of Population 2021, Census Profile (98-401-X2021006) by census subdivision, via the census SDMX API',
      worshipSource: 'OpenStreetMap contributors (amenity=place_of_worship, religion, denomination; ODbL), via Overpass',
      asOf: new Date().toISOString().slice(0, 10),
      religions: RELIGIONS, slackKm: needs?.slackKm ?? 1,
      prov, towns, sites,
    });
  },

  // Newcomer services: where to get settlement help, English classes, a Social Insurance Number (Service Canada) and a
  // driver's licence and plates (an SGI motor licence issuer), and the drive from each place to the nearest of each.
  // Settlement providers come from IRCC's own "Find free newcomer services near you" tool: its page loads the whole
  // national list, with coordinates and the services each office offers, as one script (services-info.js), which is
  // read here as text (never run). The province's list of settlement services (the Regional Newcomer Gateways) is not
  // published as data, so it is typed below (SK_SETTLEMENT) and matched to IRCC's offices. Service Canada offices and
  // SGI issuers come from OpenStreetMap: neither ESDC nor SGI publishes its office list as open data.
  async newcomer() {
    await getProvince();
    const places = await getPlaces();
    const byKey = new Map(places.map((p) => [p.key, p]));

    // --- IRCC settlement providers (one record per line: `{Type : {en : "…", fr : "…"}, … Coordinates : {…}}`)
    const IRCC_JS = 'https://ircc.canada.ca/js/tools/services/services-info.js';
    const js = (await cached('newcomer/ircc-services-info.js', () => fetchBuf(IRCC_JS, { timeout: 300_000 }))).toString('utf8');
    if (!/var ServicesData\s*=\s*\[/.test(js)) throw new Error('IRCC services-info.js no longer holds `var ServicesData = [`');
    const str = (line, field) => line.match(new RegExp(`\\b${field} : \\{en : "((?:[^"\\\\]|\\\\.)*)"`))?.[1]?.replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim() ?? '';
    // IRCC's service flags, kept as one letter each
    const FLAGS = { General: 'g', Needs_assets_referrals: 'n', Help_community: 'c', Job_search: 'j', Help_professions: 'p', Lang_assess: 'a', Lang_training_en: 'e', Lang_training_fr: 'f', Job_lang_training: 'w', Citzenship_test_prep: 'z', Franco: 'F', Youth: 'y', Women: 'W', Help_gar: 'r' };
    const agencies = [];
    let national = 0;
    for (const line of js.split(/\r?\n/)) {
      if (!/^\s*\{\s*Type\s*:/.test(line)) continue;
      national++;
      const lon = +(line.match(/Longitude : "(-?[\d.]+)"/)?.[1] ?? NaN), lat = +(line.match(/Latitude : "(-?[\d.]+)"/)?.[1] ?? NaN);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || !inSask(lon, lat, 0.1)) continue;
      const sv = Object.fromEntries([...(line.match(/Services : \{([^}]*)\}/)?.[1] ?? '').matchAll(/(\w+) : "(yes|no)"/g)].map((m) => [m[1], m[2] === 'yes']));
      if (sv.InPerson_services === false) continue;
      const n = str(line, 'Type');
      if (agencies.some((a) => a.n === n && distKm(a.lon, a.lat, lon, lat) < 0.05)) continue;
      const web = str(line, 'Website');
      agencies.push({
        n, city: str(line, 'City') || null, addr: str(line, 'Address') || null, tel: str(line, 'Telephone') || null,
        web: web ? (/^https?:\/\//i.test(web) ? web : `https://${web}`) : null,
        sv: Object.entries(FLAGS).filter(([k]) => sv[k]).map(([, v]) => v).join(''),
        lon: round(lon, 5), lat: round(lat, 5), src: 'ircc',
      });
    }
    if (!agencies.length) throw new Error(`no Saskatchewan offices among IRCC's ${national} records`);
    log(`  ${agencies.length} in-person IRCC-funded offices in or near Saskatchewan (of ${national} in Canada)`);

    // --- the province's settlement services. HAND-TYPED: the Government of Saskatchewan publishes this list only as a
    // web page, "Find immigration services near you", https://www.saskatchewan.ca/residents/moving-to-saskatchewan/live-in-saskatchewan/find-immigration-services-near-you
    // (entries tagged "Settlement Services"), as read on 2026-11-12. Settlement services there are "offered by Regional
    // Newcomer Gateways". `ircc` picks out the same organisation's offices in IRCC's list (so the IRCC position is used);
    // an organisation IRCC does not list is put at its town's centre (approximate). Re-check the page when rebuilding.
    const SK_SETTLEMENT_ASOF = '2026-11-12';
    const SK_SETTLEMENT = [
      { n: 'Assemblée communautaire fransaskoise (ACF)', town: 'regina', addr: '215, 1440 9th Avenue N., Regina', tel: '306-569-1912', ircc: /communautaire fransaskoise.*Carrefour/i },
      { n: 'Moose Jaw Multicultural Council', town: 'moose jaw', addr: '1235 Main Street North, Moose Jaw', tel: '306-693-4677', ircc: /Moose Jaw Multicultural Council/i },
      { n: 'Regina Immigrant Women Centre', town: 'regina', addr: '211, 3988 Albert Street, Regina', tel: '306-359-6514', ircc: /Regina Immigrant Women Centre/i },
      { n: 'East Central Newcomer Welcome Centre', town: 'yorkton', addr: '132 Broadway Street W., Yorkton', tel: '306-783-2777', ircc: /East Central Newcomer/i },
      { n: 'Southeast Advocates for Employment (Estevan)', town: 'estevan', addr: '1112 6th Street, Estevan', tel: '306-634-9554', ircc: /Southeast Advocates.*Estevan/i },
      { n: 'Humboldt Regional Newcomer Centre', town: 'humboldt', addr: '606 9th Street, Humboldt', tel: '306-682-4277', ircc: /Humboldt Regional Newcomer/i },
      { n: 'Southwest Newcomer Welcome Centre', town: 'swift current', addr: '237 Central Avenue North, Swift Current', tel: '306-778-6262', ircc: /Southwest Newcomer/i },
      { n: 'International Women of Saskatoon', town: 'saskatoon', addr: '301, 336 5th Avenue North, Saskatoon', tel: '306-978-6611', ircc: /^International Women of Saskatoon\s*$/i },
      { n: 'Saskatoon Open Door Society', town: 'saskatoon', addr: '100, 129 3rd Avenue N, Saskatoon', tel: '306-653-4464', ircc: /Saskatoon Open Door Society/i },
      { n: 'Saskatchewan Intercultural Association', town: 'saskatoon', addr: '601B 1st Avenue North, Saskatoon', tel: '306-978-1818', ircc: /Saskatchewan Intercultural Association/i },
      { n: 'Ukrainian Canadian Congress, Saskatchewan Provincial Council', town: 'saskatoon', addr: '#2, 604 22 Street W., Saskatoon', tel: '306-652-5850', ircc: null },
      { n: 'Northeast Newcomer Services (Town of Tisdale)', town: 'tisdale', addr: '800 101 Street, Tisdale', tel: '306-873-2681', ircc: null },
      { n: 'YWCA Prince Albert', town: 'prince albert', addr: '1895 Central Avenue, Prince Albert', tel: '306-763-0736', ircc: /YWCA Prince Albert/i },
      { n: 'Battlefords Immigration Resource Centre', town: 'north battleford', addr: '761C 106th Street, North Battleford', tel: '306-446-0622', ircc: /Battlefords Immigration Resource/i },
      { n: 'Catholic Social Services (Lloydminster)', town: 'lloydminster', addr: '6612 35 Street, Lloydminster, AB', tel: '780-875-9084', ircc: null },
    ];
    for (const s of SK_SETTLEMENT) {
      const hits = s.ircc ? agencies.filter((a) => s.ircc.test(a.n)) : [];
      if (s.ircc && !hits.length) log(`  ${s.n}: not found in IRCC's list any more; placed at the town centre`);
      for (const a of hits) a.g = 1;
      if (hits.length) continue;
      const p = byKey.get(s.town);
      if (!p) throw new Error(`SK_SETTLEMENT: unknown place "${s.town}"`);
      agencies.push({ n: s.n, city: p.name, addr: s.addr, tel: s.tel, web: null, sv: 'gn', lon: round(p.lon, 5), lat: round(p.lat, 5), src: 'sk', g: 1, approx: 1 });
    }
    log(`  ${agencies.filter((a) => a.g).length} offices on the province's settlement list (${agencies.filter((a) => a.src === 'sk').length} not in IRCC's list, placed at their town's centre)`);

    // --- Service Canada offices and SGI motor licence issuers, from OpenStreetMap
    const osm = await overpass('sk-gov-offices.json', `[out:json][timeout:240];(nwr["office"~"^(government|insurance)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});nwr["shop"="insurance"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center tags qt;`);
    const offices = [];
    // not motor licence issuers: life and health insurers, SGI's claims centres, head offices
    const NOT_ISSUER = /sun life|primerica|blue cross|crop production|municode|claims|administration|head office|freedom 55|investors group|ig wealth|manulife|great-west|canada life/i;
    for (const e of osm.elements) {
      const t = e.tags ?? {};
      const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
      const name = (t.name ?? '').trim();
      if (lon == null || !name) continue;
      const city = t['addr:city'] ?? t['is_in:city'] ?? null;
      const addr = [t['addr:unit'] ? `${t['addr:unit']}-` : '', t['addr:housenumber'] ? `${t['addr:housenumber']} ` : '', t['addr:street'] ?? ''].join('').trim() || null;
      const base = { n: name, city, addr, note: t.note ?? t['addr:description'] ?? null, hours: t.opening_hours ?? null, lon: round(lon, 5), lat: round(lat, 5), osm: `${e.type}/${e.id}` };
      if (/service canada/i.test(`${name} ${t.operator ?? ''}`)) {
        // Flin Flon (Manitoba) serves Creighton; Lloydminster's office is on the Alberta side
        if (!inSask(lon, lat, 0.3)) continue;
        offices.push({ ...base, k: /outreach/i.test(name) ? 'so' : 'sc' });
      } else if (inSask(lon, lat)) {
        if (/\bSGI\b|licen[cs]e issuer|driver exam/i.test(name) && !NOT_ISSUER.test(name)) offices.push({ ...base, k: 'sgi' });
        else if ((t.office === 'insurance' || t.shop === 'insurance') && !NOT_ISSUER.test(name)) offices.push({ ...base, k: 'ins' });
      }
    }
    offices.sort((a, b) => b.lat - a.lat);
    const tallyO = (k) => offices.filter((o) => o.k === k).length;
    log(`  OpenStreetMap: ${tallyO('sc')} Service Canada Centres, ${tallyO('so')} scheduled outreach sites; ${tallyO('sgi')} named SGI offices or licence issuers, ${tallyO('ins')} other insurance brokers`);

    // --- drives: settlement help, English classes, Service Canada, an SGI issuer
    const idx = (list) => list.map((x, i) => ({ ...x, i }));
    const sets = {
      s: idx(agencies).filter((a) => a.g || /[gnc]/.test(a.sv)),
      l: idx(agencies).filter((a) => /[ew]/.test(a.sv)),
      c: idx(offices).filter((o) => o.k === 'sc' || o.k === 'so'),
      g: idx(offices).filter((o) => o.k === 'sgi' || o.k === 'ins'),
    };
    const towns = Object.fromEntries(places.map((p) => [p.key, {}]));
    let routed = true;
    for (const [k, list] of Object.entries(sets)) {
      const d = await driveTimes(places, list, `newcomer-${k}`, { keep: 1 });
      routed &&= d.routed;
      for (const [key, v] of Object.entries(d.towns)) if (v[0]) towns[key][k] = { ...v[0], f: list[v[0].f].i };
    }

    await writeOut('newcomer', {
      source: 'Immigration, Refugees and Citizenship Canada, “Find free newcomer services near you” (ircc.canada.ca/english/newcomers/services), the IRCC-funded settlement and language offices it lists',
      provSource: `Government of Saskatchewan, “Find immigration services near you” (saskatchewan.ca), settlement services: typed into the build script from the web page as read on ${SK_SETTLEMENT_ASOF}`,
      provUrl: 'https://www.saskatchewan.ca/residents/moving-to-saskatchewan/live-in-saskatchewan/find-immigration-services-near-you',
      provAsOf: SK_SETTLEMENT_ASOF,
      officeSource: 'OpenStreetMap contributors (Service Canada offices: office=government named Service Canada; SGI motor licence issuers: offices named SGI or licence issuer, and insurance brokers, office=insurance; ODbL), via Overpass',
      routing: routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line',
      routingSource: routed ? 'Drive times: OSRM demo server, © OpenStreetMap contributors (ODbL)' : null,
      asOf: new Date().toISOString().slice(0, 10),
      agencies, offices, towns,
    });
  },

  // Getting around without STC (the provincial bus, closed in 2017): airports with scheduled flights (OurAirports'
  // `scheduled_service` flag, placed by OpenStreetMap's aerodrome), VIA Rail stations and lines and intercity bus routes
  // as mapped in OpenStreetMap, and city transit from the cities' GTFS feeds (route shapes and stop counts), with
  // OpenStreetMap's local bus routes for towns that publish no feed. Per place: the drive to the nearest airport with
  // scheduled service, and whether a VIA station, an intercity bus stop or local transit is in town.
  async transit() {
    await getProvince();
    const places = await getPlaces();
    const near = (lon, lat, tol) => inSask(lon, lat, tol);
    let needs = null;
    try { needs = await readOut('needs'); } catch { log('  needs.json missing: run the needs stage for town limits'); }
    const inTown = (p, lon, lat) => {
      const a = needs?.areas?.[p.key];
      if (a?.length) {
        const geom = { type: 'MultiPolygon', coordinates: a };
        return booleanPointInPolygon([lon, lat], { type: 'Feature', properties: {}, geometry: geom }) || edgeKm(lon, lat, geom) <= (needs.slackKm ?? 1);
      }
      return distKm(p.lon, p.lat, lon, lat) <= (needs?.fallbackKm ?? 3);
    };
    const line = (pts, tol) => {
      const out = [];
      for (const [x, y] of (pts.length > 4 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 1e-4 ? dpRing(pts, tol) : dp(pts, tol))) { const q = [round(x, 4), round(y, 4)]; if (!out.length || q[0] !== out.at(-1)[0] || q[1] !== out.at(-1)[1]) out.push(q); }
      return out;
    };

    // --- airports: OurAirports (public domain) decides scheduled service; OSM's aerodrome (same IATA code) places it
    const OURAIRPORTS = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
    const oa = parseCSV((await cached('transit/ourairports.csv', () => fetchBuf(OURAIRPORTS, { timeout: 300_000 }))).toString('utf8'));
    if (!oa.length || !('scheduled_service' in oa[0])) throw new Error('OurAirports airports.csv has no scheduled_service column');
    // Saskatchewan's, and Canadian ones just over the border (Lloydminster's is on the Alberta side; Flin Flon's serves Creighton)
    const sched = oa.filter((r) => r.scheduled_service === 'yes' && r.iata_code && /^CA-(SK|AB|MB)$/.test(r.iso_region)
      && (r.iso_region === 'CA-SK' || near(+r.longitude_deg, +r.latitude_deg, 0.6)));
    const osmAir = await overpass('sk-aerodromes.json', `[out:json][timeout:120];nwr["aeroway"="aerodrome"](${BBOX.south - 0.5},${BBOX.west - 0.8},${BBOX.north},${BBOX.east + 0.8});out center tags qt;`);
    const airports = [];
    for (const r of sched) {
      const o = osmAir.elements.find((e) => e.tags?.iata === r.iata_code || (r.icao_code && e.tags?.icao === r.icao_code));
      const lon = o ? o.lon ?? o.center?.lon : +r.longitude_deg, lat = o ? o.lat ?? o.center?.lat : +r.latitude_deg;
      airports.push({ n: (o?.tags?.name ?? r.name).trim(), iata: r.iata_code, icao: r.icao_code || r.ident, city: r.municipality || null, prov: r.iso_region.slice(3), size: r.type === 'large_airport' ? 2 : r.type === 'medium_airport' ? 1 : 0, lon: round(lon, 5), lat: round(lat, 5), osm: o ? `${o.type}/${o.id}` : null, wiki: r.wikipedia_link || null });
    }
    if (!airports.length) throw new Error('no airports with scheduled service found in OurAirports');
    // Far-north airports (Stony Rapids, Uranium City, Wollaston Lake…) are reached by air or winter road; OSRM routes
    // over OpenStreetMap's winter roads, so it cannot tell them apart. They are all drive targets, and none is the
    // nearest for any of the atlas's places (checked below).
    airports.sort((x, y) => y.size - x.size || y.lat - x.lat);
    log(`  ${airports.length} airports with scheduled service (OurAirports): ${airports.map((a) => a.iata).join(' ')}; ${airports.filter((a) => a.osm).length} placed by OSM`);

    // --- VIA Rail stations and lines, and intercity / local bus routes, from OpenStreetMap
    const B = `${BBOX.south},${BBOX.west - 0.3},${BBOX.north},${BBOX.east + 0.3}`;
    const viaOSM = await overpass('sk-via.json', `[out:json][timeout:200];(nwr["railway"~"^(station|halt)$"]["operator"~"VIA",i](${B});nwr["railway"~"^(station|halt)$"]["network"~"VIA",i](${B}););out center tags qt;rel["route"="train"]["operator"~"VIA",i](${B});out geom qt;`);
    const stations = [];
    for (const e of viaOSM.elements) {
      if (e.type === 'relation' && e.tags?.route) continue;
      const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat, n = (e.tags?.name ?? '').trim();
      if (lon == null || !n || !near(lon, lat, 0.05)) continue;
      if (stations.some((s) => s.n === n && distKm(s.lon, s.lat, lon, lat) < 3)) continue;
      stations.push({ n, k: e.tags.railway === 'halt' ? 'halt' : 'station', lon: round(lon, 5), lat: round(lat, 5), osm: `${e.type}/${e.id}` });
    }
    // lines: each VIA route's ways inside the province, ways shared by both directions kept once
    const railLines = [];
    const seenWay = new Set();
    for (const r of viaOSM.elements.filter((e) => e.type === 'relation' && e.tags?.route === 'train')) {
      const name = /canadian/i.test(r.tags.name ?? '') ? 'The Canadian (Toronto – Vancouver)' : /churchill/i.test(r.tags.name ?? '') ? 'Winnipeg – Churchill' : (r.tags.name ?? 'VIA Rail');
      let ln = railLines.find((l) => l.n === name);
      if (!ln) railLines.push((ln = { n: name, paths: [] }));
      for (const m of r.members ?? []) {
        if (m.type !== 'way' || !m.geometry || seenWay.has(m.ref)) continue;
        seenWay.add(m.ref);
        const pts = m.geometry.map((g) => [g.lon, g.lat]).filter(([x, y]) => near(x, y, 0.15));
        if (pts.length >= 2) ln.paths.push(pts);
      }
    }
    // stations on a line: within 2 km of it
    for (const s of stations) {
      const l = railLines.find((ln) => ln.paths.some((p) => p.some(([x, y]) => distKm(s.lon, s.lat, x, y) < 2)));
      s.line = l ? l.n : null;
    }
    for (const l of railLines) l.paths = joinPaths(l.paths).map((p) => line(p, 0.002)).filter((p) => p.length >= 2);
    log(`  VIA Rail (OSM): ${stations.length} stations and stops (${stations.filter((s) => s.k === 'halt').length} flag stops); lines: ${railLines.map((l) => `${l.n} (${l.paths.length} pieces)`).join(', ')}`);

    // --- city transit: GTFS feeds where a city publishes one
    const GTFS = [
      { key: 'regina', n: 'Regina Transit', url: 'https://opengis.regina.ca/reginagtfs/google_transit.zip', licence: 'City of Regina Open Data terms of use (open.regina.ca)', licUrl: 'https://open.regina.ca/pages/terms-of-use' },
      { key: 'saskatoon', n: 'Saskatoon Transit', url: 'https://apps5.saskatoon.ca/data/gtfs/google_transit.zip', licence: 'City of Saskatoon Open Data: “free to use, re-use and redistribute”', licUrl: 'https://www.saskatoon.ca/services-residents/connect-your-city/open-data' },
      { key: 'moose jaw', n: 'Moose Jaw Transit', url: 'https://moosejaw.ca/wp-content/uploads/2023/11/moosejaw-GTFS.zip', licence: 'Published by the City of Moose Jaw on its transit page for trip planners; no licence stated', licUrl: 'https://moosejaw.ca/streets-roads/transit/' },
      // the city's own file has moved off citypa.ca; the Mobility Database keeps the last copy it fetched
      { key: 'prince albert', n: 'Prince Albert Transit', url: 'https://files.mobilitydatabase.org/tld-5509_1/latest.zip', licence: 'Published by the City of Prince Albert for trip planners (copy kept by the Mobility Database); no licence stated', licUrl: 'https://mobilitydatabase.org/feeds/gtfs/tld-5509_1' },
    ];
    const systems = [];
    for (const g of GTFS) {
      try {
        const zip = await cached(`transit/gtfs-${g.key.replace(/ /g, '_')}.zip`, async () => { const b = await fetchBuf(g.url, { timeout: 300_000 }); if (b[0] !== 0x50 || b[1] !== 0x4b) throw new Error('not a zip'); return b; });
        const files = unzipSync(new Uint8Array(zip), { filter: (f) => /^(routes|trips|shapes|stops|calendar|feed_info|frequencies)\.txt$/.test(f.name.split('/').pop()) });
        const read = (n) => { const k = Object.keys(files).find((f) => f.split('/').pop() === `${n}.txt`); return k ? parseCSV(strFromU8(files[k])) : []; };
        const routes = read('routes'), trips = read('trips'), shapes = read('shapes'), stops = read('stops'), cal = read('calendar'), info = read('feed_info')[0];
        const pts = new Map();
        for (const s of shapes) { if (!pts.has(s.shape_id)) pts.set(s.shape_id, []); pts.get(s.shape_id).push([+s.shape_pt_sequence, +s.shape_pt_lon, +s.shape_pt_lat]); }
        const len = (id) => { const p = pts.get(id) ?? []; let d = 0; for (let i = 1; i < p.length; i++) d += distKm(p[i - 1][1], p[i - 1][2], p[i][1], p[i][2]); return d; };
        const wed = new Set(cal.filter((c) => c.wednesday === '1').map((c) => c.service_id));
        const end = [info?.feed_end_date, ...cal.map((c) => c.end_date)].filter(Boolean).sort().at(-1) ?? null;
        // a feed that runs by headway (frequencies.txt) has one template trip per route, so its trip count means nothing
        const byHeadway = read('frequencies').length > 0;
        const out = [];
        for (const r of routes) {
          const rt = trips.filter((t) => t.route_id === r.route_id);
          if (!rt.length) continue;
          // the longest shape the route runs stands for it (the other direction mostly retraces it)
          const ids = [...new Set(rt.map((t) => t.shape_id).filter((id) => pts.has(id)))];
          const best = ids.sort((a, b) => len(b) - len(a))[0];
          const path = best ? line(pts.get(best).sort((a, b) => a[0] - b[0]).map(([, x, y]) => [x, y]), 0.0003) : [];
          out.push({ s: r.route_short_name || null, n: (r.route_long_name || r.route_short_name || '').trim(), c: /^[0-9a-f]{6}$/i.test(r.route_color ?? '') ? `#${r.route_color.toLowerCase()}` : null, trips: byHeadway ? null : rt.filter((t) => wed.has(t.service_id)).length, path });
        }
        out.sort((a, b) => (parseInt(a.s) || 999) - (parseInt(b.s) || 999) || String(a.s).localeCompare(String(b.s)));
        const nStops = stops.filter((s) => !s.location_type || s.location_type === '0').length;
        const endDate = end ? `${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}` : null;
        systems.push({ key: g.key, n: g.n, src: 'gtfs', url: g.url, licence: g.licence, licUrl: g.licUrl, stops: nStops, end: endDate, routes: out });
        log(`  ${g.n} (GTFS): ${out.length} routes, ${nStops} stops, ${byHeadway ? 'runs by headway' : `${out.reduce((s, r) => s + r.trips, 0)} trips on a Wednesday`}; timetable to ${endDate}`);
      } catch (e) { log(`  ${g.n}: GTFS failed (${e.message}); left out`); }
    }

    // --- bus routes in OpenStreetMap that no GTFS feed covers: intercity (spanning 40 km or more) or a town's own buses
    const gtfsOps = new RegExp(GTFS.map((g) => g.n).join('|'), 'i');
    const busOSM = await overpass('sk-bus-routes.json', `[out:json][timeout:240];rel["route"~"^(bus|coach)$"](${B})->.r;.r out geom qt;node(r.r);out tags qt;`);
    const nodeTags = new Map(busOSM.elements.filter((e) => e.type === 'node').map((e) => [e.id, e.tags ?? {}]));
    const busRoutes = [], busStops = [], localOSM = [];
    const seenBusWay = new Set();
    for (const r of busOSM.elements.filter((e) => e.type === 'relation')) {
      const t = r.tags ?? {};
      if (gtfsOps.test(`${t.operator ?? ''} ${t.network ?? ''}`)) continue;
      const ways = (r.members ?? []).filter((m) => m.type === 'way' && m.geometry);
      // a route mapped with its stops only (North Battleford's) is drawn stop to stop, in the relation's order
      const stopPts = (r.members ?? []).filter((m) => m.type === 'node' && m.lat != null).map((m) => [m.lon, m.lat]);
      const all = ways.length ? ways.flatMap((m) => m.geometry.map((g) => [g.lon, g.lat])) : stopPts.length >= 5 ? stopPts : [];
      if (!all.length) continue;
      const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
      const span = distKm(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
      const op = (t.operator ?? t.network ?? '').trim() || null;
      if (span >= 40) {
        let br = busRoutes.find((b) => b.op === op);
        if (!br) busRoutes.push((br = { op, names: [], web: t.website ?? null, paths: [] }));
        if (t.name && !br.names.includes(t.name)) br.names.push(t.name);
        for (const m of ways) {
          if (seenBusWay.has(m.ref)) continue;
          seenBusWay.add(m.ref);
          const pts = m.geometry.map((g) => [g.lon, g.lat]).filter(([x, y]) => near(x, y, 0.15));
          if (pts.length >= 2) br.paths.push(pts);
        }
        for (const m of r.members ?? []) {
          if (m.type !== 'node' || !/stop|platform/.test(m.role ?? '') || m.lat == null) continue;
          const nt = nodeTags.get(m.ref) ?? {};
          const n = (nt.name ?? '').trim();
          if (!near(m.lon, m.lat, 0.05) || busStops.some((s) => s.op === op && distKm(s.lon, s.lat, m.lon, m.lat) < 1)) continue;
          busStops.push({ n: n || null, op, lon: round(m.lon, 5), lat: round(m.lat, 5), osm: `node/${m.ref}` });
        }
      } else {
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const p = places.find((pl) => inTown(pl, cx, cy));
        if (!p || systems.some((s) => s.key === p.key)) continue;
        const path = ways.length ? joinPaths(ways.map((m) => m.geometry.map((g) => [g.lon, g.lat]))).sort((a, b) => b.length - a.length)[0] : stopPts;
        localOSM.push({ key: p.key, n: op, name: (t.name ?? '').trim() || (t.ref ? `Route ${t.ref}` : null), osm: `relation/${r.id}`, stops: stopPts.length, path: line(path, 0.0003) });
      }
    }
    for (const b of busRoutes) b.paths = joinPaths(b.paths).map((p) => line(p, 0.002)).filter((p) => p.length >= 2);
    for (const key of [...new Set(localOSM.map((l) => l.key))]) {
      const ls = localOSM.filter((l) => l.key === key);
      systems.push({ key, n: ls.find((l) => l.n)?.n ?? 'Town bus', src: 'osm', url: `https://www.openstreetmap.org/${ls[0].osm}`, licence: 'OpenStreetMap contributors (ODbL)', licUrl: 'https://www.openstreetmap.org/copyright', stops: ls.reduce((s, l) => s + l.stops, 0) || null, end: null,
        routes: ls.map((l) => ({ s: null, n: l.name ?? 'Bus route', c: null, trips: null, path: l.path })) });
    }
    log(`  OSM intercity bus: ${busRoutes.map((b) => `${b.op ?? 'unnamed'} (${b.names.length} routes)`).join(', ') || 'none'}; ${busStops.length} stops; OSM-only town buses: ${[...new Set(localOSM.map((l) => l.key))].join(', ') || 'none'}`);

    // --- per place
    const roadAir = airports.map((a, i) => ({ ...a, i }));
    const d = await driveTimes(places, roadAir, 'transit-air', { keep: 1 });
    const farNorth = [...new Set(Object.values(d.towns).map((v) => v[0] && roadAir[v[0].f]).filter((a) => a && a.lat > 57))];
    if (farNorth.length) log(`  warning: ${farNorth.map((a) => a.iata).join(', ')} (winter road or fly-in) came out nearest for some place`);
    const towns = {};
    for (const p of places) {
      const t = {};
      const tr = d.towns[p.key]?.[0];
      if (tr) t.air = { ...tr, f: roadAir[tr.f].i };
      const rs = stations.map((s, i) => (inTown(p, s.lon, s.lat) ? i : -1)).filter((i) => i >= 0);
      if (rs.length) t.rail = rs;
      const bs = busStops.map((s, i) => (inTown(p, s.lon, s.lat) ? i : -1)).filter((i) => i >= 0);
      if (bs.length) t.bus = bs;
      const sy = systems.findIndex((s) => s.key === p.key);
      if (sy >= 0) t.sys = sy;
      towns[p.key] = t;
    }
    const tally = (k) => Object.values(towns).filter((t) => t[k] != null).length;
    log(`  places with a VIA stop in town: ${tally('rail')}, an intercity bus stop: ${tally('bus')}, local transit: ${tally('sys')}`);

    await writeOut('transit', {
      airSource: 'OurAirports (ourairports.com, public domain): airports flagged with scheduled passenger service; positions and names from OpenStreetMap aerodromes (ODbL) with the same IATA code',
      railSource: 'OpenStreetMap contributors (ODbL): VIA Rail stations and stops (railway=station|halt, operator or network VIA) and VIA train routes, via Overpass',
      busSource: 'OpenStreetMap contributors (ODbL): bus route relations spanning 40 km or more (intercity) and their stops, via Overpass',
      transitSource: 'City GTFS feeds (Regina, Saskatoon, Moose Jaw, Prince Albert); OpenStreetMap bus routes for towns without a feed',
      routing: d.routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line',
      routingSource: d.routed ? 'Drive times: OSRM demo server, © OpenStreetMap contributors (ODbL)' : null,
      asOf: new Date().toISOString().slice(0, 10),
      airports, stations, railLines, busRoutes, busStops, systems, towns,
    });
  },

  // Workday Reach: the drive between every pair of places (OSRM table, one call: the demo server takes up to 100
  // coordinates). `min[i][j]` is the drive in minutes from place i to place j, `km[i][j]` its length.
  async commute() {
    const places = await getPlaces();
    const keys = places.map((p) => p.key);
    const n = places.length;
    let min = null, kms = null, routed = true;
    try {
      if (n > 100) throw new Error(`${n} places is more than one table call takes`);
      const coords = places.map((p) => `${p.lon},${p.lat}`).join(';');
      let h = 0;
      for (let i = 0; i < coords.length; i++) h = (h * 31 + coords.charCodeAt(i)) | 0;
      const tb = await osrm(`commute-matrix-${n}-${(h >>> 0).toString(36)}`, `${OSRM}/table/v1/driving/${coords}?annotations=duration,distance`);
      if (tb.code !== 'Ok') throw new Error(tb.message ?? tb.code);
      min = tb.durations.map((row) => row.map((v) => (v == null ? null : Math.round(v / 60))));
      kms = tb.distances.map((row) => row.map((v) => (v == null ? null : Math.round(v / 1000))));
    } catch (e) {
      log(`  OSRM unavailable (${e.message}); rough straight-line drive times instead`);
      routed = false;
    }
    if (!routed) {
      // a rough drive: 80 km/h along a road 1.3 times the straight line
      kms = places.map((a) => places.map((b) => Math.round(distKm(a.lon, a.lat, b.lon, b.lat) * 1.3)));
      min = kms.map((row) => row.map((v) => Math.round((v / 80) * 60)));
    }
    const near = keys.map((_, i) => min[i].filter((v, j) => j !== i && v != null && v <= 45).length).sort((a, b) => a - b);
    log(`  ${n}×${n} drive times; the median place has ${near[n >> 1]} other places within 45 min`);
    await writeOut('commute', {
      source: routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving; © OpenStreetMap contributors (ODbL)' : 'Straight-line distance × 1.3 at 80 km/h (no routing service was reachable)',
      routed,
      asOf: new Date().toISOString().slice(0, 10),
      keys, min, km: kms,
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

  // ---- Right now: live readings, rebuilt hourly by .github/workflows/live.yml and never committed (public/data/now/ is
  // in .gitignore). Nothing here is cached: each run reads the feeds as they are. `asOf` is the newest reading's time
  // (for hotspots and alerts, which are lists of what is in effect, the moment the list was read).

  // ECCC real-time hydrometric data: the latest level and discharge at each gauge in rivers.json, from the last 24 hours.
  async 'now-rivers'() {
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
  },

  // CWFIS satellite hotspots of the last 24 hours, and the perimeters it estimates from them (season to date; kept while heat
  // was seen within 7 days).
  async 'now-fires'() {
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
  },

  // ECCC AQHI: the latest hourly observation and the latest forecast's highest value for each community near Saskatchewan;
  // each place borrows the nearest community within 150 km (the smoke layer's rule).
  async 'now-air'() {
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
  },

  // ECCC public weather alerts in effect whose area is in Saskatchewan: one row per alert, with every forecast region it
  // covers (simplified outlines) and the atlas's places inside them.
  async 'now-alerts'() {
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
  },
};
/** The live stages, which `npm run data now` runs. */
const NOW_STAGES = ['now-rivers', 'now-fires', 'now-air', 'now-alerts'];

// The daily record of the live feeds (scripts/history.mjs; plans/digital-twin/2-accumulated-state.md). Run only when
// named: `history` rolls today in, `history-backfill` also reaches back as far as each feed keeps. Both read the live
// files, so run them after `now`.
const historyHelpers = () => ({ log, fetchBuf, asJSON, OGC, BBOX, OUT, readOut, inSask, getProvince, round });
SOURCES.history = async () => { const { history } = await import('./history.mjs'); await history(historyHelpers()); };
SOURCES['history-backfill'] = async () => { const { history } = await import('./history.mjs'); await history(historyHelpers(), { backfill: true }); };
const ON_REQUEST = ['history', 'history-backfill'];
/** Stages whose run is recorded in public/data/now/manifest.json (not committed), not in manifest.json. */
const LIVE_STAGES = [...NOW_STAGES, ...ON_REQUEST];

async function writeNow(name, data) {
  await fs.mkdir(path.join(OUT, 'now'), { recursive: true });
  const text = JSON.stringify(data);
  await fs.writeFile(path.join(OUT, 'now', `${name}.json`), text);
  log(`wrote now/${name}.json (${(text.length / 1024).toFixed(0)} KB)`);
}

/** Text items {page, x, y, s} from a simple PDF: Flate-compressed page streams, text placed with `Tm` and drawn with
 * `Tj` in standard (WinAnsi) fonts, as the province's OpenPDF reports are. Not a general PDF reader. */
function pdfText(buf) {
  const s = buf.toString('latin1');
  const items = [];
  const re = /stream\r?\n/g;
  let m, page = 0;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length, end = s.indexOf('endstream', start);
    let out;
    try { out = Buffer.from(unzlibSync(buf.subarray(start, end))).toString('latin1'); } catch { continue; }
    if (!/\bBT\b/.test(out)) continue;
    page++;
    let x = 0, y = 0, t;
    const tok = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) Tm|\(((?:\\.|[^\\)])*)\)\s*Tj/g;
    while ((t = tok.exec(out))) {
      if (t[1] != null) { x = +t[5]; y = +t[6]; continue; }
      const str = t[7].replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] ?? (/^[0-7]/.test(c) ? String.fromCharCode(parseInt(c, 8)) : c)));
      if (str.trim()) items.push({ page, x, y, s: str });
    }
  }
  return items;
}

/** The rows of a "PDWA and EBWO currently in effect" report. Each row has one `1` in the PDWA or EBWO column; a row
 * runs from its mark down to the next one (or onto the next page). Columns by x: name, date (and health region),
 * title, marks, comments. */
function advisoryRows(buf) {
  const items = pdfText(buf);
  const rows = [];
  const pages = items.length ? Math.max(...items.map((i) => i.page)) : 0;
  for (let p = 1; p <= pages; p++) {
    const its = items.filter((i) => i.page === p && i.y < 440 && i.y > 40);
    const marks = its.filter((i) => i.x >= 480 && i.x < 550 && i.s.trim() === '1').sort((a, b) => b.y - a.y);
    const bands = marks.map((mk, k) => ({ top: mk.y + 4, bottom: k + 1 < marks.length ? marks[k + 1].y + 4 : 0, kind: mk.x < 515 ? 'PDWA' : 'EBWO', items: [] }));
    for (const i of its) {
      if (i.x >= 480 && i.x < 550) continue;
      const b = bands.find((b) => i.y <= b.top && i.y > b.bottom);
      if (b) b.items.push(i);
      else if (rows.length) rows[rows.length - 1].items.push(i); // carried over from the last page
    }
    rows.push(...bands);
  }
  return rows.map((r) => {
    const col = (lo, hi) => r.items.filter((i) => i.x >= lo && i.x < hi).sort((a, b) => b.y - a.y).map((i) => i.s.trim());
    let nameLines = col(0, 185);
    const half = nameLines.length / 2; // a name is sometimes printed twice in its row
    if (nameLines.length % 2 === 0 && nameLines.slice(0, half).join('|') === nameLines.slice(half).join('|')) nameLines = nameLines.slice(0, half);
    const mid = col(185, 255);
    const date = mid.find((s) => /^\d{2}-[A-Z][a-z]{2}-\d{2}$/.test(s)) ?? null;
    const region = mid.filter((s) => s !== date).join(' ').replace(/\s*Regional Health\s*Authority\s*/i, '').trim() || null;
    const title = col(255, 480).join(' ').replace(/\s+/g, ' ').trim();
    const comments = col(550, 1000).join(' ').replace(/\s+/g, ' ');
    const pick = (k) => comments.match(new RegExp(`${k}:\\s*(.*?)(?=Operational:|Quality:|$)`))?.[1]?.trim() || null;
    return { nameLines, kind: r.kind, date, region, title, quality: pick('Quality'), operational: pick('Operational') };
  });
}

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

// `now` stands for the four live stages
const wanted = process.argv.slice(2).flatMap((n) => (n === 'now' ? NOW_STAGES : [n]));
const order = ['province', 'places', 'fires', 'tornadoes', 'hail', 'rivers', 'climate', 'smoke', 'drought', 'normals', 'population', 'crime', 'housing', 'tax', 'jobs', 'needs', 'treaties', 'justice', 'hospitals', 'camping', 'schools', 'internet', 'community', 'newcomer', 'doctors', 'childcare', 'industry', 'water', 'radon', 'light', 'transit', 'commute', ...NOW_STAGES, ...ON_REQUEST];
const unknown = wanted.filter((n) => !order.includes(n));
if (unknown.length) { console.error(`Unknown stage(s): ${unknown.join(', ')}`); process.exit(1); }
const run = wanted.length ? order.filter((n) => wanted.includes(n)) : order.filter((n) => !ON_REQUEST.includes(n));

// The live stages keep their own manifest beside their files (public/data/now/, not committed), so the committed
// manifest.json never changes just because the live stages ran.
const readManifest = async (file) => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return {}; } };
const MANIFEST = path.join(OUT, 'manifest.json'), NOW_MANIFEST = path.join(OUT, 'now', 'manifest.json');
const manifests = { main: await readManifest(MANIFEST), now: await readManifest(NOW_MANIFEST) };

let failures = 0;
for (const name of run) {
  const t0 = Date.now();
  const manifest = LIVE_STAGES.includes(name) ? manifests.now : manifests.main;
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
if (run.some((n) => !LIVE_STAGES.includes(n))) await fs.writeFile(MANIFEST, JSON.stringify(manifests.main, null, 2));
if (run.some((n) => LIVE_STAGES.includes(n))) {
  await fs.mkdir(path.dirname(NOW_MANIFEST), { recursive: true });
  await fs.writeFile(NOW_MANIFEST, JSON.stringify(manifests.now, null, 2));
}
console.log(failures ? `\nFinished with ${failures} failed source(s).` : '\nAll sources fetched.');
