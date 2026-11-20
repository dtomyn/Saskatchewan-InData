import { AIR_GRID, airGrid, layerTimes } from '../lib/geomet.mjs';
import { log, pool, writeNow } from '../lib/io.mjs';

// The wildfire smoke forecast (plans/wow/2-wind-and-smoke.md): ECCC's RAQDPS with FireWork, surface PM2.5 from wildfire
// plumes only, every third hour from now to the end of the newest run (72 hours from its start), on the air grid. Each
// frame is one byte a cell, q = round(10·√(µg/m³)) (so 1 µg/m³ is 10 and the top, 255, is 650), with runs of zeros
// packed as [0, length], then base64. A frame that cannot be read is left out, never a blank one.
const LAYER = 'RAQDPS.Sfc_PM2.5-WildfireSmokePlume';
const EVERY_H = 3, FRAMES = 25;

const quant = (ug) => Math.max(0, Math.min(255, Math.round(10 * Math.sqrt(Math.max(0, ug)))));
function pack(q) {
  const out = [];
  for (let i = 0; i < q.length; ) {
    if (q[i]) { out.push(q[i++]); continue; }
    let n = 0;
    while (i < q.length && !q[i] && n < 255) { i++; n++; }
    out.push(0, n);
  }
  return Buffer.from(out).toString('base64');
}

export default async function nowPlume() {
  const fetched = new Date().toISOString();
  const { run, times } = await layerTimes(LAYER);
  // from the hour now is in, every third hour
  const from = Math.floor(Date.now() / 36e5) * 36e5;
  const want = times.filter((t) => Date.parse(t) >= from).filter((_, i) => i % EVERY_H === 0).slice(0, FRAMES);
  if (want.length < 2) throw new Error(`the newest smoke run (${run}) has no hours still to come`);
  const got = await pool(want, 4, async (t) => {
    try {
      const kg = await airGrid(LAYER, t, run);
      const q = new Uint8Array(kg.length);
      let max = 0;
      for (let i = 0; i < kg.length; i++) {
        const ug = kg[i] * 1e9; // kg/m³ → µg/m³
        if (!(ug >= 0 && ug < 1e6)) throw new Error(`a smoke value out of range (${kg[i]})`);
        q[i] = quant(ug);
        max = Math.max(max, ug);
      }
      return { t, max: Math.round(max * 10) / 10, d: pack(q) };
    } catch (e) { log(`  smoke frame ${t} failed: ${e.message}`); return null; }
  });
  const frames = got.filter(Boolean);
  if (frames.length < 2) throw new Error('fewer than two smoke frames could be read');
  log(`  smoke forecast, run ${run}: ${frames.length} of ${want.length} frames, ${frames[0].t} to ${frames.at(-1).t}, highest ${Math.max(...frames.map((f) => f.max))} µg/m³ on the grid`);
  await writeNow('plume', {
    asOf: fetched, fetched, run, model: 'RAQDPS-FW', everyH: EVERY_H,
    grid: AIR_GRID, frames,
    source: 'Environment and Climate Change Canada, RAQDPS with FireWork: surface PM2.5 from wildfire smoke, MSC GeoMet',
    sourceUrl: 'https://eccc-msc.github.io/open-data/msc-data/nwp_raqdps-fw/readme_raqdps-fw_en/',
    licence: 'ECCC Data Servers End-use Licence', licenceUrl: 'https://eccc-msc.github.io/open-data/licence/readme_en/',
  });
}
