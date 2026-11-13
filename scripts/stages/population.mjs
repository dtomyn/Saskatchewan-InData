import { statcanTable } from '../lib/apis.mjs';
import { log, writeOut } from '../lib/io.mjs';
import { parseCSV } from '../lib/parse.mjs';
import { PLACES_LIST, PLACE_KEYS, normalizeName } from '../places.mjs';

export default async function population() {
  const csv = await statcanTable('17100155');
  const rows = parseCSV(csv);
  const munis = {};
  const seen = {};
  for (const r of rows) {
    const geo = r.GEO ?? '';
    if (!/Saskatchewan/.test(geo) || r.VALUE === '' || (r.Gender && !/^Total/i.test(r.Gender)) || (r['Age group'] && !/^All ages/i.test(r['Age group']))) continue;
    // e.g. "Regina (CY), Saskatchewan" or "Lloydminster (Part) (CY), Saskatchewan"
    const name = geo.split(',')[0].replace(/\((part|partie)\)/i, '');
    const type = (name.match(/\(([A-Z]+)\)\s*$/) ?? [])[1] ?? '';
    if (/^(RM|IRI|S-E|TP|NO|SNO|RV)$/.test(type)) continue;
    const key = normalizeName(name.replace(/\([A-Z]+\)\s*$/, ''));
    if (!PLACE_KEYS.has(key)) continue;
    seen[key] = geo;
    const y = r.REF_DATE.slice(0, 4);
    ((munis[key] ??= { pop: {}, s65: {}, firstProjection: null }).pop[y] = (munis[key].pop[y] ?? 0) + Number(r.VALUE));
  }
  const missing = PLACES_LIST.filter((p) => !munis[normalizeName(p.name)]).map((p) => p.name);
  if (missing.length) log('  population: no match for', missing.join(', '));
  log(`  ${Object.keys(munis).length} places matched`);
  await writeOut('population', { source: 'Statistics Canada, Table 17-10-0155-01, Population estimates, July 1, by census subdivision, 2021 boundaries', munis });
}
