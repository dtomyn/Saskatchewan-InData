// A small PMTiles v3 writer (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md): one static file of
// vector tiles that MapLibre reads with HTTP range requests, so the site needs no tile server. Tiles go in tile-id
// order (clustered), gzipped; the root directory holds every entry, or points at leaf directories when it would not
// fit in the first 16 KiB.

import { gzipSync } from 'node:zlib';
import { zxyToTileId } from 'pmtiles';

const varint = (out, v) => {
  // numbers up to 2^53: arithmetic, not bit operators (which stop at 2^31)
  while (v >= 0x80) { out.push((v % 0x80) | 0x80); v = Math.floor(v / 0x80); }
  out.push(v);
};

function directory(entries) {
  const b = [];
  varint(b, entries.length);
  let last = 0;
  for (const e of entries) { varint(b, e.id - last); last = e.id; }
  for (const e of entries) varint(b, e.run);
  for (const e of entries) varint(b, e.length);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    varint(b, i > 0 && e.offset === prev.offset + prev.length ? 0 : e.offset + 1);
  });
  return gzipSync(Buffer.from(b));
}

/** The root directory, and leaf directories when the root would not fit with the header in 16 KiB. */
function directories(entries) {
  const root = directory(entries);
  if (root.length <= 16384 - 127) return { root, leaves: Buffer.alloc(0) };
  for (let size = 4096; ; size *= 2) {
    const leaves = [], rootEntries = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += size) {
      const leaf = directory(entries.slice(i, i + size));
      rootEntries.push({ id: entries[i].id, run: 0, offset, length: leaf.length });
      leaves.push(leaf);
      offset += leaf.length;
    }
    const r = directory(rootEntries);
    if (r.length <= 16384 - 127) return { root: r, leaves: Buffer.concat(leaves) };
  }
}

/**
 * Builds a PMTiles archive. `tiles` is [{ z, x, y, data }] with `data` an uncompressed MVT buffer; `meta` is the
 * metadata JSON (vector_layers, attribution…); `bounds` [w, s, e, n]; `center` [lon, lat, zoom].
 */
export function writePMTiles(tiles, { meta, bounds, center }) {
  const sorted = tiles.map((t) => ({ ...t, id: zxyToTileId(t.z, t.x, t.y) })).sort((a, b) => a.id - b.id);
  // identical tiles are stored once; consecutive ids with the same contents share one entry (run length)
  const seen = new Map();
  const blobs = [];
  const entries = [];
  let offset = 0;
  for (const t of sorted) {
    const gz = gzipSync(t.data);
    const key = gz.toString('base64');
    let at = seen.get(key);
    if (at == null) { at = { offset, length: gz.length }; seen.set(key, at); blobs.push(gz); offset += gz.length; }
    const prev = entries.at(-1);
    if (prev && prev.offset === at.offset && prev.id + prev.run === t.id) prev.run++;
    else entries.push({ id: t.id, run: 1, offset: at.offset, length: at.length });
  }
  const data = Buffer.concat(blobs);
  const { root, leaves } = directories(entries);
  const metadata = gzipSync(Buffer.from(JSON.stringify(meta)));
  const zs = sorted.map((t) => t.z);

  const h = Buffer.alloc(127);
  h.write('PMTiles', 0, 'latin1');
  h.writeUInt8(3, 7);
  const u64 = (pos, v) => h.writeBigUInt64LE(BigInt(v), pos);
  const rootOff = 127, metaOff = rootOff + root.length, leafOff = metaOff + metadata.length, dataOff = leafOff + leaves.length;
  u64(8, rootOff); u64(16, root.length);
  u64(24, metaOff); u64(32, metadata.length);
  u64(40, leafOff); u64(48, leaves.length);
  u64(56, dataOff); u64(64, data.length);
  u64(72, sorted.length); u64(80, entries.length); u64(88, blobs.length);
  h.writeUInt8(1, 96); // clustered
  h.writeUInt8(2, 97); // internal compression: gzip
  h.writeUInt8(2, 98); // tile compression: gzip
  h.writeUInt8(1, 99); // tile type: MVT
  h.writeUInt8(Math.min(...zs), 100);
  h.writeUInt8(Math.max(...zs), 101);
  const e7 = (pos, v) => h.writeInt32LE(Math.round(v * 1e7), pos);
  e7(102, bounds[0]); e7(106, bounds[1]); e7(110, bounds[2]); e7(114, bounds[3]);
  h.writeUInt8(center[2], 118);
  e7(119, center[0]); e7(123, center[1]);
  return Buffer.concat([h, root, metadata, leaves, data]);
}
