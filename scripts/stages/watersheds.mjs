import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { distKm, dp, edgeKm, polys, ringArea, vwRing } from '../lib/geo.mjs';
import { asJSON, cached, cachedFile, fetchBuf, log, readOut, round, writeOut } from '../lib/io.mjs';
import { getPlaces, getSmallPlaces } from '../lib/places.mjs';
import { zipFeatures } from '../lib/zipjson.mjs';

// Watersheds: where the water from a place goes. AAFC's Watershed Project 2013 (the prairie drainage areas of every
// hydrometric gauge, which ocean each drains to, and the land that drains nowhere in a median year) and Natural Earth's
// rivers (public domain) for the course a raindrop follows to the sea.
//
// The AAFC layers come as zipped GeoJSON, one FeatureCollection on one line (the incremental gross drainage areas are
// 162 MB unzipped), so they are streamed a feature at a time (`zipFeatures`) and burnt into a grid instead of kept:
// each cell holds the gauge whose own (incremental) drainage area it lies in. A gauge's whole drainage area is then
// every cell of the gauges upstream of it on AAFC's gauge network, worked out in the app.
const AAFC = 'https://agriculture.canada.ca/atlas/data_donnees/watersheds2013/data_donnees/geojson';
const AAFC_PAGE = 'https://open.canada.ca/data/en/dataset/38d86b01-05c5-4763-aea6-4f3c62bac2a9';
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson';
/** The drainage grid: 0.04° × 0.025° (about 2.8 km square at 52° N), rows south to north, over Saskatchewan and the
 *  land upstream of it (the Rockies' east slope, Montana's Milk River, North Dakota's Souris loop). */
const G = { w: -120, s: 47.5, dx: 0.04, dy: 0.025, nx: 575, ny: 520 };
/** "Southern Saskatchewan" for the hero share: the province south of 54° N, on a 0.01° grid. */
const SOUTH = { w: -110.01, s: 49, dx: 0.01, dy: 0.01, nx: 866, ny: 500, top: 54 };
/** Non-contributing outlines are kept for drawing only around the province. */
const NC_BOX = [-110.6, 48.6, -100.8, 56.2];
/** The rivers a raindrop may follow: Natural Earth's lines touching this box, and everything downstream of them. */
const RIVER_BOX = [-120, 47.5, -97, 60.5];

const title = (s) => (s ?? '').toLowerCase().replace(/(^|[\s(/'.-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bMc([a-z])/g, (m, c) => `Mc${c.toUpperCase()}`).replace(/'S\b/g, '’s').replace(/'/g, '’');

/** The rings of a Polygon / MultiPolygon as polygons. */
const polysOf = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
function bboxOf(g) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polysOf(g)) for (const [x, y] of p[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
const meets = (b, box) => b[0] <= box[2] && b[2] >= box[0] && b[1] <= box[3] && b[3] >= box[1];

/**
 * Burns a polygon (outer ring and holes, even–odd) into a grid: every cell whose centre is inside gets `value`.
 * Scanline: each edge adds its crossing to the rows whose centre line it spans.
 */
function burn(grid, out, poly, value) {
  const rows = new Map();
  for (const ring of poly)
    for (let i = 1; i < ring.length; i++) {
      const [x1, y1] = ring[i - 1], [x2, y2] = ring[i];
      if (y1 === y2) continue;
      const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
      const r0 = Math.max(0, Math.ceil((lo - grid.s) / grid.dy - 0.5)), r1 = Math.min(grid.ny - 1, Math.ceil((hi - grid.s) / grid.dy - 0.5) - 1);
      for (let r = r0; r <= r1; r++) {
        const yc = grid.s + (r + 0.5) * grid.dy;
        if (yc < lo || yc >= hi) continue;
        const x = x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1);
        let a = rows.get(r);
        if (!a) rows.set(r, (a = []));
        a.push(x);
      }
    }
  let n = 0;
  for (const [r, xs] of rows) {
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - grid.w) / grid.dx - 0.5)), c1 = Math.min(grid.nx - 1, Math.ceil((xs[k + 1] - grid.w) / grid.dx - 0.5) - 1);
      for (let c = c0; c <= c1; c++) { out[r * grid.nx + c] = value; n++; }
    }
  }
  return n;
}

/** Run-length encoding of a grid of small ints: [value, count, value, count, …]. */
function rle(a) {
  const out = [];
  for (let i = 0; i < a.length;) {
    let j = i + 1;
    while (j < a.length && a[j] === a[i]) j++;
    out.push(a[i], j - i);
    i = j;
  }
  return out;
}

/** A tiny binary min-heap of [key, value]. */
function heap() {
  const h = [];
  return {
    get size() { return h.length; },
    push(k, v) { h.push([k, v]); for (let i = h.length - 1; i;) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } },
    pop() {
      const top = h[0], last = h.pop();
      if (h.length) { h[0] = last; for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } }
      return top;
    },
  };
}

