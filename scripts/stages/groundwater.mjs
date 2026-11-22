import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { arcgisAll } from '../lib/apis.mjs';
import { distKm, edgeKm, polys } from '../lib/geo.mjs';
import { log, readOut, round, writeOut } from '../lib/io.mjs';
import { getPlaces, getProvince, getSmallPlaces, inSask, smallAreas } from '../lib/places.mjs';

// GROUNDWATER: will a well find water here, and how deep. The Water Security Agency's water well layer is built from
// the drillers' reports every driller must file (the "Water Well Driller's Reports" database), most wells placed at the
// centre of their quarter section. Only aggregates are published: ~4 km hexagons (as the Hidden neighbours wells), each
// place's wells within WELL_KM of its town limits, and depth histograms. No well row, owner or driller name is kept:
// the owner field (`WellName`) and the driller are never even requested. Depths are feet, as the drillers record them.
// A log is what the driller recorded the day the well was drilled, not today's level. Glacial drift thickness (surface
// to bedrock, by 50 m class) is the Saskatchewan Geological Survey's 1:1,000,000 isopach.
export default async function groundwater() {
  await getProvince();
  const places = await getPlaces();
  const smallP = await getSmallPlaces();
  const sAreas = await smallAreas();
  let needs = null;
  try { needs = await readOut('needs'); } catch { log('  needs.json missing: run the needs stage for town limits'); }
  const WELLS = 'https://gis.wsask.ca/arcgiswa/rest/services/Public/Water_Wells/FeatureServer/4';
  const DRIFT = 'https://gis.saskatchewan.ca/egis/rest/services/Economy/Regional_Datasets_and_Compilations/FeatureServer/9';
  const WELL_KM = 10, HEX_KM = 4, MIN_N = 3, MAX_FT = 3000, MIN_PLACE = 10;
  const BIN_FT = 50, BINS = 11; // 0–50 ft … 450–500 ft, then 500 ft and deeper

  // --- the wells: never WellName (the owner's surname), cDrillerName or any other name field
  const rows = await arcgisAll(WELLS, {
    where: '1=1', outFields: 'nBoreHoleDepthInFeet,nWaterLevel,nFlowingHead,cwateruse,cwelluse,dCompleted,cDecommisioned',
    returnGeometry: 'true', orderByFields: 'OBJECTID',
  }, 'wsa-wells', 10000);
  // what the hole was for: water wells, test holes drilled looking for water, observation and monitoring wells.
  // Seismic, soil and mineral test holes and waste disposal wells are in the database but are not water wells.
  const NOT_WATER = new Set(['Seismic Test Hole', 'Soil Test Hole', 'Mineral Test Hole', 'Waste Disposal']);
  const KINDS = ['Withdrawal', 'Water Test Hole', 'Observation', 'Quality Monitoring', 'Recharge', 'Other'];
  // what the water is for (cwateruse), grouped
  const USES = ['Domestic', 'Municipal', 'Industrial', 'Irrigation', 'Research', 'Other'];
  const useOf = (s) => { const i = USES.indexOf(s); return i >= 0 ? i : 5; };
  const kindOf = (s) => { const i = KINDS.indexOf(s); return i >= 0 ? i : 5; };
  const wells = [];
  let dropped = 0, offMap = 0;
  for (const f of rows) {
    const p = f.properties, [lon, lat] = f.geometry?.coordinates ?? [];
    if (NOT_WATER.has(p.cwelluse)) { dropped++; continue; }
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !inSask(lon, lat, 0.05)) { offMap++; continue; }
    const bore = p.nBoreHoleDepthInFeet > 0 && p.nBoreHoleDepthInFeet <= MAX_FT ? p.nBoreHoleDepthInFeet : null;
    // depth to water below ground; a flowing well's water stands at or above the surface (0). A 0 with no flowing head
    // is a level not recorded; a level below the bottom of the hole is a slip in the record. Both left out.
    const flow = p.nFlowingHead > 0;
    const lvl = flow ? 0 : p.nWaterLevel > 0 && (bore == null || p.nWaterLevel <= bore) ? p.nWaterLevel : null;
    const y = Number(String(p.dCompleted ?? '').slice(0, 4));
    wells.push({ lon, lat, k: kindOf(p.cwelluse), u: useOf(p.cwateruse), bore, lvl, flow, y: y >= 1900 && y <= new Date().getFullYear() ? y : null, dec: p.cDecommisioned === '1' });
  }
  log(`  ${rows.length} driller's reports: ${wells.length} water wells and test holes kept, ${dropped} seismic, soil, mineral or disposal holes dropped, ${offMap} off the map`);
  if (wells.length < 100000) throw new Error(`only ${wells.length} water wells came back from the Water Security Agency`);

  const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
  const quart = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const hist = (a) => { const h = new Array(BINS).fill(0); for (const v of a) h[Math.min(BINS - 1, Math.floor(v / BIN_FT))]++; return h; };
  const topOf = (counts) => { let b = 0; counts.forEach((c, i) => { if (c > counts[b]) b = i; }); return counts[b] ? b : null; };
  // a group of wells as published: the medians come from withdrawal wells (the ones people draw water from)
  const summarise = (ws) => {
    const draw = ws.filter((w) => w.k === 0);
    const bores = draw.flatMap((w) => (w.bore != null ? [w.bore] : []));
    const lvls = draw.flatMap((w) => (w.lvl != null ? [w.lvl] : []));
    const uses = USES.map(() => 0), kinds = KINDS.map(() => 0);
    for (const w of ws) { uses[w.u]++; kinds[w.k]++; }
    const ys = draw.flatMap((w) => (w.y != null ? [w.y] : []));
    return { n: ws.length, nw: draw.length, bores, lvls, uses, kinds, flow: draw.filter((w) => w.flow).length, ys };
  };

  // --- hexagons (pointy-top, HEX_KM centre to corner) on the same sinusoidal grid as the Hidden neighbours wells
  const LON0 = -106, KY = 110.574;
  const kxAt = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180);
  const hexes = new Map();
  for (const w of wells) {
    const x = (w.lon - LON0) * kxAt(w.lat), y = w.lat * KY;
    const qf = ((Math.sqrt(3) / 3) * x - y / 3) / HEX_KM, rf = ((2 / 3) * y) / HEX_KM, sf = -qf - rf;
    let q = Math.round(qf), r = Math.round(rf); const s = Math.round(sf);
    const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
    const k = `${q},${r}`;
    if (!hexes.has(k)) {
      const cy = HEX_KM * 1.5 * r, clat = cy / KY, cx = HEX_KM * Math.sqrt(3) * (q + r / 2);
      hexes.set(k, { lon: round(LON0 + cx / kxAt(clat), 3), lat: round(clat, 3), ws: [] });
    }
    hexes.get(k).ws.push(w);
  }
  // [lon, lat, water wells, withdrawal wells, median bore depth ft, wells with a level, median depth to water ft,
  //  flowing wells, the most common water use (index into uses)]; a median of fewer than MIN_N wells is null
  const hexRows = [...hexes.values()].map((h) => {
    const s = summarise(h.ws);
    return [h.lon, h.lat, s.n, s.nw, s.bores.length >= MIN_N ? median(s.bores) : null, s.lvls.length, s.lvls.length >= MIN_N ? median(s.lvls) : null, s.flow, topOf(s.uses)];
  }).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  log(`  ${hexRows.length} hexagons, ${hexRows.filter((h) => h[6] != null).length} with a depth to water`);

  // --- glacial drift thickness: surface to bedrock, by 50 m class
  const driftRows = await arcgisAll(DRIFT, { where: '1=1', outFields: 'CONTOUR', maxAllowableOffset: '0.005', orderByFields: 'OBJECTID' }, 'sgs-drift', 1000);
  const driftClass = (c) => {
    const s = String(c ?? '').trim();
    const m = s.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) return [Number(m[1]), Number(m[2])];
    const o = s.match(/^over\s*(\d+)/i);
    return o ? [Number(o[1]), null] : null;
  };
  const classes = [];
  const drift = driftRows.flatMap((f) => {
    const c = driftClass(f.properties.CONTOUR);
    if (!c || !f.geometry) { log(`  drift: class "${f.properties.CONTOUR}" not read`); return []; }
    let i = classes.findIndex((x) => x[0] === c[0]);
    if (i < 0) { classes.push(c); i = classes.length - 1; }
    return [{ c: i, geom: f.geometry, p: polys(f.geometry, 0.01, 3) }];
  });
  // classes in order, shallow first
  const order = classes.map((c, i) => [c, i]).sort((a, b) => a[0][0] - b[0][0]);
  const remap = new Map(order.map(([, i], j) => [i, j]));
  const driftOut = drift.map((d) => ({ c: remap.get(d.c), p: d.p })).filter((d) => d.p.length);
  const driftFeat = drift.map((d) => ({ c: remap.get(d.c), f: { type: 'Feature', properties: {}, geometry: d.geom } }));
  log(`  glacial drift: ${driftOut.length} polygons in ${classes.length} classes`);
  if (!driftOut.length) throw new Error('no glacial drift thickness polygons came back');
  const driftAt = (lon, lat) => driftFeat.find((d) => booleanPointInPolygon([lon, lat], d.f))?.c ?? null;

  // --- per place: water wells within WELL_KM of the town limits (needs.json; tier 2 their census subdivision outline),
  // or of a circle round the centre when there are none
  const fallbackKm = needs?.fallbackKm ?? 3;
  const placeRow = (p, area) => {
    const geom = area?.length ? { type: 'MultiPolygon', coordinates: area } : null;
    const feat = geom && { type: 'Feature', properties: {}, geometry: geom };
    const pts = geom ? area.flat(2) : [[p.lon, p.lat]];
    const pad = geom ? 0 : fallbackKm;
    const w = Math.min(...pts.map((c) => c[0])), e = Math.max(...pts.map((c) => c[0])), s = Math.min(...pts.map((c) => c[1])), n = Math.max(...pts.map((c) => c[1]));
    const dy = (WELL_KM + pad) / KY, dx = (WELL_KM + pad) / kxAt(p.lat);
    const near = wells.filter((x) => x.lon >= w - dx && x.lon <= e + dx && x.lat >= s - dy && x.lat <= n + dy
      && (geom ? booleanPointInPolygon([x.lon, x.lat], feat) || edgeKm(x.lon, x.lat, geom) <= WELL_KM : distKm(p.lon, p.lat, x.lon, x.lat) - fallbackKm <= WELL_KM));
    const t = summarise(near);
    const ok = (a) => a.length >= MIN_PLACE;
    return {
      n: t.n, nw: t.nw,
      b: ok(t.bores) ? [median(t.bores), quart(t.bores, 0.25), quart(t.bores, 0.75)] : null, bn: t.bores.length,
      l: ok(t.lvls) ? [median(t.lvls), quart(t.lvls, 0.25), quart(t.lvls, 0.75)] : null, ln: t.lvls.length,
      fl: t.flow, u: topOf(t.uses), us: t.uses, h: t.bores.length ? hist(t.bores) : null,
      y: t.ys.length ? [median(t.ys), t.ys.reduce((a, b) => Math.max(a, b))] : null,
      d: driftAt(p.lon, p.lat),
    };
  };
  const towns = {}, small = {};
  for (const p of places) towns[p.key] = placeRow(p, needs?.areas?.[p.key]);
  for (const p of smallP) small[p.key] = placeRow(p, sAreas[p.key]);
  const withB = Object.values(towns).filter((t) => t.b).length;
  log(`  ${places.length} places (${withB} with ${MIN_PLACE}+ bore depths within ${WELL_KM} km), ${smallP.length} small communities`);

  // --- the province: medians, histogram, wells logged per decade, what the holes were for
  const all = summarise(wells);
  const decades = {};
  for (const w of wells) if (w.y != null) { const d = Math.floor(w.y / 10) * 10; decades[d] = (decades[d] ?? 0) + 1; }
  const years = wells.flatMap((w) => (w.y != null ? [w.y] : []));
  await writeOut('groundwater', {
    source: 'Water Security Agency, Water Wells (Public) layer, from the Water Well Driller’s Reports database (gis.wsask.ca); Saskatchewan Geological Survey, Glacial Drift Thickness (1:1,000,000), Saskatchewan Mining and Petroleum GeoAtlas',
    licence: 'Government of Saskatchewan Standard Unrestricted Use Data Licence v2.0',
    // the wells service states no licence itself; the WSA's own item for it (Water Wells Web Map) and the GeoHub's
    // Glacial Drift Thickness item state this one
    licenceNote: 'stated on the Water Security Agency’s Water Wells Web Map item (ArcGIS Online 3386acc3da8e4bb383cde182203ff77d) and the GeoHub’s Glacial Drift Thickness item; the wells feature service itself states none',
    licenceUrl: 'https://gisappl.saskatchewan.ca/Html5Ext/Resources/GOS_Standard_Unrestricted_Use_Data_Licence_v2.0.pdf',
    wellsUrl: 'https://gis.wsask.ca/Html5Viewer/index.html?viewer=WaterWells.WellsViewer/',
    driftUrl: 'https://geohub.saskatchewan.ca/datasets/494635e796064cdca35be8ea05c864de',
    asOf: new Date().toISOString().slice(0, 10),
    wellKm: WELL_KM, hexKm: HEX_KM, minN: MIN_N, minPlace: MIN_PLACE, binFt: BIN_FT, fallbackKm,
    uses: USES, kinds: KINDS,
    totals: {
      reports: rows.length, n: all.n, nw: all.nw, notWater: dropped, flow: all.flow, dec: wells.filter((w) => w.dec).length,
      b: [median(all.bores), quart(all.bores, 0.25), quart(all.bores, 0.75)], bn: all.bores.length,
      l: [median(all.lvls), quart(all.lvls, 0.25), quart(all.lvls, 0.75)], ln: all.lvls.length,
      uses: all.uses, kinds: all.kinds, h: hist(all.bores),
      years: [years.reduce((a, b) => Math.min(a, b)), years.reduce((a, b) => Math.max(a, b))], decades: Object.entries(decades).map(([d, n]) => [Number(d), n]).sort((a, b) => a[0] - b[0]),
    },
    hexes: hexRows,
    drift: { classes: order.map(([c]) => c), polys: driftOut },
    towns, small,
  });
}
