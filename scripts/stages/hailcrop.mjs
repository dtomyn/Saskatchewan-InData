import { cached, fetchBuf, log, pool, readOut, round, writeOut } from '../lib/io.mjs';
import { getProvince } from '../lib/places.mjs';
import { ACI_BASE, CROP_GROUPS, CROP_LUT } from './crops.mjs';

// Hail exposure: what grew under each radar hail swath (the `hail` stage's Northern Hail Project swaths) in that year's
// Annual Crop Inventory (the 30 m map the `crops` stage folds into 3 km cells). Exposure, never damage: the inventory
// says what was in the field that season, not what the hail did to it, and the corridor is the atlas's own:
//
// - a swath is a centre line and a widest width, so its corridor is a band as wide as the swath at its widest all along
//   the centre line, cut square at both ends: an upper bound, since real swaths taper and narrow along the way;
// - a swath with no width (all of 2022's, and a few later ones) gets no corridor, and a year with no inventory none;
// - only the part inside Saskatchewan is counted.
//
// The inventory is read raw (exportImage, format=bsq, U8, nearest neighbour; the bytes are followed by a 1-bit mask,
// so only the first w×h are read) on a fixed Web Mercator grid of 200 m pixels (about 120 m on the ground), in 512 px
// tiles shared by the swaths of a year and cached in .cache/hailcrop/. Each sample is one 30 m inventory pixel, so the
// shares are a systematic sample of the 30 m map, not the 3 km cells' most common class (which would hide small fields).
const PX = 200, TILE = 512, R = 6378137;
const mx = (lon) => (R * lon * Math.PI) / 180, my = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const ulon = (x) => (x / R) * (180 / Math.PI), ulat = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
const KX = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180), KY = 110.57;

/**
 * Distance (km) from a point to a centre line, with square ends: a point beyond either end (along the line) is
 * Infinity, so the corridor stops where the swath does. `pts` are [lon, lat].
 */
export function corridorKm(pts, lon, lat) {
  const kx = KX(lat);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = (pts[i - 1][0] - lon) * kx, ay = (pts[i - 1][1] - lat) * KY, bx = (pts[i][0] - lon) * kx, by = (pts[i][1] - lat) * KY;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let u = L ? -(ax * dx + ay * dy) / L : 0;
    if ((i === 1 && u < 0) || (i === pts.length - 1 && u > 1)) continue; // past the start or the end
    u = Math.max(0, Math.min(1, u));
    best = Math.min(best, Math.hypot(ax + u * dx, ay + u * dy));
  }
  return best;
}

