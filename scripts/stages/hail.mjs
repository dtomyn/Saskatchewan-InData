import { arcgisAll } from '../lib/apis.mjs';
import { BBOX } from '../lib/config.mjs';
import { dp } from '../lib/geo.mjs';
import { log, round, writeOut } from '../lib/io.mjs';
import { ymdFrac } from '../lib/parse.mjs';
import { getPlaces, getProvince, inSask } from '../lib/places.mjs';

// Northern Hail Project (Western University): its radar hail swaths (MESH, the radar's Maximum Expected Size of Hail)
// for 2022–2024, and the hailstorms in its research database, which it investigated on the ground. CC BY-NC 4.0.
export default async function hail() {
  await getProvince();
  const places = await getPlaces();
  const B = 'https://services.arcgis.com/rGKxabTU9mcXMw7k/arcgis/rest/services';
  const env = { where: '1=1', outFields: '*', geometry: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' };
  const SWATHS = [
    [2022, `${B}/MESH_Hailswaths_2022_and_2023_WFL1(copy)/FeatureServer/0`],
    [2023, `${B}/MESH_Hailswaths_2022_and_2023_WFL1(copy)/FeatureServer/1`],
    [2024, `${B}/MESH_Hailswaths_2024_Lines_WFL1/FeatureServer/0`],
  ];
  // a storm's local (CST) hour as a fraction of a year, from the date's noon
  const at = (y, m, d, localHour) => round(ymdFrac(y, m, d) + ((localHour ?? 12) - 12) / 24 / 365, 4);
  const utcHour = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s ?? '').trim()); return m ? (+m[1] + +m[2] / 60 - 6 + 24) % 24 : null; };
  // "1Wawota-2Lemberg-3Davidson, SK" (one storm, several numbered places) → "Wawota / Lemberg / Davidson";
  // "Unity SK-2Glaslyn SK_(1)64" → "Unity / Glaslyn"; places outside Saskatchewan keep their province
  const tidy = (s) => String(s ?? '').replace(/_\(.*$/, '').replace(/,\s*(SK|AB|MB)\b.*$/, '').replace(/-\d+(?=\p{Lu})/gu, ' / ').replace(/^\d+(?=\p{Lu})/u, '')
    .replace(/\s+SK\b/g, '').replace(/\s+(AB|MB)\b/g, ' ($1)').trim() || null;
  const out = [];
  let pieces = 0;
  for (const [year, url] of SWATHS) {
    const feats = await arcgisAll(url, env, `nhp-mesh-${year}`);
    // a swath with bends is stored as one feature per straight piece (start → bend → … → end), each carrying the whole
    // swath's attributes: put the pieces back together, in order along the track
    const swaths = new Map();
    for (const f of feats) {
      const p = f.properties, g = f.geometry;
      const lines = !g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      const key = [p.File_Name, utcHour(p.Start_Time_of_Hailswath__UTC_), utcHour(p.End_Time_of_Hailswath__UTC_ ?? p.End_Time_of_Hailswath), p.Max_MESH_Value_in_the_Hailswath, p.Hailswath_Length__To_Nearest_ha].join('|');
      const s = swaths.get(key) ?? { p, segs: [], pieceKm: 0 };
      for (const l of lines) if (l.length >= 2) s.segs.push(l.filter((c) => Number.isFinite(c[0])));
      s.pieceKm += p.Swat_Length_km > 0 ? p.Swat_Length_km : 0; // 2022 gives each piece its own length
      swaths.set(key, s);
    }
    let kept = 0;
    for (const { p, segs, pieceKm } of swaths.values()) {
      if (!segs.length) continue;
      pieces += segs.length - 1;
      const near = (a, b) => Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3;
      // start from the piece no other piece runs into, then follow end → start
      const rest = segs.slice();
      let cur = rest.find((s) => !rest.some((o) => o !== s && near(o.at(-1), s[0]))) ?? rest[0];
      const pts = [];
      while (cur) {
        rest.splice(rest.indexOf(cur), 1);
        pts.push(...(pts.length ? cur.slice(1) : cur));
        cur = rest.find((s) => near(s[0], pts.at(-1))) ?? rest[0];
      }
      if (pts.length < 2 || !pts.some(([x, y]) => inSask(x, y, 0.02))) continue;
      const fm = /^(\d{4})(\d{2})(\d{2})_(.*)$/.exec(p.File_Name ?? '');
      if (!fm) continue;
      const path = dp(pts, 0.01).map(([x, y]) => [round(x, 3), round(y, 3)]);
      const mesh = p.Max_MESH_Value_in_the_Hailswath > 0 ? p.Max_MESH_Value_in_the_Hailswath : null;
      const len = p.Hailswath_Length__To_Nearest_ha ?? (pieceKm || null);
      const wid = p.Max_width_of_swath__To_Nearest_ ?? null;
      // row: lon, lat (swath start), t, largest hail mm (radar MESH; null when not given), source (0 radar swath),
      // place name, swath centre line, length km, widest km, hail size word, confirmed on the ground
      out.push([path[0][0], path[0][1], at(+fm[1], +fm[2], +fm[3], utcHour(p.Start_Time_of_Hailswath__UTC_)), mesh, 0, tidy(fm[4]), path, len > 0 ? round(len, 1) : null, wid > 0 ? round(wid, 1) : null, null, 0]);
      kept++;
    }
    log(`  ${year}: ${kept} radar hail swaths over Saskatchewan`);
  }

  // research database: one point per investigated storm, with measured, estimated and reported hail sizes (mm, though
  // some 2025 rows are in cm) and a size word ("golfball")
  const WORD = { pea: 6, marble: 13, penny: 19, nickel: 21, quarter: 24, mothball: 25, walnut: 32, pingpong: 40, golfball: 43, hen: 50, egg: 50, tennisball: 64, baseball: 70, teacup: 76, softball: 100, grapefruit: 102 };
  const nhp = await arcgisAll(`${B}/NHP_Research_Database_(Public_Layer)/FeatureServer/0`, { where: "province_name='saskatchewan'", outFields: 'year,month,day,local_time,event,maximum_measured_hailsize,max_measured_hailsize,maximum_estimated_hailsize,max_estimated_hailsize,maximum_reported_hailsize,max_reported_hailsize,confirmation' }, 'nhp-research');
  let placedByName = 0, dropped = 0;
  for (const f of nhp) {
    const p = f.properties;
    if (!p.year) continue;
    let [lon, lat] = f.geometry?.coordinates ?? [];
    if (!(lon && lat && inSask(lon, lat, 0.05))) {
      // a point off the map (0, 0 or in Alberta): fall back to the first place named in the event, when it is one of ours
      const first = String(p.event ?? '').split(/[/,(]/)[0].trim().toLowerCase();
      const pl = places.find((m) => m.key === first);
      if (!pl) { dropped++; continue; }
      [lon, lat] = [pl.lon, pl.lat];
      placedByName++;
    }
    let best = null, word = null;
    for (const [n, w] of [['maximum_measured_hailsize', 'max_measured_hailsize'], ['maximum_estimated_hailsize', 'max_estimated_hailsize'], ['maximum_reported_hailsize', 'max_reported_hailsize']]) {
      const wmm = WORD[String(p[w] ?? '').toLowerCase().replace(/\s+/g, '')] ?? null;
      let v = p[n] > 0 ? p[n] : null;
      if (v != null && v < 12 && wmm >= 15) v *= 10; // given in cm
      const mm = v ?? wmm;
      if (mm != null && (best == null || mm > best)) { best = mm; word = p[w] || null; }
    }
    const lt = p.local_time > 0 ? Math.floor(p.local_time / 100) + (p.local_time % 100) / 60 : null;
    out.push([round(lon, 3), round(lat, 3), at(p.year, p.month, p.day, lt), best == null ? null : Math.round(best), 1, String(p.event ?? '').trim() || null, null, null, null, word, p.confirmation === 'yes' ? 1 : 0]);
  }
  log(`  ${nhp.length} research-database storms (${placedByName} placed by name, ${dropped} with no usable location); ${pieces} swath pieces joined`);
  out.sort((a, b) => a[2] - b[2]);
  await writeOut('hail', {
    source: 'Northern Hail Project, Western University: MESH hail swaths (2022–2024) and NHP Research Database, CC BY-NC 4.0',
    sources: [{ name: 'Radar hail swaths (MESH)', from: 2022, to: 2024 }, { name: 'NHP Research Database', from: Math.min(...out.filter((r) => r[4] === 1).map((r) => Math.floor(r[2]))), to: Math.max(...out.filter((r) => r[4] === 1).map((r) => Math.floor(r[2]))) }],
    rows: out,
  });
}
