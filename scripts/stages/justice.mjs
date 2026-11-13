import { overpass } from '../lib/apis.mjs';
import { BBOX } from '../lib/config.mjs';
import { driveTimes } from '../lib/drive.mjs';
import { log, round, writeOut } from '../lib/io.mjs';
import { getPlaces, getProvince, getSmallPlaces, inSask, straightTimes } from '../lib/places.mjs';

// Courthouses, police detachments and correctional centres from OpenStreetMap, and the drive from each place to
// its nearest court and police.
export default async function justice() {
  await getProvince();
  const places = await getPlaces();
  const osm = await overpass('sk-justice.json', `[out:json][timeout:240];(nwr["amenity"~"^(courthouse|police|prison)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out center tags qt;`);
  const KIND = { courthouse: 'court', police: 'police', prison: 'corrections' };
  const sites = [];
  const seen = new Set();
  for (const e of osm.elements) {
    const t = e.tags ?? {};
    const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
    if (lon == null || !inSask(lon, lat, 0.01)) continue;
    const kind = KIND[t.amenity];
    // OSM's police tag also covers offices and kiosks; a building with no name is usually a detail of a bigger site
    const name = (t.name ?? t['official_name'] ?? '').trim();
    const op = (t.operator ?? '').trim();
    const rcmp = /rcmp|royal canadian mounted/i.test(`${name} ${op}`);
    const label = name || (kind === 'police' ? (rcmp ? 'RCMP detachment' : 'Police station') : kind === 'court' ? 'Courthouse' : 'Correctional facility');
    const dupe = `${kind}:${round(lon, 2)}:${round(lat, 2)}:${label}`;
    if (seen.has(dupe)) continue;
    seen.add(dupe);
    const city = t['addr:city'] ?? null;
    sites.push({ kind, name: label, op: op || null, rcmp, city, lon: round(lon, 4), lat: round(lat, 4), osm: `${e.type}/${e.id}`, ...(t.website ? { web: t.website } : {}) });
  }
  sites.sort((a, b) => a.kind.localeCompare(b.kind) || b.lat - a.lat);
  const count = (k) => sites.filter((s) => s.kind === k).length;
  log(`  ${count('court')} courthouses, ${count('police')} police sites, ${count('corrections')} correctional sites`);
  const courts = sites.map((s, i) => ({ ...s, i })).filter((s) => s.kind === 'court');
  const police = sites.map((s, i) => ({ ...s, i })).filter((s) => s.kind === 'police');
  const remap = (r, list) => Object.fromEntries(Object.entries(r.towns).map(([k, v]) => [k, v.map((t) => ({ ...t, f: list[t.f].i }))]));
  const c = await driveTimes(places, courts, 'court');
  const p = await driveTimes(places, police, 'police', { keep: 1 });
  const towns = {};
  for (const pl of places) towns[pl.key] = { court: remap(c, courts)[pl.key] ?? [], police: remap(p, police)[pl.key] ?? [] };
  // tier 2: straight lines only (min null), labelled in the app
  const smallP = await getSmallPlaces();
  const sc = { towns: straightTimes(smallP, courts, { keep: 3 }) }, sp = { towns: straightTimes(smallP, police) };
  const small = {};
  for (const pl of smallP) small[pl.key] = { court: remap(sc, courts)[pl.key] ?? [], police: remap(sp, police)[pl.key] ?? [] };
  await writeOut('justice', {
    source: 'OpenStreetMap contributors (amenity=courthouse, police, prison; ODbL), via Overpass',
    routing: c.routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line',
    routingSource: c.routed ? 'Drive times: OSRM demo server, © OpenStreetMap contributors (ODbL)' : null,
    asOf: new Date().toISOString().slice(0, 10),
    // `small`: tier-2 communities, nearest by straight line (min null)
    sites, towns, small,
  });
}
