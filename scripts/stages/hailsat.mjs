import fs from 'node:fs/promises';
import path from 'node:path';
import { OUT } from '../lib/config.mjs';
import { cogLevel, cogOpen, utm } from '../lib/cog.mjs';
import { cached, fetchBuf, log, readOut, round, writeAtomic, writeOut } from '../lib/io.mjs';
import { palettePng } from '../lib/png.mjs';
import { corridorKm } from './hailcrop.mjs';

// From space: for a few big radar hail swaths on storm days the insurers documented, Sentinel-2 L2A's vegetation index
// (NDVI) on the clearest days before and after, read anonymously from AWS Earth Search (STAC) as Cloud-Optimized
// GeoTIFFs at their 160 m overview (red B04, near infrared B08, and the scene classification SCL to keep only
// vegetation and bare-soil pixels: no cloud, shadow, water or snow), mosaicked per pixel from the nearest clear scene,
// and written as three small palette PNGs per swath (before, after, change) on a Web Mercator grid over the corridor
// and 10 km around it. Vegetation change, never damage: clouds, harvest, haying and crops growing or ripening change it
// too. Contains modified Copernicus Sentinel data.
const PICKS = [
  { year: 2023, name: 'Smiley', why: 'The radar swath across the west-central farm belt on the day Municipal Hail counted as its worst of 2023 (25 July: $11.4 million in crop claims, most in the RMs of Oakdale and Kindersley).' },
  { year: 2023, name: 'Webb', why: 'The radar swath west of Swift Current on 22 July 2023, when Municipal Hail recorded a storm that began northwest of Swift Current ($8.3 million in crop claims along its whole track).' },
  { year: 2024, name: 'Estevan', why: 'The longest radar swath of 2024, across the southeast on 23 June 2024, when Municipal Hail counted hail in 76 rural municipalities.' },
];
const STAC = 'https://earth-search.aws.element84.com/v1/search';
const DAYS = 20, MARGIN_KM = 10, MAX_PX = 500_000, MAX_BYTES = 1_000_000;
const R = 6378137;
const mx = (lon) => (R * lon * Math.PI) / 180, my = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const ulon = (x) => (x / R) * (180 / Math.PI), ulat = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
const isoDay = (t) => { const y = Math.floor(t); return new Date(Math.round(Date.UTC(y, 0, 1) + (t - y) * (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)))).toISOString().slice(0, 10); };
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** distance (km) to a centre line, round at the ends (the context ring around the corridor) */
const lineKm = (pts, lon, lat) => {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = (pts[i - 1][0] - lon) * kx, ay = (pts[i - 1][1] - lat) * ky, bx = (pts[i][0] - lon) * kx, by = (pts[i][1] - lat) * ky;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, u = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(ax + u * dx, ay + u * dy));
  }
  return best;
};
// palettes: 0 transparent; NDVI −0.1…0.9 and change −0.5…+0.5 on 1…250
const lerp = (stops, x) => {
  for (let i = 1; i < stops.length; i++) if (x <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], f = (x - a) / (b - a); return ca.map((v, k) => Math.round(v + f * (cb[k] - v))); }
  return stops.at(-1)[1];
};
const NDVI_STOPS = [[-0.1, [120, 96, 70, 235]], [0.15, [140, 109, 70, 235]], [0.35, [217, 194, 122, 235]], [0.55, [143, 196, 106, 235]], [0.9, [30, 120, 50, 235]]];
const CHANGE_STOPS = [[-0.5, [178, 50, 34, 240]], [-0.15, [224, 140, 90, 230]], [0, [225, 225, 215, 110]], [0.15, [140, 200, 122, 230]], [0.5, [30, 120, 50, 240]]];
const palette = (stops, lo, hi) => Array.from({ length: 256 }, (_, i) => (i === 0 || i > 250 ? [0, 0, 0, 0] : lerp(stops, lo + ((i - 1) / 249) * (hi - lo))));
const toIdx = (v, lo, hi) => 1 + Math.round(Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 249);

