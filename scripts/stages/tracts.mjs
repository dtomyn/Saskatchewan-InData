import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { arcgisAll } from '../lib/apis.mjs';
import { CENSUS_SDMX, censusCSV } from '../lib/census.mjs';
import { polys, ringArea } from '../lib/geo.mjs';
import { log, readOut, round, writeOut } from '../lib/io.mjs';

// Inside the cities: Statistics Canada's 2021 census tracts for the Regina (705) and Saskatoon (725) metropolitan areas
// (the only tracted areas in Saskatchewan), with census profile values per tract (census SDMX API, DF_CT). A tract
// belongs to a city when its centre lies inside the city's own census subdivision (subdivisions.json); the rest of the
// metropolitan area is kept and marked with `out`. Values Statistics Canada suppressed are left out, never zero.
export default async function tracts() {
  const CT = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/11';
  const feats = await arcgisAll(CT, { where: "PRUID='47'", outFields: 'CTUID,DGUID,CTNAME,LANDAREA', maxAllowableOffset: '0.0002' }, 'ct-47', 200);
  const CITY = { 705: 'regina', 725: 'saskatoon' };
  const CHARS = { 1: 'pop', 2: 'pop16', 1474: 'value', 1480: 'rentCost', 229: 'inc', 1451: 'hh', 1453: 'hh30', 1401: 'owners', 1402: 'renters', 1513: 'hhPop', 1515: 'imm', 1522: 'rec', 1388: 'indTot', 1389: 'ind' };
  const sub = await readOut('subdivisions');
  const outline = Object.fromEntries(Object.values(CITY).map((k) => [k, sub.csds.find((c) => c.k === k)?.p]));
  const ids = feats.map((f) => String(f.properties.DGUID).replace('.', '_'));
  const vals = {};
  for (let i = 0; i < ids.length; i += 25) {
    const part = ids.slice(i, i + 25);
    const rows = await censusCSV(`tracts-${String(i).padStart(3, '0')}-${part[0]}`, `${CENSUS_SDMX}/data/STC_CP,DF_CT/A5.${part.join('+')}.1.${Object.keys(CHARS).join('+')}.1`);
    for (const r of rows) if (r.OBS_VALUE !== '' && !Number.isNaN(Number(r.OBS_VALUE)) && CHARS[r.CHARACTERISTIC]) (vals[r.REF_AREA] ??= {})[CHARS[r.CHARACTERISTIC]] = Number(r.OBS_VALUE);
  }
  const tracts = [];
  for (const f of feats) {
    const p = f.properties, cma = String(p.CTUID).slice(0, 3), city = CITY[cma];
    if (!city || !f.geometry) continue;
    const ps = polys(f.geometry, 0.0003, 4);
    const big = ps.map((x) => x[0]).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
    const c = [round(big.reduce((a, q) => a + q[0], 0) / big.length, 4), round(big.reduce((a, q) => a + q[1], 0) / big.length, 4)];
    const lim = outline[city];
    const inside = lim ? booleanPointInPolygon(c, { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: lim } }) : true;
    const v = { ...(vals[String(p.DGUID).replace('.', '_')] ?? {}) };
    if (v.hh && v.hh30 != null) v.stir30 = round((v.hh30 / v.hh) * 100, 1);
    delete v.hh30;
    tracts.push({ id: String(p.CTUID), city, ...(inside ? {} : { out: 1 }), c, km2: round(Number(p.LANDAREA), 2), ...v, p: ps });
  }
  tracts.sort((a, b) => a.id.localeCompare(b.id));
  // the cities' own neighbourhood outlines, for names on the tract map (no figures are joined to them). Neither city
  // publishes police-reported crime by neighbourhood with a reuse licence (Regina Police's area tables and 90-day
  // occurrence map carry none; Saskatoon Police publish city-wide figures only), so none is read.
  const NB = [
    { city: 'regina', url: 'https://opengis.regina.ca/arcgis/rest/services/OpenData/Subdivisions/MapServer/5', name: 'SUB_NAME', skip: /^UNDEVELOP/i },
    { city: 'saskatoon', url: 'https://gisext.saskatoon.ca/arcgisod/rest/services/OD/LandSurface/MapServer/0', name: 'NeighbourhoodName', skip: null },
  ];
  const hoods = [];
  for (const nb of NB) {
    try {
      const fs_ = await arcgisAll(nb.url, { where: '1=1', outFields: nb.name, maxAllowableOffset: '0.0002' }, `hoods-${nb.city}`, 1000);
      const byName = new Map();
      for (const f of fs_) {
        const n = String(f.properties[nb.name] ?? '').replace(/\s+/g, ' ').trim();
        if (!n || !f.geometry || nb.skip?.test(n)) continue;
        const title = n === n.toUpperCase() ? n.toLowerCase().replace(/(^|[\s(\-/.])([a-z])/g, (_, x, c) => x + c.toUpperCase()) : n;
        const e = byName.get(title) ?? { city: nb.city, n: title, p: [] };
        e.p.push(...polys(f.geometry, 0.0003, 4));
        byName.set(title, e);
      }
      hoods.push(...byName.values());
      log(`  ${nb.city}: ${byName.size} neighbourhoods`);
    } catch (e) { log(`  ${nb.city} neighbourhoods unavailable: ${e.message}`); }
  }
  for (const k of Object.values(CITY)) log(`  ${k}: ${tracts.filter((t) => t.city === k && !t.out).length} tracts in the city, ${tracts.filter((t) => t.city === k && t.out).length} in the rest of the metropolitan area; ${tracts.filter((t) => t.city === k && t.value == null).length} with no dwelling value`);
  await writeOut('tracts', {
    source: 'Statistics Canada, 2021 Census Cartographic Boundary Files, census tracts',
    censusSource: 'Statistics Canada, Census of Population 2021, Census Profile (98-401-X2021006) by census tract, via the census SDMX API',
    hoodSources: {
      regina: { source: 'City of Regina, Subdivisions (OpenData MapServer)', licence: 'Open Government Licence – City of Regina', licenceUrl: 'https://www.regina.ca/city-government/open-data/open-government-licence/' },
      saskatoon: { source: 'City of Saskatoon, Neighbourhoods (OD LandSurface MapServer)', licence: 'City of Saskatoon open data: “free to use, re-use and redistribute”', licenceUrl: 'https://www.saskatoon.ca/services-residents/connect-your-city/open-data' },
    },
    tracts, hoods,
  });
}