async function aafc(name) {
  const file = await cachedFile(`watersheds/${name}.zip`, `${AAFC}/${name}.zip`);
  const out = [];
  await zipFeatures(file, (n) => n.endsWith('.geojson'), (f) => out.push(f));
  if (!out.length) throw new Error(`${name}: no features`);
  return out;
}
const aafcStream = async (name, fn) => {
  const file = await cachedFile(`watersheds/${name}.zip`, `${AAFC}/${name}.zip`);
  let n = 0;
  await zipFeatures(file, (x) => x.endsWith('.geojson'), (f) => { n++; fn(f); });
  if (!n) throw new Error(`${name}: no features`);
};

export default async function watersheds() {
  const places = [...(await getPlaces()), ...(await getSmallPlaces())];
  const province = await readOut('province');
  const gauges = (await readOut('rivers')).stations;

  // ---- the ocean each basin drains to, the major basins and the PFRA sub-basins (named)
  const systems = (await aafc('HYD_AAFC_MAJ_DRAINAGE_SYS')).map((f) => ({ name: f.properties.MAJOR_SYSTEM_NAME, g: f.geometry }));
  const SYS = systems.map((s) => s.name);
  log(`  drainage systems: ${SYS.join(', ')}`);
  const sysOfPoint = (x, y) => systems.findIndex((s) => booleanPointInPolygon([x, y], s.g));
  const basinsRaw = await aafc('HYD_AAFC_MAJOR_BASIN');
  const basins = basinsRaw.map((f) => {
    const ps = polys(f.geometry, 0.02, 3).filter((p) => Math.abs(ringArea(p[0])) > 0.002);
    // the system a basin drains to: the one holding most of its outline's points
    const pts = polysOf(f.geometry).flatMap((p) => p[0]).filter((_, i) => i % 50 === 0);
    const votes = SYS.map(() => 0);
    for (const [x, y] of pts) { const k = sysOfPoint(x, y); if (k >= 0) votes[k]++; }
    return { name: f.properties.MAJOR_BASIN_NAME, sys: votes.indexOf(Math.max(...votes)), polys: ps };
  });
  const BASIN = basins.map((b) => b.name);
  const subsRaw = await aafc('HYD_AAFC_PF_SUB_BASIN');
  const subs = subsRaw.map((f) => ({ name: f.properties.SUBBASIN_PF_NAME, polys: polys(f.geometry, 0.01, 3).filter((p) => Math.abs(ringArea(p[0])) > 0.0005), raw: f.geometry }));
  const SUB = subs.map((s) => s.name);
  log(`  ${basins.length} major basins, ${subs.length} sub-basins`);

  // ---- gauges and the gauge network (FROM_STATION_ID → TO_STATION_ID: downstream)
  const stRaw = (await aafc('HYD_AAFC_GAUGING_STATION')).map((f) => f.properties && f.geometry ? { ...f.properties, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] } : null).filter(Boolean);
  const byUid = new Map(stRaw.map((s) => [s.UNIQUE_STATION_ID, s]));
  const net = await aafc('HYD_AAFC_GAUGING_STN_NETWORK');
  const outs = new Map(); // uid → [{ to, gross }]
  for (const f of net) {
    const p = f.properties;
    if (!p.FROM_STATION_ID || !p.TO_STATION_ID) continue;
    if (!outs.has(p.FROM_STATION_ID)) outs.set(p.FROM_STATION_ID, []);
    outs.get(p.FROM_STATION_ID).push({ to: p.TO_STATION_ID, gross: !!p.GROSS_ONLY_IND });
  }
  log(`  ${stRaw.length} gauges, ${net.length} network links`);

  // ---- each gauge's own drainage area, burnt into the grid; towns inside each
  const cell = new Int32Array(G.nx * G.ny).fill(-1); // index into stRaw
  const uidIdx = new Map(stRaw.map((s, i) => [s.UNIQUE_STATION_ID, i]));
  const placeArea = new Map(); // key → stRaw index
  let areas = 0;
  await aafcStream('HYD_AAFC_INCRML_GROSS_DRAIN', (f) => {
    const i = uidIdx.get(f.properties.UNIQUE_STATION_ID);
    if (i == null || !f.geometry) return;
    const b = bboxOf(f.geometry);
    if (meets(b, [G.w, G.s, G.w + G.nx * G.dx, G.s + G.ny * G.dy])) { for (const p of polysOf(f.geometry)) burn(G, cell, p, i); areas++; }
    for (const m of places) if (m.lon >= b[0] && m.lon <= b[2] && m.lat >= b[1] && m.lat <= b[3] && booleanPointInPolygon([m.lon, m.lat], f.geometry)) placeArea.set(m.key, i);
  });
  log(`  ${areas} gauge drainage areas meet the grid; ${placeArea.size} of ${places.length} places inside one`);

  // ---- the land that drains nowhere in a median year (AAFC's non-contributing areas): a mask on both grids, outlines
  // kept around the province
  const nc = new Uint8Array(G.nx * G.ny);
  const ncSouth = new Uint8Array(SOUTH.nx * SOUTH.ny);
  const ncPlaces = new Set();
  const ncPolys = [];
  let ncKept = 0, ncIn = 0;
  await aafcStream('HYD_AAFC_INCRML_NON_CTRB_DRAIN', (f) => {
    if (!f.geometry) return;
    const b = bboxOf(f.geometry);
    if (!meets(b, [G.w, G.s, G.w + G.nx * G.dx, G.s + G.ny * G.dy])) return;
    ncIn++;
    for (const p of polysOf(f.geometry)) { burn(G, nc, p, 1); burn(SOUTH, ncSouth, p, 1); }
    for (const m of places) if (m.lon >= b[0] && m.lon <= b[2] && m.lat >= b[1] && m.lat <= b[3] && booleanPointInPolygon([m.lon, m.lat], f.geometry)) ncPlaces.add(m.key);
    if (!meets(b, NC_BOX)) return;
    for (const p of polysOf(f.geometry)) {
      // outlines under about 2 km² (and holes as small) are dropped: they still count in the grids and the share
      const outer = vwRing(p[0], 4e-5);
      if (outer.length < 4 || Math.abs(ringArea(outer)) <= 2.5e-4) continue;
      const holes = p.slice(1).map((r) => vwRing(r, 4e-5)).filter((r) => r.length >= 4 && Math.abs(ringArea(r)) > 2.5e-4);
      ncPolys.push([outer, ...holes].map((r) => r.map(([x, y]) => [round(x, 3), round(y, 3)])));
      ncKept++;
    }
  });
  log(`  ${ncIn} non-contributing areas meet the grid; ${ncKept} outlines kept for drawing; ${ncPlaces.size} place centres inside one`);

  // the share of southern Saskatchewan that drains nowhere in a median year, cells weighted by their true area
  const prov = new Uint8Array(SOUTH.nx * SOUTH.ny);
  for (const p of polysOf(province.geometry)) burn(SOUTH, prov, p, 1);
  let land = 0, dead = 0;
  for (let r = 0; r < SOUTH.ny; r++) {
    const w = Math.cos(((SOUTH.s + (r + 0.5) * SOUTH.dy) * Math.PI) / 180);
    for (let c = 0; c < SOUTH.nx; c++) { const k = r * SOUTH.nx + c; if (prov[k]) { land += w; if (ncSouth[k]) dead += w; } }
  }
  const cellKm2 = 111.32 * 110.57 * SOUTH.dx * SOUTH.dy;
  const south = { share: round(dead / land, 4), km2: Math.round(dead * cellKm2), of: Math.round(land * cellKm2), top: SOUTH.top };
  log(`  ${(south.share * 100).toFixed(1)}% of Saskatchewan south of ${SOUTH.top}° N (${south.km2.toLocaleString()} of ${south.of.toLocaleString()} km²) drains nowhere in a median year`);
  if (!(south.share > 0.05 && south.share < 0.9)) throw new Error(`non-contributing share ${south.share} looks wrong`);
  {
    // the same from AAFC's own areas: the gauges whose point is in the province south of the line
    let g = 0, n = 0;
    for (const s of stRaw) if (s.lat < SOUTH.top && s.lon > -110 && s.lon < -101.4 && s.lat > 49) { g += s.INCR_GROSS_SQKM_AREA ?? 0; n += s.INCR_NON_CONTRIB_SQKM_AREA ?? 0; }
    log(`  (AAFC's own areas for gauges there: ${(n / g * 100).toFixed(1)}% of ${Math.round(g).toLocaleString()} km² non-contributing)`);
  }

  // ---- the gauges kept: those whose own area is on the grid, the River floods gauges, and every gauge downstream of them
  const subIdx = (n) => SUB.indexOf(n), basinIdx = (n) => BASIN.indexOf(n), sysIdx = (n) => SYS.indexOf(n);
  const linkTo = (o) => (o.to !== 'NONE' ? uidIdx.get(o.to) : undefined);
  const keep = new Set();
  for (const v of cell) if (v >= 0) keep.add(v);
  const gaugeIdx = {};
  for (const g of gauges) {
    const i = uidIdx.get(`${g.id}_1`) ?? stRaw.findIndex((s) => s.STATION_NUMBER === g.id);
    if (i != null && i >= 0) { keep.add(i); gaugeIdx[g.id] = i; }
  }
  for (const i of [...keep]) {
    const st = [i];
    while (st.length) for (const o of outs.get(stRaw[st.pop()].UNIQUE_STATION_ID) ?? []) { const j = linkTo(o); if (j != null && !keep.has(j)) { keep.add(j); st.push(j); } }
  }
  const kept = [...keep].sort((a, b) => a - b);
  const newIdx = new Map(kept.map((i, k) => [i, k]));
  // A sub-basin closed in a median year: its only links out are gross-only ones (it spills only in a wet year). One with
  // no link out at all leaves the map (to the sea, or across the border) and is open.
  const exits = SUB.map(() => ({ eff: 0, gross: 0 }));
  for (const s of stRaw)
    for (const o of outs.get(s.UNIQUE_STATION_ID) ?? []) {
      const t = byUid.get(o.to);
      if (t && t.SUBBASIN_PF_NAME !== s.SUBBASIN_PF_NAME && subIdx(s.SUBBASIN_PF_NAME) >= 0) exits[subIdx(s.SUBBASIN_PF_NAME)][o.gross ? 'gross' : 'eff']++;
    }
  const closed = SUB.map((_, i) => i).filter((i) => exits[i].gross && !exits[i].eff);
  log(`  closed in a median year: ${closed.map((i) => SUB[i]).join(', ')}`);
  // a gauge's links downstream to other kept gauges: `d` the effective ones (larger drainage areas first), `gl` those that
  // carry water only from the gross area (in a wet year)
  const byArea = (a, b) => (byUid.get(b.to)?.TOTAL_GROSS_SQKM_AREA ?? 0) - (byUid.get(a.to)?.TOTAL_GROSS_SQKM_AREA ?? 0);
  const stations = kept.map((i) => {
    const s = stRaw[i], me = newIdx.get(i);
    const os = (outs.get(s.UNIQUE_STATION_ID) ?? []).filter((o) => linkTo(o) != null && newIdx.has(linkTo(o)) && newIdx.get(linkTo(o)) !== me);
    const d = [...new Set(os.filter((o) => !o.gross).sort(byArea).map((o) => newIdx.get(linkTo(o))))];
    const gl = [...new Set(os.filter((o) => o.gross).map((o) => newIdx.get(linkTo(o))))].filter((x) => !d.includes(x));
    return {
      id: s.STATION_NUMBER, n: title(s.STATION_NAME), lon: round(s.lon, 3), lat: round(s.lat, 3),
      sb: subIdx(s.SUBBASIN_PF_NAME), b: basinIdx(s.MAJOR_BASIN_NAME), o: sysIdx(s.MAJOR_SYSTEM_NAME),
      g: Math.round(s.TOTAL_GROSS_SQKM_AREA ?? 0), e: Math.round(s.TOTAL_EFFECTIVE_SQKM_AREA ?? 0),
      d, ...(gl.length ? { gl } : {}),
    };
  });
  const cells = Array.from(cell, (v) => (v >= 0 ? newIdx.get(v) + 1 : 0));
  // a check on the network: the gauge's own drainage area plus every gauge upstream of it should add up to its total
  {
    const up = stations.map(() => []);
    stations.forEach((s, k) => { for (const j of s.d) up[j].push(k); for (const j of s.gl ?? []) up[j].push(k); });
    const incr = new Map(kept.map((i) => [newIdx.get(i), stRaw[i].INCR_GROSS_SQKM_AREA ?? 0]));
    let ok = 0, n = 0;
    for (const g of Object.values(gaugeIdx)) {
      const k = newIdx.get(g), seen = new Set([k]), st = [k];
      while (st.length) for (const j of up[st.pop()]) if (!seen.has(j)) { seen.add(j); st.push(j); }
      const sum = [...seen].reduce((a, j) => a + incr.get(j), 0), tot = stations[k].g;
      n++; if (tot && Math.abs(sum - tot) / tot < 0.05) ok++;
    }
    log(`  ${ok} of ${n} River floods gauges: the areas upstream on the network add up to the gauge's total (within 5%)`);
  }

  // ---- the rivers: Natural Earth's lines, joined at shared points, each point given its way to the sea
  const neFeats = [];
  for (const n of ['ne_10m_rivers_lake_centerlines', 'ne_10m_rivers_north_america']) {
    const j = asJSON(await cached(`watersheds/${n}.geojson`, () => fetchBuf(`${NE}/${n}.geojson`, { timeout: 300_000 })), n);
    for (const f of j.features) if (f.geometry) neFeats.push(f);
  }
  const nodeId = new Map(), nx = [], ny = [], adj = [];
  const node = (x, y) => {
    const k = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
    let i = nodeId.get(k);
    if (i == null) { i = nx.length; nodeId.set(k, i); nx.push(x); ny.push(y); adj.push([]); }
    return i;
  };
  const names = [''], nameOf = new Map([['', 0]]);
  const nameIdx = (s) => { s = (s ?? '').trim(); let i = nameOf.get(s); if (i == null) { i = names.length; names.push(s); nameOf.set(s, i); } return i; };
  for (const f of neFeats) {
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    if (!lines.some((l) => l.some(([x, y]) => x > -142 && x < -84 && y > 28 && y < 71))) continue;
    const nm = nameIdx(f.properties.name_en ?? f.properties.name);
    for (const l of lines) {
      let a = node(l[0][0], l[0][1]);
      for (let i = 1; i < l.length; i++) {
        const b = node(l[i][0], l[i][1]);
        if (a === b) continue;
        const km = distKm(nx[a], ny[a], nx[b], ny[b]);
        adj[a].push([b, km, nm]); adj[b].push([a, km, nm]);
        a = b;
      }
    }
  }
  // rivers stop at a lake's shore: the ends of the rivers meeting one lake are joined across it, straight
  const ends1 = [];
  for (let i = 0; i < nx.length; i++) if (adj[i].length === 1) ends1.push(i);
  let lakesJoined = 0;
  for (const n of ['ne_10m_lakes', 'ne_10m_lakes_north_america']) {
    const j = asJSON(await cached(`watersheds/${n}.geojson`, () => fetchBuf(`${NE}/${n}.geojson`, { timeout: 300_000 })), n);
    for (const f of j.features) {
      if (!f.geometry) continue;
      const b = bboxOf(f.geometry);
      if (!meets(b, [-142, 28, -84, 71])) continue;
      const at = ends1.filter((i) => nx[i] >= b[0] - 0.03 && nx[i] <= b[2] + 0.03 && ny[i] >= b[1] - 0.03 && ny[i] <= b[3] + 0.03)
        .filter((i) => booleanPointInPolygon([nx[i], ny[i]], f.geometry) || edgeKm(nx[i], ny[i], f.geometry) < 0.5);
      if (at.length < 2) continue;
      const nm = nameIdx(f.properties.name_en ?? f.properties.name);
      for (let a = 0; a < at.length; a++) for (let c = a + 1; c < at.length; c++) {
        const km = distKm(nx[at[a]], ny[at[a]], nx[at[c]], ny[at[c]]);
        adj[at[a]].push([at[c], km, nm]); adj[at[c]].push([at[a], km, nm]);
      }
      lakesJoined++;
    }
  }
  // an end that stops just short of another line (a tributary drawn to within a few hundred metres) joins it
  const bucket = new Map(), bk = (x, y) => `${Math.floor(x / 0.05)},${Math.floor(y / 0.05)}`;
  for (let i = 0; i < nx.length; i++) { const k = bk(nx[i], ny[i]); if (!bucket.has(k)) bucket.set(k, []); bucket.get(k).push(i); }
  let snapped = 0;
  for (let i = 0; i < nx.length; i++) {
    if (adj[i].length !== 1) continue;
    let best = -1, bd = 1.5;
    const cx = Math.floor(nx[i] / 0.05), cy = Math.floor(ny[i] / 0.05);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      for (const j of bucket.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (j === i || adj[i].some((e) => e[0] === j)) continue;
        const d = distKm(nx[i], ny[i], nx[j], ny[j]);
        if (d < bd) { bd = d; best = j; }
      }
    if (best >= 0 && adj[i][0][0] !== best) { adj[i].push([best, bd, adj[i][0][2]]); adj[best].push([i, bd, adj[i][0][2]]); snapped++; }
  }
  // connected components
  const comp = new Int32Array(nx.length).fill(-1);
  let nComp = 0;
  for (let i = 0; i < nx.length; i++) {
    if (comp[i] >= 0) continue;
    const st = [i]; comp[i] = nComp;
    while (st.length) { const a = st.pop(); for (const [b] of adj[a]) if (comp[b] < 0) { comp[b] = nComp; st.push(b); } }
    nComp++;
  }
  // the seas: a river's end within 4 km of Natural Earth's coastline is its mouth; which sea by where it is (Hudson and
  // James Bay, the Gulf of Mexico, the Arctic coast). A mouth on another sea (the Pacific, the Atlantic) is no outlet:
  // no Saskatchewan water reaches one.
  const coast = asJSON(await cached('watersheds/ne_10m_coastline.geojson', () => fetchBuf(`${NE}/ne_10m_coastline.geojson`, { timeout: 300_000 })), 'coastline');
  const coastB = new Set();
  for (const f of coast.features) {
    if (!f.geometry) continue;
    const ls = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    for (const l of ls)
      for (let i = 1; i < l.length; i++) {
        // every ~1 km along the coast, so a long straight piece still marks the buckets it crosses
        const [x1, y1] = l[i - 1], [x2, y2] = l[i], n = Math.max(1, Math.ceil(distKm(x1, y1, x2, y2)));
        for (let k = 0; k <= n; k++) { const x = x1 + ((x2 - x1) * k) / n, y = y1 + ((y2 - y1) * k) / n; if (x > -142 && x < -76 && y > 28 && y < 71) coastB.add(`${Math.round(x * 50)},${Math.round(y * 50)}`); }
      }
  }
  const onCoast = (x, y) => { const cx = Math.round(x * 50), cy = Math.round(y * 50); for (let dx = -3; dx <= 3; dx++) for (let dy = -2; dy <= 2; dy++) if (coastB.has(`${cx + dx},${cy + dy}`)) return true; return false; };
  const seaAt = (x, y) => (y < 31 ? sysIdx('Gulf of Mexico') : y > 65 ? sysIdx('Arctic Ocean') : x > -96 && y > 51 && y < 64 ? sysIdx('Hudson Bay') : -1);
  const outlet = new Map(); // node → system index
  for (let i = 0; i < nx.length; i++) if (adj[i].length === 1 && onCoast(nx[i], ny[i])) { const s = seaAt(nx[i], ny[i]); if (s >= 0) outlet.set(i, s); }
  const outletsBy = SYS.map((_, s) => [...outlet.values()].filter((v) => v === s).length);
  log(`  river mouths: ${SYS.map((s, i) => `${outletsBy[i]} on the ${s}`).join(', ')}`);
  // no river crosses a continental divide: AAFC's three drainage systems, burnt into a grid, forbid a step from one to
  // another (a lake joined to two rivers that only come near each other, Wollaston Lake's second outlet)
  const SG = { w: -128, s: 45, dx: 0.05, dy: 0.05, nx: 800, ny: 340 };
  const sysGrid = new Int8Array(SG.nx * SG.ny);
  systems.forEach((s, k) => { for (const p of polysOf(s.g)) burn(SG, sysGrid, p, k + 1); });
  const sysCell = (x, y) => { const c = Math.floor((x - SG.w) / SG.dx), r = Math.floor((y - SG.s) / SG.dy); return c >= 0 && c < SG.nx && r >= 0 && r < SG.ny ? sysGrid[r * SG.nx + c] : 0; };
  const nodeSys = new Int8Array(nx.length);
  for (let i = 0; i < nx.length; i++) nodeSys[i] = sysCell(nx[i], ny[i]);
  const divide = (a, b) => nodeSys[a] && nodeSys[b] && nodeSys[a] !== nodeSys[b];
  // Natural Earth's lines run either way (the North America set mostly upstream), and some rivers meet at both ends
  // (the Qu'Appelle leaves Lake Diefenbaker; Wollaston Lake drains two ways), so the shortest way to a sea can run
  // upstream. Inside the grid, a point's drainage area says which way is down: the largest total area of the gauges
  // around it (3 × 3 cells, so the main stem wins over a tributary's area beside it). A step to a point with much less
  // drainage area is uphill and costs forty times its length.
  const cellAt = (x, y) => { const c = Math.floor((x - G.w) / G.dx), r = Math.floor((y - G.s) / G.dy); return c >= 0 && c < G.nx && r >= 0 && r < G.ny ? cells[r * G.nx + c] - 1 : -1; };
  const acc = new Float64Array(nx.length);
  for (let i = 0; i < nx.length; i++) {
    if (!(nx[i] >= RIVER_BOX[0] && nx[i] <= RIVER_BOX[2] && ny[i] >= RIVER_BOX[1] && ny[i] <= RIVER_BOX[3])) continue;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const k = cellAt(nx[i] + dx * G.dx, ny[i] + dy * G.dy); if (k >= 0) acc[i] = Math.max(acc[i], stations[k].g); }
  }
  const uphill = (from, to) => acc[from] > 0 && acc[to] > 0 && acc[to] < 0.6 * acc[from];
  // every point's next step towards its sea: the cheapest way along the rivers to an outlet of its component
  const next = new Int32Array(nx.length).fill(-1), sea = new Float64Array(nx.length).fill(Infinity), sysOf = new Int8Array(nx.length).fill(-1);
  const cost = new Float64Array(nx.length).fill(Infinity);
  const h = heap();
  for (const [i, s] of outlet) { cost[i] = sea[i] = 0; sysOf[i] = s; h.push(0, i); }
  while (h.size) {
    const [d, a] = h.pop();
    if (d > cost[a]) continue;
    // a drop at b would step to a
    for (const [b, km] of adj[a]) {
      if (divide(a, b)) continue;
      const c = d + km * (uphill(b, a) ? 40 : 1);
      if (c < cost[b]) { cost[b] = c; sea[b] = sea[a] + km; next[b] = a; sysOf[b] = sysOf[a]; h.push(c, b); }
    }
  }
  // the points that matter: those inside the box with a way to a sea, and every point downstream of them
  const want = new Uint8Array(nx.length);
  for (let i = 0; i < nx.length; i++) {
    if (!(nx[i] >= RIVER_BOX[0] && nx[i] <= RIVER_BOX[2] && ny[i] >= RIVER_BOX[1] && ny[i] <= RIVER_BOX[3]) || sea[i] === Infinity) continue;
    for (let j = i; j >= 0 && !want[j]; j = next[j]) want[j] = 1;
  }
  // reaches: runs of points between junctions (or a source and a junction), each ending where the next begins
  const inDeg = new Int32Array(nx.length);
  for (let i = 0; i < nx.length; i++) if (want[i] && next[i] >= 0) inDeg[next[i]]++;
  const startsReach = (i) => want[i] && (inDeg[i] !== 1);
  const reachOf = new Map(); // start node → reach index
  const reaches = [];
  const edgeName = (a, b) => adj[a].find((e) => e[0] === b)?.[2] ?? 0;
  for (let i = 0; i < nx.length; i++) {
    if (!startsReach(i)) continue;
    const pts = [i];
    let j = i;
    const nm = new Map();
    while (next[j] >= 0) {
      const k = next[j];
      const n = edgeName(j, k);
      nm.set(n, (nm.get(n) ?? 0) + distKm(nx[j], ny[j], nx[k], ny[k]));
      pts.push(k);
      j = k;
      if (startsReach(k)) break;
    }
    if (pts.length < 2) continue;
    const name = [...nm].filter(([n]) => n).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    reachOf.set(i, reaches.length);
    reaches.push({ pts, name, end: j });
  }
  // each reach simplified; `at` gives a river point its reach and the simplified point it runs on to (a drop continuing
  // from it). A reach's last point belongs to the reach after it.
  const at = new Map();
  const R = reaches.map((r, ri) => {
    const objs = r.pts.map((i) => [nx[i], ny[i]]);
    const line = dp(objs, 0.006);
    const pos = new Map(line.map((o, k) => [o, k]));
    let k = line.length - 1;
    for (let q = objs.length - 1; q >= 0; q--) { if (pos.has(objs[q])) k = pos.get(objs[q]); if (q < objs.length - 1) at.set(r.pts[q], [ri, k]); }
    const d = reachOf.get(r.end);
    return { n: r.name, d: d ?? -1, ...(d == null ? { o: sysOf[r.end] } : {}), p: line.flatMap(([x, y]) => [round(x, 3), round(y, 3)]) };
  });
  const usedNames = [...new Set(R.map((r) => r.n))].sort((a, b) => a - b);
  const remap = new Map(usedNames.map((n, i) => [n, i]));
  for (const r of R) r.n = remap.get(r.n);
  const vtx = R.reduce((a, r) => a + r.p.length / 2, 0);
  log(`  Natural Earth: ${nx.length} river points, ${lakesJoined} lakes crossed, ${snapped} ends joined, ${nComp} pieces, ${outlet.size} outlets; ${R.length} reaches (${vtx} points) kept`);
  for (const s of SYS) if (!R.some((r) => r.o === sysIdx(s))) log(`  ! no river reaches the ${s}`);

  // ---- the way down. AAFC's gauge network says whose water reaches whom; Natural Earth gives the course between two
  // gauges when both sit on one of its rivers (within 4 km) and its way between them is not much longer than the
  // straight line; otherwise the step is drawn straight. Where the network stops short of a sea (a gap, or the map's
  // edge) the drop carries on down Natural Earth's rivers, but only along a river whose sea is the one AAFC gives.
  const nearNode = (x, y, maxKm, ok = () => true) => {
    let best = -1, bd = maxKm;
    const cx = Math.floor(x / 0.05), cy = Math.floor(y / 0.05), r = Math.ceil(maxKm / 3);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++)
      for (const j of bucket.get(`${cx + dx},${cy + dy}`) ?? []) { if (!ok(j)) continue; const d = distKm(x, y, nx[j], ny[j]); if (d < bd) { bd = d; best = j; } }
    return best;
  };
  const between = (a, b, limit) => {
    const dist = new Map([[a, 0]]), prev = new Map(), q = heap();
    q.push(0, a);
    while (q.size) {
      const [d, u] = q.pop();
      if (u === b) { const out = [b]; while (out.at(-1) !== a) out.push(prev.get(out.at(-1))); return out.reverse(); }
      if (d > (dist.get(u) ?? Infinity) || d > limit) continue;
      for (const [v, km] of adj[u]) { const nd = d + km; if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); q.push(nd, v); } }
    }
    return null;
  };
  const snapSt = stations.map((s) => nearNode(s.lon, s.lat, 4));
  let onRiver = 0;
  stations.forEach((s, k) => {
    if (!s.d.length) return;
    const t = stations[s.d[0]], a = snapSt[k], b = snapSt[s.d[0]];
    const straight = distKm(s.lon, s.lat, t.lon, t.lat);
    const path = a >= 0 && b >= 0 && a !== b ? between(a, b, straight * 1.6 + 15) : null;
    if (!path) return;
    s.p = dp(path.map((i) => [nx[i], ny[i]]), 0.004).flatMap(([x, y]) => [round(x, 3), round(y, 3)]);
    onRiver++;
  });
  // A chain's last gauge: at the sea already (AAFC's Hudson Bay coast); a lake with no outlet in a median year (its only
  // links lead to NONE or carry gross-area water only: Lenore Lake, Fife Lake); or carried on down a river to the right sea.
  const hbCoast = subIdx('Hudson Bay');
  let carried = 0, atSea = 0, stops = 0, sinks = 0;
  const stopSubs = {};
  stations.forEach((s, k) => {
    if (s.d.length || closed.includes(s.sb)) return;
    if (s.sb === hbCoast || stRaw[kept[k]].STATION_TYPE_CODE === 5) { s.sea = 1; atSea++; return; }
    const os = outs.get(stRaw[kept[k]].UNIQUE_STATION_ID) ?? [];
    if (os.some((o) => o.to === 'NONE' || o.gross) && !os.some((o) => o.to !== 'NONE' && !o.gross)) { s.x = 1; sinks++; return; }
    const sameWay = (j) => want[j] && sysOf[j] === s.o && at.has(j) && (() => { const c = cellAt(nx[j], ny[j]); return c < 0 || stations[c].b === s.b; })();
    const j = nearNode(s.lon, s.lat, 40, sameWay);
    if (j >= 0) { s.c = at.get(j); carried++; } else { stops++; stopSubs[SUB[s.sb]] = (stopSubs[SUB[s.sb]] ?? 0) + 1; }
  });
  log(`  ${onRiver} gauge-to-gauge steps follow a river; chain ends: ${atSea} on the coast, ${sinks} in lakes with no outlet, ${carried} carried on down a river, ${stops} where the map stops ${JSON.stringify(stopSubs)}`);

  // a check, the way the app walks it: from the gauge whose area holds a point, down the first links, then on
  const walk = (k0) => {
    const seen = new Set(), subsSeen = [];
    let k = k0, km = 0;
    while (!seen.has(k)) {
      seen.add(k);
      const s = stations[k];
      if (SUB[s.sb] && SUB[s.sb] !== subsSeen.at(-1)) subsSeen.push(SUB[s.sb]);
      if (!s.d.length) break;
      km += distKm(s.lon, s.lat, stations[s.d[0]].lon, stations[s.d[0]].lat);
      k = s.d[0];
    }
    const s = stations[k];
    if (closed.includes(s.sb)) return { end: `pools in the ${SUB[s.sb]} basin at ${s.n}`, km, subsSeen, pool: 1 };
    if (s.x) return { end: `ends in ${s.n}, no outlet`, km, subsSeen, pool: 1 };
    if (s.sea) return { end: `${SYS[s.o]} at ${s.n}`, km, subsSeen, sys: s.o };
    if (s.c) {
      const nm = [];
      let [r] = s.c;
      for (const seenR = new Set(); r >= 0 && !seenR.has(r); r = R[r].d) { seenR.add(r); const n = usedNames[R[r].n] != null ? names[usedNames[R[r].n]] : ''; if (n && n !== nm.at(-1)) nm.push(n); if (R[r].d < 0) return { end: `${nm.join(' › ')} › ${SYS[R[r].o]}`, km, subsSeen, sys: R[r].o }; }
    }
    return { end: `the map stops at ${s.n}`, km, subsSeen };
  };
  for (const [n, x, y] of [['Regina', -104.6, 50.45], ['Saskatoon', -106.67, 52.13], ['Estevan', -103, 49.14], ['Swift Current', -107.8, 50.29], ['La Ronge', -105.28, 55.1], ['Uranium City', -108.6, 59.57], ['Eastend', -108.82, 49.52], ['Yorkton', -102.46, 51.21], ['Lloydminster', -110.0, 53.28], ['Humboldt', -105.12, 52.2], ['Gravelbourg', -106.55, 49.87]]) {
    const k = cellAt(x, y);
    if (k < 0) { log(`  ${n}: no gauge area`); continue; }
    const w = walk(k);
    log(`  ${n}: ${w.subsSeen.join(' › ')} › ${w.end}`);
  }
  let bad = 0, checked = 0, stopped = 0, pooled = 0;
  const badSubs = {};
  stations.forEach((s, k) => {
    if (closed.includes(s.sb) || cellAt(s.lon, s.lat) < 0) return;
    const w = walk(k);
    checked++;
    if (w.pool) pooled++;
    else if (w.sys == null) stopped++;
    else if (w.sys !== s.o) { bad++; badSubs[SUB[s.sb]] = (badSubs[SUB[s.sb]] ?? 0) + 1; }
  });
  log(`  of ${checked} gauges: ${checked - bad - stopped - pooled} reach their sea, ${pooled} end in a lake with no outlet, ${stopped} stop where the map does, ${bad} reach another sea ${JSON.stringify(badSubs)}`);
  if (bad / checked > 0.02) throw new Error(`${bad} of ${checked} gauges would reach the wrong sea`);

  // ---- per place: its gauge area (sub-basin, basin, sea) and whether its centre drains nowhere in a median year
  const placeRow = (m) => {
    const i = placeArea.get(m.key);
    if (i == null) return null;
    const s = stRaw[i];
    return { sb: subIdx(s.SUBBASIN_PF_NAME), b: basinIdx(s.MAJOR_BASIN_NAME), o: sysIdx(s.MAJOR_SYSTEM_NAME), st: newIdx.get(i) ?? -1, ...(ncPlaces.has(m.key) ? { nc: 1 } : {}) };
  };
  const towns = {}, small = {};
  for (const m of places) { const r = placeRow(m); if (r) ((m.tier ?? 1) === 1 ? towns : small)[m.key] = r; }
  log(`  ${Object.keys(towns).length} places and ${Object.keys(small).length} small communities placed; ${[...ncPlaces].filter((k) => towns[k]).length} places' centres in land that drains nowhere`);

  await writeOut('watersheds', {
    source: 'Agriculture and Agri-Food Canada, AAFC Watersheds Project 2013',
    sourceUrl: AAFC_PAGE,
    licence: 'Open Government Licence – Canada',
    riverSource: 'Natural Earth, 1:10m rivers and lake centerlines (with the North America supplement), v5.1.2',
    riverUrl: 'https://www.naturalearthdata.com/downloads/10m-physical-vectors/',
    riverLicence: 'Public domain',
    asOf: new Date().toISOString().slice(0, 10),
    systems: SYS,
    basins: basins.map(({ name, sys, polys: p }) => ({ name, sys, polys: p })),
    subs: subs.map(({ name, polys: p }) => ({ name, polys: p })),
    closed,
    nc: ncPolys,
    south,
    grid: { w: G.w, s: G.s, dx: G.dx, dy: G.dy, nx: G.nx, ny: G.ny, st: rle(cells), nc: rle(Array.from(nc)) },
    stations,
    gauges: Object.fromEntries(Object.entries(gaugeIdx).map(([k, i]) => [k, newIdx.get(i)])),
    rivers: { names: usedNames.map((n) => names[n]), reaches: R },
    towns, small,
  });
}
