import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { arcgisAll, overpass } from '../lib/apis.mjs';
import { BBOX } from '../lib/config.mjs';
import { driveTimes } from '../lib/drive.mjs';
import { distKm, edgeKm } from '../lib/geo.mjs';
import { log, readOut, round, writeOut } from '../lib/io.mjs';
import { getPlaces, getProvince, getSmallPlaces, inSask, smallAreas, straightTimes } from '../lib/places.mjs';
import { normalizeName } from '../places.mjs';

// Schools & learning: the Ministry of Education's K-12 schools (public, separate, Fransaskois and First Nations band
// schools) and the Ministry of Advanced Education's post-secondary institutions, both from the Saskatchewan GeoHub,
// with Saskatchewan Polytechnic and university campuses the ministry list lacks added from OpenStreetMap. Then the drive
// from each place to its nearest elementary school, high school, French-language or French immersion school and
// post-secondary campus. Reads needs.json for the town limits behind "schools in town".
export default async function schools() {
  await getProvince();
  const places = await getPlaces();
  const ED = 'https://gis.saskatchewan.ca/arcgis/rest/services/Education';
  const fixName = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/�/g, '’').trim();

  // --- K-12. The ministry layers state no grades except for band schools, so a provincial school's grades come from
  // its name: "High", "Collegiate", "Composite", "Comprehensive", "Secondary", "secondaire" → high school; "Elementary",
  // "Middle", "Junior", "Primary", "Junior High" → elementary or middle. A name that says neither is '?' (grades not
  // stated) and counts as an elementary school; it also counts as a high school (inferred K-12, `gi`) when no school
  // that states high-school grades is within INFER_KM, as in most small towns with one school.
  const INFER_KM = 10;
  const LAYERS = [{ id: 2, s: 'pub' }, { id: 3, s: 'sep' }, { id: 4, s: 'fr' }, { id: 5, s: 'fn' }];
  const level = (name) => (/\bjunior high\b|\b(elementary|middle|primary|junior)\b|\bél[ée]mentaire\b/i.test(name) ? 'e'
    : /\b(high|collegiate|composite|comprehensive|secondary)\b|\bsecondaire\b/i.test(name) ? 'h' : '?');
  const bandLevel = (lo, hi) => {
    const g = (x) => (x === 'K' || x === 'P' ? 0 : Number(x));
    const a = g(lo), b = g(hi);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return '?';
    return b >= 12 ? (a <= 6 ? 'k' : 'h') : 'e';
  };
  const schools = [];
  for (const L of LAYERS) {
    const fs_ = await arcgisAll(`${ED}/SchoolsAndDivisions/MapServer/${L.id}`, { where: '1=1', outFields: '*' }, `ed-schools-${L.id}`);
    for (const f of fs_) {
      const a = f.properties ?? {};
      const [lon, lat] = f.geometry?.coordinates ?? [];
      if (lon == null || !inSask(lon, lat, 0.05)) continue;
      const n = fixName(a.SCH_NAME);
      if (!n) continue;
      const prog = String(a.PROG_TYPE ?? '');
      const imm = [...prog.matchAll(/(\w+) Immersion/g)].map((m) => m[1]);
      const sc = { n, s: a.SCH_INDEPENDENT === 'Y' ? 'ind' : L.s, lon: round(lon, 5), lat: round(lat, 5) };
      if (L.s === 'fn') {
        sc.g = bandLevel(a.ENROL_GR_LOWEST, a.ENROL_GR_HIGHEST);
        if (a.ENROL_GR_LOWEST && a.ENROL_GR_HIGHEST) sc.gr = `${a.ENROL_GR_LOWEST}–${a.ENROL_GR_HIGHEST}`;
        sc.div = fixName(a.BAND_PARTNER_NAME || a.TC_PARTNER_NAME) || null;
        if (a.GEO_NAME) sc.at = fixName(a.GEO_NAME);
      } else {
        sc.g = level(n);
        sc.div = fixName(a.SD_NAME) || null;
        if (a.SCH_HUTTERITE === 'Y') sc.col = 1;
        if (imm.length) sc.imm = imm;
        if (L.s === 'fr') sc.fr = 1;
      }
      const e = Number(a.ENROL_K_12);
      if (Number.isFinite(e) && e > 0) sc.e = e;
      schools.push(sc);
    }
  }
  // --- schools in town: inside the place's limits (needs.json) or within the same slack, like Daily needs
  let needs = null;
  try { needs = await readOut('needs'); } catch { log('  needs.json missing: run the needs stage for "schools in town"'); }
  const sAreas = await smallAreas();
  const inTown = (p, s) => {
    const a = p.tier === 2 ? sAreas[p.key] : needs?.areas?.[p.key];
    if (a?.length) {
      if (p.tier === 2 && (Math.abs(s.lat - p.lat) > 0.3 || Math.abs(s.lon - p.lon) > 0.45)) return false;
      const geom = { type: 'MultiPolygon', coordinates: a };
      return booleanPointInPolygon([s.lon, s.lat], { type: 'Feature', properties: {}, geometry: geom }) || edgeKm(s.lon, s.lat, geom) <= (needs?.slackKm ?? 1);
    }
    return distKm(p.lon, p.lat, s.lon, s.lat) <= (needs?.fallbackKm ?? 3);
  };

  // The ministry's GeoHub layers place about a third of schools 1–20 km from the building (rural ones often at a
  // land-survey or post-office point) and miss many (Estevan has none; Kindersley, Rosetown and Unity lack their high
  // schools). So: a listed school takes the position of the OpenStreetMap school with the same name within 30 km; and
  // OpenStreetMap schools that match no listed school, lie inside one of the atlas's places (its town limits, as Daily
  // needs counts them) and 300 m or more from every school already kept are added, named or not; outside the towns,
  // OpenStreetMap's many mapped one-room schoolhouses of the homestead era would pass for schools. Their sector is 'osm' (not stated) unless the operator or name says Catholic / separate; they never
  // count as French. Private, religious, colony, college and pre-school sites are left out.
  const official = schools.length;
  const osmS = await overpass('sk-schools.json', `[out:json][timeout:240];(nwr["amenity"="school"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center tags qt;`);
  const SKIP = /colony|bible|islamic|christian|adventist|mennonite|montessori|academy|refuge|ranch ehrlo|success cent|college|polytech|university|pre-?school|daycare|nursery|driving|education centre|learning centre|alternate|alternative|youth|correctional/i;
  const key_ = (n) => normalizeName(n).replace(/[^a-z0-9 ]/g, ' ').replace(/(school|elementary|elementry|high|composite|composit|community|central|public|the|ecole)/g, '').replace(/\s+/g, ' ').trim();
  const osmList = [];
  for (const e of osmS.elements) {
    const t = e.tags ?? {};
    const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
    const n = fixName(t.name);
    if (lon == null || !inSask(lon, lat, 0.02) || (n && SKIP.test(n)) || /^(private|religious)$/.test(t['operator:type'] ?? '')) continue;
    if (t.historic || t.disused || t.abandoned || /^(ruins|historic)$/.test(t.building ?? '') || /historic|former|old /i.test(n)) continue;
    osmList.push({ t, n, k: n ? key_(n) : null, lon, lat, id: `${e.type}/${e.id}`, used: false });
  }
  let snapped = 0;
  for (const s of schools.slice(0, official)) {
    const k = key_(s.n);
    const m = k ? osmList.filter((o) => o.k === k).map((o) => ({ o, d: distKm(o.lon, o.lat, s.lon, s.lat) })).filter((x) => x.d < 30).sort((a, b) => a.d - b.d)[0] : null;
    if (!m) continue;
    m.o.used = true;
    if (m.d > 0.3) { s.lon = round(m.o.lon, 5); s.lat = round(m.o.lat, 5); snapped++; }
  }
  for (const o of osmList.sort((a, b) => (b.n ? 1 : 0) - (a.n ? 1 : 0))) {
    if (o.used || !places.some((p) => inTown(p, o)) || schools.some((s) => distKm(s.lon, s.lat, o.lon, o.lat) < 0.3)) continue;
    const n = o.n || 'School (unnamed in OpenStreetMap)';
    const g = /^k-?12$|^0-12$/i.test(o.t.grades ?? '') ? 'k' : /^(7|8|9|10)-12$/.test(o.t.grades ?? '') ? 'h' : o.n ? level(n) : '?';
    const sep = /catholic|separate/i.test(`${o.t.operator ?? ''} ${o.n}`);
    schools.push({ n, s: sep ? 'sep' : 'osm', g, lon: round(o.lon, 5), lat: round(o.lat, 5), div: fixName(o.t.operator) || null, osm: o.id });
  }
  log(`  ${snapped} listed schools moved to their OpenStreetMap position; ${schools.length - official} schools added from OpenStreetMap (${schools.filter((s) => s.osm && s.n.startsWith('School (unnamed')).length} unnamed)`);
  // schools any family in town can attend: not Hutterite colony schools (for colony children), not band schools
  // (on reserve, for the band's children) and not independent schools
  const open = (s) => !s.col && (s.s === 'pub' || s.s === 'sep' || s.s === 'fr' || s.s === 'osm');
  const statesHigh = schools.filter((s) => open(s) && (s.g === 'h' || s.g === 'k'));
  for (const s of schools) if (s.g === '?' && open(s) && !statesHigh.some((h) => distKm(s.lon, s.lat, h.lon, h.lat) <= INFER_KM)) s.gi = 1;
  schools.sort((a, b) => b.lat - a.lat);
  const tally = (pred) => schools.filter(pred).length;
  log(`  ${schools.length} K-12 schools: ${tally((s) => s.s === 'osm')} OpenStreetMap only, ${tally((s) => s.s === 'pub')} public, ${tally((s) => s.s === 'sep')} separate, ${tally((s) => s.s === 'fr')} Fransaskois, ${tally((s) => s.s === 'fn')} First Nations, ${tally((s) => s.s === 'ind')} independent; ${tally((s) => s.col)} Hutterite colony schools`);
  log(`  grades: ${tally((s) => s.g === 'e')} elementary/middle, ${tally((s) => s.g === 'h')} high, ${tally((s) => s.g === 'k')} K-12 (stated), ${tally((s) => s.g === '?')} not stated (${tally((s) => s.gi)} inferred K-12); ${tally((s) => s.imm?.includes('French'))} French immersion`);

  // --- post-secondary (Ministry of Advanced Education institutions), by governing institution
  const KIND = { University: 'uni', 'Federated College': 'uni', 'Affiliated College': 'uni', FNUC: 'uni', 'Sask Polytechnic': 'poly', SIIT: 'poly', 'GDI/DTI': 'poly', 'Post Secondary': 'col' };
  const inst = await arcgisAll(`${ED}/AdvancedEducation/MapServer/0`, { where: '1=1', outFields: 'FACILITY_N,GOVERNANCE,CITY,PSETYPE' }, 'ae-institutions');
  const pse = [];
  for (const f of inst) {
    const a = f.properties ?? {};
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (lon == null || !inSask(lon, lat, 0.1)) continue;
    const k = KIND[a.PSETYPE] ?? 'col';
    const name = fixName(a.GOVERNANCE).replace(/^SIIT$/, 'Saskatchewan Indian Institute of Technologies (SIIT)') || (a.PSETYPE === 'University' ? 'University of Regina' : fixName(a.PSETYPE));
    const city = fixName(a.CITY).replace(/^Lloydminister AB$/, 'Lloydminster').replace(/^Moosimin$/, 'Moosomin').replace(/^Munester$/, 'Muenster') || null;
    if (pse.some((p) => p.n === name && distKm(p.lon, p.lat, lon, lat) < 0.3)) continue;
    pse.push({ n: name, k, city, lon: round(lon, 5), lat: round(lat, 5), src: 'ae' });
  }
  const aeCount = pse.length;
  // campuses the ministry list lacks (it has one Saskatchewan Polytechnic campus): OpenStreetMap's universities and
  // colleges named for Saskatchewan Polytechnic or the two universities, unless a listed site is already there
  const osm = await overpass('sk-pse.json', `[out:json][timeout:240];(nwr["amenity"~"^(university|college)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center tags qt;`);
  const BODIES = [
    { re: /saskatchewan polytechnic|sask ?polytech|siast/i, n: 'Saskatchewan Polytechnic', k: 'poly' },
    { re: /^university of regina\b/i, n: 'University of Regina', k: 'uni' },
    { re: /^university of saskatchewan\b/i, n: 'University of Saskatchewan', k: 'uni' },
  ];
  for (const e of osm.elements) {
    const t = e.tags ?? {};
    const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
    if (lon == null || !inSask(lon, lat, 0.05)) continue;
    const b = BODIES.find((x) => x.re.test(t.name ?? ''));
    // the same body within 2 km (a second outline of one campus), or any listed site within 600 m
    if (!b || pse.some((p) => (p.n === b.n && distKm(p.lon, p.lat, lon, lat) < 2) || distKm(p.lon, p.lat, lon, lat) < 0.6)) continue;
    pse.push({ n: b.n, campus: fixName(t.name) || null, k: b.k, city: t['addr:city'] ?? null, lon: round(lon, 5), lat: round(lat, 5), src: 'osm', osm: `${e.type}/${e.id}` });
  }
  log(`  ${pse.length} post-secondary sites (${aeCount} from the ministry list, ${pse.length - aeCount} campuses added from OpenStreetMap)`);

  // --- drives
  const openIdx = schools.map((s, i) => ({ ...s, i })).filter(open);
  const sets = {
    e: openIdx.filter((s) => s.g === 'e' || s.g === 'k' || s.g === '?'),
    h: openIdx.filter((s) => s.g === 'h' || s.g === 'k' || s.gi),
    f: openIdx.filter((s) => s.fr || s.imm?.includes('French')),
  };
  const towns = Object.fromEntries(places.map((p) => [p.key, { n: schools.filter((s) => open(s) && inTown(p, s)).length }]));
  let routed = true;
  for (const [k, list] of Object.entries(sets)) {
    const d = await driveTimes(places, list, `school-${k}`, { keep: 1 });
    routed &&= d.routed;
    for (const [key, v] of Object.entries(d.towns)) if (v[0]) towns[key][k] = { ...v[0], f: list[v[0].f].i };
  }
  const dp_ = await driveTimes(places, pse, 'pse', { keep: 1 });
  routed &&= dp_.routed;
  for (const [key, v] of Object.entries(dp_.towns)) if (v[0]) towns[key].p = v[0];
  // tier 2: schools in town; the nearest of each kind by straight line (min null)
  const smallP = await getSmallPlaces();
  const small = Object.fromEntries(smallP.map((p) => [p.key, { n: schools.filter((s) => open(s) && inTown(p, s)).length }]));
  for (const [k, list] of Object.entries(sets))
    for (const [key, v] of Object.entries(straightTimes(smallP, list))) if (v[0]) small[key][k] = { ...v[0], f: list[v[0].f].i };
  for (const [key, v] of Object.entries(straightTimes(smallP, pse))) if (v[0]) small[key].p = v[0];

  await writeOut('schools', {
    source: 'Government of Saskatchewan, Ministry of Education, K-12 schools (SchoolsAndDivisions: public, separate, Francophone and band schools), Saskatchewan GeoHub; schools it lacks from OpenStreetMap contributors (amenity=school; ODbL), via Overpass',
    pseSource: 'Government of Saskatchewan, Ministry of Advanced Education, post-secondary institutions (AdvancedEducation), Saskatchewan GeoHub; Saskatchewan Polytechnic and university campuses it lacks from OpenStreetMap contributors (amenity=university, college; ODbL), via Overpass',
    routing: routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line',
    routingSource: routed ? 'Drive times: OSRM demo server, © OpenStreetMap contributors (ODbL)' : null,
    asOf: new Date().toISOString().slice(0, 10),
    inferKm: INFER_KM,
    schools, pse, towns, small,
  });
}