export default async function hailcrop() {
  const { clipFeature } = await getProvince();
  const hail = await readOut('hail');
  const crops = await readOut('crops'); // the years the inventory has (the stage that reads it lists them)
  const invYears = new Set(crops.years);
  // the province's edges, for an even-odd test along each row of samples
  const edges = clipFeature.geometry.coordinates.flatMap((poly) => poly.flatMap((ring) => ring.slice(1).map((b, i) => [ring[i], b])));
  const crossings = (lat) => edges.filter(([a, b]) => (a[1] <= lat) !== (b[1] <= lat)).map(([a, b]) => a[0] + ((lat - a[1]) / (b[1] - a[1])) * (b[0] - a[0])).sort((p, q) => p - q);
  const inside = (xs, lon) => { let n = 0; for (const x of xs) if (x < lon) n++; else break; return n % 2 === 1; };

  const swaths = hail.rows.filter((r) => r[4] === 0);
  const rows = [];
  const years = {};
  const tiles = new Map(); // `${year}/${tx}_${ty}` → buffer
  const plan = [];
  for (const r of swaths) {
    const y = Math.floor(r[2]);
    const yr = (years[y] ??= { swaths: 0, corridor: 0, noWidth: 0, inventory: invYears.has(y), area: 0, km2: new Array(CROP_GROUPS.length).fill(0) });
    yr.swaths++;
    if (!(r[8] > 0)) { yr.noWidth++; continue; }
    if (!yr.inventory) continue;
    yr.corridor++;
    const half = r[8] / 2, pts = r[6];
    const lats = pts.map((p) => p[1]), lons = pts.map((p) => p[0]);
    const s = Math.min(...lats) - half / KY, n = Math.max(...lats) + half / KY;
    const kx = KX(Math.max(Math.abs(s), Math.abs(n)));
    const w = Math.min(...lons) - half / kx, e = Math.max(...lons) + half / kx;
    // the 200 m pixels whose centres fall in the swath's box (columns from x = 0, rows from y = 0 northwards)
    const c0 = Math.floor(mx(w) / PX), c1 = Math.ceil(mx(e) / PX), r0 = Math.floor(my(s) / PX), r1 = Math.ceil(my(n) / PX);
    const need = [];
    for (let ty = Math.floor(r0 / TILE); ty <= Math.floor(r1 / TILE); ty++)
      for (let tx = Math.floor(c0 / TILE); tx <= Math.floor(c1 / TILE); tx++) {
        // skip a tile the corridor cannot reach: its centre farther than half the width plus half its diagonal
        const clon = ulon((tx + 0.5) * TILE * PX), clat = ulat((ty + 0.5) * TILE * PX);
        const halfDiag = (TILE * PX * Math.cos((clat * Math.PI) / 180) * Math.SQRT2) / 2000;
        const d = pts.length > 1 ? Math.min(...pts.slice(1).map((p, i) => segKm(pts[i], p, clon, clat))) : Infinity;
        if (d > half + halfDiag) continue;
        need.push([tx, ty]);
        const key = `${y}/${tx}_${ty}`;
        if (!tiles.has(key)) tiles.set(key, null);
      }
    plan.push({ r, y, half, pts, c0, c1, r0, r1, need });
  }
  log(`  ${plan.length} swaths with a width in an inventory year; ${tiles.size} tiles of ${TILE} × ${TILE} (${PX} m)`);
  let fetched = 0;
  await pool([...tiles.keys()], 3, async (key) => {
    const [y, t] = key.split('/'), [tx, ty] = t.split('_').map(Number);
    const x0 = tx * TILE * PX, y0 = ty * TILE * PX;
    const q = new URLSearchParams({ bbox: `${x0},${y0},${x0 + TILE * PX},${y0 + TILE * PX}`, bboxSR: '3857', imageSR: '3857', size: `${TILE},${TILE}`, format: 'bsq', pixelType: 'U8', interpolation: 'RSP_NearestNeighbor', f: 'image' });
    tiles.set(key, await cached(`hailcrop/${y}-${PX}m-${tx}_${ty}.bin`, async () => {
      const b = await fetchBuf(`${ACI_BASE}/${y}/ImageServer/exportImage?${q}`, { timeout: 300_000 });
      if (b.length < TILE * TILE) throw new Error(`crop inventory ${y} tile ${t}: got ${b.length} bytes, expected ${TILE * TILE}`);
      return b;
    }, (b) => b.length >= TILE * TILE));
    if (++fetched % 100 === 0) log(`  ${fetched} / ${tiles.size} tiles`);
  });

  // each swath: its samples inside the corridor and the province, by class (km², each sample's true ground area)
  const seen = new Set();
  let grid3 = 0, fine = 0; // cropland share by the 3 km cells (crops.json) against the samples here, as a check
  for (const { r, y, half, pts, c0, c1, r0, r1, need } of plan) {
    const km2 = new Float64Array(CROP_GROUPS.length);
    let corridor = 0;
    const tileOf = new Map(need.map(([tx, ty]) => [tx * 1e5 + ty, tiles.get(`${y}/${tx}_${ty}`)]));
    for (let row = r0; row <= r1; row++) {
      const ty = Math.floor(row / TILE);
      const lat = ulat((row + 0.5) * PX);
      const xs = crossings(lat);
      const a = ((PX * Math.cos((lat * Math.PI) / 180)) / 1000) ** 2; // a sample's ground area, km²
      for (let col = c0; col <= c1; col++) {
        const tx = Math.floor(col / TILE);
        const buf = tileOf.get(tx * 1e5 + ty);
        if (!buf) continue; // a tile the corridor cannot reach
        const lon = ulon((col + 0.5) * PX);
        if (corridorKm(pts, lon, lat) > half || !inside(xs, lon)) continue;
        corridor += a;
        // the tile's rows run north to south
        const p = (TILE - 1 - (row - ty * TILE)) * TILE + (col - tx * TILE);
        const g = CROP_LUT[buf[p]];
        if (g >= 0) km2[g] += a;
        // the season's ground under any swath, each sample once (two swaths over one field count it once)
        const yr = years[y], mk = `${tx}_${ty}`;
        const m = (yr.seen ??= new Map()).get(mk) ?? yr.seen.set(mk, new Uint8Array(TILE * TILE)).get(mk);
        if (!m[p]) { m[p] = 1; yr.area += a; if (g >= 0) yr.km2[g] += a; }
      }
    }
    const key = `${r[2]}|${r[0]}|${r[1]}`;
    if (seen.has(key)) throw new Error(`two swaths share a key: ${key}`);
    seen.add(key);
    const mapped = km2.reduce((s, v) => s + v, 0);
    if (mapped > 50) { fine += (km2[0] + km2[1] + km2[2] + km2[3]) / mapped; grid3 += grid3Share(crops, y, pts, half); }
    // row: t, lon, lat (the swath's own, to find it), corridor km² in Saskatchewan, km² by class (CROP_GROUPS order;
    // what the inventory did not map, cloud or past its northern edge, is the corridor less their sum)
    rows.push([r[2], r[0], r[1], round(corridor, 1), [...km2].map((v) => round(v, 1))]);
  }
  const big = rows.filter((x) => x[4].reduce((s, v) => s + v, 0) > 50).length;
  log(`  cropland share under the corridors: ${((fine / (big || 1)) * 100).toFixed(1)}% from the samples, ${((grid3 / (big || 1)) * 100).toFixed(1)}% from the 3 km cells (mean of ${big} swaths)`);
  for (const [y, v] of Object.entries(years)) {
    log(`  ${y}: ${v.swaths} swaths, ${v.corridor} with a corridor, ${v.noWidth} without a width${v.inventory ? '' : ', no crop inventory'}; ${Math.round(v.area)} km² under the corridors`);
    // per season: the ground under any of its corridors (km²) and the same by class, each piece of ground once
    v.area = round(v.area, 1);
    v.km2 = v.km2.map((x) => round(x, 1));
    delete v.seen;
  }
  await writeOut('hail-exposure', {
    source: 'The atlas’s own: Northern Hail Project radar hail swaths (CC BY-NC 4.0) crossed with AAFC’s Annual Crop Inventory (Open Government Licence – Canada)',
    sourceUrl: crops.sourceUrl,
    classes: CROP_GROUPS,
    corridor: 'a band as wide as the swath at its widest, all along its centre line, square at both ends; inside Saskatchewan only',
    sample: { px: PX, groundM: Math.round(PX * Math.cos((52 * Math.PI) / 180)) },
    years,
    rows,
  });
}

