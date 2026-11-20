import { statcanTable } from '../lib/apis.mjs';
import { censusProfile, censusProfileAll } from '../lib/census.mjs';
import { log, round, writeOut } from '../lib/io.mjs';
import { parseCSV } from '../lib/parse.mjs';
import { PLACES_LIST, PLACE_KEYS, normalizeName } from '../places.mjs';

// Home costs. Census 2021 profile by census subdivision (Statistics Canada's census SDMX API): dwelling values, shelter
// costs and the share of households spending 30 %+ of income on shelter, for every place. CMHC's Rental Market Survey
// (average rents and vacancy rates, as Statistics Canada republishes it) for the surveyed centres, year by year.
export default async function housing() {
  const CHARS = { 1474: 'value', 1472: 'ownCost', 1480: 'rentCost', 1451: 'hh', 1453: 'hh30', 1470: 'own30', 1478: 'rent30', 1401: 'owners', 1402: 'renters' };
  const pick = (vals) => Object.fromEntries(Object.entries(vals).filter(([c]) => CHARS[c]).map(([c, v]) => [CHARS[c], v]));
  // The profile publishes some small places' owner or renter rate as 0.0 where the count of households at 30 %+ says
  // otherwise (a suppressed figure, not a zero): a 0 rate is dropped (left out, never 0) when the other tenure's
  // households cannot make up the total, more than random rounding (counts to 5) explains (never when the other rate is
  // itself unknown: those households could make up the whole total).
  const SLACK = 10;
  const tenure = (o) => {
    if (o.hh30 == null || o.owners == null || o.renters == null) return;
    const own = o.own30 == null ? null : (o.owners * o.own30) / 100, rent = o.rent30 == null ? null : (o.renters * o.rent30) / 100;
    const dropOwn = o.own30 === 0 && rent != null && o.hh30 - rent >= SLACK, dropRent = o.rent30 === 0 && own != null && o.hh30 - own >= SLACK;
    if (dropOwn) delete o.own30;
    if (dropRent) delete o.rent30;
    return dropOwn || dropRent;
  };
  let dropped = 0;
  const stir = (o) => {
    if (tenure(o)) dropped++;
    if (o.hh && o.hh30 != null) o.stir30 = round((o.hh30 / o.hh) * 100, 1);
    delete o.hh30;
    return o;
  };
  const cp = await censusProfile('', Object.keys(CHARS));
  const keys = Object.keys(cp.places).sort();
  const census = {};
  for (const k of keys) {
    const o = stir(pick(cp.places[k].v));
    census[k] = { csd: cp.places[k].csd, ...o };
  }
  const prov = stir(pick(cp.prov));
  const missing = PLACES_LIST.filter((p) => !census[normalizeName(p.name)]).map((p) => p.name);
  log(`  census: ${keys.length} places matched${missing.length ? `; no CSD for ${missing.join(', ')}` : ''}`);
  // every census subdivision, for the province-wide tint and the census-only report (keyed by CSD uid)
  const csd = {};
  for (const [uid, c] of Object.entries(await censusProfileAll('housing-', Object.keys(CHARS)))) {
    const o = stir(pick(c.v));
    if (Object.keys(o).length) csd[uid] = o;
  }
  log(`  census: ${Object.keys(csd).length} subdivisions with values, ${Object.values(csd).filter((o) => o.value != null).length} with a dwelling value`);
  const noValue = keys.filter((k) => census[k].value == null);
  if (noValue.length) log('  census: dwelling value suppressed for', noValue.join(', '));
  log(`  census: ${dropped} owner or renter 30 %+ rates published as 0 against the household count, left out`);

  // CMHC Rental Market Survey (October), row and apartment structures of three units and over, via Statistics Canada
  const rent = {};
  const geoKey = (geo) => normalizeName(geo.split(',')[0]);
  const rentRows = parseCSV(await statcanTable('34100133'));
  for (const r of rentRows) {
    if (!/Saskatchewan/.test(r.GEO) || r['Type of structure'] !== 'Row and apartment structures of three units and over') continue;
    const unit = { 'One bedroom units': 'r1', 'Two bedroom units': 'r2' }[r['Type of unit']];
    const y = Number(r.REF_DATE.slice(0, 4));
    if (!unit || y < 2000 || r.VALUE === '' || r.STATUS === 'F') continue;
    const key = geoKey(r.GEO);
    if (!PLACE_KEYS.has(key)) continue;
    const e = (rent[key] ??= { centre: r.GEO.replace(/, Saskatchewan(\/Alberta)?$/, '').replace(/, Saskatchewan part$/, ' (Saskatchewan part)'), r1: {}, r2: {}, vac: {} });
    e[unit][y] = Number(r.VALUE);
  }
  // vacancy: census metropolitan areas (Regina, Saskatoon) and census agglomerations 10,000+, same structure type
  for (const pid of ['34100130', '34100132']) {
    for (const r of parseCSV(await statcanTable(pid))) {
      const y = Number(r.REF_DATE.slice(0, 4));
      if (!/Saskatchewan/.test(r.GEO) || y < 2000 || r.VALUE === '' || r.STATUS === 'F') continue;
      const key = geoKey(r.GEO);
      if (rent[key]) {
        rent[key].vac[y] = Number(r.VALUE);
        if (/Alberta/.test(r.GEO)) rent[key].vacArea = 'whole census agglomeration (Saskatchewan and Alberta sides)';
      }
    }
  }
  for (const [k, e] of Object.entries(rent)) if (!Object.keys(e.vac).length) { delete e.vac; log(`  CMHC: no vacancy series for ${k}`); }
  const years = Object.values(rent).flatMap((e) => Object.keys(e.r2).map(Number));
  log(`  CMHC: ${Object.keys(rent).length} surveyed centres, ${Math.min(...years)}–${Math.max(...years)}`);
  await writeOut('housing', {
    source: 'Statistics Canada, Census of Population 2021, Census Profile (98-401-X2021006) by census subdivision, via the census SDMX API',
    rentSource: 'CMHC Rental Market Survey via Statistics Canada Tables 34-10-0133-01 (average rents), 34-10-0130-01 and 34-10-0132-01 (vacancy rates); row and apartment structures of three units and over, October',
    prov, census, rent, csd,
  });
}
