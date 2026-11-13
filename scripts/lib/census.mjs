// Census 2021 profile (Statistics Canada's census SDMX API). It answers HTTP 500 unless asked for English.

import { PLACE_KEYS, normalizeName } from '../places.mjs';
import { cached, fetchBuf } from './io.mjs';
import { parseCSV } from './parse.mjs';

export const CENSUS_SDMX = 'https://api.statcan.gc.ca/census-recensement/profile/sdmx/rest';
export async function censusCSV(name, url) {
  const buf = await cached(`census/${name}.csv`, async () => {
    const b = await fetchBuf(url, { headers: { Accept: 'application/vnd.sdmx.data+csv', 'Accept-Language': 'en' }, timeout: 300_000 });
    if (!/^\s*DATAFLOW,/.test(b.toString('utf8'))) throw new Error(`census profile ${name}: not a CSV answer`);
    return b;
  });
  return parseCSV(buf.toString('utf8'));
}
/** The atlas's places as Saskatchewan census subdivisions (city, town, village, northern village/town/hamlet). */
let csdMemo;
async function censusCSDs() {
  if (csdMemo) return csdMemo;
  // "Regina, City [Census subdivision], Saskatchewan"
  const desc = (await cached('census/CL_DESC_CSD.xml', () => fetchBuf(`${CENSUS_SDMX}/codelist/STC_CP/CL_DESC_CSD/latest`, { headers: { 'Accept-Language': 'en' }, timeout: 300_000 }))).toString('utf8');
  const csd = {};
  for (const m of desc.matchAll(/<structure:Code id="(2021A000547\d{5})">\s*<common:Name xml:lang="en">([^<]+)<\/common:Name>/g)) {
    const [, id, label] = m;
    const [, name, type] = label.match(/^(.*), ([^,]+) \[Census subdivision\], Saskatchewan$/) ?? [];
    if (!name || !/^(City|Town|Village|Northern village|Northern town|Northern hamlet)$/i.test(type)) continue;
    const key = normalizeName(name.replace(/\((part|partie)\)/i, ''));
    if (PLACE_KEYS.has(key) && !csd[key]) csd[key] = { id, name: label.replace(/ \[Census subdivision\], Saskatchewan$/, '') };
  }
  return (csdMemo = csd);
}
/**
 * Census 2021 profile characteristics (ids from the CL_CHARACTERISTIC codelist) for the atlas's places and the province:
 * `places[key] = { csd, v: { charId: value } }`, `prov = { charId: value }`. Suppressed values are left out.
 * `tag` keeps each stage's cached answers apart (they ask for different characteristics).
 */
export async function censusProfile(tag, chars) {
  const csd = await censusCSDs();
  const charKey = chars.join('+');
  const vals = (rows) => {
    const o = {};
    for (const r of rows) if (chars.includes(String(r.CHARACTERISTIC)) && r.OBS_VALUE !== '' && !Number.isNaN(Number(r.OBS_VALUE))) o[r.CHARACTERISTIC] = Number(r.OBS_VALUE);
    return o;
  };
  const keys = Object.keys(csd).sort();
  const places = {};
  for (let i = 0; i < keys.length; i += 20) {
    const part = keys.slice(i, i + 20);
    const rows = await censusCSV(`${tag}csd-${part.map((k) => csd[k].id.slice(-7)).join('_').slice(0, 120)}`, `${CENSUS_SDMX}/data/STC_CP,DF_CSD/A5.${part.map((k) => csd[k].id).join('+')}.1.${charKey}.1`);
    for (const k of part) places[k] = { csd: csd[k].name, v: vals(rows.filter((r) => r.REF_AREA === csd[k].id)) };
  }
  const prov = vals(await censusCSV(`${tag}province-47`, `${CENSUS_SDMX}/data/STC_CP,DF_PR/A5.2021A000247.1.${charKey}.1`));
  return { places, prov };
}
/**
 * Every Saskatchewan census subdivision in the census profile's codelist (cities, towns, villages, rural municipalities,
 * reserves…): [{ uid (7 digits), id (SDMX code), name, type, label }].
 */
let allCsdMemo;
export async function censusAllCSDs() {
  if (allCsdMemo) return allCsdMemo;
  const desc = (await cached('census/CL_DESC_CSD.xml', () => fetchBuf(`${CENSUS_SDMX}/codelist/STC_CP/CL_DESC_CSD/latest`, { headers: { 'Accept-Language': 'en' }, timeout: 300_000 }))).toString('utf8');
  const out = [];
  for (const m of desc.matchAll(/<structure:Code id="(2021A000547\d{5})">\s*<common:Name xml:lang="en">([^<]+)<\/common:Name>/g)) {
    const label = m[2].replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '’');
    const [, name, type] = label.match(/^(.*), ([^,]+) \[Census subdivision\], Saskatchewan$/) ?? [];
    if (name) out.push({ uid: m[1].slice(-7), id: m[1], name, type, label: label.replace(/ \[Census subdivision\], Saskatchewan$/, '') });
  }
  return (allCsdMemo = out);
}
/**
 * The same characteristics for every Saskatchewan census subdivision: `{ [uid]: { v: { charId: value }, ne } }`. `ne`:
 * an incompletely enumerated reserve or settlement (the first digit of Statistics Canada's data quality flag). Suppressed
 * values are left out, never zero. Asked 25 subdivisions at a time.
 */
export async function censusProfileAll(tag, chars) {
  const every = await censusAllCSDs();
  const charKey = chars.join('+');
  const all = {};
  for (let i = 0; i < every.length; i += 25) {
    const part = every.slice(i, i + 25);
    const rows = await censusCSV(`${tag}all-${String(i).padStart(3, '0')}-${part[0].uid}-${part.at(-1).uid}`, `${CENSUS_SDMX}/data/STC_CP,DF_CSD/A5.${part.map((c) => c.id).join('+')}.1.${charKey}.1`);
    const by = {};
    for (const r of rows) (by[r.REF_AREA] ??= []).push(r);
    for (const c of part) {
      const rs = by[c.id] ?? [], v = {};
      for (const r of rs) if (chars.includes(String(r.CHARACTERISTIC)) && r.OBS_VALUE !== '' && !Number.isNaN(Number(r.OBS_VALUE))) v[r.CHARACTERISTIC] = Number(r.OBS_VALUE);
      all[c.uid] = { v, ne: rs.some((r) => String(r.DATA_QUALITY_FLAG ?? '').startsWith('1')) };
    }
  }
  return all;
}
