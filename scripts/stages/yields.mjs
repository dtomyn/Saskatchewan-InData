import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { arcgisAll, statcanTable } from '../lib/apis.mjs';
import { edgeKm, polys, ringArea } from '../lib/geo.mjs';
import { cached, fetchBuf, log, round, writeOut } from '../lib/io.mjs';
import { parseCSV, parseCSVLine } from '../lib/parse.mjs';
import { getPlaces } from '../lib/places.mjs';

// Crop yields, three published series kept apart (never spliced):
// - AAFC's Canadian Crop Yields: reported yields by census division 1987 on (the map's series) and the Canadian Crop
//   Yield Forecaster's in-season forecast for the next harvest, with its 10th and 90th percentiles (a model range).
// - Statistics Canada Table 32-10-0359-01: Saskatchewan's own yield since 1908 (the century chart).
// - Statistics Canada Table 32-10-0002-01: by Small Area Data Region. Saskatchewan's regions were its 20 crop districts
//   to 2016 and are census divisions from 2017 (region 16 is divisions 16 and 18). The 2017-on regions are only used
//   to check AAFC's figures; the crop districts, which have no open boundaries, are kept as their own chart series.
// Yields are as published: bushels an acre, pounds an acre for lentils. A blank, suppressed (x), too unreliable (F) or
// zero ("not enumerated" in AAFC's specification) value is missing, never zero.
const CROPS = [
  { id: 'sw', name: 'Spring wheat', aafc: 'Spring Wheat', sc: 'Wheat, spring', unit: 'bu/ac' },
  { id: 'dw', name: 'Durum wheat', aafc: 'Durum Wheat', sc: 'Wheat, durum', unit: 'bu/ac' },
  { id: 'ca', name: 'Canola', aafc: 'Canola', sc: 'Canola', sc359: 'Canola (rapeseed)', unit: 'bu/ac' },
  { id: 'ba', name: 'Barley', aafc: 'Barley', sc: 'Barley', unit: 'bu/ac' },
  { id: 'oa', name: 'Oats', aafc: 'Oats', sc: 'Oats', unit: 'bu/ac' },
  { id: 'pe', name: 'Peas', aafc: 'Peas', sc: 'Peas, dry', unit: 'bu/ac' },
  { id: 'le', name: 'Lentils', aafc: 'Lentils', sc: 'Lentils', unit: 'lb/ac' },
  { id: 'fl', name: 'Flax', aafc: 'Flax', sc: 'Flaxseed', unit: 'bu/ac' },
];
const AAFC = 'https://agriculture.canada.ca/atlas/data_donnees/canadianCropYield/data_donnees/csv';
const ACTUAL = `${AAFC}/actual/historical_actual_crop_yield_by_CAR.csv`;
const FORECAST = `${AAFC}/forecast/crop_yield_forecast_by_CAR.csv`;
const CD_LAYER = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/4';
const UNIT_TEXT = { 'bu/ac': 'Average yield (bushels per acre)', 'lb/ac': 'Average yield (pounds per acre)' };
const dp = (unit) => (unit === 'lb/ac' ? 0 : 1);
/** a published value, or null when blank, flagged or zero */
const num = (s) => { const v = Number(s); return s === '' || s == null || !Number.isFinite(v) || v <= 0 ? null : v; };

/** AAFC's CSVs change once a month in season: cached per day. */
async function aafcCSV(name, url) {
  const day = new Date().toISOString().slice(0, 10);
  const buf = await cached(`yields/${name}-${day}.csv`, async () => {
    const b = await fetchBuf(url, { timeout: 120_000 });
    if (!/^﻿?UID,/.test(b.toString('utf8', 0, 20))) throw new Error(`${name}: not the expected CSV`);
    return b;
  });
  return parseCSV(buf.toString('utf8'));
}

/** a StatCan table's Saskatchewan average-yield rows, as { geo, crop, unit, year, v } */
async function statcanYields(pid, keep) {
  const lines = (await statcanTable(pid)).split(/\r?\n/).filter(Boolean);
  const h = parseCSVLine(lines[0].replace(/^﻿/, ''));
  const col = Object.fromEntries(['REF_DATE', 'GEO', 'Harvest disposition', 'Type of crop', 'VALUE'].map((k) => [k, h.indexOf(k)]));
  const lost = Object.entries(col).filter(([, i]) => i < 0).map(([k]) => k);
  if (lost.length) throw new Error(`table ${pid} has no ${lost.join(', ')} column: layout changed`);
  const out = [];
  for (const l of lines.slice(1)) {
    if (!l.includes('Saskatchewan') || !l.includes('Average yield')) continue;
    const c = parseCSVLine(l);
    if (!keep(c[col.GEO])) continue;
    out.push({ geo: c[col.GEO], disp: c[col['Harvest disposition']], crop: c[col['Type of crop']], year: +c[col.REF_DATE].slice(0, 4), v: num(c[col.VALUE]) });
  }
  return out;
}

