import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { arcgisAll, statcanTable } from '../lib/apis.mjs';
import { censusProfile, censusProfileAll } from '../lib/census.mjs';
import { polys, ringArea } from '../lib/geo.mjs';
import { log, round, writeOut } from '../lib/io.mjs';
import { parseCSV } from '../lib/parse.mjs';
import { getPlaces, getProvince, getSmallPlaces } from '../lib/places.mjs';

// Jobs & income. Labour Force Survey, annual, by economic region (Statistics Canada Table 14-10-0464-01, which replaced the archived 14-10-0393-01): unemployment
// and employment rates year by year. The LFS publishes Prince Albert (4750) and Northern (4760) only as one combined
// region, so they share one series and one tinted area. Economic-region outlines: the 2021 cartographic boundary file;
// each place takes the region its centre lies in. Census 2021 profile per place: median household income and the
// labour force by industry (NAICS sectors).
export default async function jobs() {
  await getProvince();
  const places = await getPlaces();
  // --- LFS
  const STATS = { 'Unemployment rate': 'ur', 'Employment rate': 'er', 'Participation rate': 'pr' };
  const lfs = {}, prov = {};
  for (const r of parseCSV(await statcanTable('14100464'))) {
    const stat = STATS[r['Labour force characteristics']];
    if (!stat || !/Saskatchewan$/.test(r.GEO)) continue;
    const y = Number(r.REF_DATE.slice(0, 4));
    // blank or "F" (too unreliable to publish) stays a gap; never filled in
    const v = r.VALUE === '' || r.STATUS === 'F' || r.STATUS === '..' ? null : Number(r.VALUE);
    if (r.GEO === 'Saskatchewan') { if (v != null) (prov[stat] ??= {})[y] = v; continue; }
    const name = r.GEO.replace(/, Saskatchewan$/, '').replace(/-/g, '–');
    const e = (lfs[name] ??= { name, ur: {}, er: {}, pr: {}, gaps: 0 });
    if (v == null) e.gaps++; else e[stat][y] = v;
  }
  const names = Object.keys(lfs);
  if (!names.length) throw new Error('no Saskatchewan economic regions in Table 14-10-0464-01');
  // --- boundaries: Saskatchewan's economic regions 4710–4760
  const ER = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/2';
  const ers = await arcgisAll(ER, { where: "PRUID='47'", outFields: 'ERUID,ERNAME', maxAllowableOffset: '0.002' }, 'er-47', 50);
  const erName = (n) => String(n).split(' / ')[0].replace(/--|-/g, '–');
  const regions = [];
  const regionOfER = {};
  for (const n of names) {
    const e = lfs[n];
    // "Prince Albert and Northern" is two economic regions; every other LFS region is one, matched by name
    const parts = ers.filter((f) => f.geometry && n.split(' and ').some((p) => erName(f.properties.ERNAME) === p));
    if (!parts.length) { log(`  jobs: no boundary for LFS region ${n}`); continue; }
    const idx = regions.length;
    for (const f of parts) regionOfER[f.properties.ERUID] = idx;
    const ps = parts.flatMap((f) => polys(f.geometry, 0.004, 3));
    // label at the largest part's ring centre
    const big = ps.map((p) => p[0]).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
    regions.push({
      name: n, ers: parts.map((f) => `${f.properties.ERUID} ${erName(f.properties.ERNAME)}`).sort(), combined: parts.length > 1,
      ur: e.ur, er: e.er, pr: e.pr,
      c: [round(big.reduce((a, p) => a + p[0], 0) / big.length, 2), round(big.reduce((a, p) => a + p[1], 0) / big.length, 2)],
      polys: ps,
    });
    if (e.gaps) log(`  jobs: ${n} has ${e.gaps} suppressed values`);
  }
  const unmatched = ers.filter((f) => regionOfER[f.properties.ERUID] == null).map((f) => f.properties.ERNAME);
  if (unmatched.length) log(`  jobs: economic regions with no LFS series: ${unmatched.join(', ')}`);
  // each place's region, from the outlines; a centre just outside (on the provincial border) takes the nearest
  const towns = {};
  const inER = (p) => ers.find((f) => f.geometry && booleanPointInPolygon([p.lon, p.lat], { type: 'Feature', properties: {}, geometry: f.geometry }));
  for (const p of places) {
    let f = inER(p);
    if (!f) {
      for (const d of [0.02, 0.05, 0.1]) { f = [[d, 0], [-d, 0], [0, d], [0, -d]].map(([dx, dy]) => inER({ lon: p.lon + dx, lat: p.lat + dy })).find(Boolean); if (f) break; }
      if (f) log(`  jobs: ${p.name} sits just outside the outlines; took ${f.properties.ERNAME}`);
    }
    if (!f) { log(`  jobs: ${p.name} is in no economic region`); continue; }
    towns[p.key] = { r: regionOfER[f.properties.ERUID] ?? null };
  }
  // tier 2: only the LFS region (its census figures are in `csd`, by its census subdivision)
  const small = {};
  for (const p of await getSmallPlaces()) {
    let f = inER(p);
    for (const d of [0.02, 0.05, 0.1]) { if (f) break; f = [[d, 0], [-d, 0], [0, d], [0, -d]].map(([dx, dy]) => inER({ lon: p.lon + dx, lat: p.lat + dy })).find(Boolean); }
    if (f) small[p.key] = { r: regionOfER[f.properties.ERUID] ?? null };
  }

  // --- Census 2021: median total household income (2020 incomes), unemployment rate (May 2021), labour force by industry
  const NAICS = { 2262: 'Agriculture, forestry, fishing & hunting', 2263: 'Mining, oil & gas', 2264: 'Utilities', 2265: 'Construction', 2266: 'Manufacturing', 2267: 'Wholesale trade', 2268: 'Retail trade', 2269: 'Transportation & warehousing', 2270: 'Information & culture', 2271: 'Finance & insurance', 2272: 'Real estate', 2273: 'Professional & technical services', 2274: 'Management of companies', 2275: 'Admin & support services', 2276: 'Education', 2277: 'Health care & social assistance', 2278: 'Arts, entertainment & recreation', 2279: 'Accommodation & food', 2280: 'Other services', 2281: 'Public administration' };
  const nIds = Object.keys(NAICS);
  const cp = await censusProfile('jobs-', ['229', '2230', '2261', ...nIds]);
  const profile = (v) => {
    const o = {};
    if (v[229] != null) o.inc = v[229];
    if (v[2230] != null) o.cur = v[2230];
    const all = v[2261];
    if (all) {
      o.lf = all;
      o.ind = nIds.filter((c) => v[c] != null).map((c) => [nIds.indexOf(c), round((v[c] / all) * 100, 1)]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    }
    return o;
  };
  for (const [k, p] of Object.entries(cp.places)) if (towns[k]) Object.assign(towns[k], { csd: p.csd }, profile(p.v));
  const sk = profile(cp.prov);
  const csd = {};
  for (const [uid, c] of Object.entries(await censusProfileAll('jobs-', ['229', '2230', '2261', ...nIds]))) {
    const o = profile(c.v);
    if (Object.keys(o).length) csd[uid] = o;
  }
  log(`  census: ${Object.keys(csd).length} subdivisions with values, ${Object.values(csd).filter((o) => o.inc != null).length} with an income`);
  const noInc = Object.keys(towns).filter((k) => towns[k].inc == null);
  if (noInc.length) log('  jobs: no census income for', noInc.join(', '));
  const ys = Object.values(lfs).flatMap((e) => Object.keys(e.ur).map(Number));
  log(`  LFS: ${regions.length} regions (${regions.filter((r) => r.combined).map((r) => r.name).join(', ') || 'none'} combined), ${Math.min(...ys)}–${Math.max(...ys)}; ${Object.keys(towns).length} places placed`);
  await writeOut('jobs', {
    source: 'Statistics Canada, Table 14-10-0464-01, Labour force characteristics by province, territory and economic region, annual (Labour Force Survey)',
    censusSource: 'Statistics Canada, Census of Population 2021, Census Profile (98-401-X2021006) by census subdivision, via the census SDMX API',
    areaSource: 'Statistics Canada, 2021 Census Cartographic Boundary Files, economic regions',
    naics: Object.values(NAICS),
    prov: { ur: prov.ur ?? {}, er: prov.er ?? {}, pr: prov.pr ?? {}, ...sk },
    regions, towns, small, csd,
  });
}
