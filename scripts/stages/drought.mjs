import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { cached, cachedJSON, fetchBuf, log, pool, round, writeOut } from '../lib/io.mjs';
import { getPlaces, getProvince, getSmallPlaces } from '../lib/places.mjs';

// AAFC Canadian Drought Monitor: the monthly D0–D4 drought map, read from AAFC's image service as raw categories on a
// 10 km Web Mercator grid over Saskatchewan (one small request a month, cached), clipped to the province and
// run-length encoded. Each place takes the category of the grid cell its centre is in.
export default async function drought() {
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
  const smallP = await getSmallPlaces();
  const small = Object.fromEntries(smallP.map((p) => [p.key, '']));
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
    for (const p of smallP) { const k = cell(p.lon, p.lat); small[p.key] += k < 0 ? 'a' : (CH[px[k]] ?? 'a'); }
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
    // per place, one letter a month: the category of the grid cell its centre is in (`small`: the tier-2 communities)
    towns, small,
  });
}
