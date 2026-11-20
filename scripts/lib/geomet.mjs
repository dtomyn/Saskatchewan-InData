// MSC GeoMet's weather-model layers as small grids over the province (plans/wow/2-wind-and-smoke.md): a layer's forecast
// times from its WMS capabilities, and one valid time of it from the WCS as a GeoTIFF resampled to the atlas's air grid.

import { fetchBuf } from './io.mjs';
import { readTiff } from './tiff.mjs';

export const GEOMET = 'https://geo.weather.gc.ca/geomet';
/** The air grid: nodes every 0.25° from (`w`, `s`), rows south to north and each west to east. Saskatchewan with a
 *  margin, so wind and smoke are seen arriving. */
export const AIR_GRID = { w: -112, s: 47.5, nx: 51, ny: 57, step: 0.25 };

/** A layer's valid times (ISO, ascending) and its newest model run, from its own WMS capabilities. */
export async function layerTimes(layer) {
  const caps = (await fetchBuf(`${GEOMET}?service=WMS&version=1.3.0&request=GetCapabilities&layer=${encodeURIComponent(layer)}`, { timeout: 60_000 })).toString('utf8');
  const dim = caps.match(/<Dimension name="time"[^>]*>([^<]+)<\/Dimension>/)?.[1].trim();
  const run = caps.match(/<Dimension name="reference_time"[^>]*default="([^"]+)"/)?.[1];
  if (!dim || !run || !Number.isFinite(Date.parse(run))) throw new Error(`${layer}: no forecast times in its capabilities`);
  let times;
  const [a, b, step] = dim.split('/');
  const h = step?.match(/^PT(\d+)H$/)?.[1];
  if (h) {
    times = [];
    for (let t = Date.parse(a); t <= Date.parse(b); t += h * 36e5) times.push(t);
  } else times = dim.split(',').map((t) => Date.parse(t));
  if (!times.length || times.some((t) => !Number.isFinite(t))) throw new Error(`${layer}: unreadable time list (${dim.slice(0, 80)})`);
  const iso = (t) => new Date(t).toISOString().replace('.000Z', 'Z');
  return { run: iso(Date.parse(run)), times: times.map(iso) };
}

/** One valid time of a layer on the air grid, as a Float64Array in the grid's order. Throws unless the answer is exactly
 *  that grid. */
export async function airGrid(layer, time, run) {
  const g = AIR_GRID, half = g.step / 2;
  const q = [
    'SERVICE=WCS', 'VERSION=2.0.1', 'REQUEST=GetCoverage', `COVERAGEID=${encodeURIComponent(layer)}`,
    'SUBSETTINGCRS=EPSG:4326', 'OUTPUTCRS=EPSG:4326', 'FORMAT=image/tiff',
    `SUBSET=x(${g.w - half},${g.w + (g.nx - 1) * g.step + half})`, `SUBSET=y(${g.s - half},${g.s + (g.ny - 1) * g.step + half})`,
    `RESOLUTION=x(${g.step})`, `RESOLUTION=y(${g.step})`, `TIME=${time}`, `DIM_REFERENCE_TIME=${run}`,
  ].join('&');
  const t = readTiff(await fetchBuf(`${GEOMET}?${q}`, { timeout: 90_000 }), `${layer} ${time}`);
  const near = (x, y) => Math.abs(x - y) < 1e-6;
  if (t.w !== g.nx || t.h !== g.ny || !near(t.west, g.w - half) || !near(t.north, g.s + (g.ny - 1) * g.step + half) || !near(t.dx, g.step) || !near(t.dy, g.step))
    throw new Error(`${layer}: the answer is not the grid asked for (${t.w} × ${t.h} from ${t.west}, ${t.north})`);
  // the picture's rows run north to south
  const v = new Float64Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) v.set(t.v.subarray((g.ny - 1 - j) * g.nx, (g.ny - j) * g.nx), j * g.nx);
  return v;
}
