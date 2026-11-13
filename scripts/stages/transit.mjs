import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { strFromU8, unzipSync } from 'fflate';
import { overpass } from '../lib/apis.mjs';
import { BBOX } from '../lib/config.mjs';
import { driveTimes } from '../lib/drive.mjs';
import { distKm, dp, dpRing, edgeKm, joinPaths } from '../lib/geo.mjs';
import { cached, fetchBuf, log, readOut, round, writeOut } from '../lib/io.mjs';
import { parseCSV } from '../lib/parse.mjs';
import { getPlaces, getProvince, inSask } from '../lib/places.mjs';

// Getting around without STC (the provincial bus, closed in 2017): airports with scheduled flights (OurAirports'
// `scheduled_service` flag, placed by OpenStreetMap's aerodrome), VIA Rail stations and lines and intercity bus routes
// as mapped in OpenStreetMap, and city transit from the cities' GTFS feeds (route shapes and stop counts), with
// OpenStreetMap's local bus routes for towns that publish no feed. Per place: the drive to the nearest airport with
// scheduled service, and whether a VIA station, an intercity bus stop or local transit is in town.
export default async function transit() {
  await getProvince();
  const places = await getPlaces();
  const near = (lon, lat, tol) => inSask(lon, lat, tol);
  let needs = null;
  try { needs = await readOut('needs'); } catch { log('  needs.json missing: run the needs stage for town limits'); }
  const inTown = (p, lon, lat) => {
    const a = needs?.areas?.[p.key];
    if (a?.length) {
      const geom = { type: 'MultiPolygon', coordinates: a };
      return booleanPointInPolygon([lon, lat], { type: 'Feature', properties: {}, geometry: geom }) || edgeKm(lon, lat, geom) <= (needs.slackKm ?? 1);
    }
    return distKm(p.lon, p.lat, lon, lat) <= (needs?.fallbackKm ?? 3);
  };
  const line = (pts, tol) => {
    const out = [];
    for (const [x, y] of (pts.length > 4 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 1e-4 ? dpRing(pts, tol) : dp(pts, tol))) { const q = [round(x, 4), round(y, 4)]; if (!out.length || q[0] !== out.at(-1)[0] || q[1] !== out.at(-1)[1]) out.push(q); }
    return out;
  };

  // --- airports: OurAirports (public domain) decides scheduled service; OSM's aerodrome (same IATA code) places it
  const OURAIRPORTS = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
  const oa = parseCSV((await cached('transit/ourairports.csv', () => fetchBuf(OURAIRPORTS, { timeout: 300_000 }))).toString('utf8'));
  if (!oa.length || !('scheduled_service' in oa[0])) throw new Error('OurAirports airports.csv has no scheduled_service column');
  // Saskatchewan's, and Canadian ones just over the border (Lloydminster's is on the Alberta side; Flin Flon's serves Creighton)
  const sched = oa.filter((r) => r.scheduled_service === 'yes' && r.iata_code && /^CA-(SK|AB|MB)$/.test(r.iso_region)
    && (r.iso_region === 'CA-SK' || near(+r.longitude_deg, +r.latitude_deg, 0.6)));
  const osmAir = await overpass('sk-aerodromes.json', `[out:json][timeout:120];nwr["aeroway"="aerodrome"](${BBOX.south - 0.5},${BBOX.west - 0.8},${BBOX.north},${BBOX.east + 0.8});out center tags qt;`);
  const airports = [];
  for (const r of sched) {
    const o = osmAir.elements.find((e) => e.tags?.iata === r.iata_code || (r.icao_code && e.tags?.icao === r.icao_code));
    const lon = o ? o.lon ?? o.center?.lon : +r.longitude_deg, lat = o ? o.lat ?? o.center?.lat : +r.latitude_deg;
    airports.push({ n: (o?.tags?.name ?? r.name).trim(), iata: r.iata_code, icao: r.icao_code || r.ident, city: r.municipality || null, prov: r.iso_region.slice(3), size: r.type === 'large_airport' ? 2 : r.type === 'medium_airport' ? 1 : 0, lon: round(lon, 5), lat: round(lat, 5), osm: o ? `${o.type}/${o.id}` : null, wiki: r.wikipedia_link || null });
  }
  if (!airports.length) throw new Error('no airports with scheduled service found in OurAirports');
  // Far-north airports (Stony Rapids, Uranium City, Wollaston Lake…) are reached by air or winter road; OSRM routes
  // over OpenStreetMap's winter roads, so it cannot tell them apart. They are all drive targets, and none is the
  // nearest for any of the atlas's places (checked below).
  airports.sort((x, y) => y.size - x.size || y.lat - x.lat);
  log(`  ${airports.length} airports with scheduled service (OurAirports): ${airports.map((a) => a.iata).join(' ')}; ${airports.filter((a) => a.osm).length} placed by OSM`);

  // --- VIA Rail stations and lines, and intercity / local bus routes, from OpenStreetMap
  const B = `${BBOX.south},${BBOX.west - 0.3},${BBOX.north},${BBOX.east + 0.3}`;
  const viaOSM = await overpass('sk-via.json', `[out:json][timeout:200];(nwr["railway"~"^(station|halt)$"]["operator"~"VIA",i](${B});nwr["railway"~"^(station|halt)$"]["network"~"VIA",i](${B}););out center tags qt;rel["route"="train"]["operator"~"VIA",i](${B});out geom qt;`);
  const stations = [];
  for (const e of viaOSM.elements) {
    if (e.type === 'relation' && e.tags?.route) continue;
    const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat, n = (e.tags?.name ?? '').trim();
    if (lon == null || !n || !near(lon, lat, 0.05)) continue;
    if (stations.some((s) => s.n === n && distKm(s.lon, s.lat, lon, lat) < 3)) continue;
    stations.push({ n, k: e.tags.railway === 'halt' ? 'halt' : 'station', lon: round(lon, 5), lat: round(lat, 5), osm: `${e.type}/${e.id}` });
  }
  // lines: each VIA route's ways inside the province, ways shared by both directions kept once
  const railLines = [];
  const seenWay = new Set();
  for (const r of viaOSM.elements.filter((e) => e.type === 'relation' && e.tags?.route === 'train')) {
    const name = /canadian/i.test(r.tags.name ?? '') ? 'The Canadian (Toronto – Vancouver)' : /churchill/i.test(r.tags.name ?? '') ? 'Winnipeg – Churchill' : (r.tags.name ?? 'VIA Rail');
    let ln = railLines.find((l) => l.n === name);
    if (!ln) railLines.push((ln = { n: name, paths: [] }));
    for (const m of r.members ?? []) {
      if (m.type !== 'way' || !m.geometry || seenWay.has(m.ref)) continue;
      seenWay.add(m.ref);
      const pts = m.geometry.map((g) => [g.lon, g.lat]).filter(([x, y]) => near(x, y, 0.15));
      if (pts.length >= 2) ln.paths.push(pts);
    }
  }
  // stations on a line: within 2 km of it
  for (const s of stations) {
    const l = railLines.find((ln) => ln.paths.some((p) => p.some(([x, y]) => distKm(s.lon, s.lat, x, y) < 2)));
    s.line = l ? l.n : null;
  }
  for (const l of railLines) l.paths = joinPaths(l.paths).map((p) => line(p, 0.002)).filter((p) => p.length >= 2);
  log(`  VIA Rail (OSM): ${stations.length} stations and stops (${stations.filter((s) => s.k === 'halt').length} flag stops); lines: ${railLines.map((l) => `${l.n} (${l.paths.length} pieces)`).join(', ')}`);

  // --- city transit: GTFS feeds where a city publishes one
  const GTFS = [
    { key: 'regina', n: 'Regina Transit', url: 'https://opengis.regina.ca/reginagtfs/google_transit.zip', licence: 'City of Regina Open Data terms of use (open.regina.ca)', licUrl: 'https://open.regina.ca/pages/terms-of-use' },
    { key: 'saskatoon', n: 'Saskatoon Transit', url: 'https://apps5.saskatoon.ca/data/gtfs/google_transit.zip', licence: 'City of Saskatoon Open Data: “free to use, re-use and redistribute”', licUrl: 'https://www.saskatoon.ca/services-residents/connect-your-city/open-data' },
    { key: 'moose jaw', n: 'Moose Jaw Transit', url: 'https://moosejaw.ca/wp-content/uploads/2023/11/moosejaw-GTFS.zip', licence: 'Published by the City of Moose Jaw on its transit page for trip planners; no licence stated', licUrl: 'https://moosejaw.ca/streets-roads/transit/' },
    // the city's own file has moved off citypa.ca; the Mobility Database keeps the last copy it fetched
    { key: 'prince albert', n: 'Prince Albert Transit', url: 'https://files.mobilitydatabase.org/tld-5509_1/latest.zip', licence: 'Published by the City of Prince Albert for trip planners (copy kept by the Mobility Database); no licence stated', licUrl: 'https://mobilitydatabase.org/feeds/gtfs/tld-5509_1' },
  ];
  const systems = [];
  for (const g of GTFS) {
    try {
      const zip = await cached(`transit/gtfs-${g.key.replace(/ /g, '_')}.zip`, async () => { const b = await fetchBuf(g.url, { timeout: 300_000 }); if (b[0] !== 0x50 || b[1] !== 0x4b) throw new Error('not a zip'); return b; });
      const files = unzipSync(new Uint8Array(zip), { filter: (f) => /^(routes|trips|shapes|stops|calendar|feed_info|frequencies)\.txt$/.test(f.name.split('/').pop()) });
      const read = (n) => { const k = Object.keys(files).find((f) => f.split('/').pop() === `${n}.txt`); return k ? parseCSV(strFromU8(files[k])) : []; };
      const routes = read('routes'), trips = read('trips'), shapes = read('shapes'), stops = read('stops'), cal = read('calendar'), info = read('feed_info')[0];
      const pts = new Map();
      for (const s of shapes) { if (!pts.has(s.shape_id)) pts.set(s.shape_id, []); pts.get(s.shape_id).push([+s.shape_pt_sequence, +s.shape_pt_lon, +s.shape_pt_lat]); }
      const len = (id) => { const p = pts.get(id) ?? []; let d = 0; for (let i = 1; i < p.length; i++) d += distKm(p[i - 1][1], p[i - 1][2], p[i][1], p[i][2]); return d; };
      const wed = new Set(cal.filter((c) => c.wednesday === '1').map((c) => c.service_id));
      const end = [info?.feed_end_date, ...cal.map((c) => c.end_date)].filter(Boolean).sort().at(-1) ?? null;
      // a feed that runs by headway (frequencies.txt) has one template trip per route, so its trip count means nothing
      const byHeadway = read('frequencies').length > 0;
      const out = [];
      for (const r of routes) {
        const rt = trips.filter((t) => t.route_id === r.route_id);
        if (!rt.length) continue;
        // the longest shape the route runs stands for it (the other direction mostly retraces it)
        const ids = [...new Set(rt.map((t) => t.shape_id).filter((id) => pts.has(id)))];
        const best = ids.sort((a, b) => len(b) - len(a))[0];
        const path = best ? line(pts.get(best).sort((a, b) => a[0] - b[0]).map(([, x, y]) => [x, y]), 0.0003) : [];
        out.push({ s: r.route_short_name || null, n: (r.route_long_name || r.route_short_name || '').trim(), c: /^[0-9a-f]{6}$/i.test(r.route_color ?? '') ? `#${r.route_color.toLowerCase()}` : null, trips: byHeadway ? null : rt.filter((t) => wed.has(t.service_id)).length, path });
      }
      out.sort((a, b) => (parseInt(a.s) || 999) - (parseInt(b.s) || 999) || String(a.s).localeCompare(String(b.s)));
      const nStops = stops.filter((s) => !s.location_type || s.location_type === '0').length;
      const endDate = end ? `${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}` : null;
      systems.push({ key: g.key, n: g.n, src: 'gtfs', url: g.url, licence: g.licence, licUrl: g.licUrl, stops: nStops, end: endDate, routes: out });
      log(`  ${g.n} (GTFS): ${out.length} routes, ${nStops} stops, ${byHeadway ? 'runs by headway' : `${out.reduce((s, r) => s + r.trips, 0)} trips on a Wednesday`}; timetable to ${endDate}`);
    } catch (e) { log(`  ${g.n}: GTFS failed (${e.message}); left out`); }
  }

  // --- bus routes in OpenStreetMap that no GTFS feed covers: intercity (spanning 40 km or more) or a town's own buses
  const gtfsOps = new RegExp(GTFS.map((g) => g.n).join('|'), 'i');
  const busOSM = await overpass('sk-bus-routes.json', `[out:json][timeout:240];rel["route"~"^(bus|coach)$"](${B})->.r;.r out geom qt;node(r.r);out tags qt;`);
  const nodeTags = new Map(busOSM.elements.filter((e) => e.type === 'node').map((e) => [e.id, e.tags ?? {}]));
  const busRoutes = [], busStops = [], localOSM = [];
  const seenBusWay = new Set();
  for (const r of busOSM.elements.filter((e) => e.type === 'relation')) {
    const t = r.tags ?? {};
    if (gtfsOps.test(`${t.operator ?? ''} ${t.network ?? ''}`)) continue;
    const ways = (r.members ?? []).filter((m) => m.type === 'way' && m.geometry);
    // a route mapped with its stops only (North Battleford's) is drawn stop to stop, in the relation's order
    const stopPts = (r.members ?? []).filter((m) => m.type === 'node' && m.lat != null).map((m) => [m.lon, m.lat]);
    const all = ways.length ? ways.flatMap((m) => m.geometry.map((g) => [g.lon, g.lat])) : stopPts.length >= 5 ? stopPts : [];
    if (!all.length) continue;
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    const span = distKm(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    const op = (t.operator ?? t.network ?? '').trim() || null;
    if (span >= 40) {
      let br = busRoutes.find((b) => b.op === op);
      if (!br) busRoutes.push((br = { op, names: [], web: t.website ?? null, paths: [] }));
      if (t.name && !br.names.includes(t.name)) br.names.push(t.name);
      for (const m of ways) {
        if (seenBusWay.has(m.ref)) continue;
        seenBusWay.add(m.ref);
        const pts = m.geometry.map((g) => [g.lon, g.lat]).filter(([x, y]) => near(x, y, 0.15));
        if (pts.length >= 2) br.paths.push(pts);
      }
      for (const m of r.members ?? []) {
        if (m.type !== 'node' || !/stop|platform/.test(m.role ?? '') || m.lat == null) continue;
        const nt = nodeTags.get(m.ref) ?? {};
        const n = (nt.name ?? '').trim();
        if (!near(m.lon, m.lat, 0.05) || busStops.some((s) => s.op === op && distKm(s.lon, s.lat, m.lon, m.lat) < 1)) continue;
        busStops.push({ n: n || null, op, lon: round(m.lon, 5), lat: round(m.lat, 5), osm: `node/${m.ref}` });
      }
    } else {
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const p = places.find((pl) => inTown(pl, cx, cy));
      if (!p || systems.some((s) => s.key === p.key)) continue;
      const path = ways.length ? joinPaths(ways.map((m) => m.geometry.map((g) => [g.lon, g.lat]))).sort((a, b) => b.length - a.length)[0] : stopPts;
      localOSM.push({ key: p.key, n: op, name: (t.name ?? '').trim() || (t.ref ? `Route ${t.ref}` : null), osm: `relation/${r.id}`, stops: stopPts.length, path: line(path, 0.0003) });
    }
  }
  for (const b of busRoutes) b.paths = joinPaths(b.paths).map((p) => line(p, 0.002)).filter((p) => p.length >= 2);
  for (const key of [...new Set(localOSM.map((l) => l.key))]) {
    const ls = localOSM.filter((l) => l.key === key);
    systems.push({ key, n: ls.find((l) => l.n)?.n ?? 'Town bus', src: 'osm', url: `https://www.openstreetmap.org/${ls[0].osm}`, licence: 'OpenStreetMap contributors (ODbL)', licUrl: 'https://www.openstreetmap.org/copyright', stops: ls.reduce((s, l) => s + l.stops, 0) || null, end: null,
      routes: ls.map((l) => ({ s: null, n: l.name ?? 'Bus route', c: null, trips: null, path: l.path })) });
  }
  log(`  OSM intercity bus: ${busRoutes.map((b) => `${b.op ?? 'unnamed'} (${b.names.length} routes)`).join(', ') || 'none'}; ${busStops.length} stops; OSM-only town buses: ${[...new Set(localOSM.map((l) => l.key))].join(', ') || 'none'}`);

  // --- per place
  const roadAir = airports.map((a, i) => ({ ...a, i }));
  const d = await driveTimes(places, roadAir, 'transit-air', { keep: 1 });
  const farNorth = [...new Set(Object.values(d.towns).map((v) => v[0] && roadAir[v[0].f]).filter((a) => a && a.lat > 57))];
  if (farNorth.length) log(`  warning: ${farNorth.map((a) => a.iata).join(', ')} (winter road or fly-in) came out nearest for some place`);
  const towns = {};
  for (const p of places) {
    const t = {};
    const tr = d.towns[p.key]?.[0];
    if (tr) t.air = { ...tr, f: roadAir[tr.f].i };
    const rs = stations.map((s, i) => (inTown(p, s.lon, s.lat) ? i : -1)).filter((i) => i >= 0);
    if (rs.length) t.rail = rs;
    const bs = busStops.map((s, i) => (inTown(p, s.lon, s.lat) ? i : -1)).filter((i) => i >= 0);
    if (bs.length) t.bus = bs;
    const sy = systems.findIndex((s) => s.key === p.key);
    if (sy >= 0) t.sys = sy;
    towns[p.key] = t;
  }
  const tally = (k) => Object.values(towns).filter((t) => t[k] != null).length;
  log(`  places with a VIA stop in town: ${tally('rail')}, an intercity bus stop: ${tally('bus')}, local transit: ${tally('sys')}`);

  await writeOut('transit', {
    airSource: 'OurAirports (ourairports.com, public domain): airports flagged with scheduled passenger service; positions and names from OpenStreetMap aerodromes (ODbL) with the same IATA code',
    railSource: 'OpenStreetMap contributors (ODbL): VIA Rail stations and stops (railway=station|halt, operator or network VIA) and VIA train routes, via Overpass',
    busSource: 'OpenStreetMap contributors (ODbL): bus route relations spanning 40 km or more (intercity) and their stops, via Overpass',
    transitSource: 'City GTFS feeds (Regina, Saskatoon, Moose Jaw, Prince Albert); OpenStreetMap bus routes for towns without a feed',
    routing: d.routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line',
    routingSource: d.routed ? 'Drive times: OSRM demo server, © OpenStreetMap contributors (ODbL)' : null,
    asOf: new Date().toISOString().slice(0, 10),
    airports, stations, railLines, busRoutes, busStops, systems, towns,
  });
}
