import { BBOX, OGC } from '../lib/config.mjs';
import { cachedJSON, log, writeOut } from '../lib/io.mjs';
import { getPlaces } from '../lib/places.mjs';

// Statistics Canada Table 17-10-0155-01: population estimates, 1 July, by census subdivision (2021 boundaries).
// Climate projections (plans/digital-twin/3-forecasts-and-what-ifs.md, 3b): Environment and Climate Change Canada's
// CMIP6 statistically downscaled projections (CanDCS-U6, 26 models, BCCAQv2, ~10 km grid), as 30-year averages of the
// change from 1971–2000, from MSC GeoMet's OGC API coverage. One request per window, scenario and percentile over the
// province (18, cached in .cache/projections/); each place takes its grid cell. Kept as published, never recomputed:
// for a low (SSP1-2.6) and a high (SSP5-8.5) scenario, the ensemble's 10th, 50th and 90th percentile change.
// (ClimateData.ca serves richer indices from the same models, such as days above 30 °C, but its terms reserve all
// rights, so they are not used: ROADMAP.md, Still open.)
export default async function projections() {
  const places = await getPlaces();
  const COV = `${OGC}/climate:candcsu6:projected:annual:P30Y-Avg/coverage`;
  const VARS = {
    tg: { prop: 'AirTempAnomaly', label: 'Mean temperature', unit: '°C' },
    tx: { prop: 'AirTempMaxAnomaly', label: 'Daily high', unit: '°C' },
    tn: { prop: 'AirTempMinAnomaly', label: 'Daily low', unit: '°C' },
    pr: { prop: 'PrecipAnomaly', label: 'Precipitation', unit: 'mm' },
  };
  const SCEN = { ssp126: { id: 'SSP126', label: 'Low emissions (SSP1-2.6)' }, ssp585: { id: 'SSP585', label: 'High emissions (SSP5-8.5)' } };
  const WINDOWS = ['2021-2050', '2041-2070', '2071-2100'];
  const PCT = [10, 50, 90];
  const bbox = `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`;
  const props = Object.values(VARS).map((v) => v.prop).join(',');
  const grids = {};
  for (const sc of Object.keys(SCEN)) for (const w of WINDOWS) for (const p of PCT) {
    const q = `f=json&bbox=${bbox}&properties=${props}&subset=${encodeURIComponent(`scenario(${SCEN[sc].id}),percentile(${p}),P30Y-Avg(${w})`)}`;
    const cov = await cachedJSON(`projections/candcsu6-${sc}-${w}-p${p}.json`, `${COV}?${q}`, { timeout: 300_000 });
    if (cov.type !== 'Coverage' || cov.domain?.axes?.t?.values?.[0] !== w.slice(0, 4)) throw new Error(`projections ${sc} ${w} p${p}: unexpected answer`);
    grids[`${sc}|${w}|${p}`] = cov;
  }
  // a place's value: its grid cell, or the nearest cell with data within two cells (lakes and the border have none)
  const sample = (cov, prop, lon, lat) => {
    const { x, y } = cov.domain.axes;
    const dx = (x.stop - x.start) / (x.num - 1), dy = (y.stop - y.start) / (y.num - 1);
    const vals = cov.ranges[prop].values;
    const i0 = Math.round((lon - x.start) / dx), j0 = Math.round((lat - y.start) / dy);
    let best = null, bd = Infinity;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= x.num || j >= y.num) continue;
      const v = vals[j * x.num + i];
      if (v == null || !Number.isFinite(v) || Math.abs(v) > 1e6) continue;
      const d = di * di + dj * dj;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  };
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const towns = {};
  for (const pl of places) {
    const t = {};
    for (const [k, v] of Object.entries(VARS)) {
      t[k] = {};
      for (const sc of Object.keys(SCEN)) {
        // [window start, median, 10th, 90th percentile] of the change from 1971–2000
        t[k][sc] = WINDOWS.map((w) => [+w.slice(0, 4), ...[50, 10, 90].map((p) => r2(sample(grids[`${sc}|${w}|${p}`], v.prop, pl.lon, pl.lat)))]);
        if (t[k][sc].some((r) => r.includes(null))) throw new Error(`projections: no ${k} value near ${pl.name}`);
      }
    }
    towns[pl.key] = t;
  }
  log(`  ${Object.keys(towns).length} places × ${Object.keys(VARS).length} variables × ${WINDOWS.length} windows`);
  await writeOut('projections', {
    source: 'Environment and Climate Change Canada, CMIP6 statistically downscaled climate scenarios (CanDCS-U6), 30-year averages, via MSC GeoMet',
    sourceUrl: 'https://open.canada.ca/data/en/dataset/f73d6939-912a-4add-a291-c233fc5d1946',
    licence: 'ECCC Data Servers End-use Licence (Data Source: Environment and Climate Change Canada)',
    asOf: new Date().toISOString().slice(0, 10),
    baseline: '1971–2000',
    windowYears: 30,
    percentiles: [10, 90],
    vars: Object.fromEntries(Object.entries(VARS).map(([k, v]) => [k, { label: v.label, unit: v.unit }])),
    scenarios: Object.fromEntries(Object.entries(SCEN).map(([k, v]) => [k, v.label])),
    windows: WINDOWS.map((w) => +w.slice(0, 4)),
    towns,
  });
}
