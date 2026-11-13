import { distKm } from '../lib/geo.mjs';
import { cached, cachedJSON, fetchBuf, log, round, writeOut } from '../lib/io.mjs';
import { advisoryRows, pdfText } from '../lib/parse.mjs';
import { getPlaces, getProvince, inSask } from '../lib/places.mjs';
import { normalizeName } from '../places.mjs';

// DRINKING WATER: the advisories in effect today. The province publishes no data feed, only two PDF reports linked
// from saskatchewan.ca: waterworks regulated by the Water Security Agency or the Ministry of Environment (town and
// village systems, rural pipelines, provincial parks) and public water supplies regulated by the Saskatchewan Health
// Authority (lodges, campgrounds, restaurants, small wells). Neither gives a location, so each is placed by its name
// with the Canadian Geographical Names Database (a town, park or reserve named in it, else a named lake), and the rest
// are listed, not mapped. First Nations advisories come from Indigenous Services Canada: the long-term ones from its
// map's data file (with coordinates) and the short-term ones from its web table, placed at their community.
export default async function water() {
  await getProvince();
  const places = await getPlaces();
  const NEAR_KM = 25;
  const today = new Date().toISOString().slice(0, 10);
  const GOC = 'https://waterquality.saskatchewan.ca/GoCReports';
  const ISC_ST = 'https://www.sac-isc.gc.ca/eng/1562856509704/1562856530304';
  const ISC_LT = 'https://www.sac-isc.gc.ca/DAM/DAM-ISC-SAC/DAM-WTR/STAGING/texte-text/lTDWA_map_data_1572010201618_eng.txt';
  // advisories change daily, so the cache is per day
  const envPdf = await cached(`water/EnvActive-${today}.pdf`, () => fetchBuf(`${GOC}/EnvActive.pdf`));
  const rhaPdf = await cached(`water/RhaActive-${today}.pdf`, () => fetchBuf(`${GOC}/RhaActive.pdf`));
  const stHtml = (await cached(`water/isc-short-term-${today}.html`, () => fetchBuf(ISC_ST))).toString('utf8');
  const noBom = (b) => b.toString('utf8').replace(/^﻿/, '');
  const lt = JSON.parse(noBom(await cached(`water/isc-long-term-${today}.json`, async () => { const b = await fetchBuf(ISC_LT); JSON.parse(noBom(b)); return b; })));

  // --- gazetteer: every populated place, reserve and park in Saskatchewan (CGNDB), one feature type at a time (a
  // query mixing types pages unreliably and drops names)
  const KINDS = ['CITY', 'TOWN', 'VILG', 'NV', 'MUN1', 'MUN2', 'UNP', 'HAM', 'IR', 'PARK'];
  const gaz = new Map();
  for (const code of KINDS) {
    for (let skip = 0; skip < 10000; skip += 1000) {
      const res = await cachedJSON(`cgndb/sk-${code}-${skip}.json`, `https://geogratis.gc.ca/services/geoname/en/geonames.json?province=47&concise=${code}&num=1000&skip=${skip}`);
      for (const i of res.items ?? []) {
        const k = normalizeName(i.name);
        const prev = gaz.get(k);
        if (!prev || KINDS.indexOf(code) < KINDS.indexOf(prev.code)) gaz.set(k, { name: i.name, code, lon: i.longitude, lat: i.latitude });
      }
      if ((res.items ?? []).length < 1000) break;
    }
  }
  log(`  ${gaz.size} named places, reserves and parks in the gazetteer`);
  // single words that are place names but also ordinary words in a title
  const COMMON = new Set(['success', 'plenty', 'prairie', 'service', 'central', 'union', 'marsh', 'lodge', 'colony', 'spring', 'valley', 'island', 'beach', 'point', 'park', 'resort', 'well', 'lake', 'water', 'church', 'school', 'station', 'store', 'farm', 'camp', 'north', 'south', 'east', 'west', 'bay', 'river', 'creek', 'hill', 'hills', 'main', 'centre', 'center', 'grand', 'summer', 'fishing', 'forest', 'pleasant', 'regional', 'provincial', 'national', 'staff', 'residence', 'unity', 'leader', 'frontier', 'herbert', 'macoun', 'rural', 'bench', 'churchill', 'thunder', 'eagle', 'garden', 'sunrise', 'heartland']);
  const gazNames = [...gaz.keys()].filter((k) => k.length >= 4).sort((a, b) => b.length - a.length);
  const tidy = (s) => s
    .replace(/\[\s*\d+\s*\]|#\s*\d+/g, ' ')
    .replace(/\bPROV(?:INCIAL)?\.?\s*PK\.?|\bProv\.?\s*(?:Pk\.?|Park)/gi, ' Provincial Park ')
    .replace(/\bCAMPGD\.?/gi, ' Campground ')
    .replace(/\bREG(?:IONAL)?\.?\s*PK\.?/gi, ' Regional Park ')
    .replace(/\s+/g, ' ').trim();
  const sysName = (s) => tidy(s).replace(/\b(WATERWORKS|PIPELINE|WATER DISTRIBUTION SYSTEM|DISTRIBUTION SYSTEM)\b/gi, ' ').replace(/[-\s]+$/, '').replace(/\s+/g, ' ').trim();
  const inBox = (g) => g && Number.isFinite(g.lon) && inSask(g.lon, g.lat, 0.1);
  const scan = (text) => {
    const t = ` ${normalizeName(tidy(text))} `;
    for (const k of gazNames) {
      if (!k.includes(' ') && COMMON.has(k)) continue;
      // "Scott Lake Lodge" is on Scott Lake, not in the town of Scott
      if (t.includes(` ${k} `) && !t.includes(` ${k} lake `) && !t.includes(` ${k} river `)) {
        // a single-word name must be written with a capital in the original
        if (!k.includes(' ') && !new RegExp(`\\b${k[0].toUpperCase()}`, '').test(text)) continue;
        const g = gaz.get(k);
        if (inBox(g)) return g;
      }
    }
    return null;
  };
  const lakeHit = async (text) => {
    const names = [...tidy(text).matchAll(/((?:[A-Z][\w'.]*\s){1,3})Lake\b|\b(?:Lake|Lac)\s((?:[A-Z][\w'.]*\s?){1,3})/g)].map((m) => (m[1] ? `${m[1].trim()} Lake` : `${/^Lac/.test(m[0]) ? 'Lac' : 'Lake'} ${m[2].trim()}`));
    for (const n of names) {
      if (/^(Regional|Provincial|Park|Resort|Lodge|The|Of|And|Site|PDWA|EBWO)\b/.test(n)) continue;
      const res = await cachedJSON(`cgndb/lake-${normalizeName(n).replace(/ /g, '_')}.json`, `https://geogratis.gc.ca/services/geoname/en/geonames.json?${new URLSearchParams({ q: n, province: '47', concise: 'LAKE' })}`);
      const g = (res.items ?? []).find((i) => normalizeName(i.name) === normalizeName(n));
      if (g && inSask(g.longitude, g.latitude, 0.1)) return { name: g.name, lon: g.longitude, lat: g.latitude };
    }
    return null;
  };
  const locate = async (name, area, title) => {
    const own = name ? gaz.get(normalizeName(sysName(name))) ?? gaz.get(`the ${normalizeName(sysName(name))}`) : null;
    if (inBox(own)) return { g: own, loc: 'name' };
    for (const t of [name, area, title]) { if (!t) continue; const g = scan(t); if (g) return { g, loc: 'text' }; }
    for (const t of [name, title]) { if (!t) continue; const g = await lakeHit(t); if (g) return { g, loc: 'lake' }; }
    return null;
  };
  const MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  const isoDate = (d) => { const m = d?.match(/^(\d{2})-([A-Z][a-z]{2})-(\d{2})$/); return m ? `${+m[3] > 70 ? 19 : 20}${m[3]}-${MON[m[2]]}-${m[1]}` : null; };
  const kindOf = (k, title) => (/do not (consume|drink|use)/i.test(title ?? '') ? 'dnc' : k === 'EBWO' ? 'boil' : 'pdwa');
  const createdOn = (buf) => { const t = pdfText(buf).find((i) => /^Created on:/.test(i.s))?.s; const d = t && new Date(t.replace(/^Created on:\s*/, '').replace(/ CST/, ' GMT-0600')); return d && !Number.isNaN(+d) ? d.toISOString().slice(0, 10) : today; };

  const sites = [], unplaced = [];
  const add = (s, hit) => {
    if (hit) sites.push({ ...s, lon: round(hit.g.lon, 3), lat: round(hit.g.lat, 3), loc: hit.loc, at: hit.loc === 'name' ? null : hit.g.name });
    else unplaced.push(s);
  };
  // --- provincial lists (PDF)
  for (const [src, buf] of [['wsa', envPdf], ['sha', rhaPdf]]) {
    const rows = advisoryRows(buf);
    if (!rows.length) throw new Error(`${src} advisory PDF: no rows read (has its layout changed?)`);
    for (const r of rows) {
      // the WSA list prints the system in capitals and, below it, the part of the system affected
      const caps = src === 'wsa' ? r.nameLines.filter((l) => l === l.toUpperCase()) : r.nameLines;
      const name = caps.join(' ').replace(/\s+-\s*$/, '').replace(/\s+/g, ' ').trim();
      const area = src === 'wsa' ? r.nameLines.filter((l) => l !== l.toUpperCase()).join(' ').trim() || null : null;
      const title = r.title || null;
      const part = src !== 'wsa' ? null : area && normalizeName(area) !== normalizeName(name) && !/^\(|\b(corp|inc|utility|association)\b/i.test(area) ? area : /\bportion\b|only affects/i.test(title ?? '') ? 'part of the system' : null;
      // a row printed without a system name is named by its title
      const shown = name ? (src === 'wsa' ? sysName(name).replace(/\b([A-Z])([A-Z'.]+)\b/g, (_, a, b) => a + b.toLowerCase()) : tidy(name)) : (title ?? 'Unnamed system');
      const s = {
        n: shown, sys: src === 'wsa' && name ? normalizeName(sysName(name)) : null,
        src, k: kindOf(r.kind, title), d: isoDate(r.date), t: title, why: r.quality || r.operational || null, reg: r.region, part,
      };
      add(s, await locate(name, area, title));
    }
  }
  const provAsOf = createdOn(envPdf);
  // --- First Nations: long-term (with coordinates)
  const comms = (lt.data ?? []).filter((c) => c.ProvinceAcronym === 'SK');
  const iscType = (t) => (/do not (consume|use)/i.test(t ?? '') ? 'dnc' : 'boil');
  for (const c of comms) for (const a of c.LTDWACurrent ?? []) {
    add({ n: (a.WaterSystemName ?? '').trim(), sys: null, src: 'isc', lt: true, k: iscType(a.AdvisoryType), d: a.DateSet || null, t: `${a.AdvisoryType}${a.CorrectiveMeasure ? `. Planned fix: ${a.CorrectiveMeasure.trim()}` : ''}`, why: null, reg: c.CommunityName, pop: a.PopulatioEstimated ?? null, part: null },
      { g: { name: c.CommunityName, lon: a.Longitude ?? +c.Longitude, lat: a.Lattitude ?? +c.Latitude }, loc: 'fn' });
  }
  // --- First Nations: short-term (web table), placed at the community
  const html = stHtml.replace(/<!--[\s\S]*?-->/g, '');
  const sec = html.match(/<section id="sask"[\s\S]*?<\/section>/)?.[0] ?? '';
  const cell = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/\s+/g, ' ').trim();
  const stRows = (sec.split(/<\/tr>/).map((r) => [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cell(m[1]))).filter((c) => c.length >= 6));
  const fnKey = (s) => normalizeName(s).replace(/\b(cree|first|dakota|nation|band|no|indian|reserve|ir)\b|\b\d+[a-z]?\b/g, ' ').replace(/\s+/g, ' ').trim();
  const STT = { BWA: 'boil', DNC: 'dnc', DNU: 'dnc' };
  for (const [fn, community, system, type, set, , pop] of stRows) {
    const c = comms.find((x) => fnKey(x.CommunityName) === fnKey(fn)) ?? comms.find((x) => fnKey(x.CommunityName) === fnKey(community));
    const hit = c ? { g: { name: c.CommunityName, lon: +c.Longitude, lat: +c.Latitude }, loc: 'fn' } : await locate(system, community, fn);
    add({ n: system, sys: null, src: 'isc', lt: false, k: STT[type] ?? 'boil', d: set?.replace(/\//g, '-') || null, t: `${{ BWA: 'Boil water advisory', DNC: 'Do not consume', DNU: 'Do not use' }[type] ?? type}`, why: null, reg: fn, pop: pop ?? null, part: null }, hit);
  }
  const stAsOf = (() => { const m = stHtml.match(/As of <span[^>]*>([^<]+)<\/span>/); const d = m && new Date(m[1].replace(/&nbsp;/g, ' ')); return d && !Number.isNaN(+d) ? d.toISOString().slice(0, 10) : today; })();
  log(`  ${sites.length} advisories placed, ${unplaced.length} not placed (${sites.filter((s) => s.src === 'isc').length} on First Nations; ${stRows.length} short-term)`);
  for (const k of ['name', 'text', 'lake', 'fn']) log(`    placed by ${k}: ${sites.filter((s) => s.loc === k).length}`);

  // --- per place: the town system's own advisories, and every advisory within NEAR_KM of the town centre
  const towns = {};
  for (const p of places) {
    const sys = sites.flatMap((s, i) => (s.src === 'wsa' && s.sys === p.key ? [i] : []));
    const nb = sites.flatMap((s, i) => { const k = distKm(p.lon, p.lat, s.lon, s.lat); return k <= NEAR_KM ? [[i, round(k, 1)]] : []; }).sort((a, b) => a[1] - b[1]);
    const sysUnplaced = unplaced.filter((s) => s.src === 'wsa' && s.sys === p.key).length;
    towns[p.key] = { sys, nb, ...(sysUnplaced ? { su: sysUnplaced } : {}) };
  }
  await writeOut('water', {
    source: 'Water Security Agency / Ministry of Environment and Saskatchewan Health Authority, “PDWA and EBWO currently in effect” reports (waterquality.saskatchewan.ca); Indigenous Services Canada, short-term and long-term drinking water advisories; Natural Resources Canada, Canadian Geographical Names Database (locations)',
    licence: 'Crown copyright, Government of Saskatchewan (non-commercial reproduction); Government of Canada terms (non-commercial reproduction); CGNDB OGL – Canada',
    licenceUrl: 'https://www.saskatchewan.ca/copyright',
    pageUrl: 'https://www.saskatchewan.ca/residents/environment-public-health-and-safety/environmental-health/water-and-wastewater-management/advisories-and-warnings',
    wsaUrl: `${GOC}/EnvActive.pdf`, shaUrl: `${GOC}/RhaActive.pdf`, iscUrl: ISC_ST, iscLtUrl: 'https://www.sac-isc.gc.ca/eng/1506514143353/1533317130660',
    wellUrl: 'https://wsask.ca/drinking-water-wastewater/groundwater/domestic-water-well-management/',
    asOf: today, provAsOf, stAsOf, nearKm: NEAR_KM,
    sites: sites.map(({ sys, ...s }) => s), unplaced: unplaced.map(({ sys, ...s }) => s), towns,
  });
}
