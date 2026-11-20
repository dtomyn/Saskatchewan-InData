import { AIR_GRID, airGrid, layerTimes } from '../lib/geomet.mjs';
import { log, writeNow } from '../lib/io.mjs';

// The wind right now (plans/wow/2-wind-and-smoke.md): the 10 m wind of ECCC's Regional Deterministic Prediction System
// (RDPS, 10 km, a new run every 6 hours) for the forecast hour nearest the clock, on the air grid. GeoMet publishes the
// surface wind as speed and direction (the direction it blows from), so the eastward and northward parts are worked
// out here, and kept in steps of 0.25 m/s. A model's forecast for that hour, not a measurement.
const SPEED = 'RDPS_10km_WindSpeed_10m', DIR = 'RDPS_10km_WindDir_10m';
const SCALE = 0.25;

export default async function nowWind() {
  const fetched = new Date().toISOString();
  const { run, times } = await layerTimes(SPEED);
  const now = Date.now();
  const valid = times.reduce((b, t) => (Math.abs(Date.parse(t) - now) < Math.abs(Date.parse(b) - now) ? t : b));
  if (Math.abs(Date.parse(valid) - now) > 3 * 36e5) throw new Error(`the newest wind run (${run}) has no hour near now`);
  // both parts from the same run, one request each
  const [sp, dir] = await Promise.all([airGrid(SPEED, valid, run), airGrid(DIR, valid, run)]);
  const n = sp.length, u = new Array(n), v = new Array(n);
  let top = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const s = sp[i], d = dir[i];
    if (!(s >= 0 && s < 120) || !(d >= 0 && d <= 360.5)) throw new Error(`a wind value out of range (${s} m/s from ${d}°)`);
    const r = (d * Math.PI) / 180;
    const q = (x) => Math.round(x / SCALE); // plain JSON numbers: no byte range to clip a gale to
    u[i] = q(-s * Math.sin(r));
    v[i] = q(-s * Math.cos(r));
    top = Math.max(top, s);
    sum += s;
  }
  log(`  wind for ${valid} (RDPS run ${run}): mean ${(sum / n).toFixed(1)} m/s, strongest ${top.toFixed(1)} m/s on the grid`);
  await writeNow('wind', {
    asOf: fetched, fetched, run, valid, model: 'RDPS', height: 10,
    grid: AIR_GRID, scale: SCALE, u, v,
    source: 'Environment and Climate Change Canada, Regional Deterministic Prediction System (RDPS) 10 m wind, MSC GeoMet',
    sourceUrl: 'https://eccc-msc.github.io/open-data/msc-data/nwp_rdps/readme_rdps_en/',
    licence: 'ECCC Data Servers End-use Licence', licenceUrl: 'https://eccc-msc.github.io/open-data/licence/readme_en/',
  });
}
