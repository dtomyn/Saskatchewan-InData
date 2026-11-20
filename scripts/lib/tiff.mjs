// A small reader for the GeoTIFFs MSC GeoMet's WCS returns: one band, uncompressed, in strips, 32- or 64-bit floats
// (or 8/16-bit integers). No library: anything else (tiles, compression, more bands) throws, so a changed answer is
// never misread.

const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

/** → { w, h, v: Float64Array (rows north to south, each west to east), west, north, dx, dy } (the corner of the first
 *  pixel and the pixel size in degrees, when the file is georeferenced). */
export function readTiff(buf, what = 'tiff') {
  const bo = buf.toString('latin1', 0, 2);
  if (bo !== 'II' && bo !== 'MM') throw new Error(`${what}: not a TIFF (${buf.toString('utf8', 0, 120).replace(/\s+/g, ' ')})`);
  const le = bo === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const f64 = (o) => (le ? buf.readDoubleLE(o) : buf.readDoubleBE(o));
  if (u16(2) !== 42) throw new Error(`${what}: not a classic TIFF`);
  const ifd = u32(4), n = u16(ifd), tags = {};
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12, type = u16(e + 2), count = u32(e + 4), size = SIZE[type] ?? 1;
    const at = size * count <= 4 ? e + 8 : u32(e + 8);
    const read = type === 3 ? u16 : type === 4 ? u32 : type === 12 ? f64 : type === 1 ? (o) => buf[o] : null;
    tags[u16(e)] = read ? Array.from({ length: count }, (_, k) => read(at + k * size)) : [];
  }
  const one = (t, d) => tags[t]?.[0] ?? d;
  const w = one(256), h = one(257), bits = one(258, 1), fmt = one(339, 1);
  if (!w || !h) throw new Error(`${what}: no image size`);
  if (one(259, 1) !== 1) throw new Error(`${what}: compressed (${one(259)})`);
  if (one(277, 1) !== 1) throw new Error(`${what}: ${one(277)} bands, expected one`);
  if (tags[322]) throw new Error(`${what}: tiled`);
  const get = fmt === 3 && bits === 32 ? (o) => (le ? buf.readFloatLE(o) : buf.readFloatBE(o))
    : fmt === 3 && bits === 64 ? f64
    : fmt === 1 && bits === 8 ? (o) => buf[o]
    : fmt === 1 && bits === 16 ? u16
    : fmt === 2 && bits === 16 ? (o) => (le ? buf.readInt16LE(o) : buf.readInt16BE(o))
    : null;
  if (!get) throw new Error(`${what}: ${bits}-bit samples of format ${fmt} are not read`);
  const v = new Float64Array(w * h), step = bits / 8;
  let k = 0;
  for (let s = 0; s < tags[273].length; s++)
    for (let o = tags[273][s], end = o + tags[279][s]; o < end && k < v.length; o += step) v[k++] = get(o);
  if (k !== v.length) throw new Error(`${what}: ${k} samples for ${w} × ${h}`);
  const scale = tags[33550], tie = tags[33922];
  return { w, h, v, ...(scale && tie ? { west: tie[3] - tie[0] * scale[0], north: tie[4] + tie[1] * scale[1], dx: scale[0], dy: scale[1] } : {}) };
}
