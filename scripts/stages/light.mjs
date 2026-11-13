import { driveTimes } from '../lib/drive.mjs';
import { cached, fetchBuf, log, readOut, round, writeOut } from '../lib/io.mjs';
import { getPlaces, getSmallPlaces, straightTimes } from '../lib/places.mjs';

// Light & dark: day length from each place's latitude (NOAA's solar position equations, with refraction), aurora
// odds from geomagnetic latitude (centred dipole of the latest IGRF-14 epoch, read from the IAGA coefficient file;
// NOAA SWPC's rule for the auroral oval's equatorward edge), and RASC's dark-sky sites, drawn with the park outlines
// the `camping` stage already built, with the drive from each place to the nearest campground inside one.
export default async function light() {
  const places = await getPlaces();
  const outline = await readOut('province');
  const camping = await readOut('camping');
  const year = new Date().getUTCFullYear();
  const R = Math.PI / 180;

  // --- the sun (NOAA Solar Calculator equations: declination at local solar noon)
  const declination = (y, mo, d, lon) => {
    const jd = Date.UTC(y, mo - 1, d, 12) / 864e5 + 2440587.5 - lon / 360;
    const T = (jd - 2451545) / 36525;
    const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const C = Math.sin(M * R) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * R) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * R) * 0.000289;
    const om = 125.04 - 1934.136 * T;
    const lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * R);
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(om * R);
    return Math.asin(Math.sin(eps * R) * Math.sin(lam * R));
  };
  // hours the sun is above `zenith` (90.833°: sunrise to sunset, with refraction and the sun's radius; 96°: civil dawn to dusk)
  const hoursAbove = (lat, dec, zenith) => {
    const cosH = (Math.cos(zenith * R) - Math.sin(lat * R) * Math.sin(dec)) / (Math.cos(lat * R) * Math.cos(dec));
    if (cosH <= -1) return 24;
    if (cosH >= 1) return 0;
    return round((2 * Math.acos(cosH)) / R / 15, 3);
  };
  const DATES = [{ id: 'dec', label: 'Dec 21', m: 12, d: 21 }, { id: 'mar', label: 'Mar 20', m: 3, d: 20 }, { id: 'jun', label: 'Jun 21', m: 6, d: 21 }];
  const day = (lat, lon) => DATES.map((x) => hoursAbove(lat, declination(year, x.m, x.d, lon), 90.833));
  const civil = (lat, lon) => DATES.map((x) => hoursAbove(lat, declination(year, x.m, x.d, lon), 96));

  // --- geomagnetic latitude: IGRF-14 dipole (g10, g11, h11) at the newest main-field epoch
  const IGRF_URL = 'https://www.ngdc.noaa.gov/IAGA/vmod/coeffs/igrf14coeffs.txt';
  const igrfText = (await cached('light/igrf14coeffs.txt', () => fetchBuf(IGRF_URL))).toString('utf8');
  const lines = igrfText.split(/\r?\n/);
  const hdr = lines.find((l) => /^g\/h\s+n\s+m\s/.test(l));
  const kinds = lines.find((l) => /^c\/s\s+deg\s+ord\s/.test(l));
  if (!hdr || !kinds) throw new Error('IGRF coefficient file: header not found');
  const cols = hdr.trim().split(/\s+/), kcols = kinds.trim().split(/\s+/);
  // newest IGRF (main field) column; the last column is the secular variation
  let ci = -1;
  for (let i = 3; i < cols.length; i++) if (/^\d{4}(\.\d)?$/.test(cols[i]) && kcols[i] === 'IGRF') ci = i;
  if (ci < 0) throw new Error('IGRF coefficient file: no IGRF epoch column');
  const epoch = Number(cols[ci]);
  const coef = (gh, n, m) => {
    const l = lines.find((x) => new RegExp(`^${gh}\\s+${n}\\s+${m}\\s`).test(x));
    if (!l) throw new Error(`IGRF coefficient ${gh}${n}${m} missing`);
    return Number(l.trim().split(/\s+/)[ci]);
  };
  const g10 = coef('g', 1, 0), g11 = coef('g', 1, 1), h11 = coef('h', 1, 1);
  const B0 = Math.hypot(g10, g11, h11);
  const poleLat = 90 - Math.acos(-g10 / B0) / R;
  const poleLon = Math.atan2(-h11, -g11) / R;
  const mlat = (lat, lon) => round(Math.asin(Math.sin(lat * R) * Math.sin(poleLat * R) + Math.cos(lat * R) * Math.cos(poleLat * R) * Math.cos((lon - poleLon) * R)) / R, 2);
  log(`  IGRF-14 ${epoch}: g10 ${g10}, g11 ${g11}, h11 ${h11} → north geomagnetic pole ${poleLat.toFixed(2)}°N ${(-poleLon).toFixed(2)}°W`);
  // NOAA SWPC: the oval's equatorward edge sits near 66° geomagnetic at Kp 0 and moves ~2° equatorward per Kp step
  const KP = { k0: 66, perKp: 2, url: 'https://www.swpc.noaa.gov/content/tips-viewing-aurora' };
  // rounded up, so the Kp shown always agrees with the band
  const kpOverhead = (ml) => Math.max(0, Math.ceil(((KP.k0 - ml) / KP.perKp) * 10 - 1e-9) / 10);
  // often: overhead on quiet nights (Kp ≤ 2); sometimes: at Kp 3–4 (unsettled to active); rarely: only in a storm (Kp 5+, NOAA G1+)
  const band = (ml) => (ml >= KP.k0 - 2 * KP.perKp ? 'often' : ml >= KP.k0 - 4 * KP.perKp ? 'sometimes' : 'rarely');

  // --- rows (0.25° of latitude) and aurora cells (0.5° of longitude), clipped to the province outline row by row
  const ring = outline.geometry.coordinates[0][0];
  const xRange = (y) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      if ((y1 <= y && y2 >= y) || (y2 <= y && y1 >= y)) {
        const x = y1 === y2 ? Math.min(x1, x2) : x1 + ((y - y1) / (y2 - y1)) * (x2 - x1);
        const xx = y1 === y2 ? Math.max(x1, x2) : x;
        lo = Math.min(lo, x); hi = Math.max(hi, xx);
      }
    }
    return [lo, hi];
  };
  const rows = [], cells = [];
  const S = 49, N = 60, STEP = 0.25, LSTEP = 0.5;
  for (let s = S; s < N - 1e-9; s += STEP) {
    const n = s + STEP, yc = s + STEP / 2;
    const [w, e] = xRange(yc);
    if (!Number.isFinite(w)) continue;
    const lonC = (w + e) / 2;
    rows.push({ s: round(s, 3), n: round(n, 3), w: round(w, 3), e: round(e, 3), d: day(yc, lonC), c: civil(yc, lonC) });
    for (let x = w; x < e - 1e-9; x += LSTEP) {
      const x2 = Math.min(e, x + LSTEP);
      cells.push([round(x, 3), round(s, 3), round(x2, 3), round(n, 3), mlat(yc, (x + x2) / 2)]);
    }
  }
  // a year of day length at each whole degree of latitude, one value a week (for the panel's chart)
  const curves = [];
  for (let lat = S; lat <= N; lat++) {
    const y = [];
    for (let doy = 1; doy <= 365; doy += 7) {
      const dt = new Date(Date.UTC(year, 0, doy));
      y.push(round(hoursAbove(lat, declination(year, dt.getUTCMonth() + 1, dt.getUTCDate(), -106), 90.833), 2));
    }
    curves.push({ lat, y });
  }

  // --- RASC's designated dark-sky sites in Saskatchewan, matched to park outlines by name
  const RASC_URL = 'https://rasc.ca/lpa/dark-sky-sites';
  const html = (await cached('light/rasc-dark-sky-sites.html', async () => {
    const b = await fetchBuf(RASC_URL, { headers: { Accept: 'text/html' } });
    if (!/Dark-Sky Site/i.test(b.toString('utf8'))) throw new Error('RASC page: no dark-sky table');
    return b;
  })).toString('utf8');
  const text = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;/g, '’').replace(/&nbsp;|&#13;/g, ' ').replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+([),])/g, (_, p) => p).trim();
  const table = html.match(/<table class="sortable">([\s\S]*?)<\/table>/)?.[1];
  if (!table) throw new Error('RASC page: sortable table not found');
  const GENERIC = new Set(['park', 'national', 'provincial', 'interprovincial', 'historic', 'site', 'recreation', 'regional', 'and', 'of', 'the']);
  const words = (s) => s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w && !GENERIC.has(w));
  const sites = [];
  for (const tr of table.split(/<tr>/).slice(1)) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (tds.length < 5) continue;
    const [name, prov, yr, type] = tds.slice(0, 4).map(text);
    if (!/\bSK\b/.test(prov)) continue;
    const info = tds[4].match(/href="([^"]+)"/)?.[1] ?? RASC_URL;
    const site = words(name);
    const parks = camping.parks.map((p, i) => ({ p, i })).filter(({ p }) => { const w = words(p.name); return w.length && w.every((x) => site.includes(x)); });
    sites.push({ name, prov, year: Number(yr) || null, type, info, parks: parks.map((x) => x.i) });
  }
  if (!sites.length) throw new Error('RASC page: no Saskatchewan sites');
  const preserves = sites.filter((s) => s.parks.length).map((s) => ({
    name: s.name.replace(/\s*\(.*\)$/, ''), full: s.name, year: s.year, type: s.type, info: s.info, prov: s.prov,
    parks: s.parks.map((i) => ({ name: camping.parks[i].name, c: camping.parks[i].c, ha: camping.parks[i].ha, polys: camping.parks[i].polys })),
  }));
  const unmapped = sites.filter((s) => !s.parks.length).map(({ parks, ...s }) => s);
  log(`  RASC: ${sites.length} Saskatchewan sites; mapped ${preserves.map((p) => `${p.name} (${p.parks.map((x) => x.name).join(', ')})`).join('; ')}${unmapped.length ? `; no outline for ${unmapped.map((s) => s.name).join(', ')}` : ''}`);

  // --- the drive from each place to the nearest campground (not backcountry) inside a dark-sky preserve
  const parkToPreserve = new Map();
  sites.forEach((s) => { const k = preserves.findIndex((p) => p.full === s.name); if (k >= 0) for (const i of s.parks) parkToPreserve.set(i, k); });
  const targets = camping.camps.filter((c) => c.p != null && parkToPreserve.has(c.p) && c.kind === 'campground').map((c) => ({ name: c.name, lon: c.lon, lat: c.lat, k: parkToPreserve.get(c.p) }));
  if (!targets.length) throw new Error('no campgrounds inside a dark-sky preserve');
  const dr = await driveTimes(places, targets, 'darksky', { pre: targets.length, keep: 1 }); // few targets: rank them all by road

  const towns = {};
  for (const p of places) {
    const ml = mlat(p.lat, p.lon);
    const t = dr.towns[p.key]?.[0];
    towns[p.key] = { d: day(p.lat, p.lon), c: civil(p.lat, p.lon), ml, kp: kpOverhead(ml), a: band(ml), ...(t ? { dk: { f: t.f, min: t.min, km: t.km } } : {}) };
  }
  // tier 2: the same, with the dark-sky campground by straight line (min null)
  const smallP = await getSmallPlaces();
  const sdr = straightTimes(smallP, targets);
  const small = {};
  for (const p of smallP) {
    const ml = mlat(p.lat, p.lon), t = sdr[p.key]?.[0];
    small[p.key] = { d: day(p.lat, p.lon), c: civil(p.lat, p.lon), ml, kp: kpOverhead(ml), a: band(ml), ...(t ? { dk: { f: t.f, min: null, km: t.km } } : {}) };
  }
  const dec = places.map((p) => towns[p.key].d[0]);
  log(`  ${places.length} places: Dec 21 daylight ${Math.min(...dec).toFixed(2)}–${Math.max(...dec).toFixed(2)} h; geomagnetic ${Math.min(...places.map((p) => towns[p.key].ml))}–${Math.max(...places.map((p) => towns[p.key].ml))}°; ${targets.length} preserve campgrounds`);
  await writeOut('light', {
    source: 'Computed: NOAA Global Monitoring Laboratory solar position equations (sunrise/sunset at 90.833°, civil twilight at 96°); IAGA IGRF-14 dipole coefficients; NOAA SWPC Kp–latitude rule; RASC Dark-Sky Sites in Canada',
    year, dates: DATES.map(({ id, label }) => ({ id, label })),
    solarUrl: 'https://gml.noaa.gov/grad/solcalc/calcdetails.html',
    igrf: { model: 'IGRF-14', epoch, g10, g11, h11, poleLat: round(poleLat, 2), poleLon: round(poleLon, 2), url: IGRF_URL },
    kp: KP,
    rasc: { url: RASC_URL, sites: sites.map(({ parks, ...s }) => s) },
    routing: dr.routed ? 'OSRM (router.project-osrm.org) on OpenStreetMap roads, typical free-flow driving' : 'straight-line distance (OSRM unavailable)',
    preserves, unmapped, targets, rows, cells, curves, towns, small,
  });
}
