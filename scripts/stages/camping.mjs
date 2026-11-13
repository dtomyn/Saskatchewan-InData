import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { arcgisAll, overpass } from '../lib/apis.mjs';
import { BBOX, OSRM } from '../lib/config.mjs';
import { driveTimes, osrm } from '../lib/drive.mjs';
import { distKm, polys, ringArea } from '../lib/geo.mjs';
import { log, round, writeOut } from '../lib/io.mjs';
import { getPlaces, getProvince, inSask } from '../lib/places.mjs';

// Parks and campgrounds: the province's park, recreation site and regional park boundaries (Ministry of Parks, Culture
// and Sport), Parks Canada's campsites, and OpenStreetMap's camp sites; then the drive from each place to its nearest
// campground.
export default async function camping() {
  await getProvince();
  const places = await getPlaces();
  const now = Date.now();
  // capitalise each word; after an apostrophe only a longer run ("Qu'Appelle", not "Rowan'S")
  const title = (s) => s.toLowerCase().replace(/(^|[\s(\-/.'’])([a-z])([a-z]*)/g, (m, a, c, rest) => ((a === "'" || a === '’') && !rest ? m : a + c.toUpperCase() + rest))
    .replace(/\b(Of|And|The|At)\b(?!$)/g, (w, _, i) => (i ? w.toLowerCase() : w)).replace(/\bSt\b/g, 'St.');

  // --- parks (Saskatchewan's ParksAsTitled service: national, provincial, recreation sites, historic sites, regional)
  const PT = 'https://gis.saskatchewan.ca/arcgis/rest/services/ParksAsTitled/MapServer';
  const SUB = { NE: 'natural environment', RP: 'recreation', WP: 'wilderness', HP: 'historic' };
  const geo = { maxAllowableOffset: '0.002' };
  const parks = [];
  const addPark = (f, type, name, extra = {}) => {
    if (!f.geometry) return;
    const ps = polys(f.geometry, 0.002);
    if (!ps.length) return;
    const ring = ps.map((p) => p[0]).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
    const c = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
    if (!inSask(c[0], c[1], 0.05)) return;
    const ha = ps.reduce((a, p) => a + Math.abs(ringArea(p[0])) * 111.32 * 111.32 * Math.cos((c[1] * Math.PI) / 180) * 100, 0);
    parks.push({ name, type, ...extra, c: [round(c[0], 3), round(c[1], 3)], ha: Math.round(ha), polys: ps });
  };
  for (const f of await arcgisAll(`${PT}/0`, { where: '1=1', outFields: 'PARKNM', ...geo }, 'parks-national'))
    addPark(f, /HISTORIC/.test(f.properties.PARKNM) ? 'historic' : 'national', title(f.properties.PARKNM), { by: 'Parks Canada' });
  for (const f of await arcgisAll(`${PT}/1`, { where: '1=1', outFields: 'PARKNM,PARKTYPE', ...geo }, 'parks-provincial'))
    addPark(f, 'provincial', title(f.properties.PARKNM), { sub: SUB[f.properties.PARKTYPE] ?? null });
  for (const f of await arcgisAll(`${PT}/2`, { where: '1=1', outFields: 'PARKNM', ...geo }, 'parks-recsites'))
    addPark(f, 'recreation', title(f.properties.PARKNM));
  for (const f of await arcgisAll(`${PT}/5`, { where: '1=1', outFields: 'PARKNM', ...geo }, 'parks-historic'))
    addPark(f, 'historic', title(f.properties.PARKNM));
  let dissolved = 0;
  for (const f of await arcgisAll(`${PT}/6`, { where: '1=1', outFields: 'PARK_NAME,SECONDARY_NAME,EXPIRY_DATE,SRPA_CONTACT', ...geo }, 'parks-regional')) {
    const p = f.properties;
    // regional parks that have been dissolved keep their record with an expiry date: leave those out
    if (p.EXPIRY_DATE && p.EXPIRY_DATE < now) { dissolved++; continue; }
    addPark(f, 'regional', p.PARK_NAME.trim(), p.SRPA_CONTACT && /^https?:\/\//.test(p.SRPA_CONTACT) ? { web: p.SRPA_CONTACT.trim() } : {});
  }
  parks.sort((a, b) => b.ha - a.ha);
  const count = (k) => parks.filter((p) => p.type === k).length;
  log(`  parks: ${count('national')} national, ${count('provincial')} provincial, ${count('recreation')} recreation sites, ${count('historic')} historic, ${count('regional')} regional (${dissolved} dissolved left out)`);
  const parkAt = (lon, lat) => {
    // smallest park containing the point, so a rec site inside a bigger park wins
    let best = -1;
    parks.forEach((p, i) => {
      if (p.polys.some((poly) => booleanPointInPolygon([lon, lat], { type: 'Polygon', coordinates: poly })) && (best < 0 || p.ha < parks[best].ha)) best = i;
    });
    return best < 0 ? null : best;
  };

  // --- Parks Canada: individual campsites, grouped here into campgrounds
  const PC = 'https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services';
  const env = { geometry: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' };
  const sites = (await arcgisAll(`${PC}/vw_Accommodation_Hebergement_V2_FGP/FeatureServer/0`, { where: '1=1', outFields: 'Name_e,URL_f,Accommodation_Type', ...env }, 'pc-accommodation'))
    .filter((f) => f.geometry && inSask(...f.geometry.coordinates, 0.01));
  const facil = (await arcgisAll(`${PC}/vw_Facilities_Installations_Point_V2_FGP/FeatureServer/0`, { where: "Facility_Type_Installation LIKE 'Front%'", outFields: 'Name_e,Facility_Type_Installation', ...env }, 'pc-campgrounds'))
    .filter((f) => f.geometry && f.properties.Name_e);
  // a site's code is park-campground-site ("PA-BG-A12"): group by park-campground and name, then split far-apart sites
  const groups = new Map();
  for (const f of sites) {
    const p = f.properties;
    const code = (p.URL_f ?? '').replace(/-[^-]*$/, '');
    const k = `${code}|${p.Name_e ?? ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  const pcCamps = [];
  for (const [k, fs] of groups) {
    const clusters = [];
    for (const f of fs) {
      const [lon, lat] = f.geometry.coordinates;
      const c = clusters.find((c) => c.some((g) => distKm(lon, lat, ...g.geometry.coordinates) < 1.5));
      if (c) c.push(f); else clusters.push([f]);
    }
    for (const c of clusters) {
      const lon = c.reduce((a, f) => a + f.geometry.coordinates[0], 0) / c.length, lat = c.reduce((a, f) => a + f.geometry.coordinates[1], 0) / c.length;
      const types = c.map((f) => f.properties.Accommodation_Type ?? '');
      const back = /-BC$/.test(k.split('|')[0]) || types.some((t) => /backcountry/i.test(t));
      const group = types.every((t) => /group/i.test(t));
      const near = facil.map((f) => ({ f, d: distKm(lon, lat, ...f.geometry.coordinates) })).sort((a, b) => a.d - b.d)[0];
      pcCamps.push({
        // a backcountry site only takes a front-country campground's name when it is right at it
        name: c[0].properties.Name_e?.trim() || (near && near.d < (back ? 0.3 : 1.5) ? near.f.properties.Name_e.trim() : null),
        kind: back ? 'backcountry' : group ? 'group' : 'campground',
        sites: c.length, otentik: types.filter((t) => /otentik/i.test(t)).length || undefined,
        lon: round(lon, 4), lat: round(lat, 4), src: 'pc',
      });
    }
  }
  // oTENTiks are their own group in the source: fold them into the campground they stand in
  for (const c of pcCamps.filter((c) => c.otentik && c.otentik === c.sites)) {
    const host = pcCamps.find((h) => h !== c && h.kind === 'campground' && !h.otentik && distKm(c.lon, c.lat, h.lon, h.lat) < 1.5);
    if (host) { host.otentik = c.otentik; host.sites += c.sites; c.drop = true; }
  }
  // one campground filed under two codes (Rock Creek's accessible site): fold the smaller into the larger
  for (const c of [...pcCamps].sort((a, b) => a.sites - b.sites)) {
    if (c.drop || !c.name) continue;
    const host = pcCamps.find((h) => h !== c && !h.drop && h.name === c.name && h.kind === c.kind && h.sites >= c.sites && distKm(c.lon, c.lat, h.lon, h.lat) < 1.5);
    if (host) { host.sites += c.sites; if (c.otentik) host.otentik = (host.otentik ?? 0) + c.otentik; c.drop = true; }
  }
  log(`  Parks Canada: ${sites.length} campsites in ${pcCamps.filter((c) => !c.drop).length} campgrounds and backcountry sites`);

  // --- OpenStreetMap camp sites and RV parks
  const osm = await overpass('sk-camping.json', `[out:json][timeout:240];(nwr["tourism"~"^(camp_site|caravan_site)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center tags qt;`);
  const osmCamps = [];
  for (const e of osm.elements) {
    const t = e.tags ?? {};
    const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
    if (lon == null || !inSask(lon, lat, 0.01)) continue;
    if (/^(private|no)$/.test(t.access ?? '')) continue;
    const name = (t.name ?? '').trim() || null;
    const dupe = osmCamps.find((c) => distKm(lon, lat, c.lon, c.lat) < (name && c.name === name ? 2 : 0.15));
    if (dupe) continue;
    const kind = t.backcountry === 'yes' ? 'backcountry' : t.group_only === 'yes' ? 'group' : t.tourism === 'caravan_site' ? 'rv' : 'campground';
    const cap = Number.parseInt(t.capacity, 10);
    const web = [t.website, t['contact:website'], t.url].find((u) => u && /^https?:\/\//.test(u.trim()));
    osmCamps.push({
      name, kind, sites: Number.isFinite(cap) && cap > 0 ? cap : undefined,
      op: (t.operator ?? '').trim() || undefined,
      power: t.power_supply ? t.power_supply !== 'no' : undefined,
      fee: t.fee ? t.fee !== 'no' : undefined,
      web: web?.trim(), lon: round(lon, 4), lat: round(lat, 4), src: 'osm', osm: `${e.type}/${e.id}`,
    });
  }
  // where both sources have a campground, keep Parks Canada's (it counts the sites) and borrow OSM's name and link
  let merged = 0;
  for (const c of pcCamps) {
    if (c.drop) continue;
    const o = osmCamps.find((o) => !o.drop && distKm(c.lon, c.lat, o.lon, o.lat) < (c.kind === 'backcountry' ? 0.3 : 1.2));
    if (!o) continue;
    c.name ??= o.name;
    if (o.web) c.web ??= o.web;
    c.osm = o.osm;
    o.drop = true;
    merged++;
  }
  const camps = [...pcCamps, ...osmCamps].filter((c) => !c.drop).map(({ drop, ...c }) => c);
  for (const c of camps) {
    const p = parkAt(c.lon, c.lat);
    if (p != null) c.p = p;
    if (!c.name) c.name = c.kind === 'backcountry' ? 'Backcountry campsite' : c.kind === 'rv' ? 'RV park' : 'Campground';
    for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
  }
  camps.sort((a, b) => b.lat - a.lat);
  log(`  OSM: ${osmCamps.length} camp sites (${merged} matched to Parks Canada); ${camps.length} on the map, ${camps.filter((c) => c.p != null).length} inside a park`);

  // --- drive from each place to its nearest campground you can drive to
  const driveable = camps.map((c, i) => ({ ...c, i })).filter((c) => c.kind !== 'backcountry');
  const d = await driveTimes(places, driveable, 'camp', { keep: 1 });
  const towns = Object.fromEntries(Object.entries(d.towns).map(([k, v]) => [k, v.map((t) => ({ ...t, f: driveable[t.f].i }))]));

  // --- Weekend reach: from each place, the drive to every campground within REACH_MIN, in one OSRM table call per place
  // (the demo server takes up to 100 coordinates, so the 99 nearest in a straight line are the candidates; the farthest
  // of those is checked against REACH_MIN so a place never silently loses campgrounds it could reach)
  const REACH_MIN = 240;
  const reach = {};
  let reachRouted = d.routed, clipped = 0;
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  for (const p of places) {
    // nothing more than 4 h away can be closer than ~400 km in a straight line
    const near = driveable.map((c) => ({ c, d: distKm(p.lon, p.lat, c.lon, c.lat) })).filter((n) => n.d <= 400).sort((a, b) => a.d - b.d);
    let rows = null;
    if (reachRouted) {
      try {
        rows = [];
        // pages of 99 destinations, nearest first, until a page's farthest campground is already out of reach
        for (let at = 0; at < near.length; at += 99) {
          const page = near.slice(at, at + 99);
          const coords = [p, ...page.map((n) => n.c)].map((x) => `${x.lon},${x.lat}`).join(';');
          const tb = await osrm(`campreach-${p.key.replace(/ /g, '_')}-${hash(coords)}`, `${OSRM}/table/v1/driving/${coords}?sources=0&annotations=duration`);
          if (tb.code !== 'Ok') throw new Error(tb.message ?? tb.code);
          const got = page.map((n, j) => [n.c.i, tb.durations[0][j + 1] == null ? null : Math.round(tb.durations[0][j + 1] / 60)]);
          rows.push(...got.filter((r) => r[1] != null && r[1] <= REACH_MIN));
          if (!got.some((r) => r[1] != null && r[1] <= REACH_MIN)) break;
          if (at + 99 < near.length) clipped++;
        }
      } catch (e) { log(`  reach: OSRM unavailable (${e.message}); straight-line reach from here on`); reachRouted = false; rows = null; }
    }
    // without routing, a rough reach: 80 km/h along a road 1.3× the straight line
    rows ??= near.map((n) => [n.c.i, Math.round((n.d * 1.3) / 80 * 60)]).filter((r) => r[1] <= REACH_MIN);
    reach[p.key] = rows.sort((a, b) => a[1] - b[1]);
  }
  const medReach = Object.values(reach).map((r) => r.filter((x) => x[1] <= 120).length).sort((a, b) => a - b);
  log(`  reach: median place has ${medReach[medReach.length >> 1]} campgrounds within 2 h (${clipped} extra table pages for places with more than 99 candidates)`);

  await writeOut('camping', {
    source: 'Government of Saskatchewan, Ministry of Parks, Culture and Sport: ParksAsTitled (provincial and national parks, recreation sites, historic sites, regional parks); Parks Canada, Accommodation and Facilities (Open Government Licence – Canada); OpenStreetMap contributors (tourism=camp_site, caravan_site; ODbL)',
    routing: d.routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line',
    routingSource: d.routed ? 'Drive times: OSRM demo server, © OpenStreetMap contributors (ODbL)' : null,
    asOf: new Date().toISOString().slice(0, 10),
    reachRouted, reachMax: REACH_MIN,
    parks, camps, towns, reach,
  });
}
