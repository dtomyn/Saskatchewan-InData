import fs from 'node:fs/promises';
import path from 'node:path';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { strFromU8, unzipSync } from 'fflate';
import { CACHE } from '../lib/config.mjs';
import { distKm } from '../lib/geo.mjs';
import { cached, cachedFile, fetchBuf, log, readOut, round, writeOut, zipLines } from '../lib/io.mjs';
import { getPlaces, getProvince, getSmallPlaces, inSask, smallAreas } from '../lib/places.mjs';

// Internet & mobile: ISED's National Broadband Data. Every pseudo-household (PHH: ISED's representative points for
// where people live, with the 2021 census households behind each) carries the top fixed speed tier offered there, by any
// wired or fixed-wireless service and by wire alone, and whether LTE mobile service reaches it. The national files
// (~300 MB zipped) are streamed once, kept to Saskatchewan's points in .cache/, then summed into ISED's own 25 km²
// hexagons (the map) and into each place's town limits (needs.json). ISED's hexagon table adds which providers and
// technologies serve each hexagon, which gives the mobile carriers. 5G is not in the open data.
export default async function internet() {
  await getProvince();
  const places = await getPlaces();
  const API = 'https://ised-isde.canada.ca/app/scr/sittibc/web/api/openData';
  const TIERS = ['', '<5_1', '5_1', '10_2', '25_5', '50_10'];
  const tierOf = (s) => Math.max(0, TIERS.indexOf(s.replace(/"/g, '').trim()));
  const cells = (line) => line.split(',').map((s) => s.replace(/^"|"$/g, '').trim());

  // --- Saskatchewan's pseudo-households with their speeds: id, lon, lat, households, hexagon, combined tier, wired tier, LTE
  const skFile = path.join(CACHE, 'internet', 'sk-phh-speeds.tsv');
  let rows;
  try {
    rows = (await fs.readFile(skFile, 'utf8')).split('\n').filter(Boolean).map((l) => l.split('\t'));
  } catch {
    const phhZip = await cachedFile('internet/PHH_2021_CSV.zip', `${API}/PHH_2021_CSV.zip`);
    const spdZip = await cachedFile('internet/NBD_PHH_Speeds.zip', `${API}/NBD_PHH_Speeds.zip`);
    const sk = new Map();
    let hdr = null;
    await zipLines(phhZip, (n) => /PHH-SK\.csv$/i.test(n), (line) => {
      const c = cells(line);
      if (!hdr) { hdr = Object.fromEntries(c.map((h, i) => [h.replace(/^﻿/, ''), i])); return; }
      // only points with households behind them (most are empty road points)
      const hh = Number(c[hdr.URDwell2021_RH2021]);
      if (c[hdr.Pruid_Pridu] !== '47' || !(hh > 0)) return;
      sk.set(c[hdr.PHH_ID], [c[hdr.PHH_ID], Number(c[hdr.Longitude]).toFixed(5), Number(c[hdr.Latitude]).toFixed(5), round(hh, 2), c[hdr.HEXUID_IdUHEX], 0, 0, 0]);
    });
    if (!sk.size) throw new Error('no Saskatchewan pseudo-households in the PHH file (has its layout changed?)');
    log(`  ${sk.size} Saskatchewan pseudo-households with households`);
    let sh = null, matched = 0;
    // current service only (not funded projects or announced expansions), Saskatchewan's file
    await zipLines(spdZip, (n) => /^PHH_Speeds_Current-[^/]*_SK\.csv$/i.test(n), (line) => {
      const c = cells(line);
      if (!sh) {
        const find = (re) => { const i = c.findIndex((h) => re.test(h.replace(/^﻿/, ''))); if (i < 0) throw new Error(`speeds file has no column like ${re}`); return i; };
        sh = { id: find(/^PHH_ID$/), comb: find(/^Combined_Max/), wired: find(/^Wired_Max/), lte: find(/LTE/) };
        return;
      }
      const r = sk.get(c[sh.id]);
      if (!r) return;
      r[5] = tierOf(c[sh.comb]); r[6] = tierOf(c[sh.wired]); r[7] = c[sh.lte] === '1' ? 1 : 0;
      matched++;
    });
    log(`  speeds matched for ${matched} of them`);
    if (!matched) throw new Error('no speeds matched Saskatchewan pseudo-households');
    rows = [...sk.values()].map((r) => r.map(String));
    await fs.writeFile(skFile, rows.map((r) => r.join('\t')).join('\n'));
  }
  const phh = rows.map((r) => ({ lon: +r[1], lat: +r[2], hh: +r[3], hex: r[4], comb: +r[5], wired: +r[6], lte: +r[7] }));

  // --- ISED's hexagon table: centres, and the providers and technologies serving each Saskatchewan hexagon
  const mapZip = await cached('internet/Map_Data_CSV.zip', () => fetchBuf(`${API}/Map_Data_CSV.zip`, { timeout: 600_000 }));
  const chxZip = await cached('internet/CHX_EXO_CSV.zip', () => fetchBuf(`${API}/CHX_EXO_CSV.zip`, { timeout: 600_000 }));
  const mapFiles = unzipSync(new Uint8Array(mapZip), { filter: (f) => /^ISP_Hex/i.test(f.name) });
  const ispCsv = strFromU8(Object.values(mapFiles)[0] ?? new Uint8Array());
  const chxCsv = strFromU8(Object.values(unzipSync(new Uint8Array(chxZip), { filter: (f) => /\.csv$/i.test(f.name) }))[0] ?? new Uint8Array());
  const centre = new Map();
  for (const line of chxCsv.split('\n')) {
    const c = cells(line.replace(/^﻿/, ''));
    if (c[0]?.startsWith('SK')) centre.set(c[0], [+c[2], +c[1]]);
  }
  if (!centre.size || !ispCsv) throw new Error('ISED hexagon files missing or empty');
  const MOBILE = 'Mobile Wireless';
  const TECH = { 'Fibre to the home': 'fibre', 'Coaxial Cable': 'cable', DSL: 'dsl', 'Fixed Wireless': 'fw', Satellite: 'sat', [MOBILE]: 'mob' };
  const hexIsp = new Map(); // hex → { mob: Set(carrier), tech: Set, isp: Set(name) }
  for (const line of ispCsv.split('\n')) {
    const c = cells(line);
    if (!c[0]?.startsWith('SK') || !TECH[c[2]]) continue;
    const h = hexIsp.get(c[0]) ?? { mob: new Set(), tech: new Set(), isp: new Set() };
    h.tech.add(TECH[c[2]]);
    if (c[2] === MOBILE) h.mob.add(c[1]);
    else if (c[2] !== 'Satellite') h.isp.add(`${c[1]}|${TECH[c[2]]}`);
    hexIsp.set(c[0], h);
  }

  // --- per hexagon: households, and the share of them offered 50/10 by any fixed service / by wire, and reached by LTE
  const agg = new Map();
  for (const p of phh) {
    const a = agg.get(p.hex) ?? { hh: 0, f50: 0, w50: 0, lte: 0 };
    a.hh += p.hh;
    if (p.comb === 5) a.f50 += p.hh;
    if (p.wired === 5) a.w50 += p.hh;
    if (p.lte) a.lte += p.hh;
    agg.set(p.hex, a);
  }
  const pc = (x, n) => (n ? Math.round((100 * x) / n) : null);
  const hexes = [];
  for (const [id, [lon, lat]] of centre) {
    const a = agg.get(id), h = hexIsp.get(id);
    if (!a?.hh && !h) continue;
    if (!inSask(lon, lat, 0.08)) continue;
    // [lon, lat, households, % 50/10 any fixed, % 50/10 by wire, % LTE, mobile carriers]
    hexes.push([round(lon, 3), round(lat, 3), Math.round(a?.hh ?? 0), a?.hh ? pc(a.f50, a.hh) : null, a?.hh ? pc(a.w50, a.hh) : null, a?.hh ? pc(a.lte, a.hh) : null, h?.mob.size ?? 0]);
  }

  // --- per place: the households inside its town limits (as Daily needs counts them)
  let needs = null;
  try { needs = await readOut('needs'); } catch { log('  needs.json missing: run the needs stage for town limits'); }
  const towns = {}, small = {};
  const sAreas = await smallAreas();
  for (const p of [...places, ...(await getSmallPlaces())]) {
    const tier2 = p.tier === 2;
    const a = tier2 ? sAreas[p.key] : needs?.areas?.[p.key];
    const geom = a?.length ? { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: a } } : null;
    const near = phh.filter((q) => Math.abs(q.lat - p.lat) < 0.25 && Math.abs(q.lon - p.lon) < 0.4);
    const inside = near.filter((q) => (geom ? booleanPointInPolygon([q.lon, q.lat], geom) : distKm(p.lon, p.lat, q.lon, q.lat) <= (needs?.fallbackKm ?? 3)));
    const hh = inside.reduce((s, q) => s + q.hh, 0);
    if (!inside.length) { if (!tier2) log(`  ✖ ${p.name}: no pseudo-households inside its limits`); continue; }
    // share of households whose top tier is each tier (index 0–5), any fixed and by wire
    const dist = (k) => { const d = [0, 0, 0, 0, 0, 0]; for (const q of inside) d[q[k]] += q.hh; return d.map((v) => pc(v, hh) ?? 0); };
    const best = (k) => Math.max(...inside.map((q) => q[k]));
    // the town centre: the pseudo-household nearest it
    const c = inside.reduce((b, q) => (distKm(p.lon, p.lat, q.lon, q.lat) < distKm(p.lon, p.lat, b.lon, b.lat) ? q : b));
    const hs = new Set(inside.map((q) => q.hex));
    const mob = new Set(), tech = new Set(), isp = new Set();
    for (const id of hs) { const h = hexIsp.get(id); if (!h) continue; h.mob.forEach((x) => mob.add(x)); h.tech.forEach((x) => tech.add(x)); h.isp.forEach((x) => isp.add(x)); }
    const ispList = {};
    for (const s of isp) { const [n, t] = s.split('|'); (ispList[n] ??= []).push(t); }
    (tier2 ? small : towns)[p.key] = {
      hh: Math.round(hh), n: inside.length,
      comb: dist('comb'), wired: dist('wired'), lte: pc(inside.filter((q) => q.lte).reduce((s, q) => s + q.hh, 0), hh),
      best: best('comb'), bestW: best('wired'), centre: [c.comb, c.wired, c.lte],
      mob: [...mob].sort(), tech: [...tech].sort(), isp: Object.entries(ispList).map(([n, t]) => [n, t.sort()]).sort((x, y) => x[0].localeCompare(y[0])),
    };
  }
  const sum = (k) => phh.reduce((s, q) => s + (k(q) ? q.hh : 0), 0);
  const allHh = sum(() => true);
  const prov = { hh: Math.round(allHh), f50: pc(sum((q) => q.comb === 5), allHh), w50: pc(sum((q) => q.wired === 5), allHh), lte: pc(sum((q) => q.lte), allHh) };
  log(`  ${hexes.length} hexagons; Saskatchewan: ${prov.f50}% of households offered 50/10 (${prov.w50}% by wire), ${prov.lte}% reached by LTE; ${Object.keys(towns).length} places, ${Object.keys(small).length} small communities`);
  await writeOut('internet', {
    source: 'Innovation, Science and Economic Development Canada, National Broadband Data (NBD PHH Speeds, NBD Map hexagon data) and Pseudo-Household Demographic Distribution 2021, open.canada.ca',
    licence: 'Open Government Licence – Canada',
    asOf: new Date().toISOString().slice(0, 10),
    tiers: ['none', 'under 5/1', '5/1', '10/2', '25/5', '50/10'],
    prov, hexes, towns, small,
  });
}
