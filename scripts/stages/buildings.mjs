import fs from 'node:fs/promises';
import path from 'node:path';
import GeoJSONVT from 'geojson-vt';
import vtpbf from 'vt-pbf';
import { arcgisAll, overpass } from '../lib/apis.mjs';
import { OUT } from '../lib/config.mjs';
import { cachedFile, log, readOut, writeAtomic, writeOut, zipLines } from '../lib/io.mjs';
import { writePMTiles } from '../lib/pmtiles.mjs';

// 3D cities with flood water (plans/wow/6-3d-cities-and-flood.md). Building footprints for the places the Water
// Security Agency has a flood map for, plus Regina and Saskatoon, as one PMTiles file the app reads with range
// requests past zoom 12. Each footprint carries whether it touches the WSA's mapped 1:500-year extent (worked out
// here, so the app does no geometry) and a height where OpenStreetMap has one; the flood extents ride along at full
// detail so the water and the tint agree.
//
// Footprints: Microsoft's Canadian Building Footprints (machine-drawn from Bing imagery, ODbL). Statistics Canada's
// Open Database of Buildings would be the official choice for the cities, but its pages and downloads sit behind a
// browser check that refuses scripted requests, so it is not used.
const MS_URL = 'https://minedbuildings.z5.web.core.windows.net/legacy/canadian-buildings-v2/Saskatchewan.zip';
const WSA = 'https://services1.arcgis.com/7MBdlVpjqbfBhQer/arcgis/rest/services';
const FILE = 'tiles/buildings.pmtiles';
const MIN_Z = 12, MAX_Z = 15;
/** at zoom 12 (a whole town on screen) only footprints this big are kept, so the tiles stay light */
const Z12_MIN_M2 = 250;
/** a storey, for a height worked out from building:levels */
const STOREY_M = 3;
const PAD_KM = 1;
const KIND_RANK = { floodway: 1, fringe: 2, 500: 2, protected: 3 };
const clean = (s) => (s ?? '').replace(/\s+/g, ' ').replace(/Qu' Appelle/i, 'Qu’Appelle').replace(/Ile-A-La-Crosse/i, 'Île-à-la-Crosse').trim();
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/^(the )?/, '');

// ------------------------------------------------------------------------------------------------
// geometry

const bboxOf = (rings) => {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const r of rings) for (const [x, y] of r) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
};
const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const pad = (b, km) => { const dy = km / 111.2, dx = km / (111.2 * Math.cos((b[1] * Math.PI) / 180)); return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy]; };
const inBox = (b, x, y) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
/** area of a lon/lat ring in m² (equirectangular at its latitude: fine at building size) */
const ringM2 = (r) => {
  const k = Math.cos((r[0][1] * Math.PI) / 180) * 111_320, m = 110_574;
  let s = 0;
  for (let i = 1; i < r.length; i++) s += (r[i - 1][0] * k) * (r[i][1] * m) - (r[i][0] * k) * (r[i - 1][1] * m);
  return Math.abs(s / 2);
};
const segsCross = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
};
const pipRing = (r, x, y) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** A flood polygon with its edges filed in latitude bands, so a point or a footprint tests only nearby edges. */
function zoneIndex(polygon, kind, place) {
  const box = bboxOf(polygon);
  const H = 0.0004; // ~45 m
  const bands = new Map();
  for (const ring of polygon)
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i];
      const k0 = Math.floor((Math.min(a[1], b[1]) - box[1]) / H), k1 = Math.floor((Math.max(a[1], b[1]) - box[1]) / H);
      for (let k = k0; k <= k1; k++) { let l = bands.get(k); if (!l) bands.set(k, (l = [])); l.push([a, b]); }
    }
  const band = (y) => bands.get(Math.floor((y - box[1]) / H)) ?? [];
  const contains = (x, y) => {
    if (!inBox(box, x, y)) return false;
    let inside = false;
    for (const [a, b] of band(y)) if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    return inside;
  };
  /** does a footprint ring touch this polygon: a corner inside, or an edge crossing one of its edges */
  const touches = (ring, rbox) => {
    if (!overlaps(box, rbox)) return false;
    for (const [x, y] of ring) if (contains(x, y)) return true;
    const k0 = Math.floor((rbox[1] - box[1]) / H), k1 = Math.floor((rbox[3] - box[1]) / H);
    for (let k = k0; k <= k1; k++)
      for (const [a, b] of bands.get(k) ?? []) {
        if (Math.max(a[0], b[0]) < rbox[0] || Math.min(a[0], b[0]) > rbox[2]) continue;
        for (let i = 1; i < ring.length; i++) if (segsCross(ring[i - 1], ring[i], a, b)) return true;
        if (pipRing(ring, a[0], a[1])) return true;
      }
    return false;
  };
  return { kind, place, box, polygon, touches };
}

