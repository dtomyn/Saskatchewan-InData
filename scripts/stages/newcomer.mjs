import { overpass } from '../lib/apis.mjs';
import { BBOX } from '../lib/config.mjs';
import { driveTimes } from '../lib/drive.mjs';
import { distKm } from '../lib/geo.mjs';
import { cached, fetchBuf, log, round, writeOut } from '../lib/io.mjs';
import { getPlaces, getProvince, inSask } from '../lib/places.mjs';

// Newcomer services: where to get settlement help, English classes, a Social Insurance Number (Service Canada) and a
// driver's licence and plates (an SGI motor licence issuer), and the drive from each place to the nearest of each.
// Settlement providers come from IRCC's own "Find free newcomer services near you" tool: its page loads the whole
// national list, with coordinates and the services each office offers, as one script (services-info.js), which is
// read here as text (never run). The province's list of settlement services (the Regional Newcomer Gateways) is not
// published as data, so it is typed below (SK_SETTLEMENT) and matched to IRCC's offices. Service Canada offices and
// SGI issuers come from OpenStreetMap: neither ESDC nor SGI publishes its office list as open data.
export default async function newcomer() {
  await getProvince();
  const places = await getPlaces();
  const byKey = new Map(places.map((p) => [p.key, p]));

  // --- IRCC settlement providers (one record per line: `{Type : {en : "…", fr : "…"}, … Coordinates : {…}}`)
  const IRCC_JS = 'https://ircc.canada.ca/js/tools/services/services-info.js';
  const js = (await cached('newcomer/ircc-services-info.js', () => fetchBuf(IRCC_JS, { timeout: 300_000 }))).toString('utf8');
  if (!/var ServicesData\s*=\s*\[/.test(js)) throw new Error('IRCC services-info.js no longer holds `var ServicesData = [`');
  const str = (line, field) => line.match(new RegExp(`\\b${field} : \\{en : "((?:[^"\\\\]|\\\\.)*)"`))?.[1]?.replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim() ?? '';
  // IRCC's service flags, kept as one letter each
  const FLAGS = { General: 'g', Needs_assets_referrals: 'n', Help_community: 'c', Job_search: 'j', Help_professions: 'p', Lang_assess: 'a', Lang_training_en: 'e', Lang_training_fr: 'f', Job_lang_training: 'w', Citzenship_test_prep: 'z', Franco: 'F', Youth: 'y', Women: 'W', Help_gar: 'r' };
  const agencies = [];
  let national = 0;
  for (const line of js.split(/\r?\n/)) {
    if (!/^\s*\{\s*Type\s*:/.test(line)) continue;
    national++;
    const lon = +(line.match(/Longitude : "(-?[\d.]+)"/)?.[1] ?? NaN), lat = +(line.match(/Latitude : "(-?[\d.]+)"/)?.[1] ?? NaN);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !inSask(lon, lat, 0.1)) continue;
    const sv = Object.fromEntries([...(line.match(/Services : \{([^}]*)\}/)?.[1] ?? '').matchAll(/(\w+) : "(yes|no)"/g)].map((m) => [m[1], m[2] === 'yes']));
    if (sv.InPerson_services === false) continue;
    const n = str(line, 'Type');
    if (agencies.some((a) => a.n === n && distKm(a.lon, a.lat, lon, lat) < 0.05)) continue;
    const web = str(line, 'Website');
    agencies.push({
      n, city: str(line, 'City') || null, addr: str(line, 'Address') || null, tel: str(line, 'Telephone') || null,
      web: web ? (/^https?:\/\//i.test(web) ? web : `https://${web}`) : null,
      sv: Object.entries(FLAGS).filter(([k]) => sv[k]).map(([, v]) => v).join(''),
      lon: round(lon, 5), lat: round(lat, 5), src: 'ircc',
    });
  }
  if (!agencies.length) throw new Error(`no Saskatchewan offices among IRCC's ${national} records`);
  log(`  ${agencies.length} in-person IRCC-funded offices in or near Saskatchewan (of ${national} in Canada)`);

  // --- the province's settlement services. HAND-TYPED: the Government of Saskatchewan publishes this list only as a
  // web page, "Find immigration services near you", https://www.saskatchewan.ca/residents/moving-to-saskatchewan/live-in-saskatchewan/find-immigration-services-near-you
  // (entries tagged "Settlement Services"), as read on 2026-11-12. Settlement services there are "offered by Regional
  // Newcomer Gateways". `ircc` picks out the same organisation's offices in IRCC's list (so the IRCC position is used);
  // an organisation IRCC does not list is put at its town's centre (approximate). Re-check the page when rebuilding.
  const SK_SETTLEMENT_ASOF = '2026-11-12';
  const SK_SETTLEMENT = [
    { n: 'Assemblée communautaire fransaskoise (ACF)', town: 'regina', addr: '215, 1440 9th Avenue N., Regina', tel: '306-569-1912', ircc: /communautaire fransaskoise.*Carrefour/i },
    { n: 'Moose Jaw Multicultural Council', town: 'moose jaw', addr: '1235 Main Street North, Moose Jaw', tel: '306-693-4677', ircc: /Moose Jaw Multicultural Council/i },
    { n: 'Regina Immigrant Women Centre', town: 'regina', addr: '211, 3988 Albert Street, Regina', tel: '306-359-6514', ircc: /Regina Immigrant Women Centre/i },
    { n: 'East Central Newcomer Welcome Centre', town: 'yorkton', addr: '132 Broadway Street W., Yorkton', tel: '306-783-2777', ircc: /East Central Newcomer/i },
    { n: 'Southeast Advocates for Employment (Estevan)', town: 'estevan', addr: '1112 6th Street, Estevan', tel: '306-634-9554', ircc: /Southeast Advocates.*Estevan/i },
    { n: 'Humboldt Regional Newcomer Centre', town: 'humboldt', addr: '606 9th Street, Humboldt', tel: '306-682-4277', ircc: /Humboldt Regional Newcomer/i },
    { n: 'Southwest Newcomer Welcome Centre', town: 'swift current', addr: '237 Central Avenue North, Swift Current', tel: '306-778-6262', ircc: /Southwest Newcomer/i },
    { n: 'International Women of Saskatoon', town: 'saskatoon', addr: '301, 336 5th Avenue North, Saskatoon', tel: '306-978-6611', ircc: /^International Women of Saskatoon\s*$/i },
    { n: 'Saskatoon Open Door Society', town: 'saskatoon', addr: '100, 129 3rd Avenue N, Saskatoon', tel: '306-653-4464', ircc: /Saskatoon Open Door Society/i },
    { n: 'Saskatchewan Intercultural Association', town: 'saskatoon', addr: '601B 1st Avenue North, Saskatoon', tel: '306-978-1818', ircc: /Saskatchewan Intercultural Association/i },
    { n: 'Ukrainian Canadian Congress, Saskatchewan Provincial Council', town: 'saskatoon', addr: '#2, 604 22 Street W., Saskatoon', tel: '306-652-5850', ircc: null },
    { n: 'Northeast Newcomer Services (Town of Tisdale)', town: 'tisdale', addr: '800 101 Street, Tisdale', tel: '306-873-2681', ircc: null },
    { n: 'YWCA Prince Albert', town: 'prince albert', addr: '1895 Central Avenue, Prince Albert', tel: '306-763-0736', ircc: /YWCA Prince Albert/i },
    { n: 'Battlefords Immigration Resource Centre', town: 'north battleford', addr: '761C 106th Street, North Battleford', tel: '306-446-0622', ircc: /Battlefords Immigration Resource/i },
    { n: 'Catholic Social Services (Lloydminster)', town: 'lloydminster', addr: '6612 35 Street, Lloydminster, AB', tel: '780-875-9084', ircc: null },
  ];
  for (const s of SK_SETTLEMENT) {
    const hits = s.ircc ? agencies.filter((a) => s.ircc.test(a.n)) : [];
    if (s.ircc && !hits.length) log(`  ${s.n}: not found in IRCC's list any more; placed at the town centre`);
    for (const a of hits) a.g = 1;
    if (hits.length) continue;
    const p = byKey.get(s.town);
    if (!p) throw new Error(`SK_SETTLEMENT: unknown place "${s.town}"`);
    agencies.push({ n: s.n, city: p.name, addr: s.addr, tel: s.tel, web: null, sv: 'gn', lon: round(p.lon, 5), lat: round(p.lat, 5), src: 'sk', g: 1, approx: 1 });
  }
  log(`  ${agencies.filter((a) => a.g).length} offices on the province's settlement list (${agencies.filter((a) => a.src === 'sk').length} not in IRCC's list, placed at their town's centre)`);

  // --- Service Canada offices and SGI motor licence issuers, from OpenStreetMap
  const osm = await overpass('sk-gov-offices.json', `[out:json][timeout:240];(nwr["office"~"^(government|insurance)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});nwr["shop"="insurance"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center tags qt;`);
  const offices = [];
  // not motor licence issuers: life and health insurers, SGI's claims centres, head offices
  const NOT_ISSUER = /sun life|primerica|blue cross|crop production|municode|claims|administration|head office|freedom 55|investors group|ig wealth|manulife|great-west|canada life/i;
  for (const e of osm.elements) {
    const t = e.tags ?? {};
    const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
    const name = (t.name ?? '').trim();
    if (lon == null || !name) continue;
    const city = t['addr:city'] ?? t['is_in:city'] ?? null;
    const addr = [t['addr:unit'] ? `${t['addr:unit']}-` : '', t['addr:housenumber'] ? `${t['addr:housenumber']} ` : '', t['addr:street'] ?? ''].join('').trim() || null;
    const base = { n: name, city, addr, note: t.note ?? t['addr:description'] ?? null, hours: t.opening_hours ?? null, lon: round(lon, 5), lat: round(lat, 5), osm: `${e.type}/${e.id}` };
    if (/service canada/i.test(`${name} ${t.operator ?? ''}`)) {
      // Flin Flon (Manitoba) serves Creighton; Lloydminster's office is on the Alberta side
      if (!inSask(lon, lat, 0.3)) continue;
      offices.push({ ...base, k: /outreach/i.test(name) ? 'so' : 'sc' });
    } else if (inSask(lon, lat)) {
      if (/\bSGI\b|licen[cs]e issuer|driver exam/i.test(name) && !NOT_ISSUER.test(name)) offices.push({ ...base, k: 'sgi' });
      else if ((t.office === 'insurance' || t.shop === 'insurance') && !NOT_ISSUER.test(name)) offices.push({ ...base, k: 'ins' });
    }
  }
  offices.sort((a, b) => b.lat - a.lat);
  const tallyO = (k) => offices.filter((o) => o.k === k).length;
  log(`  OpenStreetMap: ${tallyO('sc')} Service Canada Centres, ${tallyO('so')} scheduled outreach sites; ${tallyO('sgi')} named SGI offices or licence issuers, ${tallyO('ins')} other insurance brokers`);

  // --- drives: settlement help, English classes, Service Canada, an SGI issuer
  const idx = (list) => list.map((x, i) => ({ ...x, i }));
  const sets = {
    s: idx(agencies).filter((a) => a.g || /[gnc]/.test(a.sv)),
    l: idx(agencies).filter((a) => /[ew]/.test(a.sv)),
    c: idx(offices).filter((o) => o.k === 'sc' || o.k === 'so'),
    g: idx(offices).filter((o) => o.k === 'sgi' || o.k === 'ins'),
  };
  const towns = Object.fromEntries(places.map((p) => [p.key, {}]));
  let routed = true;
  for (const [k, list] of Object.entries(sets)) {
    const d = await driveTimes(places, list, `newcomer-${k}`, { keep: 1 });
    routed &&= d.routed;
    for (const [key, v] of Object.entries(d.towns)) if (v[0]) towns[key][k] = { ...v[0], f: list[v[0].f].i };
  }

  await writeOut('newcomer', {
    source: 'Immigration, Refugees and Citizenship Canada, “Find free newcomer services near you” (ircc.canada.ca/english/newcomers/services), the IRCC-funded settlement and language offices it lists',
    provSource: `Government of Saskatchewan, “Find immigration services near you” (saskatchewan.ca), settlement services: typed into the build script from the web page as read on ${SK_SETTLEMENT_ASOF}`,
    provUrl: 'https://www.saskatchewan.ca/residents/moving-to-saskatchewan/live-in-saskatchewan/find-immigration-services-near-you',
    provAsOf: SK_SETTLEMENT_ASOF,
    officeSource: 'OpenStreetMap contributors (Service Canada offices: office=government named Service Canada; SGI motor licence issuers: offices named SGI or licence issuer, and insurance brokers, office=insurance; ODbL), via Overpass',
    routing: routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line',
    routingSource: routed ? 'Drive times: OSRM demo server, © OpenStreetMap contributors (ODbL)' : null,
    asOf: new Date().toISOString().slice(0, 10),
    agencies, offices, towns,
  });
}
