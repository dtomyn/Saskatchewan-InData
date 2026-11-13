import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { overpass } from '../lib/apis.mjs';
import { CENSUS_SDMX, censusProfile, censusProfileAll } from '../lib/census.mjs';
import { BBOX } from '../lib/config.mjs';
import { distKm, edgeKm } from '../lib/geo.mjs';
import { cached, fetchBuf, log, readOut, round, writeOut } from '../lib/io.mjs';
import { getPlaces, getProvince, inSask } from '../lib/places.mjs';
import { normalizeName } from '../places.mjs';

// Who lives here. Census 2021 profile per place (Statistics Canada's census SDMX API): immigrants and recent immigrants
// (2016–2021), where immigrants were born, the non-official languages spoken most often at home, French (mother tongue
// and knowledge), Indigenous identity. Places of worship mapped in OpenStreetMap inside or just outside each place's
// town limits (needs.json), coloured by religion. Counts are as published: randomly rounded to a multiple of 5.
export default async function community() {
  await getProvince();
  const places = await getPlaces();
  // the characteristic codelist, for the names and the tree under "place of birth" and "home language"
  const xml = (await cached('census/CL_CHARACTERISTIC.xml', () => fetchBuf(`${CENSUS_SDMX}/codelist/STC_CP/CL_CHARACTERISTIC/latest`, { headers: { 'Accept-Language': 'en' }, timeout: 300_000 }))).toString('utf8');
  const code = {}, kids = {};
  for (const m of xml.matchAll(/<structure:Code id="(\d+)">([\s\S]*?)<\/structure:Code>/g)) {
    const name = m[2].match(/<common:Name xml:lang="en">([^<]*)</)?.[1]?.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '’') ?? '';
    const parent = m[2].match(/<structure:Parent>\s*<Ref id="(\d+)"/)?.[1] ?? null;
    code[m[1]] = { name, parent };
    if (parent) (kids[parent] ??= []).push(m[1]);
  }
  const leaves = (id) => (kids[id] ?? []).flatMap((c) => (kids[c] ? leaves(c) : [c]));
  const want = (id, re) => { if (!code[id] || !re.test(code[id].name)) throw new Error(`census characteristic ${id} is no longer "${re.source}"`); return id; };
  const C = {
    hhPop: want('1513', /^Total - Immigrant status/), imm: want('1515', /^Immigrants$/), rec: want('1522', /^2016 to 2021$/), npr: want('1523', /^Non-permanent residents$/),
    birthTot: want('1530', /^Total - Place of birth for the immigrant/),
    homeTot: want('721', /^Total - Language spoken most often at home/), nonOff: want('726', /^Non-official languages$/),
    mtTot: want('379', /^Total - Mother tongue/), frMT: want('383', /^French$/),
    knTot: want('369', /^Total - Knowledge of official languages/), frOnly: want('371', /^French only$/), enFr: want('372', /^English and French$/),
    indTot: want('1388', /^Total - Indigenous identity/), ind: want('1389', /^Indigenous identity$/),
  };
  // named countries only: "Other places of birth in Asia" is a remainder, not a place
  const BIRTH = leaves(C.birthTot).filter((id) => !/^Other|^Oceania and other/.test(code[id].name));
  const LANG = leaves(C.nonOff);
  const cp = await censusProfile('community-', [...new Set([...Object.values(C), ...BIRTH, ...LANG])]);
  const top = (v, ids, n) => ids.filter((id) => v[id] > 0).sort((a, b) => v[b] - v[a]).slice(0, n).map((id) => [code[id].name.replace(/, n\.o\.s\.$/, '').replace(/^Korea, South$/, 'South Korea').replace(/^Congo, Democratic Republic of the$/, 'DR Congo').replace(/^South Africa, Republic of$/, 'South Africa'), v[id]]);
  const profile = (v) => {
    const o = {};
    for (const k of ['hhPop', 'imm', 'rec', 'npr', 'homeTot', 'nonOff', 'mtTot', 'frMT', 'knTot', 'indTot', 'ind']) if (v[C[k]] != null) o[k] = v[C[k]];
    if (v[C.frOnly] != null && v[C.enFr] != null) o.frKn = v[C.frOnly] + v[C.enFr];
    o.birth = top(v, BIRTH, 5);
    o.lang = top(v, LANG, 5);
    return o;
  };
  const census = {};
  for (const [k, p] of Object.entries(cp.places)) census[k] = { csd: p.csd, ...profile(p.v) };
  const prov = profile(cp.prov);
  // every census subdivision (top three birthplaces and languages only, to keep the file small)
  const csd = {};
  for (const [uid, c] of Object.entries(await censusProfileAll('community-', [...new Set([...Object.values(C), ...BIRTH, ...LANG])]))) {
    const o = profile(c.v);
    o.birth = o.birth.slice(0, 3); o.lang = o.lang.slice(0, 3);
    if (!o.birth.length) delete o.birth;
    if (!o.lang.length) delete o.lang;
    if (Object.keys(o).length) csd[uid] = o;
  }
  log(`  census: ${Object.keys(csd).length} subdivisions with values`);
  const noImm = places.filter((p) => census[p.key]?.imm == null).map((p) => p.name);
  if (noImm.length) log(`  community: immigrant counts suppressed or no CSD for ${noImm.join(', ')}`);

  // --- places of worship, inside a place's town limits (needs.json) or within the same slack, like Daily needs
  let needs = null;
  try { needs = await readOut('needs'); } catch { log('  needs.json missing: run the needs stage for town limits'); }
  const RELIGIONS = ['christian', 'muslim', 'sikh', 'hindu', 'buddhist', 'jewish', 'other', 'unstated'];
  const relOf = (t) => (!t.religion ? 'unstated' : RELIGIONS.includes(t.religion) ? t.religion : 'other');
  const osm = await overpass('sk-worship.json', `[out:json][timeout:240];(nwr["amenity"="place_of_worship"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center tags qt;`);
  const all = [];
  for (const e of osm.elements) {
    const t = e.tags ?? {};
    const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
    if (lon == null || !inSask(lon, lat, 0.05)) continue;
    const r = relOf(t), name = (t.name ?? '').trim();
    // a building mapped twice (a point inside its outline)
    const dup = all.find((s) => s.r === r && distKm(s.lon, s.lat, lon, lat) < 0.1 && (!s.name || !name || normalizeName(s.name) === normalizeName(name)));
    if (dup) { if (!dup.name && name) dup.name = name; continue; }
    all.push({ lon, lat, r, name, den: t.denomination ? t.denomination.replace(/_/g, ' ') : (r === 'other' ? t.religion.replace(/_/g, ' ') : ''), osm: `${e.type[0]}${e.id}` });
  }
  const sites = [], towns = {};
  for (const p of places) {
    const a = needs?.areas?.[p.key];
    const geom = a?.length ? { type: 'MultiPolygon', coordinates: a } : null;
    const n = RELIGIONS.map(() => 0);
    for (const s of all) {
      if (s.k != null || Math.abs(s.lat - p.lat) > 0.3 || Math.abs(s.lon - p.lon) > 0.45) continue;
      const inside = geom
        ? booleanPointInPolygon([s.lon, s.lat], { type: 'Feature', properties: {}, geometry: geom }) || edgeKm(s.lon, s.lat, geom) <= (needs.slackKm ?? 1)
        : distKm(p.lon, p.lat, s.lon, s.lat) <= (needs?.fallbackKm ?? 3);
      if (!inside) continue;
      s.k = p.key;
      n[RELIGIONS.indexOf(s.r)]++;
    }
    towns[p.key] = { ...(census[p.key] ?? {}), pw: n };
  }
  // [lon, lat, religion index, name, denomination, osm id, place key]
  for (const s of all) if (s.k != null) sites.push([round(s.lon, 5), round(s.lat, 5), RELIGIONS.indexOf(s.r), s.name || null, s.den || null, s.osm, s.k]);
  log(`  ${all.length} places of worship in Saskatchewan, ${sites.length} inside the atlas's places (${RELIGIONS.map((r, i) => `${r} ${sites.filter((s) => s[2] === i).length}`).join(', ')})`);
  await writeOut('community', {
    source: 'Statistics Canada, Census of Population 2021, Census Profile (98-401-X2021006) by census subdivision, via the census SDMX API',
    worshipSource: 'OpenStreetMap contributors (amenity=place_of_worship, religion, denomination; ODbL), via Overpass',
    asOf: new Date().toISOString().slice(0, 10),
    religions: RELIGIONS, slackKm: needs?.slackKm ?? 1,
    prov, towns, sites, csd,
  });
}
