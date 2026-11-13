import { ogcAll } from '../lib/apis.mjs';
import { BBOX } from '../lib/config.mjs';
import { log, pool, round, writeOut } from '../lib/io.mjs';
import { getProvince, inSask } from '../lib/places.mjs';

// ECCC HYDAT annual peak discharge at every Saskatchewan hydrometric station with 8+ years.
export default async function rivers() {
  await getProvince();
  const stations = (await ogcAll('hydrometric-stations', { bbox: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}` }, 'hydro-stations'))
    .filter((f) => f.geometry && f.properties.PROV_TERR_STATE_LOC === 'SK' && inSask(...f.geometry.coordinates, 0.02));
  log(`  ${stations.length} hydrometric stations in Saskatchewan`);
  const out = [];
  await pool(stations, 6, async (s) => {
    const id = s.properties.STATION_NUMBER;
    const peaks = await ogcAll('hydrometric-annual-peaks', { STATION_NUMBER: id }, `peaks-${id}`);
    const byYear = {}, dates = {};
    for (const f of peaks) {
      const p = f.properties;
      if (!/discharge/i.test(p.DATA_TYPE_EN) || !/max/i.test(p.PEAK_CODE_EN) || p.PEAK == null || !p.DATE) continue;
      const y = String(p.DATE).slice(0, 4);
      byYear[y] = round(p.PEAK, 2);
      dates[y] = String(p.DATE).slice(0, 10);
    }
    if (Object.keys(byYear).length < 8) return;
    const sorted = Object.values(byYear).sort((a, b) => a - b);
    out.push({
      id,
      name: s.properties.STATION_NAME.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()),
      lon: round(s.geometry.coordinates[0]), lat: round(s.geometry.coordinates[1]),
      area: round(s.properties.DRAINAGE_AREA_GROSS, 1),
      median: sorted[Math.floor(sorted.length / 2)],
      peaks: byYear, peakDates: dates,
    });
  });
  out.sort((a, b) => a.id.localeCompare(b.id));
  log(`  ${out.length} stations with ≥8 years of peak flow`);
  await writeOut('rivers', { source: 'Environment and Climate Change Canada, HYDAT annual peaks (api.weather.gc.ca)', stations: out });
}
