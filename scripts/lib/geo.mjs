// Geometry: distances, line and ring simplification, joining paths.

import { round } from './io.mjs';

/** Great-circle distance in km. */
export function distKm(aLon, aLat, bLon, bLat) {
  const r = Math.PI / 180;
  const s = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

/** Douglas–Peucker on a lon/lat ring, tolerance in degrees. */
export function dp(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-12;
    let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
/** Joins polylines (e.g. a route's OSM ways) that meet end to end into longer ones, flipping pieces as needed. */
export function joinPaths(paths) {
  const k = ([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`;
  const left = paths.map((p) => p.slice());
  const out = [];
  while (left.length) {
    let cur = left.pop();
    for (let grew = true; grew;) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const p = left[i];
        const [a, b, c, d] = [k(cur[0]), k(cur.at(-1)), k(p[0]), k(p.at(-1))];
        if (b === c) cur = [...cur, ...p.slice(1)];
        else if (b === d) cur = [...cur, ...p.slice(0, -1).reverse()];
        else if (a === d) cur = [...p, ...cur.slice(1)];
        else if (a === c) cur = [...p.slice(1).reverse(), ...cur];
        else continue;
        left.splice(i, 1); grew = true; break;
      }
    }
    out.push(cur);
  }
  return out;
}
/** Douglas–Peucker for a closed ring: split at the point farthest from the start so neither half is degenerate. */
export function dpRing(ring, tol) {
  if (ring.length < 5) return ring;
  let k = 1, bd = -1;
  for (let i = 1; i < ring.length - 1; i++) { const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (d > bd) { bd = d; k = i; } }
  const a = dp(ring.slice(0, k + 1), tol), b = dp(ring.slice(k), tol);
  return [...a, ...b.slice(1)];
}
/** Visvalingam–Whyatt for a closed ring: drops the point whose triangle with its neighbours is smallest until every
 * remaining triangle is at least `minArea` (square degrees). Keeps a ragged outline's shape better than Douglas–Peucker,
 * which keeps every outermost spike. */
export function vwRing(ring, minArea) {
  const pts = ring.slice(0, -1), n = pts.length;
  if (n < 4) return ring;
  const prev = new Int32Array(n), next = new Int32Array(n), area = new Float64Array(n), alive = new Uint8Array(n).fill(1);
  for (let i = 0; i < n; i++) { prev[i] = (i - 1 + n) % n; next[i] = (i + 1) % n; }
  const tri = (i) => { const a = pts[prev[i]], b = pts[i], c = pts[next[i]]; return Math.abs((a[0] - c[0]) * (b[1] - a[1]) - (a[0] - b[0]) * (c[1] - a[1])) / 2; };
  const heap = []; // [area, index], lazy deletion
  const push = (v, i) => { heap.push([v, i]); for (let k = heap.length - 1; k;) { const q = (k - 1) >> 1; if (heap[q][0] <= heap[k][0]) break; [heap[q], heap[k]] = [heap[k], heap[q]]; k = q; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; }
    }
    return top;
  };
  for (let i = 0; i < n; i++) { area[i] = tri(i); push(area[i], i); }
  let left = n, floor = 0;
  while (heap.length && left > 3) {
    const [v, i] = pop();
    if (!alive[i] || v !== area[i]) continue;
    if (Math.max(v, floor) >= minArea) break;
    floor = Math.max(v, floor); // an effective area never drops below the last one removed
    alive[i] = 0; left--;
    const a = prev[i], b = next[i];
    next[a] = b; prev[b] = a;
    for (const j of [a, b]) { area[j] = Math.max(tri(j), floor); push(area[j], j); }
  }
  let k = 0;
  while (!alive[k]) k++;
  const out = [], start = k;
  do { out.push(pts[k]); k = next[k]; } while (k !== start);
  out.push(out[0]);
  return out;
}
/** Simplifies and rounds a GeoJSON Polygon/MultiPolygon to an array of polygons (rings of [lon, lat]). */
export function polys(geom, tol, d = 4) {
  const ps = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return ps.map((p) => p.map((ring) => dpRing(ring, tol).map(([x, y]) => [round(x, d), round(y, d)])).filter((r) => r.length >= 4)).filter((p) => p.length);
}
export function ringArea(r) { let s = 0; for (let i = 1; i < r.length; i++) s += (r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1]); return s / 2; }
/** Distance (km) from a point to a Polygon / MultiPolygon's edges, in a local flat projection. */
export function edgeKm(lon, lat, geom) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
  let best = Infinity;
  const ps = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const p of ps) for (const ring of p)
    for (let i = 1; i < ring.length; i++) {
      const ax = (ring[i - 1][0] - lon) * kx, ay = (ring[i - 1][1] - lat) * ky, bx = (ring[i][0] - lon) * kx, by = (ring[i][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const u = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
      best = Math.min(best, Math.hypot(ax + u * dx, ay + u * dy));
    }
  return best;
}
