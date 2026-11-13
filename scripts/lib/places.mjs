// The province outline and the atlas's places (tier 1 and tier 2), read from the stages that write them.

import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { BBOX } from './config.mjs';
import { distKm, polys, ringArea } from './geo.mjs';
import { cachedJSON, log, readOut, round } from './io.mjs';

let outline;
export async function getProvince() {
  if (outline) return outline;
  const fc = await cachedJSON('statcan/province-47.json', `https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/0/query?${new URLSearchParams({ where: "PRUID='47'", outFields: 'PRUID,PRENAME', outSR: '4326', f: 'geojson', maxAllowableOffset: '0.002' })}`, { timeout: 300_000 });
  const g = fc.features?.[0]?.geometry;
  if (!g) throw new Error('province outline missing from the StatCan boundary service');
  const display = polys(g, 0.004);
  const clip = polys(g, 0.02, 3).filter((p) => Math.abs(ringArea(p[0])) > 0.05);
  const clipFeature = { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: clip } };
  outline = { display, clipFeature };
  return outline;
}

/** Inside Saskatchewan (or within ~`tol` degrees of its border). */
export function inSask(lon, lat, tol = 0) {
  if (lon < BBOX.west || lon > BBOX.east || lat < BBOX.south || lat > BBOX.north) return false;
  const f = outline.clipFeature;
  if (booleanPointInPolygon([lon, lat], f)) return true;
  if (!tol) return false;
  for (const [dx, dy] of [[tol, 0], [-tol, 0], [0, tol], [0, -tol]]) if (booleanPointInPolygon([lon + dx, lat + dy], f)) return true;
  return false;
}

/** The atlas's places, with coordinates (from the `places` stage's output). */
let placesMemo;

/** The atlas's own places (tier 1, scripts/places.mjs). */
export async function getPlaces() {
  if (!placesMemo) placesMemo = (await readOut('municipalities')).filter((p) => (p.tier ?? 1) === 1);
  return placesMemo;
}
/**
 * Tier 2: every other city, town, village, resort village and northern municipality (from the `places` stage), [] when
 * municipalities.json has none. Stages that cover them write a `small` table beside their `towns`, so the 62 places'
 * tables never change; drive times are straight lines for them (no OSRM), labelled as such.
 */
let smallMemo;
export async function getSmallPlaces() {
  if (!smallMemo) { try { smallMemo = (await readOut('municipalities')).filter((p) => p.tier === 2); } catch { smallMemo = []; } }
  return smallMemo;
}
/** Tier-2 town limits: each place's own census subdivision outline from subdivisions.json ({} before that stage has run). */
/** The `places` stage hands over the lists it just wrote, so later stages in the same run read them. */
export function setPlaces(list) { placesMemo = list; }
export function setSmallPlaces(list) { smallMemo = list; }

let smallAreaMemo;
export async function smallAreas() {
  if (smallAreaMemo) return smallAreaMemo;
  smallAreaMemo = {};
  try {
    const sub = await readOut('subdivisions');
    const byId = Object.fromEntries(sub.csds.map((c) => [c.id, c.p]));
    for (const p of await getSmallPlaces()) if (byId[p.csd]) smallAreaMemo[p.key] = byId[p.csd];
  } catch { log('  subdivisions.json missing: small communities fall back to a radius'); }
  return smallAreaMemo;
}
/**
 * Straight-line "trips" for tier-2 places: the `keep` nearest targets as { f, min: null, km }, the same shape as
 * `driveTimes` (min null = straight-line only), so the app labels them as distances, never drives.
 */
export function straightTimes(places, targets, { keep = 1 } = {}) {
  const towns = {};
  for (const p of places) towns[p.key] = targets.map((t, j) => ({ f: j, min: null, km: round(distKm(p.lon, p.lat, t.lon, t.lat), 1) })).sort((a, b) => a.km - b.km).slice(0, keep);
  return towns;
}
