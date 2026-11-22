// A small reader for Cloud-Optimized GeoTIFFs over HTTP (Sentinel-2 L2A on AWS): the header by one range request,
// then whole tiles of one overview level by range, Deflate-compressed (node:zlib) with or without the horizontal
// predictor, 8- or 16-bit unsigned, one band. No library: anything else throws, so a changed file is never misread.
// Tiles are cached raw in .cache/ under the name the caller gives.

import { inflateSync } from 'node:zlib';
import { cached, fetchBuf } from './io.mjs';

const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };
const range = (url, from, to) => fetchBuf(url, { headers: { Range: `bytes=${from}-${to}` }, timeout: 120_000 });

/**
 * The header of a COG: its levels (full resolution first, then the overviews), each with its size, tile size and tile
 * offsets, and the full-resolution georeference (`x0`, `y0` the top-left corner, `dx` the pixel size, in the file's
 * own CRS). `cacheName` keys the cached header (e.g. "sentinel/12UWC/20230709/B04").
 */
export async function cogOpen(url, cacheName) {
  let buf = await cached(`${cacheName}-head.bin`, () => range(url, 0, 65535));
  if (buf.toString('latin1', 0, 2) !== 'II' || buf.readUInt16LE(2) !== 42) throw new Error(`${url}: not a little-endian classic TIFF`);
  const u16 = (o) => buf.readUInt16LE(o), u32 = (o) => buf.readUInt32LE(o);
  const levels = [];
  for (let ifd = u32(4); ifd; ) {
    if (ifd + 2 > buf.length) throw new Error(`${url}: IFD past the first 64 KB`);
    const n = u16(ifd), tags = {};
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12, type = u16(e + 2), count = u32(e + 4), size = SIZE[type] ?? 1;
      const at = size * count <= 4 ? e + 8 : u32(e + 8);
      if (at + size * count > buf.length) throw new Error(`${url}: tag ${u16(e)} past the first 64 KB`);
      const read = type === 3 ? u16 : type === 4 ? u32 : type === 12 ? (o) => buf.readDoubleLE(o) : type === 1 ? (o) => buf[o] : null;
      tags[u16(e)] = read ? Array.from({ length: count }, (_, k) => read(at + k * size)) : [];
    }
    const one = (t, d) => tags[t]?.[0] ?? d;
    if (!tags[322]) throw new Error(`${url}: not tiled`);
    if (one(259) !== 8) throw new Error(`${url}: compression ${one(259)}, expected Deflate`);
    if (one(277, 1) !== 1 || ![8, 16].includes(one(258)) || one(339, 1) !== 1) throw new Error(`${url}: not one band of unsigned 8- or 16-bit samples`);
    levels.push({ w: one(256), h: one(257), tw: one(322), th: one(323), bits: one(258), predictor: one(317, 1), offsets: tags[324], counts: tags[325], scale: tags[33550], tie: tags[33922] });
    ifd = u32(ifd + 2 + n * 12);
  }
  const L0 = levels[0];
  if (!L0.scale || !L0.tie) throw new Error(`${url}: no georeference`);
  return { url, cacheName, levels, x0: L0.tie[3] - L0.tie[0] * L0.scale[0], y0: L0.tie[4] + L0.tie[1] * L0.scale[1], dx: L0.scale[0] };
}

/** One whole level of a COG as a typed array (rows north to south), with its pixel size in the file's CRS. */
export async function cogLevel(cog, k) {
  const L = cog.levels[k];
  if (!L) throw new Error(`${cog.url}: no level ${k}`);
  const out = L.bits === 16 ? new Uint16Array(L.w * L.h) : new Uint8Array(L.w * L.h);
  const across = Math.ceil(L.w / L.tw), down = Math.ceil(L.h / L.th);
  for (let ty = 0; ty < down; ty++)
    for (let tx = 0; tx < across; tx++) {
      const i = ty * across + tx;
      if (!L.counts[i]) continue; // an empty tile: no data
      const raw = await cached(`${cog.cacheName}-L${k}-${i}.bin`, () => range(cog.url, L.offsets[i], L.offsets[i] + L.counts[i] - 1), (b) => b.length === L.counts[i]);
      const bytes = inflateSync(raw);
      const n = L.tw * L.th;
      if (bytes.length < n * (L.bits / 8)) throw new Error(`${cog.url}: tile ${i} inflated to ${bytes.length} bytes`);
      const own = new Uint8Array(bytes.subarray(0, n * (L.bits / 8))); // a copy, aligned for the 16-bit view
      const tile = L.bits === 16 ? new Uint16Array(own.buffer) : own;
      if (L.predictor === 2) for (let r = 0; r < L.th; r++) for (let c = 1; c < L.tw; c++) tile[r * L.tw + c] += tile[r * L.tw + c - 1];
      else if (L.predictor !== 1) throw new Error(`${cog.url}: predictor ${L.predictor}`);
      for (let r = 0; r < L.th; r++) {
        const y = ty * L.th + r;
        if (y >= L.h) break;
        const w = Math.min(L.tw, L.w - tx * L.tw);
        out.set(tile.subarray(r * L.tw, r * L.tw + w), y * L.w + tx * L.tw);
      }
    }
  return { w: L.w, h: L.h, v: out, x0: cog.x0, y0: cog.y0, dx: (cog.dx * cog.levels[0].w) / L.w };
}

/** WGS84 longitude/latitude → UTM easting/northing (northern hemisphere), Snyder's series. */
export function utm(lon, lat, zone) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180, lam = (lon * Math.PI) / 180, lam0 = ((zone * 6 - 183) * Math.PI) / 180;
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * s * s), T = t * t, C = ep2 * c * c, A = c * (lam - lam0);
  const e4 = e2 * e2, e6 = e4 * e2;
  const M = a * ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi - ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) - ((35 * e6) / 3072) * Math.sin(6 * phi));
  const E = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  const Nn = k0 * (M + N * t * ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  return [E, Nn];
}