/** Distance (km) from a point to one segment (clamped), for the tile test. */
function segKm(a, b, lon, lat) {
  const kx = KX(lat);
  const ax = (a[0] - lon) * kx, ay = (a[1] - lat) * KY, bx = (b[0] - lon) * kx, by = (b[1] - lat) * KY;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const u = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
  return Math.hypot(ax + u * dx, ay + u * dy);
}

/** The cropland share of the 3 km cells (crops.json) whose centres fall in a corridor, for the log's check. */
function grid3Share(crops, y, pts, half) {
  const i = crops.years.indexOf(y), g = crops.grid;
  if (i < 0) return 0;
  const cells = new Uint8Array(g.w * g.h);
  let k = 0;
  for (const [, n, ch] of crops.maps[i].matchAll(/(\d*)([a-z])/g)) cells.fill(ch.charCodeAt(0) - 97, k, (k += n ? +n : 1));
  let crop = 0, all = 0;
  for (let r = 0; r < g.h; r++) {
    const lat = ulat(g.y1 - (r + 0.5) * g.px);
    for (let c = 0; c < g.w; c++) {
      const v = cells[r * g.w + c];
      if (!v) continue;
      if (corridorKm(pts, ulon(g.x0 + (c + 0.5) * g.px), lat) > half) continue;
      all++;
      if (v <= 4) crop++;
    }
  }
  return all ? crop / all : 0;
}
