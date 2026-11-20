// The sky right now: where the sun is (computed in the browser from the clock, with the Astronomical Almanac's
// low-precision formulas, good to about 0.01°), the line where it is rising or setting, and NOAA's aurora forecast grid
// (public/data/now/aurora.json, the `now-aurora` stage). Nothing here is seen from the ground: clouds, the moon and city
// lights decide what a night looks like.
import type { NowAurora } from './data';

const R = Math.PI / 180;
/** The sun's centre this far below the horizon at sunrise and sunset (refraction and its radius), as in the light stage. */
export const SUNSET_ALT = -0.833;
/** Civil twilight ends here; an aurora needs it darker still. */
export const DARK_ALT = -6;
/** The aurora forecast is not drawn once the time it was made for is this many hours past: the oval moves in minutes. */
export const AURORA_DROP_H = 3;

export type Sun = { /** declination, radians */ dec: number; /** longitude the sun is overhead at, degrees east */ lon: number };

export function sunAt(ms: number): Sun {
  const n = ms / 864e5 + 2440587.5 - 2451545.0; // days from J2000.0
  const g = (357.528 + 0.9856003 * n) * R;
  const lam = (280.46 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * R;
  const eps = (23.439 - 4e-7 * n) * R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / R;
  const gmst = 280.46061837 + 360.98564736629 * n;
  return { dec: Math.asin(Math.sin(eps) * Math.sin(lam)), lon: ((((ra - gmst) % 360) + 540) % 360) - 180 };
}

/** The sun's altitude in degrees (no refraction) at a place. */
export const sunAlt = (lat: number, lon: number, s: Sun) =>
  Math.asin(Math.sin(lat * R) * Math.sin(s.dec) + Math.cos(lat * R) * Math.cos(s.dec) * Math.cos((lon - s.lon) * R)) / R;

export type SkyState = 'day' | 'twilight' | 'dark';
export const skyState = (alt: number): SkyState => (alt > SUNSET_ALT ? 'day' : alt > DARK_ALT ? 'twilight' : 'dark');
export const SKY_WORD: Record<SkyState, string> = { day: 'the sun is up', twilight: 'in twilight', dark: 'dark' };

/** The sunrise and sunset lines between two latitudes, as paths of [lon, lat] near longitude `near`. A line is missing
 *  where the sun does not cross the horizon that day (never, inside Saskatchewan). */
export function sunLines(s: Sun, south: number, north: number, near: number) {
  const rise: [number, number][] = [], set: [number, number][] = [];
  const wrap = (lon: number) => near + ((((lon - near) % 360) + 540) % 360) - 180;
  for (let lat = south; lat <= north + 1e-9; lat += 0.5) {
    const c = (Math.sin(SUNSET_ALT * R) - Math.sin(lat * R) * Math.sin(s.dec)) / (Math.cos(lat * R) * Math.cos(s.dec));
    if (Math.abs(c) > 1) continue;
    const h = Math.acos(c) / R;
    rise.push([wrap(s.lon - h), lat]);
    set.push([wrap(s.lon + h), lat]);
  }
  return { rise, set };
}

/** Whether the aurora forecast is recent enough to draw. */
export const auroraLive = (a: NowAurora | null | undefined): a is NowAurora => !!a && (Date.now() - Date.parse(a.valid)) / 36e5 < AURORA_DROP_H;

/** NOAA's chance of aurora overhead (0–100) at a point, interpolated between the grid's 1° values; null off the grid. */
export function auroraAt(a: NowAurora, lon: number, lat: number): number | null {
  const g = a.grid;
  const x = (lon - g.w) / g.step, y = (lat - g.s) / g.step;
  if (!(x >= 0 && y >= 0 && x <= g.nx - 1 && y <= g.ny - 1)) return null;
  const x0 = Math.min(g.nx - 2, Math.floor(x)), y0 = Math.min(g.ny - 2, Math.floor(y));
  const fx = x - x0, fy = y - y0;
  const at = (i: number, j: number) => g.v[j * g.nx + i];
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

/** The window the sky is painted over when there is no aurora grid to take it from (the stage's own window). */
export const SKY_BOUNDS: [number, number, number, number] = [-125, 44, -85, 75];
export const skyBounds = (a: NowAurora | null): [number, number, number, number] =>
  a ? [a.grid.w, a.grid.s, a.grid.w + (a.grid.nx - 1) * a.grid.step, a.grid.s + (a.grid.ny - 1) * a.grid.step] : SKY_BOUNDS;

export const AURORA_RGB: [number, number, number] = [61, 255, 168];
const NIGHT_RGB: [number, number, number] = [3, 6, 24];
/** How strongly a chance is painted (0–1): the square root, so a quiet night's few percent still show, eased in under
 *  3 % so the feed's whole-number steps (0, 1, 2 %) do not draw as blocks. */
export const auroraAlpha = (v: number) => Math.min(1, Math.sqrt(Math.max(0, v) / 100)) * Math.min(1, Math.max(0, v) / 3) * 0.92;
/** Night's shade (0–1): none by day, deepening through twilight to full at 12° below the horizon. */
export const nightAlpha = (alt: number) => Math.max(0, Math.min(1, (SUNSET_ALT - alt) / (12 + SUNSET_ALT))) * 0.55;

/**
 * The sky as a picture for a BitmapLayer over `skyBounds`: night's shade from the sun's altitude, and over it the
 * aurora forecast in green (drawn at a third of its strength where the sun is up, since it cannot be seen there).
 * Rows are spaced in Web Mercator, so the picture lies true on the map.
 */
export function skyImage(a: NowAurora | null, s: Sun): ImageData {
  const [w, so, e, no] = skyBounds(a);
  const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * R) / 2));
  const W = 320, yS = merc(so), yN = merc(no);
  const H = Math.round((W * (yN - yS)) / ((e - w) * R));
  const img = new ImageData(W, H);
  const cosH = new Float64Array(W), lons = new Float64Array(W);
  for (let i = 0; i < W; i++) { lons[i] = w + ((i + 0.5) / W) * (e - w); cosH[i] = Math.cos((lons[i] - s.lon) * R); }
  const sd = Math.sin(s.dec), cd = Math.cos(s.dec);
  for (let j = 0; j < H; j++) {
    const lat = (2 * Math.atan(Math.exp(yN - ((j + 0.5) / H) * (yN - yS))) - Math.PI / 2) / R;
    const sl = Math.sin(lat * R) * sd, cl = Math.cos(lat * R) * cd;
    for (let i = 0; i < W; i++) {
      const alt = Math.asin(sl + cl * cosH[i]) / R;
      const n = nightAlpha(alt);
      const v = a ? auroraAt(a, lons[i], lat) ?? 0 : 0;
      const g = auroraAlpha(v) * (alt > DARK_ALT ? 0.33 : 1);
      // fade out over the window's last 4°, so the picture has no hard edge on the map
      const edge = Math.min(1, Math.max(0, Math.min(lons[i] - w, e - lons[i], lat - so, no - lat) / 4));
      const out = (g + n * (1 - g)) * edge * edge * (3 - 2 * edge);
      const o = (j * W + i) * 4;
      if (out <= 0) continue;
      for (let k = 0; k < 3; k++) img.data[o + k] = Math.round((AURORA_RGB[k] * g + NIGHT_RGB[k] * n * (1 - g)) / (g + n * (1 - g)));
      img.data[o + 3] = Math.round(out * 255);
    }
  }
  return img;
}

