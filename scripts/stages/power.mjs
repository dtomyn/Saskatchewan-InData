import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { overpass } from '../lib/apis.mjs';
import { distKm, dp, edgeKm, joinPaths } from '../lib/geo.mjs';
import { log, readOut, round, writeOut } from '../lib/io.mjs';
import { getPlaces, getProvince, inSask } from '../lib/places.mjs';

// THE POWER GRID: transmission lines, substations and generating stations as mapped in OpenStreetMap (power=line,
// substation, plant). SaskPower publishes no open map of its grid, so coverage is what mappers have drawn: say so.
// Each place measures them from its town limits (needs.json), like Hidden neighbours.
export default async function power() {
  await getProvince();
  const places = await getPlaces();
  const LINE_KM = 1, PLANT_KM = 10;
  const lineOSM = await overpass('sk-power-lines.json', '[out:json][timeout:300];area["ISO3166-2"="CA-SK"]->.sk;way["power"="line"](area.sk);out tags geom qt;');
  const siteOSM = await overpass('sk-power-sites.json', '[out:json][timeout:300];area["ISO3166-2"="CA-SK"]->.sk;nwr["power"~"^(substation|plant)$"](area.sk);out center tags qt;');
  // the highest voltage a way carries, in kV ("138000;25000" → 138)
  const kv = (t) => { const vs = String(t.voltage ?? '').split(/[;,]/).map((v) => +v.trim()).filter((v) => v > 0); return vs.length ? Math.round(Math.max(...vs) / 1000) : null; };
  const KV_CLASS = (v) => (v == null ? 0 : v >= 200 ? 230 : v >= 100 ? 138 : 72);
  // lines grouped by voltage class and joined end to end, cut to their Saskatchewan runs
  const byClass = new Map();
  for (const e of lineOSM.elements) {
    if (e.type !== 'way' || !e.geometry?.length) continue;
    const c = KV_CLASS(kv(e.tags ?? {}));
    if (!byClass.has(c)) byClass.set(c, []);
    let run = [];
    for (const g of e.geometry) {
      if (inSask(g.lon, g.lat, 0.02)) run.push([g.lon, g.lat]);
      else { if (run.length >= 2) byClass.get(c).push(run); run = []; }
    }
    if (run.length >= 2) byClass.get(c).push(run);
  }
  const lines = [...byClass].map(([c, parts]) => ({
    kv: c || null,
    parts,
    p: joinPaths(parts).map((l) => dp(l, 0.0008).map(([x, y]) => [round(x, 4), round(y, 4)])).filter((l) => l.length >= 2),
  })).sort((a, b) => (b.kv ?? 0) - (a.kv ?? 0));
  const lineKm = (parts) => parts.reduce((a, l) => a + l.reduce((s, c, i) => s + (i ? distKm(l[i - 1][0], l[i - 1][1], c[0], c[1]) : 0), 0), 0);
  const SOURCE = (t) => {
    const s = String(t['plant:source'] ?? t['generator:source'] ?? '').toLowerCase();
    return /coal/.test(s) ? 'coal' : /gas/.test(s) ? 'gas' : /hydro|water/.test(s) ? 'hydro' : /wind/.test(s) ? 'wind' : /solar/.test(s) ? 'solar' : /biomass|biogas|waste|heat/.test(s) ? 'heat' : 'other';
  };
  const mw = (t) => { const m = /([\d.]+)\s*(mw|kw|gw)?/i.exec(String(t['plant:output:electricity'] ?? '')); if (!m) return null; const v = +m[1] * ({ kw: 0.001, gw: 1000 }[m[2]?.toLowerCase()] ?? 1); return v > 0 ? round(v, 1) : null; };
  const subs = [], plants = [];
  for (const e of siteOSM.elements) {
    const t = e.tags ?? {};
    const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
    if (!Number.isFinite(lon) || !inSask(lon, lat, 0.02)) continue;
    if (t.power === 'plant') plants.push({ n: t.name ?? null, o: t.operator ?? null, s: SOURCE(t), mw: mw(t), lon: round(lon, 4), lat: round(lat, 4) });
    // a substation drawn as a point and again as an outline is kept once
    else if (!subs.some((s) => distKm(s[0], s[1], lon, lat) < 0.3)) subs.push([round(lon, 4), round(lat, 4), kv(t), t.name ?? null]);
  }
  plants.sort((a, b) => (b.mw ?? 0) - (a.mw ?? 0));
  log(`  OpenStreetMap: ${lines.map((l) => `${l.kv ?? '?'} kV ${Math.round(lineKm(l.parts))} km`).join(', ')}; ${subs.length} substations, ${plants.length} plants`);
  if (!lines.length || subs.length < 50) throw new Error(`only ${lines.length} line classes and ${subs.length} substations mapped: Overpass answer looks incomplete`);

  // --- per place, from the town limits (needs.json) or, without them, from a circle round the centre
  let needs = null;
  try { needs = await readOut('needs'); } catch { log('  needs.json missing: run the needs stage for town limits'); }
  const fallbackKm = needs?.fallbackKm ?? 3;
  const kmFrom = (p) => {
    const a = needs?.areas?.[p.key];
    if (a?.length) {
      const geom = { type: 'MultiPolygon', coordinates: a };
      const feat = { type: 'Feature', properties: {}, geometry: geom };
      return (lon, lat) => (booleanPointInPolygon([lon, lat], feat) ? 0 : edgeKm(lon, lat, geom));
    }
    return (lon, lat) => Math.max(0, distKm(p.lon, p.lat, lon, lat) - fallbackKm);
  };
  const towns = {};
  for (const p of places) {
    const d = kmFrom(p);
    // the nearest line of each class: points every ~250 m, only those within 30 km of the centre measured exactly
    let line = null;
    for (const l of lines)
      for (const part of l.parts)
        for (let i = 1; i < part.length; i++) {
          const [x0, y0] = part[i - 1], [x1, y1] = part[i];
          const steps = Math.max(1, Math.ceil(distKm(x0, y0, x1, y1) / 0.25));
          for (let s = 0; s <= steps; s++) {
            const x = x0 + ((x1 - x0) * s) / steps, y = y0 + ((y1 - y0) * s) / steps;
            if (distKm(p.lon, p.lat, x, y) > 30) continue;
            const k = d(x, y);
            if (!line || k < line.km || (k === line.km && (l.kv ?? 0) > (line.kv ?? 0))) line = { km: k, kv: l.kv };
          }
        }
    let sub = null;
    for (const s of subs) { if (distKm(p.lon, p.lat, s[0], s[1]) > 60) continue; const k = d(s[0], s[1]); if (!sub || k < sub) sub = k; }
    let plant = null;
    plants.forEach((x, i) => { if (distKm(p.lon, p.lat, x.lon, x.lat) > 60) return; const k = d(x.lon, x.lat); if (k <= PLANT_KM && (!plant || k < plant.km)) plant = { i, km: k }; });
    towns[p.key] = {
      line: line && { km: round(line.km, 1), kv: line.kv },
      sub: sub == null ? null : round(sub, 1),
      plant: plant && { i: plant.i, km: round(plant.km, 1) },
    };
  }
  await writeOut('power', {
    source: 'OpenStreetMap contributors: power lines, substations and generating stations (power=line, substation, plant)',
    licence: 'Open Database Licence (ODbL)', licenceUrl: 'https://www.openstreetmap.org/copyright',
    asOf: new Date().toISOString().slice(0, 10), lineKm: LINE_KM, plantKm: PLANT_KM, fallbackKm,
    totals: { km: Object.fromEntries(lines.map((l) => [l.kv ?? 0, Math.round(lineKm(l.parts))])) },
    lines: lines.map(({ kv: v, p }) => ({ kv: v, p })),
    subs, plants, towns,
  });
}
