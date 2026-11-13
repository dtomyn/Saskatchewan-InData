import fs from 'node:fs/promises';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { arcgisAll, overpass } from '../lib/apis.mjs';
import { distKm, dp, edgeKm } from '../lib/geo.mjs';
import { cachedFile, log, readOut, round, writeOut } from '../lib/io.mjs';
import { parseCSVLine } from '../lib/parse.mjs';
import { getPlaces, getProvince, inSask } from '../lib/places.mjs';

// HIDDEN NEIGHBOURS: the industry an acreage buyer may not notice. Oil and gas wells, oil and gas facilities and
// provincially licensed pipelines come from the Ministry of Energy and Resources' GeoHub layers; producing mines from
// the Saskatchewan Mineral Deposit Index (GeoHub); industrial emitters and their releases from ECCC's National
// Pollutant Release Inventory (latest year published). The Canada Energy Regulator publishes no open geometry for the
// federally regulated lines, so those are the OpenStreetMap pipelines whose name or operator is a CER-regulated system.
// Wells (over 100,000) and facilities are binned into ~4 km hexagons for the map; each place counts the real points.
export default async function industry() {
  await getProvince();
  const places = await getPlaces();
  let needs = null;
  try { needs = await readOut('needs'); } catch { log('  needs.json missing: run the needs stage for town limits'); }
  const EC = 'https://gis.saskatchewan.ca/arcgis/rest/services/Economy';
  const WELL_KM = 5, PIPE_KM = 2, MINE_KM = 25, NPRI_KM = 5, HEX_KM = 4;

  // --- wells: one per surface well id; planned, cancelled and preset licences were never drilled
  const wellRows = await arcgisAll(`${EC}/Petroleum/MapServer/0`, {
    where: "WELLSTATUS NOT LIKE 'Planned%' AND WELLSTATUS <> 'Preset'", outFields: 'WELL_CWI,WELLSTATUS,SURFACELATITUDE,SURFACELONGITUDE',
    returnGeometry: 'false', orderByFields: 'OBJECTID',
  }, 'sk-wells', 2000);
  // 0 active (producing, injecting, drilling, completed or cased), 1 suspended, 2 abandoned (incl. downhole abandoned)
  const wellClass = (s) => (/abandon/i.test(s) ? 2 : /^suspend/i.test(s) ? 1 : 0);
  const wellById = new Map();
  for (const f of wellRows) {
    const p = f.properties, lon = p.SURFACELONGITUDE, lat = p.SURFACELATITUDE;
    if (!p.WELL_CWI || wellById.has(p.WELL_CWI) || !Number.isFinite(lon) || !Number.isFinite(lat) || !inSask(lon, lat, 0.05)) continue;
    wellById.set(p.WELL_CWI, { lon, lat, c: wellClass(p.WELLSTATUS ?? '') });
  }
  const wells = [...wellById.values()];
  const wellTally = [0, 1, 2].map((c) => wells.filter((w) => w.c === c).length);
  log(`  ${wellRows.length} well records, ${wells.length} wells: ${wellTally[0]} active, ${wellTally[1]} suspended, ${wellTally[2]} abandoned`);
  if (wells.length < 10000) throw new Error(`only ${wells.length} wells came back from the GeoHub`);

  // --- oil and gas facilities (batteries, satellites, injection, compression, gas plants): operating or built
  const facRows = await arcgisAll(`${EC}/Petroleum/MapServer/17`, {
    where: "INFRSTATUS IN ('Operating','Constructed')", outFields: 'LICTYPE', maxAllowableOffset: '0.005', orderByFields: 'OBJECTID',
  }, 'sk-og-facilities', 1000);
  const facilities = facRows.flatMap((f) => {
    const ring = f.geometry?.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates[0][0] : null;
    if (!ring?.length) return [];
    const xs = ring.map((c) => c[0]), ys = ring.map((c) => c[1]);
    const lon = (Math.min(...xs) + Math.max(...xs)) / 2, lat = (Math.min(...ys) + Math.max(...ys)) / 2;
    return inSask(lon, lat, 0.05) ? [{ lon, lat, t: f.properties.LICTYPE ?? '' }] : [];
  });
  log(`  ${facilities.length} operating oil and gas facilities`);

  // --- hexagons (pointy-top, HEX_KM centre to corner) on a sinusoidal projection about 106° W
  const LON0 = -106, KY = 110.574;
  const kxAt = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180);
  const hexes = new Map();
  const hexOf = (lon, lat) => {
    const x = (lon - LON0) * kxAt(lat), y = lat * KY;
    const qf = ((Math.sqrt(3) / 3) * x - y / 3) / HEX_KM, rf = ((2 / 3) * y) / HEX_KM, sf = -qf - rf;
    let q = Math.round(qf), r = Math.round(rf); const s = Math.round(sf);
    const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
    const k = `${q},${r}`;
    if (!hexes.has(k)) {
      const cy = HEX_KM * 1.5 * r, clat = cy / KY, cx = HEX_KM * Math.sqrt(3) * (q + r / 2);
      hexes.set(k, [round(LON0 + cx / kxAt(clat), 3), round(clat, 3), 0, 0, 0, 0]);
    }
    return hexes.get(k);
  };
  for (const w of wells) hexOf(w.lon, w.lat)[2 + w.c]++;
  for (const f of facilities) hexOf(f.lon, f.lat)[5]++;
  log(`  ${hexes.size} hexagons`);

  // --- provincially licensed pipelines (not flowlines: ~95,000 short lines from wells to batteries)
  const pipeRows = await arcgisAll(`${EC}/Pipelines/MapServer/0`, {
    where: "SEGMENTSTATUS <> 'Removed'", outFields: 'LICENCENUMBER,PIPELINENAME,OWNERNAME,SUBSTANCE,SEGMENTSTATUS', maxAllowableOffset: '0.0005', orderByFields: 'OBJECTID',
  }, 'sk-pipelines', 1000);
  const substanceOf = (s) => (/sour/i.test(s) ? 'sour' : /gas/i.test(s) ? 'gas' : /crude|oil|lvp|hvp|liquid/i.test(s) ? 'oil' : /water/i.test(s) ? 'water' : 'other');
  const lineParts = (g) => (g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : []);
  const pipeBy = new Map();
  for (const f of pipeRows) {
    const p = f.properties;
    const live = /operating|construct/i.test(p.SEGMENTSTATUS ?? '');
    const k = `${p.LICENCENUMBER}|${live}`;
    if (!pipeBy.has(k)) pipeBy.set(k, { n: String(p.PIPELINENAME ?? '').trim(), o: String(p.OWNERNAME ?? '').trim(), s: substanceOf(p.SUBSTANCE ?? ''), live, parts: [] });
    pipeBy.get(k).parts.push(...lineParts(f.geometry).filter((l) => l.length >= 2));
  }
  const pipes = [...pipeBy.values()].filter((p) => p.parts.length);
  log(`  ${pipeRows.length} pipeline segments, ${pipes.length} licensed lines (${pipes.filter((p) => p.live).length} operating or being built)`);

  // --- federally regulated (CER) transmission lines, as mapped in OpenStreetMap
  const CER = /alliance|enbridge|lakehead|line 3|keystone|tc energy|transcanada|foothills|northern border|express|cochin|dakota gas|souris valley|westspur|many islands|bakken/i;
  const osm = await overpass('sk-pipelines.json', '[out:json][timeout:240];area["ISO3166-2"="CA-SK"]->.sk;way["man_made"="pipeline"](area.sk);out tags geom qt;');
  const fedBy = new Map();
  for (const e of osm.elements) {
    const t = e.tags ?? {};
    if (!CER.test(`${t.name ?? ''} ${t.operator ?? ''}`) || !e.geometry?.length) continue;
    const name = t.name || t.operator;
    if (!fedBy.has(name)) fedBy.set(name, { n: name, o: t.operator ?? '', s: /gas/i.test(t.substance ?? '') ? 'gas' : /oil/i.test(t.substance ?? '') ? 'oil' : /carbon/i.test(t.substance ?? '') ? 'co2' : 'other', parts: [] });
    // a way that crosses the border is cut to its Saskatchewan runs
    let run = [];
    for (const g of e.geometry) {
      if (inSask(g.lon, g.lat, 0.02)) run.push([g.lon, g.lat]);
      else { if (run.length >= 2) fedBy.get(name).parts.push(run); run = []; }
    }
    if (run.length >= 2) fedBy.get(name).parts.push(run);
  }
  const fed = [...fedBy.values()];
  log(`  OpenStreetMap: ${fed.length} federally regulated lines (${fed.map((f) => f.n).join(', ')})`);

  // --- NPRI: the latest year's file, Saskatchewan facilities, total releases (air, water, land) in tonnes
  const NPRI_DIR = '/substances/plansreports/reporting-facilities-pollutant-release-and-transfer-data/single-year-data-tables-by-facility-releases-transfers-and-disposals';
  let npriFile = null, npriYear = null;
  for (let y = new Date().getFullYear() - 1; y >= new Date().getFullYear() - 4 && !npriFile; y--) {
    try {
      npriFile = await cachedFile(`npri/NPRI-INRP_DataDonnees_${y}.csv`, `https://data-donnees.az.ec.gc.ca/api/file?path=${encodeURIComponent(`${NPRI_DIR}/NPRI-INRP_DataDonnées_${y}.csv`)}`, { timeout: 600_000 });
      npriYear = y;
    } catch (e) { log(`  NPRI ${y}: ${e.message}`); }
  }
  if (!npriFile) throw new Error('no NPRI single-year file found');
  const npriLines = (await fs.readFile(npriFile, 'latin1')).split(/\r?\n/).filter(Boolean);
  const nh = parseCSVLine(npriLines[0]);
  const col = (en) => { const i = nh.findIndex((h) => h.trim().endsWith(`/ ${en}`)); if (i < 0) throw new Error(`NPRI column "${en}" missing`); return i; };
  const C = { id: col('NPRI ID'), co: col('Company Name'), fn: col('Facility Name'), city: col('City'), prov: col('Province'), lat: col('Latitude'), lon: col('Longitude'), n4: col('NAICS 4 Code'), s4: col('NAICS 4 Sector Name (English)'), n6: col('NAICS 6 Code'), s6: col('NAICS 6 Sector Name (English)'), sub: col('Substance Name (English)'), u: col('Units'), tot: col('Total Releases - Total Releases (Excluding Road Dust)') };
  const toT = { tonnes: 1, kg: 1e-3, grams: 1e-6 };
  const tidy = (s) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s(\-/.])([a-z])/g, (_, a, c) => a + c.toUpperCase()) : t; };
  const npriBy = new Map();
  for (const l of npriLines.slice(1)) {
    const r = parseCSVLine(l);
    if (r[C.prov] !== 'SK') continue;
    const lat = Number(r[C.lat]), lon = Number(r[C.lon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !lat) continue;
    if (!npriBy.has(r[C.id])) npriBy.set(r[C.id], { id: r[C.id], n: tidy(r[C.fn]), c: tidy(r[C.co]), city: tidy(r[C.city]), lon: round(lon, 4), lat: round(lat, 4), n4: r[C.n4], k: r[C.s4], k6: r[C.n6], t: 0, subs: new Map() });
    const f = npriBy.get(r[C.id]);
    const t = (Number(r[C.tot]) || 0) * (toT[r[C.u]] ?? 0);
    f.subs.set(r[C.sub], (f.subs.get(r[C.sub]) ?? 0) + t);
    f.t += t;
  }
  const npri = [...npriBy.values()].map(({ subs, ...f }) => {
    const top = [...subs].sort((a, b) => b[1] - a[1])[0];
    return { ...f, t: round(f.t, 2), ns: subs.size, top: top && top[1] > 0 ? [top[0].replace(/ - .*$/, '').replace(/\s*\(.*\)$/, ''), round(top[1], 2)] : null };
  }).sort((a, b) => b.t - a.t);
  log(`  NPRI ${npriYear}: ${npri.length} Saskatchewan facilities, ${Math.round(npri.reduce((a, f) => a + f.t, 0))} t released`);

  // --- producing mines: the Mineral Deposit Index, plus NPRI-reporting mines it lacks (new and project sites)
  const COMMODITY = { Pot: ['Potash', 'potash'], U: ['Uranium', 'uranium'], Cl: ['Coal', 'coal'], Sal: ['Salt', 'other'], Ss: ['Sodium sulphate', 'other'], Ksu: ['Potassium sulphate', 'other'], Ka: ['Kaolin clay', 'other'], Ben: ['Bentonite', 'other'], Cu: ['Copper and zinc', 'metal'], Au: ['Gold', 'metal'], Ci: ['Clinker shale', 'other'], Pe: ['Peat', 'other'], Ln: ['Leonardite', 'other'], SiS: ['Silica sand', 'other'] };
  const smdi = await arcgisAll(`${EC}/Mineral_Exploration/MapServer/1`, { where: "STATUS = 'Producing Mine'", outFields: 'NAME,COMMODITY,WEBLINK' }, 'sk-mines');
  const mineName = (s) => { let n = String(s ?? '').split(/[,;{]/)[0].trim(); if (/ or /.test(n)) n = n.split(' or ').at(-1).trim(); return n.replace(/\s+Deposit$/, ''); };
  const mines = [];
  for (const f of smdi) {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    const code = f.properties.COMMODITY;
    if (!Number.isFinite(lon) || code === 'He' || mines.some((m) => distKm(m.lon, m.lat, lon, lat) < 2)) continue;
    const [cn, g] = COMMODITY[code] ?? [code, 'other'];
    mines.push({ n: mineName(f.properties.NAME), cm: cn, g, lon: round(lon, 4), lat: round(lat, 4), src: 'smdi', url: /^https:\/\//.test(f.properties.WEBLINK ?? '') ? f.properties.WEBLINK : null });
  }
  const N6 = { 212396: ['Potash', 'potash'], 212291: ['Uranium', 'uranium'], 212116: ['Coal', 'coal'], 212114: ['Coal', 'coal'], 212220: ['Gold', 'metal'], 212233: ['Copper and zinc', 'metal'], 212393: ['Salt', 'other'] };
  let fromNpri = 0;
  for (const f of npri) {
    if (!/^212[123]/.test(f.n4) || !N6[f.k6] || mines.some((m) => distKm(m.lon, m.lat, f.lon, f.lat) < 10)) continue;
    const [cn, g] = N6[f.k6];
    mines.push({ n: f.n, cm: cn, g, lon: f.lon, lat: f.lat, src: 'npri', url: null });
    fromNpri++;
  }
  log(`  ${mines.length} producing mines (${fromNpri} added from NPRI)`);

  // --- per place, measured from the town limits (needs.json) or, without them, from a circle round the centre
  const fallbackKm = needs?.fallbackKm ?? 3;
  const kmFrom = (p) => {
    const a = needs?.areas?.[p.key];
    if (a?.length) {
      const geom = { type: 'MultiPolygon', coordinates: a };
      const feat = { type: 'Feature', properties: {}, geometry: geom };
      return (lon, lat) => (booleanPointInPolygon([lon, lat], feat) ? 0 : edgeKm(lon, lat, geom));
    }
    return (lon, lat) => Math.max(0, distKm(p.lon, p.lat, lon, lat) - fallbackKm);
  };
  const bboxOf = (p) => {
    const a = needs?.areas?.[p.key];
    const pts = a?.length ? a.flat(2) : [[p.lon, p.lat]];
    const xs = pts.map((c) => c[0]), ys = pts.map((c) => c[1]);
    const pad = a?.length ? 0 : fallbackKm;
    return { w: Math.min(...xs), e: Math.max(...xs), s: Math.min(...ys), n: Math.max(...ys), pad };
  };
  const near = (b, lon, lat, km) => {
    const dy = (km + b.pad) / KY, dx = (km + b.pad) / kxAt(lat);
    return lon >= b.w - dx && lon <= b.e + dx && lat >= b.s - dy && lat <= b.n + dy;
  };
  // a line comes within `km` of the town: sample each segment every ~250 m (lines are pre-filtered by bounding box)
  const lineWithin = (parts, b, d, km) => parts.some((l) => l.some((c, i) => {
    if (!i) return near(b, c[0], c[1], km) && d(c[0], c[1]) <= km;
    const [x0, y0] = l[i - 1], steps = Math.max(1, Math.ceil(distKm(x0, y0, c[0], c[1]) / 0.25));
    for (let s = 1; s <= steps; s++) {
      const x = x0 + ((c[0] - x0) * s) / steps, y = y0 + ((c[1] - y0) * s) / steps;
      if (near(b, x, y, km) && d(x, y) <= km) return true;
    }
    return false;
  }));
  const towns = {};
  for (const p of places) {
    const d = kmFrom(p), b = bboxOf(p);
    const w = [0, 0, 0];
    for (const x of wells) if (near(b, x.lon, x.lat, WELL_KM) && d(x.lon, x.lat) <= WELL_KM) w[x.c]++;
    const f = facilities.filter((x) => near(b, x.lon, x.lat, WELL_KM) && d(x.lon, x.lat) <= WELL_KM).length;
    const livePipes = pipes.filter((x) => x.live && lineWithin(x.parts, b, d, PIPE_KM));
    const fedNear = fed.flatMap((x, i) => (lineWithin(x.parts, b, d, PIPE_KM) ? [i] : []));
    let np = null, n5 = 0;
    npri.forEach((x, i) => { const k = d(x.lon, x.lat); if (k <= NPRI_KM) n5++; if (!np || k < np.km) np = { i, km: k }; });
    let mn = null;
    mines.forEach((x, i) => { const k = d(x.lon, x.lat); if (k <= MINE_KM && (!mn || k < mn.km)) mn = { i, km: k }; });
    towns[p.key] = {
      w, f, pl: livePipes.length, sour: livePipes.filter((x) => x.s === 'sour').length, fed: fedNear,
      np: np && { i: np.i, km: round(np.km, 1) }, n5, mn: mn && { i: mn.i, km: round(mn.km, 1) },
    };
  }

  // --- the map's lines: simplified (~300 m) and rounded; abandoned and discontinued lines are counted, not drawn (size)
  const simplify = (parts) => parts.map((l) => dp(l, 0.003).map(([x, y]) => [round(x, 3), round(y, 3)])).filter((l) => l.length >= 2 && !(l.length === 2 && l[0][0] === l[1][0] && l[0][1] === l[1][1]));
  const owners = [...new Set(pipes.filter((p) => p.live).map((p) => p.o))].sort();
  await writeOut('industry', {
    source: 'Government of Saskatchewan, Ministry of Energy and Resources: Petroleum (wells, facilities), Pipelines and Mineral Deposit Index layers, Saskatchewan GeoHub (gis.saskatchewan.ca); Environment and Climate Change Canada, National Pollutant Release Inventory; OpenStreetMap (federally regulated pipelines)',
    licence: 'Government of Saskatchewan Standard Unrestricted Use Data Licence v2.0; Open Government Licence – Canada; ODbL',
    licenceUrl: 'https://gisappl.saskatchewan.ca/Html5Ext/Resources/GOS_Standard_Unrestricted_Use_Data_Licence_v2.0.pdf',
    npriUrl: 'https://data-donnees.az.ec.gc.ca/data/substances/plansreports/reporting-facilities-pollutant-release-and-transfer-data/single-year-data-tables-by-facility-releases-transfers-and-disposals',
    asOf: new Date().toISOString().slice(0, 10), npriYear,
    wellKm: WELL_KM, pipeKm: PIPE_KM, mineKm: MINE_KM, npriKm: NPRI_KM, hexKm: HEX_KM, fallbackKm,
    totals: { wells: wellTally, facilities: facilities.length, pipes: pipes.filter((p) => p.live).length, oldPipes: pipes.filter((p) => !p.live).length, sour: pipes.filter((p) => p.live && p.s === 'sour').length },
    hexes: [...hexes.values()].sort((a, b) => b[1] - a[1] || a[0] - b[0]),
    pipes: pipes.filter((p) => p.live).map((p) => ({ n: p.n && p.n !== p.o ? p.n : null, o: owners.indexOf(p.o), s: p.s, p: simplify(p.parts) })).filter((p) => p.p.length),
    owners,
    fed: fed.map((p) => ({ n: p.n, o: p.o, s: p.s, p: simplify(p.parts) })),
    npri: npri.map(({ id, n4, k6, ...f }) => ({ ...f, lon: round(f.lon, 3), lat: round(f.lat, 3) })),
    mines, towns,
  });
}