export default async function yields() {
  const places = await getPlaces();

  // census divisions (2021 cartographic boundaries), for the map and to place each town
  const cdf = (await arcgisAll(CD_LAYER, { where: "PRUID='47'", outFields: 'CDUID,CDNAME', maxAllowableOffset: '0.002' }, 'cd-47', 50))
    .filter((f) => f.geometry).sort((a, b) => a.properties.CDUID.localeCompare(b.properties.CDUID));
  if (cdf.length !== 18) throw new Error(`expected Saskatchewan's 18 census divisions, got ${cdf.length}`);
  const centroid = (geom) => {
    // the area centroid of the largest part's outer ring
    const ps = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    const ring = ps.map((p) => p[0]).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
    let a = 0, x = 0, y = 0;
    for (let i = 1; i < ring.length; i++) {
      const f = ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
      a += f; x += (ring[i - 1][0] + ring[i][0]) * f; y += (ring[i - 1][1] + ring[i][1]) * f;
    }
    return [round(x / (3 * a), 3), round(y / (3 * a), 3)];
  };
  const cds = cdf.map((f) => ({
    uid: f.properties.CDUID,
    name: `Division No. ${+f.properties.CDUID.slice(2)}`,
    c: centroid(f.geometry),
    polys: polys(f.geometry, 0.006, 3),
  }));
  const idx = Object.fromEntries(cds.map((c, i) => [c.uid, i]));

  // AAFC's reported yields by census division
  const act = (await aafcCSV('actual', ACTUAL)).filter((r) => r.UID?.startsWith('47') && r.UID !== '4700');
  const yearCols = Object.keys(act[0] ?? {}).filter((k) => /^Year\d{4}$/.test(k)).sort();
  const years = yearCols.map((k) => +k.slice(4));
  if (years.length < 30) throw new Error(`AAFC actuals: only ${years.length} years`);
  const v = {};
  for (const c of CROPS) {
    v[c.id] = cds.map(() => null);
    for (const r of act.filter((x) => x.crop === c.aafc)) {
      const i = idx[r.UID];
      if (i == null) { log(`  AAFC region ${r.UID} (${r.region_name_en}) is not a census division: skipped`); continue; }
      v[c.id][i] = yearCols.map((k) => { const x = num(r[k]); return x == null ? null : round(x, dp(c.unit)); });
    }
    const n = v[c.id].filter(Boolean).length;
    if (n < 12) throw new Error(`AAFC actuals: ${c.name} for only ${n} census divisions`);
  }

  // AAFC's forecast for the next harvest: each crop's latest month, its 10th, 50th and 90th percentiles
  const fc = (await aafcCSV('forecast', FORECAST)).filter((r) => r.UID?.startsWith('47') && idx[r.UID] != null);
  const fYear = Math.max(...fc.map((r) => +r.year));
  const forecast = { year: fYear, crops: {} };
  for (const c of CROPS) {
    const rows = fc.filter((r) => r.crop === c.aafc && +r.year === fYear);
    if (!rows.length) continue;
    const month = Math.max(...rows.map((r) => +r.month));
    const fv = cds.map(() => null);
    for (const r of rows.filter((x) => +x.month === month)) {
      const lo = num(r.YIELD_LOW10), med = num(r.YIELD_MEDIAN), hi = num(r.YIELD_HIGH90);
      if (lo != null && med != null && hi != null) fv[idx[r.UID]] = [lo, med, hi].map((x) => round(x, dp(c.unit)));
    }
    forecast.crops[c.id] = { month, months: [...new Set(rows.map((r) => +r.month))].sort((a, b) => a - b), v: fv };
  }
  if (fYear <= years.at(-1)) log(`  AAFC's forecast is for ${fYear}, not past the record (${years.at(-1)}): kept, but the layer shows it only past the record`);

  // Statistics Canada by Small Area Data Region: the crop districts to 2016 (their own series) and the census divisions
  // from 2017 (to check AAFC's figures against)
  const sad = await statcanYields('32100002', (g) => /^Small Area Data Region \d+ - Saskatchewan/.test(g));
  const regionNo = (g) => +/Region (\d+)/.exec(g)[1];
  const pick = (rows, c) => rows.filter((r) => r.crop === c.sc && r.disp === UNIT_TEXT[c.unit]);
  const oldRows = sad.filter((r) => !/corresponds/.test(r.geo)), newRows = sad.filter((r) => /corresponds/.test(r.geo));
  // each set's years are those with any value (the table lists the other set's years as not available)
  const dYears = [...new Set(oldRows.filter((r) => r.v != null).map((r) => r.year))].sort((a, b) => a - b);
  const newYears = new Set(newRows.filter((r) => r.v != null).map((r) => r.year));
  const nDist = Math.max(...oldRows.map((r) => regionNo(r.geo)));
  const districts = { years: dYears, n: nDist, v: {} };
  let cells = 0, same = 0, onlyOne = 0;
  for (const c of CROPS) {
    const rows = pick(oldRows, c);
    if (!rows.length) throw new Error(`table 32-10-0002: no ${c.sc} yields in ${c.unit}`);
    const d = Array.from({ length: nDist }, () => dYears.map(() => null));
    for (const r of rows) if (r.v != null) d[regionNo(r.geo) - 1][dYears.indexOf(r.year)] = round(r.v, dp(c.unit));
    districts.v[c.id] = d;
    // from 2017 the regions are census divisions (region 16 is divisions 16 and 18): AAFC should carry the same numbers
    for (const r of pick(newRows, c).filter((x) => newYears.has(x.year))) {
      const i = idx[`47${String(regionNo(r.geo)).padStart(2, '0')}`], yi = years.indexOf(r.year);
      const a = i != null && yi >= 0 ? v[c.id][i]?.[yi] ?? null : null;
      if (a == null && r.v == null) continue;
      if (a == null || r.v == null) { onlyOne++; continue; }
      cells++;
      if (Math.abs(a - r.v) <= (c.unit === 'lb/ac' ? 0.5 : 0.05)) same++;
    }
  }
  log(`AAFC against table 32-10-0002 from 2017: ${same} of ${cells} cells the same, ${onlyOne} published in only one`);
  if (cells && same / cells < 0.9) log(`  ⚠ AAFC's census-division figures differ from Statistics Canada's in ${cells - same} cells`);

  // Saskatchewan's own yield since 1908 (Table 32-10-0359-01)
  const prov359 = await statcanYields('32100359', (g) => g === 'Saskatchewan');
  const pYears = [...new Set(prov359.map((r) => r.year))].sort((a, b) => a - b);
  // a year past the small-area table's last is the province's early estimate (revised in December and February)
  const sadLast = Math.max(...sad.filter((r) => r.v != null).map((r) => r.year));
  const province = { years: pYears, v: {}, provisionalFrom: sadLast + 1 };
  for (const c of CROPS) {
    const rows = prov359.filter((r) => r.crop === (c.sc359 ?? c.sc) && r.disp === UNIT_TEXT[c.unit]);
    if (!rows.length) throw new Error(`table 32-10-0359: no Saskatchewan ${c.sc} yields in ${c.unit}`);
    province.v[c.id] = pYears.map(() => null);
    for (const r of rows) if (r.v != null) province.v[c.id][pYears.indexOf(r.year)] = round(r.v, dp(c.unit));
  }

  // each place takes the census division its centre is in (Division 18, the north, publishes no yields)
  const feats = cdf.map((f) => ({ type: 'Feature', properties: {}, geometry: f.geometry }));
  const towns = {};
  for (const p of places) {
    let i = feats.findIndex((f) => booleanPointInPolygon([p.lon, p.lat], f));
    if (i < 0) {
      // a centre just over the border (Lloydminster) takes the nearest division within 5 km
      const d = feats.map((f) => edgeKm(p.lon, p.lat, f.geometry));
      const j = d.indexOf(Math.min(...d));
      if (d[j] <= 5) i = j;
    }
    towns[p.key] = i < 0 ? null : i;
  }
  const noCd = places.filter((p) => towns[p.key] == null).map((p) => p.name);
  if (noCd.length) log(`  no census division for ${noCd.join(', ')}`);
  log(`${years[0]}–${years.at(-1)} by census division, forecast ${fYear}; province ${pYears[0]}–${pYears.at(-1)}; crop districts ${dYears[0]}–${dYears.at(-1)}`);

  await writeOut('yields', {
    source: 'Agriculture and Agri-Food Canada, Canadian Crop Yields (reported yields by census division; Canadian Crop Yield Forecaster)',
    sourceUrl: 'https://open.canada.ca/data/en/dataset/9253a01b-f1d9-4b67-ba98-857667827c7b',
    actualUrl: ACTUAL, forecastUrl: FORECAST,
    licence: 'Open Government Licence – Canada', licenceUrl: 'https://open.canada.ca/en/open-government-licence-canada',
    provinceSource: 'Statistics Canada, Table 32-10-0359-01: Estimated areas, yield, production, average farm price and total farm value of principal field crops',
    provinceUrl: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3210035901',
    districtSource: 'Statistics Canada, Table 32-10-0002-01: Estimated areas, yield and production of principal field crops by Small Area Data Regions',
    districtUrl: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3210000201',
    statcanLicence: 'Statistics Canada Open Licence', statcanLicenceUrl: 'https://www.statcan.gc.ca/en/reference/licence',
    boundarySource: 'Statistics Canada, 2021 Census cartographic boundary file: census divisions',
    // crops in order: id, name and unit as published
    crops: CROPS.map(({ id, name, unit }) => ({ id, name, unit })),
    // the census divisions (index = position): uid, name, column position [lon, lat], outline rings
    cds,
    // reported yields by census division: v[crop][division] is a value a year of `years` (null missing), or null
    years, v,
    // the next harvest's forecast: per crop the latest month's [10th, 50th, 90th percentile] per division
    forecast,
    // Saskatchewan's own yield a year (32-10-0359-01); from `provisionalFrom` the small-area figures are not out yet
    province,
    // the 20 crop districts, 1976–2016 (32-10-0002-01; no open boundaries): v[crop][district - 1] a value a year
    districts,
    // AAFC's census-division figures against Statistics Canada's from 2017: cells compared and the same
    check: { cells, same, onlyOne },
    // per place: the index of the census division its centre is in, or null
    towns,
  });
}
