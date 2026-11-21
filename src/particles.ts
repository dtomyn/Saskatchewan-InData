// Particles that drift with a wind field: a few thousand points moved on the CPU each
// frame, each drawn as a short trail by one deck.gl PathLayer fed from typed arrays. They show the wind's direction and
// speed and count nothing. `step` is only called while the layer is drawn, so a layer that is off costs nothing; a
// visitor who prefers reduced motion gets still arrows (`arrowPaths`) instead.
import type { AirGrid } from './data';

/** A wind field on the air grid: eastward and northward parts in m/s at each node. */
export type Field = { g: AirGrid; u: Float32Array; v: Float32Array };

/** The wind at a point, bilinear between the nodes, written to `out` as [u, v]; false off the grid. */
export function windAt(f: Field, lon: number, lat: number, out: [number, number]): boolean {
  const g = f.g;
  const x = (lon - g.w) / g.step, y = (lat - g.s) / g.step;
  if (!(x >= 0 && y >= 0 && x <= g.nx - 1 && y <= g.ny - 1)) return false;
  const x0 = Math.min(g.nx - 2, Math.floor(x)), y0 = Math.min(g.ny - 2, Math.floor(y));
  const fx = x - x0, fy = y - y0, i = y0 * g.nx + x0;
  const a = (1 - fx) * (1 - fy), b = fx * (1 - fy), c = (1 - fx) * fy, d = fx * fy;
  out[0] = f.u[i] * a + f.u[i + 1] * b + f.u[i + g.nx] * c + f.u[i + g.nx + 1] * d;
  out[1] = f.v[i] * a + f.v[i + 1] * b + f.v[i + g.nx] * c + f.v[i + g.nx + 1] * d;
  return true;
}

let rm: { at: number; v: boolean } = { at: -1e9, v: false };
/** Whether the visitor asks for reduced motion (asked again every second, so a change of setting takes effect). */
export function reducedMotion() {
  const t = performance.now();
  if (t - rm.at > 1000) rm = { at: t, v: window.matchMedia('(prefers-reduced-motion: reduce)').matches };
  return rm.v;
}

/** A wind of this many m/s (about 45 km/h) or more draws at full brightness. */
export const BRIGHT_MS = 12;
/** How many seconds of wind a particle travels each second at zoom 5; halved for each zoom level in, so the trails
 *  cross the screen at the same pace at any zoom. */
const PACE = 16000, PACE_ZOOM = 5;
const TRAIL = 10, SHIFT_MS = 85;
const SLOW: [number, number, number] = [140, 196, 255], FAST: [number, number, number] = [255, 255, 255];

export type Particles = {
  /** Move every particle by `dt` seconds of screen time; new ones start inside `box` (west, south, east, north). */
  step: (dt: number, zoom: number, box: [number, number, number, number]) => void;
  /** The trails as a PathLayer's binary `data` (a new object each call, over the same arrays). */
  data: () => { length: number; startIndices: Uint32Array; attributes: { getPath: { value: Float32Array; size: 3 }; getColor: { value: Uint8Array; size: 4 } } };
};

