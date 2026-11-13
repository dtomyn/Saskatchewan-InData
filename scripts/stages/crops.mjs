import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { cached, cachedJSON, fetchBuf, log, round, writeOut } from '../lib/io.mjs';
import { getPlaces, getProvince } from '../lib/places.mjs';

// AAFC's Annual Crop Inventory: a 30 m map of crops and land cover, yearly since 2009, over the farm belt (it stops
// around 55–56° N). Read like the drought monitor (exportImage, raw categories, Web Mercator), sampled at 500 m and
// folded into 3 km cells (about 1.8 km on the ground) that each take their most common class.
export default async function crops() {
  const { clipFeature } = await getProvince();
  const places = await getPlaces();
  const BASE = 'https://agriculture.canada.ca/imagery-images/rest/services/annual_crop_inventory';
  const day = new Date().toISOString().slice(0, 10);
  const list = await cachedJSON(`crops/services-${day}.json`, `${BASE}?f=json`);
  const years = (list.services ?? []).map((s) => +/\/(\d{4})$/.exec(s.name)?.[1]).filter((y) => y >= 2009).sort((a, b) => a - b);
  if (years.length < 10) throw new Error(`crop inventory lists only ${years.length} years`);
  // classes, grouped: the inventory's codes (10 cloud, 20 water, 30 exposed, 34–35 built, 50 shrub, 60 burned, 80–85
  // wetland and peatland, 110 grassland, 120–199 agriculture, 200–230 forest)
  const CLASSES = ['cereals', 'canola', 'pulses', 'other crops', 'pasture and forage', 'grassland and shrub', 'forest', 'wetland', 'water', 'built-up', 'bare or burned'];
  const group = (v) => {
    if (v === 20) return 8;
    if (v === 34 || v === 35) return 9;
    if (v === 30 || v === 60) return 10;
    if (v === 50 || v === 110) return 5;
    if (v === 80 || v === 85) return 7;
    if (v >= 200 && v <= 230) return 6;
    if (v === 122) return 4;
    if (v === 153) return 1;
    if (v >= 160 && v <= 174) return 2;
    if (v >= 132 && v <= 147 && v !== 141) return 0;
    if (v >= 120 && v <= 199) return 3;
    return -1; // 0 not mapped, 10 cloud, anything unknown
  };
  const LUT = new Int8Array(256).map((_, v) => group(v));
  // the grid: 3 km Web Mercator cells, each sampled 6 × 6 (500 m)
  const R = 6378137, PX = 3000, SUB = 6;
  const mx = (lon) => (R * lon * Math.PI) / 180, my = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const ulon = (x) => (x / R) * (180 / Math.PI), ulat = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
  const x0 = Math.floor(mx(-110.05) / PX) * PX, x1 = Math.ceil(mx(-101.3) / PX) * PX;
  const y0 = Math.floor(my(48.95) / PX) * PX, y1 = Math.ceil(my(57) / PX) * PX;
  const W = (x1 - x0) / PX, H = (y1 - y0) / PX;
  const inside = new Uint8Array(W * H), area = new Float64Array(W * H);
  for (let r = 0; r < H; r++) {
    const lat = ulat(y1 - (r + 0.5) * PX);
    for (let c = 0; c < W; c++) if (booleanPointInPolygon([ulon(x0 + (c + 0.5) * PX), lat], clipFeature)) { inside[r * W + c] = 1; area[r * W + c] = Math.cos((lat * Math.PI) / 180) ** 2; }
  }
  // one year: the samples in horizontal strips (each under ~2 M pixels), cached raw, then the most common class per cell
  const STRIP = 160; // cell rows per request
  const yearGrid = async (y) => {
    const out = new Int8Array(W * H).fill(-1);
    for (let r0 = 0; r0 < H; r0 += STRIP) {
      const rows = Math.min(STRIP, H - r0), w = W * SUB, h = rows * SUB;
      const top = y1 - r0 * PX, bottom = top - rows * PX;
      const q = new URLSearchParams({ bbox: `${x0},${bottom},${x1},${top}`, bboxSR: '3857', imageSR: '3857', size: `${w},${h}`, format: 'bsq', pixelType: 'U8', interpolation: 'RSP_NearestNeighbor', f: 'image' });
      const buf = await cached(`crops/${y}-${PX / 1000}km-${r0}.bin`, async () => {
        const b = await fetchBuf(`${BASE}/${y}/ImageServer/exportImage?${q}`, { timeout: 300_000 });
        if (b.length < w * h) throw new Error(`crops ${y}: got ${b.length} bytes, expected ${w * h}`);
        return b;
      });
      const n = new Uint16Array(CLASSES.length);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < W; c++) {
          const k = (r0 + r) * W + c;
          if (!inside[k]) continue;
          n.fill(0);
          for (let i = 0; i < SUB; i++) for (let j = 0; j < SUB; j++) { const g = LUT[buf[(r * SUB + i) * w + c * SUB + j]]; if (g >= 0) n[g]++; }
          let best = -1, bn = 0;
          for (let g = 0; g < n.length; g++) if (n[g] > bn) { bn = n[g]; best = g; }
          out[k] = best;
        }
    }
    return out;
  };
  const grids = [];
  for (const y of years) { grids.push(await yearGrid(y)); log(`  ${y}`); }
  // the common footprint: cells mapped every year, so the shares compare like with like
  const common = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) common[k] = inside[k] && grids.every((g) => g[k] >= 0) ? 1 : 0;
  const share = grids.map((g) => {
    const s = new Float64Array(CLASSES.length);
    let tot = 0;
    for (let k = 0; k < W * H; k++) if (common[k]) { s[g[k]] += area[k]; tot += area[k]; }
    return [...s].map((v) => Math.round((v / tot) * 1000) / 10);
  });
  // the map, run-length: an optional count, then a letter: a not mapped or outside, b–l the classes in order
  const maps = grids.map((g) => {
    let rle = '', run = 0, prev = '';
    for (let k = 0; k < W * H; k++) {
      const ch = g[k] < 0 ? 'a' : String.fromCharCode(98 + g[k]);
      if (ch === prev) run++;
      else { if (prev) rle += (run > 1 ? run : '') + prev; prev = ch; run = 1; }
    }
    return rle + (run > 1 ? run : '') + prev;
  });
  // per place: the land within 25 km by class, each year (%, of the mapped cells in that circle; null when none mapped)
  const towns = {};
  for (const p of places) {
    const cells = [];
    const cx = mx(p.lon), cy = my(p.lat), sc = 1 / Math.cos((p.lat * Math.PI) / 180), rr = 25000 * sc;
    for (let r = Math.max(0, Math.floor((y1 - cy - rr) / PX)); r <= Math.min(H - 1, Math.floor((y1 - cy + rr) / PX)); r++)
      for (let c = Math.max(0, Math.floor((cx - rr - x0) / PX)); c <= Math.min(W - 1, Math.floor((cx + rr - x0) / PX)); c++) {
        const dx = x0 + (c + 0.5) * PX - cx, dy = y1 - (r + 0.5) * PX - cy;
        if (Math.hypot(dx, dy) <= rr) cells.push(r * W + c);
      }
    towns[p.key] = grids.map((g) => {
      const s = new Array(CLASSES.length).fill(0);
      let n = 0;
      for (const k of cells) if (g[k] >= 0) { s[g[k]]++; n++; }
      return n >= cells.length / 2 ? s.map((v) => Math.round((v / n) * 100)) : null;
    });
  }
  log(`${years.length} years ${years[0]}–${years.at(-1)}; grid ${W}×${H}; ${maps.reduce((a, m) => a + m.length, 0) >> 10} KB of maps`);
  await writeOut('crops', {
    source: 'Agriculture and Agri-Food Canada, Annual Crop Inventory (30 m, image services annual_crop_inventory/<year>)',
    sourceUrl: 'https://open.canada.ca/data/en/dataset/ba2645d5-4458-414d-b196-6303ac06c1c9',
    serviceUrl: BASE,
    licence: 'Open Government Licence – Canada', licenceUrl: 'https://open.canada.ca/en/open-government-licence-canada',
    classes: CLASSES,
    grid: { x0, y1, px: PX, w: W, h: H, sub: SUB, bounds: [ulon(x0), ulat(y0), ulon(x1), ulat(y1)].map((v) => round(v, 5)) },
    // per year: the map, and each class's share (%) of the footprint mapped in every year
    years, maps, share,
    towns,
  });
}
