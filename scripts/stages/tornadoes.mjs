import { arcgisAll } from '../lib/apis.mjs';
import { cached, fetchBuf, log, round, writeOut } from '../lib/io.mjs';
import { parseCSV, ymdFrac } from '../lib/parse.mjs';
import { getProvince, inSask } from '../lib/places.mjs';

// ECCC Canadian National Tornado Database: verified events 1980–2009, with track end points where known.
export default async function tornadoes() {
  await getProvince();
  const base = 'https://data-donnees.az.ec.gc.ca/api/file?path=%2Fweather%2Fproducts%2Fcanadian-national-tornado-database-verified-events-1980-2009-public%2Fcanadian-national-tornado-database-verified-events-1980-2009-public-gis-en%2F';
  const csv = (await cached('raw/tornado-events.csv', () => fetchBuf(`${base}GIS_CAN_VerifiedTornadoes_1980-2009.csv`))).toString('latin1');
  if (/^\s*</.test(csv)) throw new Error('tornado database answered with a web page');
  const rows = parseCSV(csv);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > -998 ? n : null; };
  const out = [];
  for (const r of rows) {
    if (r.PROVINCE !== 'SK') continue;
    const y = num(r.YYYY_LOCAL), m = num(r.MM_LOCAL), d = num(r.DD_LOCAL);
    const lat = num(r.START_LAT_), lon = num(r.START_LON_);
    if (y == null || lat == null || lon == null) continue;
    const lat2 = num(r.END_LAT_N), lon2 = num(r.END_LON_W);
    const f = num(r.FUJITA);
    // row: lon, lat, t, Fujita (null unknown), end lon, end lat, length m, width m, deaths, injuries, damage $K, nearest community
    // … source (0 ECCC, 1 NTP), flags (bit 0: default rating, seen but no damage to rate; bit 1: end point estimated)
    out.push([round(lon, 3), round(lat, 3), round(ymdFrac(y, m, d) + (num(r.HHMM_LOCAL) ?? 1200) / 2400 / 365, 4), f, lon2 == null ? null : round(lon2, 3), lat2 == null ? null : round(lat2, 3), num(r.LENGTH_M), num(r.WIDTH_MAX_), num(r.HUMAN_FATA) ?? 0, num(r.HUMAN_INJ) ?? 0, num(r.DMG_THOUS), r.NEAR_CMMTY || null, 0, 0]);
  }
  const eccc = out.length;

  // Northern Tornadoes Project (Western University): every tornado it has investigated since 2017, from its public
  // event-summary feature service. Re-fetched each month, since the project adds and revises events through the season.
  const NTP = 'https://services.arcgis.com/rGKxabTU9mcXMw7k/arcgis/rest/services/NTP_Event_Summaries_stakeholder/FeatureServer/0';
  const month = new Date().toISOString().slice(0, 7);
  const ntp = await arcgisAll(NTP, { where: "province='Saskatchewan' AND event_type LIKE 'tornado%'", outFields: 'Year,month,day,time,event_name,damage,track_length,max_path_width,mean_motion_from,fatalities_text,injuries,damage_cost_text,event_description' }, `ntp-${month}`);
  let estimatedEnds = 0;
  for (const f of ntp) {
    const p = f.properties;
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (lon == null || !p.Year || !inSask(lon, lat, 0.05)) continue;
    const ef = /ef(\d)/.exec(p.damage ?? '');
    const flags = /^default/.test(p.damage ?? '') ? 1 : 0;
    // NTP gives the start of the track, its length and the direction the tornado came from: walk the length the other
    // way for an approximate end point (marked as estimated)
    let lon2 = null, lat2 = null, est = 0;
    if (p.track_length > 0 && p.mean_motion_from != null) {
      const toward = ((p.mean_motion_from + 180) * Math.PI) / 180;
      lat2 = round(lat + (p.track_length * Math.cos(toward)) / 111.2, 3);
      lon2 = round(lon + (p.track_length * Math.sin(toward)) / (111.2 * Math.cos((lat * Math.PI) / 180)), 3);
      est = 2;
      estimatedEnds++;
    }
    const n = (v) => (/^\d+$/.test(String(v ?? '').trim()) ? Number(v) : 0);
    out.push([round(lon, 3), round(lat, 3), round(ymdFrac(p.Year, p.month, p.day) + (p.time ?? 1200) / 2400 / 365, 4), ef ? Number(ef[1]) : null, lon2, lat2,
      p.track_length > 0 ? Math.round(p.track_length * 1000) : null, p.max_path_width || null, n(p.fatalities_text), n(p.injuries), null, (p.event_name || '').trim() || null, 1, flags | est]);
  }
  out.sort((a, b) => a[2] - b[2]);
  log(`  ${eccc} tornadoes from ECCC (1980–2009), ${out.length - eccc} from the Northern Tornadoes Project (${estimatedEnds} with an estimated track end)`);
  await writeOut('tornadoes', {
    source: 'Environment and Climate Change Canada, Canadian National Tornado Database: Verified Events (1980–2009); Northern Tornadoes Project, Western University, Event Summaries (2017 →), CC BY-NC 4.0',
    sources: [
      { name: 'ECCC Canadian National Tornado Database', from: 1980, to: 2009, scale: 'F' },
      { name: 'Northern Tornadoes Project', from: 2017, to: new Date().getFullYear(), scale: 'EF' },
    ],
    rows: out,
  });
}
