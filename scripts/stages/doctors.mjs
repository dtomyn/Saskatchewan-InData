import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { overpass } from '../lib/apis.mjs';
import { BBOX } from '../lib/config.mjs';
import { driveTimes } from '../lib/drive.mjs';
import { distKm, edgeKm } from '../lib/geo.mjs';
import { log, readOut, round, writeOut } from '../lib/io.mjs';
import { NEEDS_KINDS, needsOSM, odhfIsHospital, odhfRows, odhfTitle } from '../lib/needs-osm.mjs';
import { getPlaces, getProvince, getSmallPlaces, inSask, smallAreas, straightTimes } from '../lib/places.mjs';
import { normalizeName } from '../places.mjs';

// Doctors & clinics: places to see a family doctor or nurse outside an emergency department, from Statistics Canada's
// ODHF (the Saskatchewan Health Authority's clinics and primary health care centres, the file the hospitals stage
// reads) and OpenStreetMap (medical clinics and doctors' offices, nurses); pharmacies from OpenStreetMap (the same
// test as Daily needs). For each place: the drive to the nearest clinic and pharmacy, and how many are in town.
export default async function doctors() {
  await getProvince();
  const places = await getPlaces();
  // not somewhere to see a family doctor: imaging, labs, dentists, eyes, chiropractors, therapy, mental health and
  // addictions, public health and home care offices, specialists, and school and student sites (for their students only)
  const NOT_PRIMARY = /imaging|\bmri\b|ultrasound|radiolog|x-ray|chiropract|denture|dental|eye ?care|eye institute|optom|lasik|laser|skin|esthetic|hair|audiolog|hearing|counc?sel|mental health|psychiatr|diagnostic|bayshore|home care|home health|\bsha office\b|spmi|public health|laborator|labratory|\blab\b|addiction|alcohol|drug services|therap|physio|massage|kidney|youth services|youth service centre|community health services|cancer|dialysis|cardiology|obstetric|gyn(a)?ecolog|specialist|planned parenthood|fertility|women'?s (clinic|health)|autism|sexual health|student|collegiate|high school|community school/i;
  const SPECIALIST = /radiology|ultrasound|chiropractic|ophthalmology|optometry|plastic_surgery|psychiatry|fertility|orthopaedics|cardiology|gynaecology|dermatology/;
  const kindOf = (name, extra = '') => (/nurse practitioner|nursing station/i.test(`${name} ${extra}`) ? 'np'
    : /primary (health|care)|health (cent(re|er)|complex|facility|clinic|department|services)|community health|wellness|union health/i.test(`${name} ${extra}`) ? 'phc' : 'md');
  const walkIn = (s) => /walk-?\s?in|minor emergency|urgent care/i.test(s);
  const near = (a, b, km) => distKm(a.lon, a.lat, b.lon, b.lat) < km;
  const word = (s) => normalizeName(s).split(' ').find((w) => w.length > 2 && !/^(the|dr)$/.test(w)) ?? '';

  // --- ODHF (Saskatchewan Health Authority sites)
  const byKey = new Map(places.map((p) => [p.key, p]));
  const clinics = [];
  let odhfNoPoint = 0, odhfPlaced = 0;
  for (const r of await odhfRows()) {
    const type = r.source_facility_type ?? '';
    const amb = r.odhf_facility_type === 'Ambulatory health care services';
    const hospLike = r.odhf_facility_type === 'Hospitals' && !odhfIsHospital(r);
    if (!amb && !hospLike) continue;
    if (NOT_PRIMARY.test(`${r.facility_name} ${type}`) || /psychiatric|youth lodge/i.test(r.facility_name)) continue;
    if (amb && !/clinic|primary|medical|medicenter|health cent|health complex|health facility|community health|nursing station|walk-in|emergency/i.test(`${r.facility_name} ${type}`)) continue;
    const f = { n: odhfTitle(r.facility_name), city: r.city ? odhfTitle(r.city) : null, k: kindOf(r.facility_name, type), src: 's' };
    if (walkIn(`${r.facility_name} ${type}`)) f.w = 1;
    if (r.latitude && r.longitude) {
      f.lon = +r.longitude; f.lat = +r.latitude;
      if (!inSask(f.lon, f.lat, 0.02)) continue;
    } else {
      // no point in the file: put it at its town's centre when the town is one of the atlas's places
      odhfNoPoint++;
      const p = byKey.get(normalizeName(r.city ?? ''));
      if (!p) continue;
      Object.assign(f, { lon: p.lon, lat: p.lat, approx: 1 });
      odhfPlaced++;
    }
    // the same site listed twice
    const dup = clinics.find((g) => near(g, f, 0.3) && (normalizeName(g.n) === normalizeName(f.n) || word(g.n) === word(f.n)));
    if (dup) { if (dup.approx && !f.approx) Object.assign(dup, { lon: f.lon, lat: f.lat, approx: undefined }); continue; }
    clinics.push(f);
  }
  const nOdhf = clinics.length;

  // --- OpenStreetMap: clinics and doctors (Daily needs' test), plus nurses and health centres
  const osm = await needsOSM();
  const extra = await overpass('sk-doctors.json', `[out:json][timeout:180];(nwr["healthcare"~"^(nurse|centre)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center tags qt;`);
  const isClinic = NEEDS_KINDS.find((k) => k.id === 'clinic').test, isPharmacy = NEEDS_KINDS.find((k) => k.id === 'pharmacy').test;
  const pharmacies = [];
  let osmClinics = 0, merged = 0;
  for (const e of [...osm.elements, ...extra.elements]) {
    const t = e.tags ?? {};
    const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
    if (lon == null || !inSask(lon, lat, 0.05)) continue;
    const name = (t.name ?? t.brand ?? '').trim();
    const city = t['addr:city'] ?? null;
    if (isPharmacy(t)) {
      if (pharmacies.some((s) => near(s, { lon, lat }, 0.15) && (!s.n || !name || normalizeName(s.n) === normalizeName(name)))) continue;
      pharmacies.push({ n: name || 'Pharmacy', city, k: 'rx', lon, lat, src: 'o', osm: `${e.type}/${e.id}` });
      continue;
    }
    const nurse = t.healthcare === 'nurse';
    if (!isClinic(t) && !nurse && t.healthcare !== 'centre') continue;
    const spec = t['healthcare:speciality'] ?? '';
    if (NOT_PRIMARY.test(name) || (SPECIALIST.test(spec) && !/general|family|community/.test(spec))) continue;
    const f = { n: name || (nurse ? 'Nurse' : t.amenity === 'doctors' ? 'Doctor’s office' : 'Clinic'), city, k: nurse ? 'np' : kindOf(name, spec), lon, lat, src: 'o', osm: `${e.type}/${e.id}` };
    if (walkIn(name) || t.walk_in === 'yes') f.w = 1;
    // the same site in ODHF or mapped twice in OSM: close by, and the same first word or one unnamed
    const dup = clinics.find((g) => near(g, f, 0.12) || (name && near(g, f, 0.6) && word(g.n) === word(f.n)));
    if (dup) {
      if (dup.src === 's') { dup.src = 'os'; dup.osm = f.osm; merged++; if (dup.approx) Object.assign(dup, { lon, lat, approx: undefined }); }
      if (f.w) dup.w = 1;
      continue;
    }
    osmClinics++;
    clinics.push(f);
  }
  for (const s of [...clinics, ...pharmacies]) { s.lon = round(s.lon, 5); s.lat = round(s.lat, 5); for (const k of Object.keys(s)) if (s[k] === undefined || s[k] === null) delete s[k]; }
  const tally = (k) => clinics.filter((c) => c.k === k).length;
  log(`  ODHF: ${nOdhf} SHA clinics and health centres (${odhfNoPoint} without a point in the file, ${odhfPlaced} of them put at their town's centre); OSM: ${merged} of them matched, ${osmClinics} more; ${tally('md')} medical clinics or doctors' offices, ${tally('phc')} primary health care or health centres, ${tally('np')} nurse sites, ${clinics.filter((c) => c.w).length} walk-in; ${pharmacies.length} pharmacies`);

  // --- in town: inside the place's limits (needs.json) or within the same slack, like Daily needs
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

  // --- drives
  const sites = [...clinics.sort((a, b) => b.lat - a.lat), ...pharmacies.sort((a, b) => b.lat - a.lat)];
  const idx = sites.map((s, i) => ({ ...s, i }));
  // a site placed at its town's centre counts in town, but is not a drive target (the drive would be a guess)
  const sets = { c: idx.filter((s) => s.k !== 'rx' && !s.approx), p: idx.filter((s) => s.k === 'rx') };
  const towns = Object.fromEntries(places.map((p) => [p.key, {
    nc: clinics.filter((s) => inTown(p, s)).length, np: pharmacies.filter((s) => inTown(p, s)).length,
  }]));
  let routed = true;
  for (const [k, list] of Object.entries(sets)) {
    const d = await driveTimes(places, list, `doctors-${k}`, { keep: 1 });
    routed &&= d.routed;
    for (const [key, v] of Object.entries(d.towns)) if (v[0]) towns[key][k] = { ...v[0], f: list[v[0].f].i };
  }
  const none = places.filter((p) => !towns[p.key].nc).map((p) => p.name);
  log(`  ${places.length - none.length} of ${places.length} places have a clinic in town${none.length ? `; none: ${none.join(', ')}` : ''}`);
  // Neither list has most private family practices, so a regional centre like Yorkton can show no clinic. INFERRED: a
  // place with no clinic mapped but a hospital in town (hospitals.json) gets `h`, that hospital and its drive, since
  // its doctors usually practise at or beside it. The app says so.
  let hosp = null;
  try { hosp = await readOut('hospitals'); } catch { log('  hospitals.json missing: run the hospitals stage for the in-town hospital rule'); }
  const withHosp = [];
  for (const p of places) {
    if (towns[p.key].nc || !hosp) continue;
    const tr = (hosp.towns[p.key] ?? []).find((t) => hosp.facilities[t.f]?.hospital && inTown(p, hosp.facilities[t.f]));
    if (!tr) continue;
    const f = hosp.facilities[tr.f];
    towns[p.key].h = { n: f.name, min: tr.min, km: tr.km, lon: f.lon, lat: f.lat };
    withHosp.push(p.name);
  }
  if (withHosp.length) log(`  no clinic mapped but a hospital in town (inferred doctors): ${withHosp.join(', ')}`);

  // --- tier 2: the same counts in town, the nearest clinic and pharmacy by straight line, and the in-town hospital rule
  const smallP = await getSmallPlaces();
  const small = Object.fromEntries(smallP.map((p) => [p.key, { nc: clinics.filter((s) => inTown(p, s)).length, np: pharmacies.filter((s) => inTown(p, s)).length }]));
  for (const [k, list] of Object.entries(sets))
    for (const [key, v] of Object.entries(straightTimes(smallP, list))) if (v[0]) small[key][k] = { ...v[0], f: list[v[0].f].i };
  for (const p of smallP) {
    if (small[p.key].nc || !hosp?.small) continue;
    const tr = (hosp.small[p.key] ?? []).find((t) => hosp.facilities[t.f]?.hospital && inTown(p, hosp.facilities[t.f]));
    if (tr) { const f = hosp.facilities[tr.f]; small[p.key].h = { n: f.name, min: null, km: tr.km, lon: f.lon, lat: f.lat }; }
  }
  log(`  tier 2: ${smallP.filter((p) => small[p.key].nc).length} of ${smallP.length} small communities have a clinic in town`);

  await writeOut('doctors', {
    source: 'Statistics Canada, Open Database of Healthcare Facilities (ODHF v1), Saskatchewan ambulatory health care services and non-hospital health centres',
    osmSource: 'OpenStreetMap contributors (amenity=clinic, doctors; healthcare=clinic, doctor, nurse, centre; amenity=pharmacy, healthcare=pharmacy; ODbL), via Overpass',
    areaSource: needs?.areaSource ?? null,
    routing: routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line',
    routingSource: routed ? 'Drive times: OSRM demo server, © OpenStreetMap contributors (ODbL)' : null,
    // The Saskatchewan Health Authority posts temporary emergency-department and service disruptions only as notices
    // on a web page (saskhealthauthority.ca/news-events/service-disruptions), with no feed or data file, so none are mapped.
    disruptions: null,
    disruptionsUrl: 'https://www.saskhealthauthority.ca/news-events/service-disruptions',
    asOf: new Date().toISOString().slice(0, 10),
    slackKm: needs?.slackKm ?? 1, fallbackKm: needs?.fallbackKm ?? 3,
    // `small`: tier-2 communities; their nearest clinic and pharmacy are straight-line distances (min null)
    sites, towns, small,
  });
}
