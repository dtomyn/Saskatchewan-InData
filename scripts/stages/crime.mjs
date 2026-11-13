import { statcanTable } from '../lib/apis.mjs';
import { log, writeOut } from '../lib/io.mjs';
import { parseCSVLine } from '../lib/parse.mjs';
import { PLACES_LIST, PLACE_KEYS, normalizeName } from '../places.mjs';

// Statistics Canada Table 35-10-0061-01: Crime Severity Index and weighted clearance rates, police services in Saskatchewan.
export default async function crime() {
  const csv = await statcanTable('35100061');
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const header = parseCSVLine(lines[0]).map((h) => h.replace(/^﻿/, ''));
  const iDate = header.indexOf('REF_DATE'), iGeo = header.indexOf('GEO'), iStat = header.indexOf('Statistics'), iVal = header.indexOf('VALUE');
  const STATS = { 'Crime severity index': 'csi', 'Violent crime severity index': 'vcsi', 'Non-violent crime severity index': 'nvcsi', 'Weighted clearance rate': 'clear' };
  const byGeo = {};
  const prov = {};
  const services = new Set();
  for (const line of lines.slice(1)) {
    const c = parseCSVLine(line);
    const stat = STATS[c[iStat]];
    // A service lists years before it existed (or after it stopped reporting) as 0: no real service has an index of 0.
    if (!stat || c[iVal] === '' || Number(c[iVal]) === 0) continue;
    const geo = c[iGeo], year = c[iDate].slice(0, 4);
    if (/^Saskatchewan/.test(geo)) { (prov[stat] ??= {})[year] = Number(c[iVal]); continue; }
    services.add(geo);
    // "Regina, Saskatchewan, municipal [47xxx]" or "Melfort, Saskatchewan, Royal Canadian Mounted Police, municipal [..]";
    // rural detachments end in "rural".
    const parts = geo.replace(/\s*\[.*\]$/, '').split(/,\s*/);
    const key = normalizeName(parts[0]);
    if (!PLACE_KEYS.has(key)) continue;
    const level = parts.at(-1);
    if (level !== 'municipal' && level !== 'rural') continue;
    const rcmp = parts.includes('Royal Canadian Mounted Police');
    const g = (byGeo[geo] ??= { key, level, rcmp, stats: {} });
    (g.stats[stat] ??= {})[year] = Number(c[iVal]);
  }
  // Each place takes one police service's series: its own municipal one while that is still reported, otherwise the
  // rural RCMP detachment of the same name (small towns' municipal RCMP series stop in 2011 and carry on as part of the
  // rural detachment, which covers the surrounding area too). Series are never spliced across services.
  const munis = {}, service = {};
  const lastYear = (g) => Math.max(...Object.keys(g.stats.csi ?? { 0: 0 }).map(Number));
  const latest = Math.max(...Object.values(byGeo).map(lastYear));
  const current = (g) => lastYear(g) >= latest - 3;
  const pick = {};
  for (const [geo, g] of Object.entries(byGeo)) {
    const p = pick[g.key];
    const better = !p
      || (current(g) && !current(p[1]))
      || (current(g) === current(p[1]) && g.level === 'municipal' && p[1].level === 'rural')
      || (current(g) === current(p[1]) && g.level === p[1].level && lastYear(g) > lastYear(p[1]));
    if (better) pick[g.key] = [geo, g];
  }
  for (const [key, [geo, g]] of Object.entries(pick)) {
    munis[key] = g.stats;
    service[key] = { level: g.level, rcmp: g.rcmp, name: geo.replace(/\s*\[.*\]$/, '').replace(', Saskatchewan', '') };
  }
  log('  rural detachment used for:', Object.entries(service).filter(([, s]) => s.level === 'rural').map(([k]) => k).join(', '));
  const missing = PLACES_LIST.filter((p) => !munis[normalizeName(p.name)]).map((p) => p.name);
  log(`  ${services.size} police services in the table; ${Object.keys(munis).length} places matched`);
  if (missing.length) log('  crime: no own police series for', missing.join(', '));
  await writeOut('crime', { source: 'Statistics Canada, Table 35-10-0061-01 (Crime severity index and weighted clearance rates, police services in Saskatchewan)', prov, munis, service, services: services.size });
}
