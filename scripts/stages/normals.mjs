import { ogcAll } from '../lib/apis.mjs';
import { BBOX } from '../lib/config.mjs';
import { log, round, writeOut } from '../lib/io.mjs';
import { getProvince, inSask } from '../lib/places.mjs';

// ECCC Canadian Climate Normals: 30-year averages of everyday weather per station.
export default async function normals() {
  await getProvince();
  const bbox = `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`;
  const ANNUAL = { 102: 'sun', 69: 'wetDays', 41: 'frostDays', 54: 'snow', 56: 'precip', 1: 'tMean' };
  const annual = await ogcAll('climate-normals', { bbox, MONTH: '13' }, 'normals-annual');
  const monthlyT = await ogcAll('climate-normals', { bbox, NORMAL_ID: '1' }, 'normals-temp-monthly');
  const monthlyP = await ogcAll('climate-normals', { bbox, NORMAL_ID: '56' }, 'normals-precip-monthly');
  const title = (s) => s.toLowerCase().split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ').replace(/\bCda\b/, 'CDA');
  const byStn = new Map();
  const stn = (f) => {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    if (!byStn.has(p.CLIMATE_IDENTIFIER)) byStn.set(p.CLIMATE_IDENTIFIER, { id: p.CLIMATE_IDENTIFIER, name: title(p.STATION_NAME), lon: round(lon), lat: round(lat), yrs: 99, period: `${p.PERIOD_BEGIN}–${p.PERIOD_END}`, wet: null });
    return byStn.get(p.CLIMATE_IDENTIFIER);
  };
  const usable = (p) => p.VALUE != null && (p.YEAR_COUNT_NORMAL_PERIOD ?? 0) >= 10;
  for (const f of annual) {
    const p = f.properties, field = ANNUAL[p.NORMAL_ID];
    if (!field || !usable(p) || !f.geometry) continue;
    const s = stn(f);
    s[field] = round(p.VALUE, 1);
    s.yrs = Math.min(s.yrs, p.YEAR_COUNT_NORMAL_PERIOD);
  }
  for (const f of monthlyT) {
    const p = f.properties;
    if (!usable(p) || !f.geometry || (p.MONTH !== 1 && p.MONTH !== 7)) continue;
    stn(f)[p.MONTH === 1 ? 'tJan' : 'tJul'] = round(p.VALUE, 1);
  }
  for (const f of monthlyP) {
    const p = f.properties;
    if (!usable(p) || !f.geometry || p.MONTH > 12) continue;
    const s = stn(f);
    if (!s.wet || p.VALUE > s.wet[1]) s.wet = [p.MONTH, round(p.VALUE, 0)];
  }
  const stations = [...byStn.values()]
    .filter((s) => inSask(s.lon, s.lat, 0.05))
    .filter((s) => ['sun', 'wetDays', 'frostDays', 'snow'].some((k) => s[k] != null))
    .sort((a, b) => b.lat - a.lat);
  for (const s of stations) if (!s.wet) delete s.wet;
  const periods = [...new Set(stations.map((s) => s.period))];
  log(`  ${stations.length} normals stations, period ${periods.join(', ')}`);
  await writeOut('normals', {
    source: 'Environment and Climate Change Canada, Canadian Climate Normals (api.weather.gc.ca climate-normals collection)',
    period: periods.length === 1 ? periods[0] : periods.join(', '),
    stations: stations.map(({ period, ...s }) => s),
  });
}