/** NOAA's words for the planetary K index. */
export const kpWord = (k: number) => (k >= 5 ? 'a geomagnetic storm' : k >= 4 ? 'active' : k >= 3 ? 'unsettled' : 'quiet');

/** Roughly the middle of the province, for "is it dark in Saskatchewan" at a given time. */
const MID: [number, number] = [-105.5, 54.5];
/**
 * The highest Kp NOAA predicts over the coming night: the forecast's 3-hour windows that start within 24 hours, have not
 * ended, and are dark in mid-Saskatchewan at their middle (any window, when none is dark). Null with no forecast left.
 */
export function kpTonight(a: NowAurora): { t: string; end: string; v: number; dark: boolean } | null {
  const f = a.kpNext, now = Date.now();
  if (!f?.rows?.length) return null;
  const span = f.hours * 36e5;
  const rows = f.rows.map(([t, v]) => ({ t, ms: Date.parse(t), v })).filter((r) => r.ms + span > now && r.ms < now + 24 * 36e5);
  if (!rows.length) return null;
  const dark = rows.filter((r) => sunAlt(MID[1], MID[0], sunAt(r.ms + span / 2)) < DARK_ALT);
  const top = (dark.length ? dark : rows).reduce((b, r) => (r.v > b.v ? r : b));
  return { t: top.t, end: new Date(top.ms + span).toISOString(), v: top.v, dark: dark.length > 0 };
}