export default async function hailsat() {
  const hail = await readOut('hail');
  const outDir = path.join(OUT, 'hail-sat');
  await fs.mkdir(outDir, { recursive: true });
  const swaths = [];
  let bytes = 0;
  for (const pick of PICKS) {
    const r = hail.rows.filter((x) => x[4] === 0 && Math.floor(x[2]) === pick.year && x[5] === pick.name && x[8] > 0).sort((a, b) => (b[3] ?? 0) - (a[3] ?? 0))[0];
    if (!r) { log(`  ${pick.year} ${pick.name}: no such swath with a width, skipped`); continue; }
    const pts = r[6], half = r[8] / 2, reach = half + MARGIN_KM;
    // the storm's date as the hail stage gives it; it may be the day after a storm late in the evening, so "before"
    // ends two days earlier and "after" starts the next day
    const day = isoDay(r[2]);
    const lats = pts.map((p) => p[1]), lons = pts.map((p) => p[0]);
    const dLat = reach / 110.57, dLon = reach / (111.32 * Math.cos((Math.max(...lats) * Math.PI) / 180));
    const bbox = [Math.min(...lons) - dLon, Math.min(...lats) - dLat, Math.max(...lons) + dLon, Math.max(...lats) + dLat];
    // the grid: Web Mercator pixels, coarser for a long swath so a picture stays under MAX_PX
    let px = 300;
    const span = () => [Math.ceil((mx(bbox[2]) - mx(bbox[0])) / px), Math.ceil((my(bbox[3]) - my(bbox[1])) / px)];
    while (span()[0] * span()[1] > MAX_PX) px = Math.round(px * 1.2);
    const [w, h] = span(), X0 = mx(bbox[0]), Y1 = my(bbox[3]);
    const lonOf = new Float64Array(w), latOf = new Float64Array(h);
    for (let c = 0; c < w; c++) lonOf[c] = ulon(X0 + (c + 0.5) * px);
    for (let rr = 0; rr < h; rr++) latOf[rr] = ulat(Y1 - (rr + 0.5) * px);
    const zone = new Uint8Array(w * h); // 0 outside, 1 inside the corridor, 2 the ring around it
    for (let rr = 0; rr < h; rr++) for (let c = 0; c < w; c++) {
      const lon = lonOf[c], lat = latOf[rr];
      zone[rr * w + c] = corridorKm(pts, lon, lat) <= half ? 1 : lineKm(pts, lon, lat) <= reach ? 2 : 0;
    }
    const want = zone.reduce((n, z) => n + (z ? 1 : 0), 0);
    const sides = {};
    for (const [side, from, to, dir] of [['before', addDays(day, -2 - DAYS), addDays(day, -2), -1], ['after', addDays(day, 1), addDays(day, 1 + DAYS), 1]]) {
      const body = JSON.stringify({ collections: ['sentinel-2-l2a'], bbox, datetime: `${from}T00:00:00Z/${to}T23:59:59Z`, limit: 200, query: { 'eo:cloud_cover': { lt: 40 } } });
      const ans = JSON.parse(await cached(`hailsat/stac-${pick.year}-${pick.name}-${side}.json`, () => fetchBuf(STAC, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }), (b) => b[0] === 0x7b));
      // nearest the storm first, the clearer first on the same day
      const items = (ans.features ?? []).sort((a, b) => dir * (Date.parse(a.properties.datetime) - Date.parse(b.properties.datetime)) || a.properties['eo:cloud_cover'] - b.properties['eo:cloud_cover']);
      const ndvi = new Float32Array(w * h).fill(NaN);
      let have = 0;
      const used = [];
      for (const it of items) {
        if (have >= want * 0.98) break;
        const [bw, bs, be, bn] = it.bbox;
        const c0 = Math.max(0, Math.floor((mx(bw) - X0) / px)), c1 = Math.min(w - 1, Math.ceil((mx(be) - X0) / px));
        const r0 = Math.max(0, Math.floor((Y1 - my(bn)) / px)), r1 = Math.min(h - 1, Math.ceil((Y1 - my(bs)) / px));
        let gap = false;
        for (let rr = r0; rr <= r1 && !gap; rr++) for (let c = c0; c <= c1; c++) if (zone[rr * w + c] && Number.isNaN(ndvi[rr * w + c])) { gap = true; break; }
        if (!gap) continue;
        const epsg = +(it.properties['proj:epsg'] ?? String(it.properties['proj:code'] ?? '').replace('EPSG:', ''));
        if (!(epsg > 32600 && epsg < 32661)) { log(`  ${it.id}: not UTM north (${epsg}), skipped`); continue; }
        const utmZone = epsg - 32600;
        const band = async (a) => {
          const href = it.assets[a]?.href;
          if (!/^https:\/\/sentinel-cogs\.s3\.us-west-2\.amazonaws\.com\//.test(href ?? '')) throw new Error(`${it.id}: unexpected ${a} asset ${href}`);
          const cog = await cogOpen(href, `hailsat/${it.id}/${a}`);
          const k = cog.levels.findIndex((L) => (cog.dx * cog.levels[0].w) / L.w >= 150);
          return { ...(await cogLevel(cog, k < 0 ? cog.levels.length - 1 : k)), rb: it.assets[a]['raster:bands']?.[0] ?? {} };
        };
        const [red, nir, scl] = [await band('red'), await band('nir'), await band('scl')];
        const at = (g, E, N) => { const c = Math.floor((E - g.x0) / g.dx), rr = Math.floor((g.y0 - N) / g.dx); return c >= 0 && c < g.w && rr >= 0 && rr < g.h ? g.v[rr * g.w + c] : 0; };
        const refl = (g, dn) => dn * (g.rb.scale ?? 1e-4) + (g.rb.offset ?? 0);
        let got = 0;
        for (let rr = r0; rr <= r1; rr++) for (let c = c0; c <= c1; c++) {
          const k = rr * w + c;
          if (!zone[k] || !Number.isNaN(ndvi[k])) continue;
          const [E, N] = utm(lonOf[c], latOf[rr], utmZone);
          const s = at(scl, E, N);
          if (s !== 4 && s !== 5) continue; // vegetation or bare soil only
          const rd = at(red, E, N), ni = at(nir, E, N);
          if (!rd || !ni) continue;
          const a = refl(red, rd), b = refl(nir, ni);
          if (a + b <= 0.01) continue;
          ndvi[k] = (b - a) / (b + a);
          got++;
        }
        if (got) { have += got; used.push(it.properties.datetime.slice(0, 10)); }
        log(`  ${pick.name} ${side}: ${it.id} gave ${got}, ${((have / want) * 100).toFixed(0)}% covered`);
      }
      sides[side] = { ndvi, cover: have / want, from: used.length ? [...used].sort()[0] : null, to: used.length ? [...used].sort().at(-1) : null, scenes: used.length };
    }
    if (sides.before.cover < 0.85 || sides.after.cover < 0.85) { log(`  ${pick.name}: only ${(sides.before.cover * 100).toFixed(0)}% / ${(sides.after.cover * 100).toFixed(0)}% clear, skipped`); continue; }
    // the pictures and the mean change inside the corridor and in the ring around it
    const idx = { before: new Uint8Array(w * h), after: new Uint8Array(w * h), change: new Uint8Array(w * h) };
    const mean = { 1: [0, 0], 2: [0, 0] };
    for (let k = 0; k < w * h; k++) {
      if (!zone[k]) continue;
      const a = sides.before.ndvi[k], b = sides.after.ndvi[k];
      if (!Number.isNaN(a)) idx.before[k] = toIdx(a, -0.1, 0.9);
      if (!Number.isNaN(b)) idx.after[k] = toIdx(b, -0.1, 0.9);
      if (!Number.isNaN(a) && !Number.isNaN(b)) { idx.change[k] = toIdx(b - a, -0.5, 0.5); mean[zone[k]][0] += b - a; mean[zone[k]][1]++; }
    }
    const slug = `${pick.year}-${pick.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const files = {};
    for (const [k, stops, lo, hi] of [['before', NDVI_STOPS, -0.1, 0.9], ['after', NDVI_STOPS, -0.1, 0.9], ['change', CHANGE_STOPS, -0.5, 0.5]]) {
      const png = palettePng(w, h, idx[k], palette(stops, lo, hi));
      bytes += png.length;
      await writeAtomic(path.join(outDir, `${slug}-${k}.png`), png);
      files[k] = `hail-sat/${slug}-${k}.png`;
    }
    const m = (z) => (mean[z][1] ? round(mean[z][0] / mean[z][1], 3) : null);
    swaths.push({
      t: r[2], lon: r[0], lat: r[1], name: pick.name, day, why: pick.why,
      bounds: [ulon(X0), ulat(Y1 - h * px), ulon(X0 + w * px), ulat(Y1)].map((v) => round(v, 5)), w, h, px,
      before: { from: sides.before.from, to: sides.before.to, scenes: sides.before.scenes, cover: round(sides.before.cover, 3) },
      after: { from: sides.after.from, to: sides.after.to, scenes: sides.after.scenes, cover: round(sides.after.cover, 3) },
      // mean NDVI change (after − before) inside the corridor and in the 10 km ring around it
      change: { inside: m(1), around: m(2) },
      files,
    });
    log(`  ${pick.name}: ${w}×${h} at ${px} m; NDVI change ${m(1)} inside, ${m(2)} around`);
  }
  if (bytes > MAX_BYTES) throw new Error(`hail-sat pictures total ${bytes} bytes, over ${MAX_BYTES}`);
  if (!swaths.length) throw new Error('no swath had clear scenes before and after');
  log(`  ${swaths.length} swaths, ${(bytes / 1024).toFixed(0)} KB of pictures`);
  await writeOut('hail-sat', {
    source: 'Copernicus Sentinel-2 L2A (ESA), Cloud-Optimized GeoTIFFs on AWS (Earth Search, Element 84), red B04, near infrared B08 and the scene classification SCL at their 160 m overview',
    sourceUrl: 'https://registry.opendata.aws/sentinel-2-l2a-cogs/',
    licence: 'Copernicus Sentinel data terms (free and open, attribution)', licenceUrl: 'https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice',
    credit: `Contains modified Copernicus Sentinel data ${[...new Set(swaths.map((s) => Math.floor(s.t)))].join(', ')}`,
    swaths,
  });
}
