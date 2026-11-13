import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { driveTimes } from '../lib/drive.mjs';
import { distKm, edgeKm } from '../lib/geo.mjs';
import { cached, fetchBuf, log, readOut, round, writeOut } from '../lib/io.mjs';
import { getPlaces, getProvince, getSmallPlaces, inSask, smallAreas, straightTimes } from '../lib/places.mjs';
import { normalizeName } from '../places.mjs';

// Childcare: the Ministry of Education's regulated child care facilities, as listed on saskatchewan.ca's "Find a child
// care provider" page. The page is plain HTML: one <li> per facility (type and options, name, address, phone) and a
// `window.pageList = [{lat, lng}, …]` array in the same order. Both are read as text, never run. Centres keep their
// name and point; family child care homes are people's homes, so only a count per community is kept, at a rounded
// point. The list gives no licensed capacity (spaces). Crown copyright: non-commercial reproduction only.
export default async function childcare() {
  await getProvince();
  const places = await getPlaces();
  const URL_ = 'https://www.saskatchewan.ca/residents/family-and-social-support/child-care/find-a-child-care-provider-in-my-community';
  const html = (await cached('childcare/find-a-child-care-provider.html', async () => {
    const b = await fetchBuf(URL_, { headers: { 'User-Agent': 'Mozilla/5.0 (LivingSkiesAtlas open-data build script)', Accept: 'text/html' } });
    if (!/window\.pageList\s*=/.test(b.toString('utf8'))) throw new Error('child care page: no facility list found');
    return b;
  })).toString('utf8');
  const decode = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/�/g, '–').replace(/\s+/g, ' ').trim();
  const list = html.slice(html.indexOf('class="map-result"'));
  const items = [...list.matchAll(/<li>\s*([\s\S]*?)<br \/>\s*<strong>([\s\S]*?)<\/strong><br \/>\s*([\s\S]*?)<br \/>/g)]
    .map((m) => ({ tags: decode(m[1]), name: decode(m[2]), addr: decode(m[3]) }));
  const pts = JSON.parse(html.match(/window\.pageList\s*=\s*(\[[\s\S]*?\]);/)[1]);
  if (!items.length || items.length !== pts.length) throw new Error(`child care page: ${items.length} facilities but ${pts.length} points`);
  // the community: the address part before ", SK"
  // (a few addresses have no comma before the community: keep what follows the last street word)
  const STREET = /^.*\b(street|st|avenue|ave|crescent|cres|drive|dr|road|rd|boulevard|blvd|way|lane|place|court|bay|highway|hwy|trail|terrace|green|close)\.?\s+(?=[A-Z])/i;
  const cityOf = (a) => {
    const m = a.replace(/\s*\(.*?\)/g, '').match(/([^,]+),?\s+SK\b/i);
    if (!m) return null;
    const c = m[1].replace(/^(box|po box|p\.o\. box)\s+\d+\s*/i, '').trim();
    const city = (/\d/.test(c) ? c.replace(STREET, '').replace(/^.*\d\S*\s+/, '') : c).trim();
    // a street with no community after it ("Delainey Road, SK") is no community
    return !city || /\b(street|st|avenue|ave|crescent|cres|drive|dr|road|rd|boulevard|blvd|way|lane|place|court|bay|trail|terrace|green|close)\.?$/i.test(city) ? null : city;
  };
  // centre or home: the listed type; when the page gives none, a name like an organisation is a centre, a person's name a home (inferred)
  const ORG = /cent(re|er)|day ?care|child|early|learn|kid|tot|preschool|nursery|montessori|academy|school|inc\b|ltd|corp|society|association|co-?op|ymca|ywca|program|head ?start|nation|band|club|play|little|sunshine|rainbow|daycare|care\b|families|family centre|university|college/i;
  const centres = [], homes = [];
  let inferred = 0, noPoint = 0;
  items.forEach((it, i) => {
    const t = it.tags.toLowerCase();
    const isCentre = /\bcentre\b/.test(t.replace(/teen parent infant centre/, 'centre')) ? true : /\bhome\b/.test(t) ? false : (inferred++, ORG.test(it.name));
    let lon = pts[i]?.lng, lat = pts[i]?.lat;
    if (lon == null || lat == null || !inSask(lon, lat, 0.05)) { noPoint++; lon = lat = null; }
    const flags = {};
    if (/infants/.test(t)) flags.i = 1;
    if (/francophone/.test(t)) flags.f = 1;
    if (/24 hours|extended hours/.test(t)) flags.x = 1;
    if (/teen parent/.test(t)) flags.t = 1;
    const city = cityOf(it.addr);
    if (isCentre) centres.push({ n: it.name.replace(/\s+\.$/, ''), city, lon, lat, ...flags });
    else homes.push({ city, lon, lat, g: /group family/.test(t) ? 1 : 0, ...flags });
  });
  log(`  ${items.length} regulated facilities: ${centres.length} centres, ${homes.length} family child care homes (${inferred} with no type listed, classed by name), ${noPoint} with no point`);

  // --- in town: inside the place's limits (needs.json) or within its slack, like Daily needs
  let needs = null;
  try { needs = await readOut('needs'); } catch { log('  needs.json missing: run the needs stage for town limits'); }
  const sAreas = await smallAreas();
  const inTown = (p, s) => {
    const a = p.tier === 2 ? sAreas[p.key] : needs?.areas?.[p.key];
    if (a?.length) {
      if (Math.abs(s.lat - p.lat) > 0.3 || Math.abs(s.lon - p.lon) > 0.45) return false;
      const geom = { type: 'MultiPolygon', coordinates: a };
      return booleanPointInPolygon([s.lon, s.lat], { type: 'Feature', properties: {}, geometry: geom }) || edgeKm(s.lon, s.lat, geom) <= (needs?.slackKm ?? 1);
    }
    return distKm(p.lon, p.lat, s.lon, s.lat) <= (needs?.fallbackKm ?? 3);
  };
  // The ministry's points are approximate and some are far off (Unity's daycare sits 39 km north of town). A facility
  // whose address is in one of the atlas's places but whose point is outside it, or missing, moves to that place's
  // centre (`approx`). Others with no point are dropped.
  const byKey = new Map(places.map((p) => [p.key, p]));
  let snapped = 0;
  for (const f of [...centres, ...homes]) {
    const p = f.city ? byKey.get(normalizeName(f.city)) : null;
    if (p && (f.lon == null || !inTown(p, f))) { Object.assign(f, { lon: p.lon, lat: p.lat, approx: 1 }); snapped++; }
  }
  for (const list of [centres, homes]) for (let j = list.length - 1; j >= 0; j--) if (list[j].lon == null) list.splice(j, 1);
  for (const c of centres) { c.lon = round(c.lon, 5); c.lat = round(c.lat, 5); }
  log(`  ${snapped} facilities in the atlas's places moved to their town's centre (point outside town or missing); ${centres.length} centres and ${homes.length} homes kept`);

  // homes, grouped by community at a point rounded to 0.02° (about 2 km), so no home address is published
  const groups = new Map();
  for (const h of homes) {
    const k = normalizeName(h.city ?? `${round(h.lon, 1)},${round(h.lat, 1)}`);
    const g = groups.get(k) ?? { city: h.city, lons: [], lats: [], n: 0, g: 0, i: 0 };
    g.lons.push(h.lon); g.lats.push(h.lat); g.n++; g.g += h.g; g.i += h.i ?? 0;
    groups.set(k, g);
  }
  const r2 = (v) => Math.round(v * 50) / 50, mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const homeSites = [...groups.values()].map((g) => ({ city: g.city, lon: r2(mean(g.lons)), lat: r2(mean(g.lats)), n: g.n, g: g.g, i: g.i }));
  log(`  homes grouped into ${homeSites.length} communities (${homeSites.filter((h) => !h.city).length} with no community in the address)`);
  centres.sort((a, b) => b.lat - a.lat);
  const towns = Object.fromEntries(places.map((p) => {
    const c = centres.filter((s) => inTown(p, s)), h = homes.filter((s) => inTown(p, s)); // homes at their own points, never published
    return [p.key, { nc: c.length, nh: h.length, ni: c.filter((s) => s.i).length + h.filter((s) => s.i).length }];
  }));
  // drives: the nearest centre (`c`), and the nearest licensed care of any kind (`a`: a centre or a community's homes)
  // A centre moved to its town's centre is not a drive target (the drive would be a guess); a place whose only centres
  // in town were moved gets one of them as "in town" (0 min) instead.
  const real = centres.map((s, i) => ({ lon: s.lon, lat: s.lat, i, approx: s.approx })).filter((s) => !s.approx);
  const any = [...real.map((s) => ({ ...s, h: 0 })), ...homeSites.map((s, i) => ({ lon: s.lon, lat: s.lat, i, h: 1 }))];
  let routed = true;
  const dc = await driveTimes(places, real, 'childcare-c', { keep: 1 });
  routed &&= dc.routed;
  for (const [key, v] of Object.entries(dc.towns)) if (v[0]) towns[key].c = { ...v[0], f: real[v[0].f].i };
  const da = await driveTimes(places, any, 'childcare-a', { keep: 1 });
  routed &&= da.routed;
  for (const [key, v] of Object.entries(da.towns)) if (v[0]) { const t = any[v[0].f]; towns[key].a = { ...v[0], f: t.i, h: t.h }; }
  for (const p of places) {
    if (centres.some((s) => !s.approx && inTown(p, s))) continue;
    const j = centres.findIndex((s) => s.approx && inTown(p, s));
    if (j >= 0) { towns[p.key].c = { f: j, min: 0, km: 0 }; towns[p.key].a = { f: j, min: 0, km: 0, h: 0 }; }
  }
  const none = places.filter((p) => !towns[p.key].nc).map((p) => p.name);
  log(`  ${places.length - none.length} of ${places.length} places have a licensed centre in town${none.length ? `; none: ${none.join(', ')}` : ''}`);
  // tier 2: counts in town; the nearest centre and nearest licensed care by straight line (min null)
  const smallP = await getSmallPlaces();
  const small = Object.fromEntries(smallP.map((p) => {
    const c = centres.filter((s) => s.lon != null && inTown(p, s)), h = homes.filter((s) => inTown(p, s));
    return [p.key, { nc: c.length, nh: h.length, ni: c.filter((s) => s.i).length + h.filter((s) => s.i).length }];
  }));
  for (const [key, v] of Object.entries(straightTimes(smallP, real))) if (v[0]) small[key].c = { ...v[0], f: real[v[0].f].i };
  for (const [key, v] of Object.entries(straightTimes(smallP, any))) if (v[0]) { const t = any[v[0].f]; small[key].a = { ...v[0], f: t.i, h: t.h }; }
  log(`  tier 2: ${smallP.filter((p) => small[p.key].nc).length} of ${smallP.length} small communities have a licensed centre in town`);

  await writeOut('childcare', {
    source: 'Government of Saskatchewan, Ministry of Education: regulated child care facilities (saskatchewan.ca, “Find a child care provider in my community”)',
    sourceUrl: URL_,
    licence: '© Government of Saskatchewan (Crown copyright). Materials may be reproduced for non-commercial purposes, accurately and not as an official version; information identifying private citizens may not be used without their permission',
    licenceUrl: 'https://www.saskatchewan.ca/copyright',
    areaSource: needs?.areaSource ?? null,
    routing: routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line',
    routingSource: routed ? 'Drive times: OSRM demo server, © OpenStreetMap contributors (ODbL)' : null,
    // the provincial list has no licensed capacity; spaces are published only as provincial totals
    spaces: null,
    asOf: new Date().toISOString().slice(0, 10),
    slackKm: needs?.slackKm ?? 1, fallbackKm: needs?.fallbackKm ?? 3,
    // `small`: tier-2 communities; their nearest centre and care are straight-line distances (min null)
    centres, homes: homeSites, towns, small,
  });
}
