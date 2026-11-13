import { ogcAll } from '../lib/apis.mjs';
import { BBOX } from '../lib/config.mjs';
import { log, pool, round, writeOut } from '../lib/io.mjs';
import { getProvince, inSask } from '../lib/places.mjs';

export default async function climate() {
  await getProvince();
  const stations = (await ogcAll('ahccd-stations', { bbox: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}` }, 'ahccd-stations'))
    .filter((f) => f.properties.measurement_type__type_mesure === 'temp_mean' && inSask(...f.geometry.coordinates, 0.05));
  log(`  ${stations.length} AHCCD temperature stations`);
  const out = [];
  await pool(stations, 6, async (s) => {
    const id = s.properties.station_id__id_station;
    const rows = await ogcAll('ahccd-annual', { station_id__id_station: id }, `ahccd-${id}`);
    const temp = {}, precip = {};
    for (const f of rows) {
      const p = f.properties;
      if (p.period_group__groupe_periode !== 'Annual') continue;
      if (p.temp_mean__temp_moyenne != null && p.temp_mean__temp_moyenne > -50) temp[p.year__annee] = p.temp_mean__temp_moyenne;
      if (p.total_precip__precip_totale != null && p.total_precip__precip_totale >= 0) precip[p.year__annee] = round(p.total_precip__precip_totale, 0);
    }
    const base = Object.entries(temp).filter(([y]) => y >= 1961 && y <= 1990).map(([, v]) => v);
    if (Object.keys(temp).length < 20 || base.length < 15) return;
    out.push({
      id,
      name: s.properties.station_name__nom_station.replace(/_+/g, ' ').trim().replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()),
      lon: round(s.geometry.coordinates[0]), lat: round(s.geometry.coordinates[1]),
      baseline: round(base.reduce((a, b) => a + b, 0) / base.length, 2),
      temp, precip,
    });
  });
  out.sort((a, b) => b.lat - a.lat);
  await writeOut('climate', { source: 'ECCC Adjusted and Homogenized Canadian Climate Data (AHCCD) via api.weather.gc.ca', baselinePeriod: '1961–1990', stations: out });
}