export function createParticles(f: Field, n = 3000): Particles {
  const g = f.g, E = g.w + (g.nx - 1) * g.step, N = g.s + (g.ny - 1) * g.step;
  const pos = new Float32Array(n * TRAIL * 3), col = new Uint8Array(n * TRAIL * 4);
  const age = new Float32Array(n), life = new Float32Array(n), spd = new Float32Array(n);
  const starts = new Uint32Array(n + 1).map((_, i) => i * TRAIL);
  const w: [number, number] = [0, 0];
  let sinceShift = 0;

  const spawn = (i: number, box: [number, number, number, number], young: boolean) => {
    // inside what the map shows, where that overlaps the grid; the whole grid when it does not
    let x0 = Math.max(g.w, box[0]), y0 = Math.max(g.s, box[1]), x1 = Math.min(E, box[2]), y1 = Math.min(N, box[3]);
    if (!(x1 > x0 && y1 > y0)) { x0 = g.w; y0 = g.s; x1 = E; y1 = N; }
    const lon = x0 + Math.random() * (x1 - x0), lat = y0 + Math.random() * (y1 - y0);
    for (let k = 0, o = i * TRAIL * 3; k < TRAIL; k++, o += 3) { pos[o] = lon; pos[o + 1] = lat; }
    life[i] = 2.5 + Math.random() * 3.5;
    age[i] = young ? Math.random() * life[i] : 0;
    spd[i] = 0;
  };
  for (let i = 0; i < n; i++) spawn(i, [g.w, g.s, E, N], true);

  return {
    step(dt, zoom, box) {
      const pace = PACE * 2 ** (PACE_ZOOM - zoom) * dt;
      sinceShift += dt * 1000;
      const shift = sinceShift >= SHIFT_MS;
      if (shift) {
        sinceShift = 0;
        // every trail moves down one vertex in a single copy; each head is then written again below
        pos.copyWithin(0, 3);
      }
      for (let i = 0; i < n; i++) {
        const h = (i * TRAIL + TRAIL - 1) * 3;
        // after a shift the head holds the next particle's tail: take this particle's place from the vertex before it
        let lon = shift ? pos[h - 3] : pos[h], lat = shift ? pos[h - 2] : pos[h + 1];
        age[i] += dt;
        if (age[i] > life[i] || !windAt(f, lon, lat, w)) { spawn(i, box, false); continue; }
        lon += (w[0] * pace) / (111320 * Math.cos((lat * Math.PI) / 180));
        lat += (w[1] * pace) / 110540;
        pos[h] = lon; pos[h + 1] = lat;
        spd[i] = Math.hypot(w[0], w[1]);
      }
      // colour: brighter and whiter the stronger the wind, fading in and out over a particle's life and along its trail
      for (let i = 0; i < n; i++) {
        const s = Math.min(1, spd[i] / BRIGHT_MS);
        const fade = Math.min(1, age[i] / 0.5, (life[i] - age[i]) / 0.6);
        const a = Math.max(0, fade) * (0.45 + 0.55 * s) * 255;
        const r = SLOW[0] + (FAST[0] - SLOW[0]) * s, gr = SLOW[1] + (FAST[1] - SLOW[1]) * s, b = SLOW[2] + (FAST[2] - SLOW[2]) * s;
        for (let k = 0, o = i * TRAIL * 4; k < TRAIL; k++, o += 4) {
          const t = k / (TRAIL - 1);
          col[o] = r; col[o + 1] = gr; col[o + 2] = b; col[o + 3] = a * t * Math.sqrt(t);
        }
      }
    },
    data: () => ({ length: n, startIndices: starts, attributes: { getPath: { value: pos, size: 3 }, getColor: { value: col, size: 4 } } }),
  };
}

export type Arrow = { path: [number, number][]; s: number };
/** Still arrows, one every `every` nodes: each points where the wind blows to and is longer the stronger it is. */
export function arrowPaths(f: Field, every = 4): Arrow[] {
  const g = f.g, out: Arrow[] = [];
  for (let j = Math.floor(every / 2); j < g.ny; j += every)
    for (let i = Math.floor(every / 2); i < g.nx; i += every) {
      const u = f.u[j * g.nx + i], v = f.v[j * g.nx + i], s = Math.hypot(u, v);
      if (s < 0.3) continue;
      const lon = g.w + i * g.step, lat = g.s + j * g.step, k = 1 / Math.cos((lat * Math.PI) / 180);
      const len = Math.min(0.42, 0.1 + s * 0.028) * (every / 4);
      const dx = u / s, dy = v / s;
      const at = (along: number, side: number): [number, number] => [lon + (dx * along - dy * side) * len * k, lat + (dy * along + dx * side) * len];
      out.push({ s, path: [at(-1, 0), at(1, 0), at(0.35, 0.4), at(1, 0), at(0.35, -0.4)] });
    }
  return out;
}