// ------------------------------------------------------------------------------------------------

export default async function buildings() {
  // the WSA extents, unsimplified (the floods stage's cached answers)
  const zones = [];
  const addZone = (f, kind) => {
    const g = f.geometry;
    if (!g) return;
    const polysOf = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    let place = clean(f.properties.Location ?? f.properties.Community);
    if (/^Saskatoon/i.test(place)) place = 'Saskatoon';
    for (const p of polysOf) if (p[0]?.length >= 4) zones.push(zoneIndex(p, kind, place));
  };
  for (const f of await arcgisAll(`${WSA}/1_500yr_Flood/FeatureServer/2`, { where: '1=1', outFields: 'Location,Line_Type' }, 'wsa-flood-500')) {
    const t = f.properties.Line_Type ?? '';
    if (/500/.test(t)) addZone(f, '500'); else if (/protected/i.test(t)) addZone(f, 'protected');
  }
  for (const f of await arcgisAll(`${WSA}/Flood_Hazard_All/FeatureServer/33`, { where: '1=1', outFields: 'Location,Community,Line_Type,Water_body,Year,Program,Hlink_PDF' }, 'wsa-flood-hazard')) {
    const t = f.properties.Line_Type ?? '';
    const kind = /floodway/i.test(t) ? 'floodway' : /fringe/i.test(t) ? 'fringe' : null;
    if (kind) addZone(f, kind);
  }
  if (!zones.length) throw new Error('no WSA flood extents (run the floods stage first)');

  // the areas kept: each mapped community (its flood extents and its own town limits, padded), plus the two cities
  const subs = (await readOut('subdivisions')).csds;
  const csdFor = (place) => {
    const want = place === 'Battlefords' ? ['north battleford', 'battleford'] : [norm(place)];
    return subs.filter((c) => want.includes(norm(c.n)) && ['CY', 'T', 'VL', 'RV', 'NV', 'NT', 'NH'].includes(c.t));
  };
  const areaNames = [...new Set([...zones.map((z) => z.place), 'Regina', 'Saskatoon'])];
  const areas = areaNames.map((name) => {
    const zb = zones.filter((z) => z.place === name).map((z) => z.box);
    const own = zb.length ? bboxOf([zb.flatMap((b) => [[b[0], b[1]], [b[2], b[3]]])]) : null;
    const csds = csdFor(name).filter((c) => !own || overlaps(pad(own, 30), bboxOf(c.p.flat())));
    const all = [...(own ? [[own[0], own[1]], [own[2], own[3]]] : []), ...csds.flatMap((c) => { const b = bboxOf(c.p.flat()); return [[b[0], b[1]], [b[2], b[3]]]; })];
    if (!all.length) return null;
    const box = pad(bboxOf([all]), PAD_KM);
    return { name, box, c: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], csd: csds.map((c) => c.id), n: 0, way: 0, ext: 0, prot: 0, h: 0, big: 0 };
  }).filter(Boolean);
  log(`  ${areas.length} areas: ${areas.map((a) => a.name).join(', ')}`);
  const areaOf = (x, y) => {
    let best = null, bd = Infinity;
    for (const a of areas) if (inBox(a.box, x, y)) { const d = (x - a.c[0]) ** 2 + (y - a.c[1]) ** 2; if (d < bd) { bd = d; best = a; } }
    return best;
  };

  // footprints: one feature a line in Microsoft's GeoJSON
  const zip = await cachedFile('buildings/Saskatchewan.zip', MS_URL);
  const feats = [];
  let read = 0;
  await zipLines(zip, (n) => /\.geojson$/i.test(n), (line) => {
    const s = line.trim().replace(/,$/, '');
    if (!s.startsWith('{"type":"Feature"')) return;
    read++;
    const g = JSON.parse(s).geometry;
    const ring = g?.type === 'Polygon' ? g.coordinates[0] : null;
    if (!ring || ring.length < 4) return;
    const rbox = bboxOf([ring]);
    const a = areaOf((rbox[0] + rbox[2]) / 2, (rbox[1] + rbox[3]) / 2);
    if (!a) return;
    feats.push({ ring: ring.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]), rbox, a, f: 0, h: null, m2: ringM2(ring) });
  });
  log(`  ${feats.length} of ${read} footprints inside the areas`);
  if (!read) throw new Error('Saskatchewan.zip: no footprints read (has the file changed?)');
  if (!feats.length) throw new Error(`none of ${read} footprints fell inside the areas`);

  // heights: OpenStreetMap buildings tagged with a height or a storey count, matched to the footprint under their centre
  const q = `[out:json][timeout:300];(${areas.map((a) => { const bb = `${a.box[1].toFixed(4)},${a.box[0].toFixed(4)},${a.box[3].toFixed(4)},${a.box[2].toFixed(4)}`; return `way["building"]["height"](${bb});way["building"]["building:levels"](${bb});relation["building"]["height"](${bb});relation["building"]["building:levels"](${bb});`; }).join('')});out tags center;`;
  const osm = await overpass('sk-building-heights.json', q);
  const CELL = 0.002;
  const grid = new Map();
  feats.forEach((b, i) => {
    for (let gx = Math.floor(b.rbox[0] / CELL); gx <= Math.floor(b.rbox[2] / CELL); gx++)
      for (let gy = Math.floor(b.rbox[1] / CELL); gy <= Math.floor(b.rbox[3] / CELL); gy++) { const k = `${gx},${gy}`; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(i); }
  });
  const num = (v) => { const m = /^\s*(\d+(?:\.\d+)?)\s*(m|metres?)?\s*$/i.exec(v ?? ''); return m ? +m[1] : null; };
  let matched = 0;
  for (const el of osm.elements) {
    const c = el.center;
    if (!c) continue;
    const t = el.tags ?? {};
    const hgt = num(t.height) ?? (num(t['building:levels']) != null ? num(t['building:levels']) * STOREY_M + (num(t['roof:levels']) ?? 0) * STOREY_M : null);
    if (hgt == null || hgt <= 0 || hgt > 200) continue;
    for (const i of grid.get(`${Math.floor(c.lon / CELL)},${Math.floor(c.lat / CELL)}`) ?? []) {
      const b = feats[i];
      if (b.h == null && inBox(b.rbox, c.lon, c.lat) && pipRing(b.ring, c.lon, c.lat)) { b.h = Math.round(hgt * 2) / 2; matched++; break; }
    }
  }
  log(`  ${osm.elements.length} OSM buildings with a height or storeys, ${matched} matched to a footprint`);

  // the flood flag: 1 touches the floodway, 2 the rest of the 1:500-year extent, 3 only land protected by dikes
  for (const b of feats) {
    for (const z of zones) {
      const r = KIND_RANK[z.kind];
      if ((b.f === 0 || r < b.f) && z.touches(b.ring, b.rbox)) b.f = r;
      if (b.f === 1) break;
    }
    const a = b.a;
    a.n++;
    if (b.f === 1) a.way++; else if (b.f === 2) a.ext++; else if (b.f === 3) a.prot++;
    if (b.h != null) a.h++;
    if (b.m2 >= Z12_MIN_M2) a.big++;
  }

  // tiles: footprints (all at 13–15, the bigger ones at 12) and the flood extents
  const fc = (list) => ({ type: 'FeatureCollection', features: list });
  const bFeat = (b, i) => ({ type: 'Feature', id: i + 1, properties: { f: b.f, ...(b.h != null ? { h: b.h } : {}) }, geometry: { type: 'Polygon', coordinates: [b.ring] } });
  const bAll = fc(feats.map(bFeat));
  const bBig = fc(feats.map(bFeat).filter((_, i) => feats[i].m2 >= Z12_MIN_M2));
  const fl = fc(zones.map((z) => ({ type: 'Feature', properties: { k: z.kind }, geometry: { type: 'Polygon', coordinates: z.polygon } })));
  const opts = { maxZoom: MAX_Z, indexMaxZoom: 5, tolerance: 2, extent: 4096, buffer: 32 };
  const idx = { all: new GeoJSONVT(bAll, opts), big: new GeoJSONVT(bBig, { ...opts, maxZoom: MIN_Z }), flood: new GeoJSONVT(fl, opts) };
  const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
  const tiles = [];
  let biggest = 0;
  for (let z = MIN_Z; z <= MAX_Z; z++) {
    const want = new Set();
    for (const a of areas) for (let x = lon2x(a.box[0], z); x <= lon2x(a.box[2], z); x++) for (let y = lat2y(a.box[3], z); y <= lat2y(a.box[1], z); y++) want.add(`${x}/${y}`);
    for (const k of want) {
      const [x, y] = k.split('/').map(Number);
      const layers = {};
      const tb = (z === MIN_Z ? idx.big : idx.all).getTile(z, x, y);
      const tf = idx.flood.getTile(z, x, y);
      if (tb?.features.length) layers.buildings = tb;
      if (tf?.features.length) layers.flood = tf;
      if (!Object.keys(layers).length) continue;
      const data = Buffer.from(vtpbf.fromGeojsonVt(layers, { version: 2, extent: 4096 }));
      biggest = Math.max(biggest, data.length);
      tiles.push({ z, x, y, data });
    }
  }
  const all = bboxOf(areas.map((a) => [[a.box[0], a.box[1]], [a.box[2], a.box[3]]]));
  const source = 'Microsoft, Canadian Building Footprints (machine-drawn from Bing imagery)';
  const licence = 'Open Data Commons Open Database License (ODbL)';
  const pm = writePMTiles(tiles, {
    bounds: all, center: [-106.67, 52.13, 14],
    meta: {
      name: 'Living Skies Atlas buildings', attribution: `${source}; heights © OpenStreetMap contributors; flood extents © Water Security Agency`,
      vector_layers: [
        { id: 'buildings', minzoom: MIN_Z, maxzoom: MAX_Z, fields: { f: 'Number', h: 'Number' } },
        { id: 'flood', minzoom: MIN_Z, maxzoom: MAX_Z, fields: { k: 'String' } },
      ],
    },
  });
  log(`  ${tiles.length} tiles (largest ${(biggest / 1024).toFixed(0)} KB raw), ${FILE} ${(pm.length / 1048576).toFixed(1)} MB`);
  // checked before anything is written, so the archive and buildings.json are only ever replaced together
  if (pm.length > 40 * 1048576) throw new Error(`${FILE} is ${(pm.length / 1048576).toFixed(1)} MB, over the 40 MB budget`);
  await fs.mkdir(path.join(OUT, 'tiles'), { recursive: true });
  await writeAtomic(path.join(OUT, FILE), pm);

  const r6 = (v) => Math.round(v * 1e4) / 1e4;
  await writeOut('buildings', {
    source, sourceUrl: 'https://github.com/microsoft/CanadianBuildingFootprints', licence,
    heights: 'OpenStreetMap contributors (height or building:levels, where tagged), ODbL',
    flood: 'Water Security Agency, 1:500 Year Flood and Flood Hazard mapping',
    asOf: new Date().toISOString().slice(0, 10),
    file: FILE, bytes: pm.length, minzoom: MIN_Z, maxzoom: MAX_Z, storey: STOREY_M, z12Min: Z12_MIN_M2,
    bounds: all.map(r6),
    areas: areas.map((a) => ({ name: a.name, box: a.box.map(r6), n: a.n, way: a.way, ext: a.ext, prot: a.prot, h: a.h })).sort((a, b) => b.n - a.n),
  });
  const t = areas.reduce((s, a) => ({ n: s.n + a.n, f: s.f + a.way + a.ext }), { n: 0, f: 0 });
  log(`  ${t.n} buildings, ${t.f} touching the mapped 1:500-year extent`);
}
