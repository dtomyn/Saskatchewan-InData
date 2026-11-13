// The sources view: a cross-section of a trembling aspen, the tree of the parkland belt. Each data source owns a wedge, each
// year is a ring from the pith (1900) out to the bark (today), and a ring glows as bright as that
// source's own record for the year. Projections grow past the bark as a hatched halo. Every number
// here is counted from the loaded data, not typed in.
import * as d3 from 'd3';
import { Data, fmt } from './data';
import { provinceAnomalies } from './metrics';
import { esc } from './html';

type Ring = { v: number; label: string; proj?: boolean };
type Source = {
  id: string; key: string; name: string; color: string; group: string;
  owner: string; title: string; url: string; endpoint: string; licence: string;
  gives: string; read: (d: Data) => { n: number; what: string } | null;
  rings: (d: Data) => Record<number, Ring>;
};
type BarkSource = { name: string; key?: string; owner: string; title: string; url: string; licence: string; gives: string; read?: (d: Data) => string };

const Y0 = 1900;
const NOW = new Date().getFullYear();
const FUT = 2070;
const OGL_CA = 'OGL – Canada';

const norm = (rows: Record<number, number>, f: (v: number, max: number) => number) => {
  const max = Math.max(...Object.values(rows), 1e-9);
  return (y: number) => Math.max(0, Math.min(1, f(rows[y], max)));
};
const span = (rings: Record<number, Ring>) => {
  const ys = Object.keys(rings).map(Number);
  return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const climateDiv = d3.scaleLinear<string>().domain([-1.5, -0.4, 0, 0.4, 1.5]).range(['#2b6cb0', '#7fb3e6', '#9aa3b2', '#f4a08a', '#e0312b']).clamp(true);

const SOURCES: Source[] = [
  {
    id: 'crime', key: 'crime', name: 'Crime severity', color: '#ff4d8d', group: 'Justice & safety',
    owner: 'Statistics Canada', title: 'Table 35-10-0061-01: Crime severity index and weighted clearance rates, police services in Saskatchewan', url: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3510006101',
    endpoint: 'www150.statcan.gc.ca/t1/wds/rest/getFullTableDownloadCSV/35100061', licence: 'Statistics Canada Open Licence',
    gives: 'How serious and how frequent police-reported crime is, and how much of it is solved, by police service.',
    read: (d) => d.crime && { n: sum(Object.values(d.crime.munis).map((m) => Object.keys(m.csi ?? {}).length)), what: `${fmt.int(sum(Object.values(d.crime.munis).map((m) => Object.keys(m.csi ?? {}).length)))} police-service years for ${Object.keys(d.crime.munis).length} places (of ${d.crime.services} services in the table)` },
    rings: (d) => {
      const csi: Record<number, number> = Object.fromEntries(Object.entries(d.crime?.prov.csi ?? {}).map(([y, v]) => [+y, v]));
      const f = norm(csi, (v, m) => v / m);
      return Object.fromEntries(Object.keys(csi).map((y) => [y, { v: 0.15 + 0.85 * f(+y) ** 2, label: `Saskatchewan Crime Severity Index ${csi[+y].toFixed(1)}` }]));
    },
  },
  {
    id: 'justice', key: 'justice', name: 'Courts & police', color: '#ffd166', group: 'Justice & safety',
    owner: 'OpenStreetMap contributors · OSRM', title: 'Courthouses, police stations and correctional facilities (amenity=courthouse, police, prison) via Overpass', url: 'https://www.openstreetmap.org/copyright',
    endpoint: 'overpass-api.de/api/interpreter · router.project-osrm.org', licence: 'ODbL',
    gives: 'Where the courts, police and corrections are, and the drive from each place to its nearest court and police.',
    read: (d) => d.justice && { n: d.justice.sites.length, what: `${d.justice.sites.filter((s) => s.kind === 'court').length} courthouses, ${d.justice.sites.filter((s) => s.kind === 'police').length} police sites and ${d.justice.sites.filter((s) => s.kind === 'corrections').length} correctional sites` },
    rings: (d) => (d.justice ? { [NOW]: { v: 1, label: `${d.justice.sites.length} sites as mapped on ${d.justice.asOf}` } } : {}),
  },
  {
    id: 'treaties', key: 'treaties', name: 'Treaties & reserves', color: '#e9c46a', group: 'Justice & safety',
    owner: 'Indigenous Services Canada · Natural Resources Canada', title: 'Historic Treaties; Aboriginal Lands of Canada Legislative Boundaries (Canada Lands Survey System)', url: 'https://open.canada.ca/data/en/dataset/f281b150-0645-48e4-9c30-01f55f93f78e',
    endpoint: 'geo.sac-isc.gc.ca … Historic_Treaty_E/MapServer · proxyinternet.nrcan-rncan.gc.ca … CLSS_Administrative_Boundaries', licence: OGL_CA,
    gives: 'The numbered treaty areas that cover the province and the legal boundaries of its reserves.',
    read: (d) => d.treaties && { n: d.treaties.treaties.length + d.treaties.reserves.length, what: `${d.treaties.treaties.length} treaty areas and ${fmt.int(d.treaties.reserves.length)} reserve parcels` },
    rings: (d) => Object.fromEntries((d.treaties?.treaties ?? []).flatMap((t) => [[t.year, { v: 1, label: `${t.name} signed` }], ...(t.end ? [[t.end, { v: 0.7, label: `${t.name} adhesions end` }]] : [])])),
  },
  {
    id: 'fires', key: 'fires', name: 'Wildfires', color: '#ff8a3d', group: 'Hazards',
    owner: 'Natural Resources Canada · Canadian Wildland Fire Information System', title: 'Canadian National Fire Database: fire points', url: 'https://cwfis.cfs.nrcan.gc.ca/ha/nfdb',
    endpoint: 'cwfis.cfs.nrcan.gc.ca/downloads/nfdb/fire_pnt/current_version/NFDB_point_txt.zip', licence: OGL_CA,
    gives: 'Every fire Saskatchewan and Parks Canada reported: where it started, when, its cause and how much it burned.',
    read: (d) => d.fires && { n: d.fires.points.length, what: `${fmt.int(d.fires.points.length)} fires` },
    rings: (d) => {
      if (!d.fires) return {};
      const ha: Record<number, number> = {}, n: Record<number, number> = {};
      for (const p of d.fires.points) { const y = Math.floor(p[2]); ha[y] = (ha[y] ?? 0) + p[3]; n[y] = (n[y] ?? 0) + 1; }
      const lh = norm(ha, (v, m) => Math.log1p(v ?? 0) / Math.log1p(m));
      return Object.fromEntries(Object.keys(ha).map((y) => [y, { v: lh(+y), label: `${fmt.ha(ha[+y])} burned · ${fmt.int(n[+y])} fires` }]));
    },
  },
  {
    id: 'smoke', key: 'smoke', name: 'Smoke & air', color: '#e8a87c', group: 'Hazards',
    owner: 'Environment and Climate Change Canada', title: 'National Air Pollution Surveillance (NAPS) program: hourly PM2.5', url: 'https://data-donnees.az.ec.gc.ca/data/air/monitor/national-air-pollution-surveillance-naps-program/',
    endpoint: 'data-donnees.az.ec.gc.ca/api/file?path=…/Data-Donnees/{year}/ContinuousData-DonneesContinu/HourlyData-DonneesHoraires/PM25_{year}.csv', licence: OGL_CA,
    gives: 'Hourly fine-particle readings at Saskatchewan’s air stations, counted into smoke days a year.',
    read: (d) => d.smoke && { n: sum(d.smoke.stations.map((s) => Object.keys(s.days).length)), what: `${sum(d.smoke.stations.map((s) => Object.keys(s.days).length))} station-years from ${d.smoke.stations.length} stations` },
    rings: (d) => {
      const r: Record<number, number[]> = {};
      for (const s of d.smoke?.stations ?? []) for (const [y, v] of Object.entries(s.days)) (r[+y] ??= []).push(v);
      return Object.fromEntries(Object.entries(r).map(([y, xs]) => {
        const m = sum(xs) / xs.length;
        return [y, { v: Math.max(0.12, Math.min(1, m / 40)), label: `${m.toFixed(0)} smoke days on average at ${xs.length} station${xs.length === 1 ? '' : 's'}` }];
      }));
    },
  },
  {
    id: 'tornadoes', key: 'tornadoes', name: 'Tornadoes to 2009', color: '#9ad8ff', group: 'Hazards',
    owner: 'Environment and Climate Change Canada', title: 'Canadian National Tornado Database: Verified Events (1980–2009)', url: 'https://open.canada.ca/data/en/dataset/fd3355a7-ae34-4df7-b477-07306182db69',
    endpoint: 'data-donnees.az.ec.gc.ca/api/file · GIS_CAN_VerifiedTornadoes_1980-2009.csv', licence: OGL_CA,
    gives: 'Every verified tornado: where and when it touched down, its Fujita rating, deaths, injuries and damage.',
    read: (d) => { const rows = (d.tornadoes?.rows ?? []).filter((r) => r[12] === 0); return rows.length ? { n: rows.length, what: `${fmt.int(rows.length)} Saskatchewan tornadoes` } : null; },
    rings: (d) => {
      const n: Record<number, number> = {};
      for (const r of d.tornadoes?.rows ?? []) if (r[12] === 0) { const y = Math.floor(r[2]); n[y] = (n[y] ?? 0) + 1; }
      const f = norm(n, (v, m) => Math.sqrt(v / m));
      return Object.fromEntries(Object.keys(n).map((y) => [y, { v: f(+y), label: `${n[+y]} tornado${n[+y] === 1 ? '' : 'es'}` }]));
    },
  },
  {
    id: 'tornadoes', key: 'tornadoes', name: 'Tornadoes since 2017', color: '#7cc4ff', group: 'Hazards',
    owner: 'Northern Tornadoes Project, Western University', title: 'NTP Event Summaries (open data hub)', url: 'https://ntpopendata-westernu.opendata.arcgis.com/',
    endpoint: 'services.arcgis.com/rGKxabTU9mcXMw7k · NTP_Event_Summaries_stakeholder/FeatureServer', licence: 'CC BY-NC 4.0',
    gives: 'Every tornado the project has investigated, found from reports, radar, satellite and drone imagery: Enhanced Fujita rating, track length and width, direction.',
    read: (d) => { const rows = (d.tornadoes?.rows ?? []).filter((r) => r[12] === 1); return rows.length ? { n: rows.length, what: `${fmt.int(rows.length)} Saskatchewan tornadoes` } : null; },
    rings: (d) => {
      const n: Record<number, number> = {};
      for (const r of d.tornadoes?.rows ?? []) if (r[12] === 1) { const y = Math.floor(r[2]); n[y] = (n[y] ?? 0) + 1; }
      const f = norm(n, (v, m) => Math.sqrt(v / m));
      return Object.fromEntries(Object.keys(n).map((y) => [y, { v: f(+y), label: `${n[+y]} tornado${n[+y] === 1 ? '' : 'es'}` }]));
    },
  },
  {
    id: 'hail', key: 'hail', name: 'Hail', color: '#c3b5ff', group: 'Hazards',
    owner: 'Northern Hail Project, Western University', title: 'MESH hail swaths (2022–2024) and NHP Research Database (public layers)', url: 'https://www.uwo.ca/nhp/',
    endpoint: 'services.arcgis.com/rGKxabTU9mcXMw7k · MESH_Hailswaths_2022_and_2023_WFL1(copy), MESH_Hailswaths_2024_Lines_WFL1, NHP_Research_Database_(Public_Layer)', licence: 'CC BY-NC 4.0',
    gives: 'Hail swaths traced on weather radar, with the radar’s largest expected hail (MESH), and the hailstorms the project investigated, with measured, estimated and reported stones.',
    read: (d) => d.hail && { n: d.hail.rows.length, what: `${fmt.int(d.hail.rows.filter((r) => r[4] === 0).length)} radar hail swaths and ${d.hail.rows.filter((r) => r[4] === 1).length} investigated storms` },
    rings: (d) => {
      const n: Record<number, number> = {};
      for (const r of d.hail?.rows ?? []) { const y = Math.floor(r[2]); n[y] = (n[y] ?? 0) + 1; }
      const f = norm(n, (v, m) => Math.sqrt(v / m));
      return Object.fromEntries(Object.keys(n).map((y) => [y, { v: f(+y), label: `${n[+y]} hail record${n[+y] === 1 ? '' : 's'}` }]));
    },
  },
  {
    id: 'drought', key: 'drought', name: 'Drought', color: '#e0a43a', group: 'Hazards',
    owner: 'Agriculture and Agri-Food Canada', title: 'Canadian Drought Monitor: monthly drought areas (D0–D4)', url: 'https://open.canada.ca/data/en/dataset/292646cd-619f-4200-afb1-8b2c52f984a2',
    endpoint: 'agriculture.canada.ca/imagery-images/rest/services/canadian_drought_monitor/ImageServer · exportImage, one month at a time, as raw categories on a 10 km grid', licence: OGL_CA,
    gives: 'The month-end consensus map of abnormally dry (D0) to exceptional drought (D4) areas, every month since late 2002, clipped to Saskatchewan.',
    read: (d) => d.drought && { n: d.drought.months.length, what: `${d.drought.months.length} monthly maps, ${d.drought.months[0]} to ${d.drought.months.at(-1)}` },
    rings: (d) => {
      const r: Record<number, number[]> = {};
      d.drought?.months.forEach((m, i) => (r[+m.slice(0, 4)] ??= []).push(d.drought!.share[i][2]));
      return Object.fromEntries(Object.entries(r).map(([y, xs]) => {
        const m = sum(xs) / xs.length;
        return [y, { v: Math.max(0.12, Math.min(1, m / 30)), label: `${m.toFixed(0)}% of the province in severe drought or worse on average (${xs.length} monthly maps)` }];
      }));
    },
  },
  {
    id: 'rivers', key: 'rivers', name: 'River floods', color: '#4cc9f0', group: 'Hazards',
    owner: 'Environment and Climate Change Canada', title: 'HYDAT national water data archive: annual peak flows', url: 'https://api.weather.gc.ca/collections/hydrometric-annual-peaks',
    endpoint: 'api.weather.gc.ca/collections/hydrometric-annual-peaks', licence: OGL_CA,
    gives: 'Each year’s highest flow at river gauges, compared with the river’s normal peak.',
    read: (d) => d.rivers && { n: sum(d.rivers.stations.map((s) => Object.keys(s.peaks).length)), what: `${fmt.int(sum(d.rivers.stations.map((s) => Object.keys(s.peaks).length)))} annual peaks from ${d.rivers.stations.length} gauges` },
    rings: (d) => {
      const r: Record<number, number[]> = {};
      for (const s of d.rivers?.stations ?? []) for (const [y, v] of Object.entries(s.peaks)) if (s.median) (r[+y] ??= []).push(v / s.median);
      return Object.fromEntries(Object.entries(r).map(([y, xs]) => {
        const m = sum(xs) / xs.length;
        return [y, { v: Math.max(0.12, Math.min(1, (m - 0.6) / 0.9)), label: `peaks averaged ${Math.round(m * 100)}% of normal at ${xs.length} gauges` }];
      }));
    },
  },
  {
    id: 'climate', key: 'climate', name: 'Climate', color: '#f25f5c', group: 'Climate',
    owner: 'Environment and Climate Change Canada', title: 'Adjusted and Homogenized Canadian Climate Data (AHCCD)', url: 'https://api.weather.gc.ca/collections/ahccd-annual',
    endpoint: 'api.weather.gc.ca/collections/ahccd-annual', licence: OGL_CA,
    gives: 'A century of station temperatures, corrected for moves and instrument changes.',
    read: (d) => d.climate && { n: sum(d.climate.stations.map((s) => Object.keys(s.temp).length)), what: `${fmt.int(sum(d.climate.stations.map((s) => Object.keys(s.temp).length)))} station-years from ${d.climate.stations.length} stations` },
    rings: (d) => {
      if (!d.climate) return {};
      const a = provinceAnomalies(d);
      return Object.fromEntries(Object.entries(a).map(([y, v]) => [y, { v, label: `${fmt.signed(v, 2)} °C against ${d.climate!.baselinePeriod}` }]));
    },
  },
  {
    id: 'normals', key: 'normals', name: 'Climate normals', color: '#c5e86c', group: 'Climate',
    owner: 'Environment and Climate Change Canada', title: 'Canadian Climate Normals', url: 'https://api.weather.gc.ca/collections/climate-normals',
    endpoint: 'api.weather.gc.ca/collections/climate-normals', licence: OGL_CA,
    gives: 'Thirty-year averages of sunshine, rain and snow days, frost days and snowfall.',
    read: (d) => d.normals && { n: d.normals.stations.length, what: `${d.normals.stations.length} stations’ ${d.normals.period} normals` },
    rings: (d) => {
      if (!d.normals) return {};
      const [a, b] = d.normals.period.split(/[–-]/).map(Number);
      const out: Record<number, Ring> = {};
      for (let y = a; y <= b; y++) out[y] = { v: 0.55, label: `inside the ${d.normals.period} averaging period` };
      return out;
    },
  },
  {
    id: 'light', key: 'light', name: 'Light & dark', color: '#a3b8ff', group: 'Climate',
    owner: 'Computed · IAGA (IGRF-14) · NOAA SWPC · RASC · Sask. Parks / Parks Canada outlines · OSRM', title: 'Day length from NOAA’s solar position equations; geomagnetic latitude from the IGRF-14 dipole coefficients; Kp and the auroral oval (NOAA SWPC); Dark-Sky Sites in Canada (RASC)', url: 'https://rasc.ca/lpa/dark-sky-sites',
    endpoint: 'computed in the light stage · ngdc.noaa.gov/IAGA/vmod/coeffs/igrf14coeffs.txt · rasc.ca/lpa/dark-sky-sites (table read as text) · camping.json park outlines · router.project-osrm.org', licence: 'Computed; IGRF coefficients freely available (IAGA); RASC list cited for the designations only; park outlines OGL – Saskatchewan / OGL – Canada; routes ODbL',
    gives: 'Daylight and civil twilight on the solstices and equinox at every place, how often the aurora comes overhead (geomagnetic latitude), and where the dark-sky preserves are, with the drive to the nearest campground inside one.',
    read: (d) => d.light && { n: Object.keys(d.light.towns).length, what: `daylight and aurora for ${Object.keys(d.light.towns).length} places; ${d.light.preserves.length} dark-sky preserves (IGRF-14 ${d.light.igrf.epoch})` },
    rings: (d) => (d.light ? { [d.light.igrf.epoch]: { v: 0.7, label: `IGRF-14 geomagnetic field, epoch ${d.light.igrf.epoch}` }, [d.light.year]: { v: 1, label: `day length computed for ${d.light.year}` } } : {}),
  },
  {
    id: 'population', key: 'population', name: 'Population', color: '#3ecf8e', group: 'People & places',
    owner: 'Statistics Canada', title: 'Table 17-10-0155-01: Population estimates, July 1, by census subdivision', url: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1710015501',
    endpoint: 'www150.statcan.gc.ca/t1/wds/rest/getFullTableDownloadCSV/17100155', licence: 'Statistics Canada Open Licence',
    gives: 'People in every city, town and northern village, year by year.',
    read: (d) => d.population && { n: sum(Object.values(d.population.munis).map((m) => Object.keys(m.pop).length)), what: `${fmt.int(sum(Object.values(d.population.munis).map((m) => Object.keys(m.pop).length)))} place-years for ${Object.keys(d.population.munis).length} places` },
    rings: (d) => {
      const tot: Record<number, number> = {};
      for (const m of Object.values(d.population?.munis ?? {})) for (const [y, v] of Object.entries(m.pop)) tot[+y] = (tot[+y] ?? 0) + v;
      const f = norm(tot, (v, m) => v / m);
      return Object.fromEntries(Object.keys(tot).map((y) => [y, { v: 0.15 + 0.85 * f(+y) ** 2, label: `${fmt.int(tot[+y])} people in the atlas’s places` }]));
    },
  },
  {
    id: 'housing', key: 'housing', name: 'Home costs', color: '#e6a57e', group: 'People & places',
    owner: 'Statistics Canada · CMHC', title: 'Census Profile 2021 by census subdivision (98-401-X2021006); CMHC Rental Market Survey via Tables 34-10-0133-01, 34-10-0130-01 and 34-10-0132-01', url: 'https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/index.cfm?Lang=E',
    endpoint: 'api.statcan.gc.ca/census-recensement/profile/sdmx/rest (DF_CSD, DF_PR) · www150.statcan.gc.ca/t1/wds/rest/getFullTableDownloadCSV/34100133', licence: 'Statistics Canada Open Licence',
    gives: 'What homes are worth and what owners and renters pay in every place; market rents and vacancy in the surveyed centres, year by year.',
    read: (d) => d.housing && { n: Object.keys(d.housing.census).length + sum(Object.values(d.housing.rent).map((r) => Object.keys(r.r2).length)), what: `census home costs for ${Object.keys(d.housing.census).length} places; ${sum(Object.values(d.housing.rent).map((r) => Object.keys(r.r2).length))} centre-years of CMHC rents for ${Object.keys(d.housing.rent).length} centres` },
    rings: (d) => {
      if (!d.housing) return {};
      const out: Record<number, Ring> = {};
      const mean: Record<number, number[]> = {};
      for (const r of Object.values(d.housing.rent)) for (const [y, v] of Object.entries(r.r2)) (mean[+y] ??= []).push(v);
      const avg: Record<number, number> = Object.fromEntries(Object.entries(mean).map(([y, a]) => [+y, sum(a) / a.length]));
      const f = norm(avg, (v, m) => v / m);
      for (const y of Object.keys(avg)) out[+y] = { v: 0.15 + 0.85 * f(+y) ** 2, label: `average 2-bedroom rent $${fmt.int(avg[+y])} across ${mean[+y].length} surveyed centres` };
      out[2021] = { v: 1, label: `Census 2021: ${Object.keys(d.housing.census).length} places’ home values and shelter costs${avg[2021] ? `; 2-bed rent $${fmt.int(avg[2021])}` : ''}` };
      return out;
    },
  },
  {
    id: 'housing', key: 'tax', name: 'Property tax', color: '#ffb38a', group: 'People & places',
    owner: 'Sask. Ministry of Government Relations', title: 'Mill Rate Survey Results (Publications Centre product 72573): uniform municipal mill rates, residential mill rate factors, base and minimum tax use, school levies', url: 'https://www.saskatchewan.ca/government/municipal-administration/taxation-and-service-fees/mill-rate-returns',
    endpoint: 'publications.saskatchewan.ca/api/v1/products/72573 (falls back to web.archive.org’s copy when the Publications Centre is down)', licence: 'Crown copyright, Government of Saskatchewan: non-commercial reproduction (saskatchewan.ca copyright terms); no open licence',
    gives: 'Each place’s residential mill rate and the provincial education rate, applied to its census median home for an indicative yearly tax.',
    read: (d) => d.tax && { n: Object.keys(d.tax.places).length, what: `${d.tax.year} mill rates for ${Object.keys(d.tax.places).length} places` },
    rings: (d) => (d.tax ? { [d.tax.year]: { v: 1, label: `${d.tax.year} Mill Rate Survey: ${Object.keys(d.tax.places).length} places` } } : {}),
  },
  {
    id: 'jobs', key: 'jobs', name: 'Jobs & income', color: '#7fd1b9', group: 'People & places',
    owner: 'Statistics Canada', title: 'Table 14-10-0464-01: Labour force characteristics by province, territory and economic region, annual; Census Profile 2021 by census subdivision (98-401-X2021006); economic regions from the 2021 Census Cartographic Boundary Files', url: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1410046401',
    endpoint: 'www150.statcan.gc.ca/t1/wds/rest/getFullTableDownloadCSV/14100464 · api.statcan.gc.ca/census-recensement/profile/sdmx/rest (DF_CSD, DF_PR) · geo.statcan.gc.ca … 2021/Cartographic_boundary_files/MapServer/2', licence: 'Statistics Canada Open Licence',
    gives: 'Unemployment and employment rates for Saskatchewan’s economic regions, year by year; median household income and the main industries in every place.',
    read: (d) => d.jobs && { n: sum(d.jobs.regions.map((r) => Object.keys(r.ur).length)) + Object.keys(d.jobs.towns).length, what: `${sum(d.jobs.regions.map((r) => Object.keys(r.ur).length))} region-years of Labour Force Survey rates for ${d.jobs.regions.length} regions; census income and industries for ${Object.values(d.jobs.towns).filter((t) => t.inc != null).length} places` },
    rings: (d) => {
      if (!d.jobs) return {};
      const ur = d.jobs.prov.ur;
      const out: Record<number, Ring> = Object.fromEntries(Object.entries(ur).map(([y, v]) => [+y, { v: 0.2 + 0.8 * Math.max(0, Math.min(1, (v - 3) / 6)), label: `Saskatchewan unemployment ${v.toFixed(1)}%` }]));
      out[2021] = { v: 1, label: `Census 2021: income and industries for ${Object.keys(d.jobs.towns).length} places${ur[2021] != null ? `; unemployment ${ur[2021].toFixed(1)}%` : ''}` };
      return out;
    },
  },
  {
    id: 'needs', key: 'needs', name: 'Daily needs', color: '#2ec4b6', group: 'People & places',
    owner: 'OpenStreetMap contributors · Statistics Canada', title: 'shop=supermarket, grocery; amenity=pharmacy, school, bank, fuel, library, post_office, clinic, doctors; healthcare=pharmacy, clinic, doctor. Town limits: 2021 census subdivision boundaries', url: 'https://www.openstreetmap.org/copyright',
    endpoint: 'overpass-api.de/api/interpreter · geo.statcan.gc.ca … 2021/Cartographic_boundary_files/MapServer/9', licence: `ODbL; boundaries Statistics Canada Open Licence`,
    gives: 'Whether each place has a grocery store, pharmacy, school, bank, gas station, library, post office and clinic inside its town limits.',
    read: (d) => d.needs && { n: d.needs.sites.length, what: `${fmt.int(d.needs.sites.length)} everyday services counted in ${Object.keys(d.needs.towns).length} places` },
    rings: (d) => (d.needs ? { [NOW]: { v: 1, label: `${fmt.int(d.needs.sites.length)} services as mapped on ${d.needs.asOf}` } } : {}),
  },
  {
    id: 'schools', key: 'schools', name: 'Schools & learning', color: '#ffb703', group: 'People & places',
    owner: 'Sask. Ministry of Education · Ministry of Advanced Education · OpenStreetMap · OSRM', title: 'SchoolsAndDivisions (K-12 schools: public, separate, Francophone, band) and AdvancedEducation (post-secondary institutions), Saskatchewan GeoHub; amenity=school (schools the ministry layer lacks), university, college', url: 'https://gis.saskatchewan.ca/arcgis/rest/services/Education',
    endpoint: 'gis.saskatchewan.ca … Education/SchoolsAndDivisions/MapServer/2–5 · Education/AdvancedEducation/MapServer/0 · overpass-api.de · router.project-osrm.org', licence: 'Open Government Licence – Saskatchewan; OSM and routes ODbL',
    gives: 'Every K-12 school, who runs it and whether it teaches in French; universities, polytechnic and regional college campuses; the drive from each place to the nearest of each.',
    read: (d) => d.schools && { n: d.schools.schools.length + d.schools.pse.length, what: `${fmt.int(d.schools.schools.length)} K-12 schools and ${d.schools.pse.length} post-secondary sites` },
    rings: (d) => (d.schools ? { [NOW]: { v: 1, label: `${fmt.int(d.schools.schools.length)} schools as listed on ${d.schools.asOf}` } } : {}),
  },
  {
    id: 'internet', key: 'internet', name: 'Internet & mobile', color: '#e9a8ff', group: 'People & places',
    owner: 'Innovation, Science and Economic Development Canada', title: 'National Broadband Data (NBD PHH Speeds, current service; NBD Map hexagon data) and Pseudo-Household Demographic Distribution 2021', url: 'https://open.canada.ca/data/en/dataset/00a331db-121b-445d-b119-35dbbe3eedd9',
    endpoint: 'ised-isde.canada.ca/app/scr/sittibc/web/api/openData/NBD_PHH_Speeds.zip · PHH_2021_CSV.zip · Map_Data_CSV.zip · CHX_EXO_CSV.zip', licence: OGL_CA,
    gives: 'The fixed internet speed tier offered to homes across the province and in every place, whether by wire, and where LTE mobile service reaches.',
    read: (d) => d.internet && { n: d.internet.hexes.length, what: `${fmt.int(d.internet.hexes.length)} hexagons; ${fmt.int(d.internet.prov.hh)} households, ${d.internet.prov.f50}% offered 50/10` },
    rings: (d) => (d.internet ? { [NOW]: { v: 1, label: `${d.internet.prov.f50}% of homes offered 50/10 Mbps, as downloaded on ${d.internet.asOf}` } } : {}),
  },
  {
    id: 'community', key: 'community', name: 'Who lives here', color: '#f0a6ca', group: 'People & places',
    owner: 'Statistics Canada · OpenStreetMap contributors', title: 'Census of Population 2021, Census Profile (98-401-X2021006) by census subdivision: immigrant status and period of immigration, place of birth, language spoken most often at home, mother tongue, knowledge of official languages, Indigenous identity; amenity=place_of_worship with religion', url: 'https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/index.cfm',
    endpoint: 'api.statcan.gc.ca/census-recensement/profile/sdmx/rest/data/STC_CP,DF_CSD · overpass-api.de/api/interpreter', licence: 'Statistics Canada Open Licence; OSM ODbL',
    gives: 'How many people in each place are immigrants, where they were born, the languages spoken at home, French speakers and Indigenous identity; places of worship in town by religion.',
    read: (d) => d.community && { n: Object.keys(d.community.towns).length + d.community.sites.length, what: `census profile for ${Object.values(d.community.towns).filter((t) => t.hhPop != null).length} places; ${fmt.int(d.community.sites.length)} places of worship` },
    rings: (d) => (d.community ? { 2021: { v: 1, label: `Census 2021: who lives in ${Object.keys(d.community.towns).length} places` }, [NOW]: { v: 0.7, label: `${fmt.int(d.community.sites.length)} places of worship as mapped on ${d.community.asOf}` } } : {}),
  },
  {
    id: 'newcomer', key: 'newcomer', name: 'Newcomer services', color: '#4fd1c5', group: 'People & places',
    owner: 'Immigration, Refugees and Citizenship Canada · Government of Saskatchewan · OpenStreetMap contributors', title: 'Find free newcomer services near you (IRCC-funded settlement and language offices); Find immigration services near you (provincial settlement services, typed from the web page); Service Canada offices and SGI motor licence issuers as mapped in OSM', url: 'https://ircc.canada.ca/english/newcomers/services/index.asp',
    endpoint: 'ircc.canada.ca/js/tools/services/services-info.js · saskatchewan.ca (typed into scripts/fetch-data.mjs) · overpass-api.de/api/interpreter · router.project-osrm.org', licence: 'Government of Canada and Government of Saskatchewan web content (reproduction permitted, non-commercial); OSM ODbL',
    gives: 'Where to get free settlement help and English classes, a Social Insurance Number (Service Canada) and a driver’s licence and plates (SGI), and the drive from each place to the nearest of each.',
    read: (d) => d.newcomer && { n: d.newcomer.agencies.length + d.newcomer.offices.length, what: `${d.newcomer.agencies.length} settlement and language offices (${d.newcomer.agencies.filter((a) => a.g).length} on the province’s list); ${d.newcomer.offices.filter((o) => o.k === 'sc' || o.k === 'so').length} Service Canada sites, ${d.newcomer.offices.filter((o) => o.k === 'sgi' || o.k === 'ins').length} SGI issuers or brokers` },
    rings: (d) => (d.newcomer ? { [NOW]: { v: 1, label: `${d.newcomer.agencies.length} newcomer offices, as listed on ${d.newcomer.asOf} (provincial list typed ${d.newcomer.provAsOf})` } } : {}),
  },
  {
    id: 'transit', key: 'transit', name: 'Getting around', color: '#f28482', group: 'People & places',
    owner: 'OurAirports · OpenStreetMap contributors · City of Regina · City of Saskatoon · City of Moose Jaw · City of Prince Albert', title: 'OurAirports airports.csv (scheduled_service); OSM aerodromes, VIA Rail stations and train routes, bus route relations; city transit GTFS feeds', url: 'https://ourairports.com/data/',
    endpoint: 'davidmegginson.github.io/ourairports-data/airports.csv · overpass-api.de/api/interpreter · opengis.regina.ca/reginagtfs/google_transit.zip · apps5.saskatoon.ca/data/gtfs/google_transit.zip · moosejaw.ca (GTFS zip) · files.mobilitydatabase.org/tld-5509_1/latest.zip · router.project-osrm.org', licence: 'OurAirports public domain; OSM ODbL; Regina and Saskatoon open data terms; Moose Jaw and Prince Albert GTFS published for trip planners, no licence stated',
    gives: 'Airports with scheduled flights and the drive to the nearest, VIA Rail stops and lines, intercity bus routes as mapped, and city bus routes with their stop counts.',
    read: (d) => d.transit && { n: d.transit.airports.length + d.transit.stations.length + d.transit.busStops.length + d.transit.systems.length, what: `${d.transit.airports.length} airports with scheduled flights; ${d.transit.stations.length} VIA stops; ${d.transit.busStops.length} intercity bus stops; ${d.transit.systems.length} city bus systems (${d.transit.systems.reduce((s, x) => s + x.routes.length, 0)} routes)` },
    rings: (d) => (d.transit ? { [NOW]: { v: 1, label: `flights, trains and buses as listed and mapped on ${d.transit.asOf}` } } : {}),
  },
  {
    id: 'hospitals', key: 'hospitals', name: 'Hospital access', color: '#6c8cff', group: 'People & places',
    owner: 'Statistics Canada · OSRM', title: 'Open Database of Healthcare Facilities (ODHF v1)', url: 'https://open.canada.ca/data/en/dataset/a1bcd4ee-8e57-499b-9c6f-94f6902fdf32',
    endpoint: 'ftp.maps.canada.ca … ODHF_BDOES/odhf_bdoes_v1.csv · router.project-osrm.org', licence: `${OGL_CA}; routes ODbL`,
    gives: 'Where the hospitals are, and how long the drive is from each place.',
    read: (d) => d.hospitals && { n: d.hospitals.facilities.length + sum(Object.values(d.hospitals.towns).map((t) => t.length)), what: `${d.hospitals.facilities.length} facilities, ${fmt.int(sum(Object.values(d.hospitals.towns).map((t) => t.length)))} routed drives` },
    rings: (d) => (d.hospitals ? { 2020: { v: 1, label: `${d.hospitals.facilities.length} facilities as compiled in 2020` } } : {}),
  },
  {
    id: 'doctors', key: 'doctors', name: 'Doctors & clinics', color: '#ff8fab', group: 'People & places',
    owner: 'Statistics Canada · OpenStreetMap contributors · OSRM', title: 'Open Database of Healthcare Facilities (ODHF v1): Saskatchewan Health Authority clinics and primary health care centres; amenity=clinic, doctors, pharmacy and healthcare=clinic, doctor, nurse, centre, pharmacy', url: 'https://open.canada.ca/data/en/dataset/a1bcd4ee-8e57-499b-9c6f-94f6902fdf32',
    endpoint: 'ftp.maps.canada.ca … ODHF_BDOES/odhf_bdoes_v1.csv · overpass-api.de/api/interpreter · router.project-osrm.org', licence: `${OGL_CA}; OSM ODbL`,
    gives: 'Where to see a family doctor or nurse outside an emergency department and where to fill a prescription; the drive from each place to the nearest of each and how many are in town. Not whether a doctor is taking patients.',
    read: (d) => d.doctors && { n: d.doctors.sites.length, what: `${d.doctors.sites.filter((s) => s.k !== 'rx').length} clinics and health centres, ${d.doctors.sites.filter((s) => s.k === 'rx').length} pharmacies` },
    rings: (d) => (d.doctors ? { 2020: { v: 0.7, label: `${d.doctors.sites.filter((s) => s.src !== 'o').length} SHA clinics and health centres as compiled in 2020` }, [NOW]: { v: 1, label: `clinics and pharmacies as mapped on ${d.doctors.asOf}` } } : {}),
  },
  {
    id: 'childcare', key: 'childcare', name: 'Childcare', color: '#ffc4a3', group: 'People & places',
    owner: 'Sask. Ministry of Education · OSRM', title: 'Regulated child care facilities: “Find a child care provider in my community” (centres and licensed family child care homes)', url: 'https://www.saskatchewan.ca/residents/family-and-social-support/child-care/find-a-child-care-provider-in-my-community',
    endpoint: 'saskatchewan.ca … find-a-child-care-provider-in-my-community (the page’s facility list and its window.pageList points, read as text) · router.project-osrm.org', licence: 'Crown copyright, Government of Saskatchewan: non-commercial reproduction only; routes ODbL',
    gives: 'Where the licensed child care centres are, how many licensed family child care homes each community has, and the drive from each place to the nearest centre. Not capacity, and not whether a space is open.',
    read: (d) => d.childcare && { n: d.childcare.centres.length + sum(d.childcare.homes.map((h) => h.n)), what: `${d.childcare.centres.length} licensed centres, ${sum(d.childcare.homes.map((h) => h.n))} family child care homes in ${d.childcare.homes.length} communities` },
    rings: (d) => (d.childcare ? { [NOW]: { v: 1, label: `licensed facilities as listed on ${d.childcare.asOf}` } } : {}),
  },
  {
    id: 'industry', key: 'industry', name: 'Hidden neighbours', color: '#d4e157', group: 'People & places',
    owner: 'Sask. Ministry of Energy and Resources · Environment and Climate Change Canada · OpenStreetMap', title: 'Petroleum (vertical wells, facilities), Pipelines and Mineral Deposit Index (mine locations) layers; National Pollutant Release Inventory, single-year data by facility; man_made=pipeline', url: 'https://geohub.saskatchewan.ca/',
    endpoint: 'gis.saskatchewan.ca … Economy/Petroleum, Economy/Pipelines, Economy/Mineral_Exploration MapServer · data-donnees.az.ec.gc.ca … NPRI-INRP_DataDonnées_<year>.csv · overpass-api.de', licence: 'Government of Saskatchewan Standard Unrestricted Use Data Licence; OGL – Canada; OSM ODbL',
    gives: 'Where the oil and gas wells (active, suspended, abandoned), facilities, licensed pipelines, reporting industrial emitters and producing mines are, and how many lie near each place.',
    read: (d) => d.industry && { n: sum(d.industry.totals.wells) + d.industry.npri.length + d.industry.mines.length, what: `${fmt.int(sum(d.industry.totals.wells))} wells, ${fmt.int(d.industry.totals.pipes + d.industry.totals.oldPipes)} licensed pipelines, ${d.industry.npri.length} NPRI sites (${d.industry.npriYear}), ${d.industry.mines.length} producing mines` },
    rings: (d) => (d.industry ? { [d.industry.npriYear]: { v: 0.7, label: `NPRI ${d.industry.npriYear} reporting year` }, [NOW]: { v: 1, label: `wells, pipelines and mines as licensed on ${d.industry.asOf}` } } : {}),
  },
  {
    id: 'water', key: 'water', name: 'Drinking water', color: '#64b5f6', group: 'People & places',
    owner: 'Water Security Agency · Saskatchewan Health Authority · Indigenous Services Canada · NRCan', title: 'PDWAs and EBWOs currently in effect (WSA / Ministry of Environment and SHA regulated waterworks, PDF reports); short-term and long-term drinking water advisories on First Nations; Canadian Geographical Names Database (locations)', url: 'https://www.saskatchewan.ca/residents/environment-public-health-and-safety/environmental-health/water-and-wastewater-management/advisories-and-warnings',
    endpoint: 'waterquality.saskatchewan.ca/GoCReports/EnvActive.pdf, RhaActive.pdf (read as text) · sac-isc.gc.ca short-term advisories page and lTDWA_map_data … .txt · geogratis.gc.ca/services/geoname', licence: 'Crown copyright, Government of Saskatchewan: non-commercial reproduction; Government of Canada terms: non-commercial reproduction; CGNDB OGL – Canada',
    gives: 'Which water systems are under a precautionary advisory, boil water order or do-not-consume advisory today, since when, and how many are near each place. Locations are inferred from the names; private wells are not covered.',
    read: (d) => d.water && { n: d.water.sites.length + d.water.unplaced.length, what: `${d.water.sites.length + d.water.unplaced.length} advisories in effect (${d.water.sites.filter((s) => s.src === 'isc').length} on First Nations), ${d.water.sites.length} placed on the map` },
    rings: (d) => (d.water ? { [NOW]: { v: 1, label: `advisories in effect on ${d.water.provAsOf}` } } : {}),
  },
  {
    id: 'radon', key: 'radon', name: 'Radon', color: '#b48cff', group: 'People & places',
    owner: 'Health Canada · Statistics Canada', title: 'Cross-Canada Survey of Radon Concentrations in Homes (one row per tested home: 2007 health region, FSA, result); Health Regions: Boundaries and Correspondence with Census Geography (82-402-X, 2007 regions); 2021 forward sortation area boundaries', url: 'https://open.canada.ca/data/en/dataset/b3bad1b0-32d4-4656-8a64-59b43900d482',
    endpoint: 'open.canada.ca … radon-concentration.csv · www150.statcan.gc.ca/n1/pub/82-402-x/2011001 … hr047b06-eng.zip (shapefile) · geo.statcan.gc.ca … Cartographic_boundary_files/MapServer/14', licence: OGL_CA,
    gives: 'The share of tested homes at or above Canada’s radon guideline (200 Bq/m³) in each 2007 health region and postal area, and for each place. A regional odds: only a long-term test tells for a house.',
    read: (d) => d.radon && { n: d.radon.prov.n, what: `${fmt.int(d.radon.prov.n)} homes tested in ${d.radon.regions.length} health regions and ${d.radon.fsas.length} postal areas` },
    rings: (d) => (d.radon ? { 2010: { v: 1, label: `homes tested ${d.radon.years}` } } : {}),
  },
  {
    id: 'camping', key: 'camping', name: 'Camping & rec', color: '#59d18c', group: 'People & places',
    owner: 'Sask. Parks, Culture and Sport · Parks Canada · OpenStreetMap', title: 'ParksAsTitled (park, recreation site and regional park boundaries); Parks Canada Accommodation and Facilities; tourism=camp_site, caravan_site', url: 'https://open.canada.ca/data/en/dataset/65f14e41-c6c7-512e-e231-aa1079978b12',
    endpoint: 'gis.saskatchewan.ca … ParksAsTitled/MapServer · services2.arcgis.com … vw_Accommodation_Hebergement_V2_FGP · overpass-api.de · router.project-osrm.org', licence: `${OGL_CA}; OSM and routes ODbL`,
    gives: 'Where the parks and campgrounds are, and the drive from each place to its nearest campground.',
    read: (d) => d.camping && { n: d.camping.parks.length + d.camping.camps.length, what: `${d.camping.parks.length} parks and sites, ${fmt.int(d.camping.camps.length)} campgrounds and campsites` },
    rings: (d) => (d.camping ? { [NOW]: { v: 1, label: `${d.camping.camps.length} campgrounds as mapped on ${d.camping.asOf}` } } : {}),
  },
  {
    id: 'commute', key: 'commute', name: 'Workday Reach', color: '#c9a7ff', group: 'People & places',
    owner: 'OpenStreetMap contributors · OSRM', title: 'OSRM demo router on OpenStreetMap roads: a drive-time table between every pair of the atlas’s places', url: 'https://project-osrm.org/docs/v5.24.0/api/#table-service',
    endpoint: 'router.project-osrm.org/table/v1/driving', licence: 'ODbL',
    gives: 'How long the drive is from every place to every other one, for Workday Reach and the Finder’s Short commute.',
    read: (d) => d.commute && { n: d.commute.keys.length ** 2, what: `${fmt.int(d.commute.keys.length ** 2)} place-to-place drive times${d.commute.routed ? '' : ' (straight-line estimates)'}` },
    rings: (d) => (d.commute ? { [NOW]: { v: 1, label: `${d.commute.keys.length}×${d.commute.keys.length} drive times as routed on ${d.commute.asOf}` } } : {}),
  },
];

const BARK: BarkSource[] = [
  { name: 'Province outline', key: 'province', owner: 'Statistics Canada', title: '2021 Census cartographic boundary file: provinces and territories', url: 'https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm', licence: 'Statistics Canada Open Licence', gives: 'The outline every layer is clipped to.' },
  { name: 'Place names', key: 'places', owner: 'Natural Resources Canada', title: 'Canadian Geographical Names Database (geonames API)', url: 'https://natural-resources.canada.ca/earth-sciences/geography/geographical-names-board-canada', licence: OGL_CA, gives: 'Where each of the atlas’s places is. The list of names itself is typed into scripts/places.mjs.', read: (d) => `${d.munis.length} places located` },
  { name: 'Roads', key: 'hospitals', owner: 'OpenStreetMap contributors · OSRM', title: 'OSRM demo router on OpenStreetMap roads', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL', gives: 'The road routes and free-flow drive times to the nearest hospital, courthouse, police station, campground and school.' },
  { name: 'Basemap', owner: 'CARTO · OpenStreetMap contributors', title: 'Dark Matter vector basemap', url: 'https://carto.com/attributions', licence: 'ODbL / CARTO terms', gives: 'The dark map, place names and roads under every layer.' },
  { name: 'Terrain', owner: 'Mapzen · AWS Open Data', title: 'Terrain Tiles (terrarium)', url: 'https://registry.opendata.aws/terrain-tiles/', licence: 'Open, with attribution', gives: 'The shaded relief: the Cypress Hills, the Missouri Coteau, the river valleys and the Shield.' },
];

const DERIVED = [
  ['Provincial warming', 'the climate anomaly is the average of every station’s difference from its own 1961–90 baseline.'],
  ['Fire scars', 'are circles with the same area as each fire’s reported size, centred where it started; they are not the fire’s real shape.'],
  ['Crime by place', 'uses each place’s own police service; northern villages with no municipal series use their rural RCMP detachment, which covers a wider area, and the report says so.'],
  ['Police in town', 'OpenStreetMap misses many police buildings here, so a place Statistics Canada lists with its own municipal police service (a city force or a municipal RCMP detachment) counts as having police in town when none is mapped within 6 km of its centre.'],
  ['Tornado track ends', 'for Northern Tornadoes Project events are estimated here from the start point, track length and direction of motion it publishes; mapped end points from Environment Canada are used as they are.'],
  ['Hail', 'swath sizes are the radar’s Maximum Expected Size of Hail (MESH), an estimate, not a measured stone; the 2022 swaths have none. A swath stored in pieces (one per bend) is joined back into one track, and only the part inside the query box around Saskatchewan is kept, so a long Alberta or Manitoba swath may look shorter here. A research-database storm whose point was off the map is placed at the atlas town it is named after (inferred), and sizes the database gives in centimetres are converted. A place’s count is every swath or storm passing within 50 km of its centre.'],
  ['Drought', 'the Canadian Drought Monitor is a consensus map drawn from many indicators, not a measurement. It is read here on a 10 km grid in the map service’s own Web Mercator projection, so edges are blocky and a few kilometres off; a place takes the category of the cell its centre is in, so a town near an edge can read one step off. Province shares are of its land and lakes, cells weighted by their true area. Until early 2004 the maps covered only the agricultural south.'],
  ['Hospitals', 'are the ODHF rows whose type or name says hospital; health centres and clinics are shown but not counted as the nearest hospital.'],
  ['Clinics', 'are the ODHF’s Saskatchewan Health Authority clinics and primary health care centres (hospitals, imaging, labs, public-health, mental-health and specialist sites left out), joined with OpenStreetMap’s medical clinics, doctors’ offices and nurses; a site in both counts once. ODHF sites with no point are put at their town’s centre. Neither list has most private practices, so a place with no clinic mapped but a hospital in town counts the hospital as its clinic (inferred). “In town” is counted as in Daily needs, whose clinic count is OpenStreetMap only. A clinic is not a doctor taking new patients, and the health authority’s temporary service disruptions are web notices, not data, so they are not shown.'],
  ['Childcare', 'the ministry’s list gives each facility a type (centre, family or group family child care home); a listing with none is counted as a centre when its name reads like an organisation and as a home when it reads like a person’s name (inferred). Family child care homes are people’s homes, so only a count per community is kept, at a point rounded to about 2 km; “in town” is counted at the home’s own point during the build, then dropped. The list has no licensed capacity, so spaces are not shown, and a licensed facility may have no space open.'],
  ['Campgrounds', 'in the national parks are Parks Canada’s individual campsites, grouped here into campgrounds (sites within 1.5 km of each other with the same campground code); a campground mapped in both Parks Canada’s data and OpenStreetMap is shown once, with Parks Canada’s site count.'],
  ['Daily needs in town', 'counts an OpenStreetMap site for a place when it lies inside the place’s 2021 census subdivision (its municipal limits) or within 1 km of them; a ✗ can mean the service is not mapped rather than missing, especially in small towns.'],
  ['School grades', 'the ministry’s list states grades only for band schools; a provincial school is elementary or high by its name, and a school whose name says neither counts as K-12 when no high school is within 10 km. The ministry’s map layer misplaces many rural schools and misses others: a listed school takes the position of the same-named OpenStreetMap school within 30 km, and OpenStreetMap schools it lacks inside the atlas’s towns are added, sector not stated. Drives count public, separate, Fransaskois and those OpenStreetMap schools only.'],
  ['Internet in town', 'ISED’s pseudo-households (points along roads carrying the 2021 census households near them) are weighted by households and counted for a place when they lie inside its 2021 census subdivision. The tiers are what providers say they offer, not measured speeds; fixed wireless counts towards 50/10, satellite does not, and mobile coverage is LTE or better (5G is not singled out in the open data).'],
  ['Who lives here', 'counts are Statistics Canada’s, randomly rounded to a multiple of 5, so a share built on a rounded 0 is shown as “—” (none, a handful or not published) rather than 0%. Figures are for the place’s own census subdivision: First Nation reserves next to a town are their own subdivisions and not in its Indigenous identity share. The Finder’s Diverse community is the immigrant share alone.'],
  ['Getting around', 'scheduled service is OurAirports’ flag, not a timetable. Trains and intercity buses are what OpenStreetMap volunteers have mapped: intercity bus coverage is partial and coach lines change often. City buses come from GTFS feeds; Moose Jaw’s has expired and Prince Albert’s is the Mobility Database’s last copy, and neither states a licence. The “without a car” score counts what is mapped, not how often it runs.'],
  ['Newcomer services', 'settlement offices are IRCC’s own list; the province’s list of settlement services (the Regional Newcomer Gateways) is published only as a web page, so it is typed into the build script with the date it was read, and an organisation IRCC does not list is placed at its town’s centre. Service Canada offices and SGI motor licence issuers are as mapped in OpenStreetMap, which has only some of SGI’s nearly 400 issuers; insurance brokers count as issuers (most are, but it is inferred), so the nearest issuer may be closer than shown.'],
  ['Market rent by place','CMHC surveys a whole census metropolitan area or agglomeration; its average rent and vacancy rate are shown only on the place it is named after (Saskatoon’s covers Warman and Martensville too), and Lloydminster’s vacancy rate covers both sides of the border.'],
  ['Hidden neighbours', 'wells include suspended and abandoned ones (split in each report); pipelines are the province’s licensed lines, not its ~95,000 flowlines; the Canada Energy Regulator publishes no open map of the lines it regulates, so federal lines are only those OpenStreetMap names; the NPRI lists only facilities above its reporting thresholds. The Finder’s count adds wells, sites, lines and mines one each.'],
  ['Borrowed stations','a place without its own sunshine, climate or air station uses the nearest one (sunshine and air within 150 km), and its report names it. Only six cities monitor PM2.5, so most places’ smoke days are borrowed from a city up to 150 km away.'],
  ['Smoke days', 'a calendar day whose 24-hour average PM2.5 is above 25 µg/m³ (WHO 2005 guideline). A day needs 18 of its 24 hourly readings; a station-year counts only when 75% of its days, and of its May–September days, are valid. Where two instruments overlap, each hour comes from the one with more readings that year, and stations in the same city are one record. Not every high-PM2.5 day is smoke: winter inversions add a few. A place’s figure is its station’s average over the last ten years of record (at least five counted).'],
  ['Treaty of a place', 'is the treaty area its centre falls in, as Indigenous Services Canada maps it.'],
  ['Commute times', 'are the OSRM router’s free-flow drive from one place’s centre to another’s, from home to work; rush hour, winter roads and where in town you live or work are not counted.'],
  ['Town Finder scores', 'are this atlas’s own blend of the numbers above, weighted by you.'],
];

// ---------------------------------------------------------------------------------------------

let root: HTMLElement | null = null;
export const sourcesOpen = () => !!root;

export function closeSources() {
  if (!root) return;
  const el = root;
  root = null;
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 260);
  if (location.hash === '#sources') history.replaceState(null, '', location.pathname + location.search);
}

export function openSources(data: Data, opts: { onShow: (layerId: string) => void }) {
  if (root) return;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // a few source rows carry impossible dates; they stay off the round
  const rings = SOURCES.map((s) => Object.fromEntries(Object.entries(s.rings(data)).filter(([y]) => +y >= Y0 && +y <= FUT)));
  const reads = SOURCES.map((s) => s.read(data));
  const live = SOURCES.map((_, i) => Object.keys(rings[i]).length > 0);
  const records = sum(reads.map((r) => r?.n ?? 0));
  const owners = new Set([...SOURCES, ...BARK].flatMap((s) => s.owner.split(' · ')));
  const licences = d3.rollups([...SOURCES, ...BARK], (v) => v.length, (s) => s.licence.split(';')[0]).sort((a, b) => b[1] - a[1]);
  const oldest = Math.min(...rings.map((r) => span(r)?.[0] ?? Infinity));
  const status = (key?: string) => {
    const m = key ? data.manifest[key] : null;
    if (!key) return '<span class="src-st">loaded live by the map</span>';
    if (!m?.ok) return `<span class="src-st bad">not available${m?.lastError ? ` · ${esc(m.lastError)}` : ''}</span>`;
    return `<span class="src-st ok">refreshed ${m.updated ? new Date(m.updated).toLocaleDateString('en-CA') : ''}</span>`;
  };

  root = document.createElement('div');
  root.className = 'sources';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'src-title');
  root.innerHTML = `
    <button class="close-x" aria-label="Close sources">×</button>
    <div class="src-stage">
      <div class="src-intro">
        <div class="kicker">Data &amp; sources</div>
        <h2 id="src-title">Every ring has a source</h2>
        <p>A cross-section of the atlas, read like an aspen round. Each wedge is one source, each ring one year from ${Y0} at the pith to ${NOW} at the bark, and a ring glows as strongly as that source’s own record for the year. Projections grow past the bark, hatched. Hover to read a ring; click to open its source.</p>
        <dl class="src-stats">
          <div><dd data-count="${SOURCES.length + BARK.length}">0</dd><dt>sources</dt></div>
          <div><dd data-count="${owners.size}">0</dd><dt>publishers</dt></div>
          <div><dd data-count="${records}">0</dd><dt>records read</dt></div>
          <div><dd data-count="${NOW - oldest + 1}">0</dd><dt>years of rings</dt></div>
        </dl>
      </div>
      <div class="src-round">
        <canvas aria-label="Tree-ring chart: one wedge per data source, one ring per year from ${Y0} to ${NOW}, projections beyond to ${FUT}"></canvas>
        <div class="src-year" aria-hidden="true"></div>
        <div class="src-tip" hidden></div>
      </div>
    </div>
    <div class="src-list">
      ${['Justice & safety', 'Hazards', 'Climate', 'People & places'].map((g) => `<h3>${g}</h3>${SOURCES.map((s, i) => s.group !== g ? '' : `
        <article class="src-card${live[i] ? '' : ' off'}" data-i="${i}" tabindex="0" style="--c:${s.color}">
          <header><span class="src-dot"></span><b>${s.name}</b>${status(s.key)}</header>
          <div class="src-owner">${esc(s.owner)}</div>
          <a class="src-title" href="${s.url}" target="_blank" rel="noopener">${esc(s.title)} ↗</a>
          <p>${s.gives}</p>
          ${reads[i] ? `<div class="src-read"><b data-count="${reads[i]!.n}">0</b> records · ${esc(reads[i]!.what)}${span(rings[i]) ? ` · rings ${span(rings[i])!.join('–')}` : ''}</div>` : ''}
          <code>${esc(s.endpoint)}</code>
          <footer><span class="src-lic">${esc(s.licence)}</span>${live[i] ? `<button class="src-go" data-id="${s.id}">See it on the map →</button>` : ''}</footer>
        </article>`).join('')}`).join('')}
      <h3>The bark: what everything sits on</h3>
      ${BARK.map((b, i) => `
        <article class="src-card bark" data-b="${i}" tabindex="0">
          <header><span class="src-dot"></span><b>${b.name}</b>${status(b.key)}</header>
          <div class="src-owner">${esc(b.owner)}${b.read ? ` · ${b.read(data)}` : ''}</div>
          <a class="src-title" href="${b.url}" target="_blank" rel="noopener">${esc(b.title)} ↗</a>
          <p>${b.gives}</p>
          <footer><span class="src-lic">${esc(b.licence)}</span></footer>
        </article>`).join('')}
      <h3>What this atlas worked out itself</h3>
      <ul class="src-derived">${DERIVED.map(([k, v]) => `<li><b>${k}</b> ${v}</li>`).join('')}</ul>
      <h3>Licences</h3>
      <div class="src-lics">${licences.map(([l, n]) => `<span>${esc(l)} <b>×${n}</b></span>`).join('')}</div>
      <p class="note">Contains information licensed under the Open Government Licence – British Columbia and the Open Government Licence – Canada. Refresh everything with <code>npm run data</code>; a source that fails keeps its last good copy and shows it above. This is a personal exploration tool, not real-estate, insurance or hazard advice.</p>
      <button class="src-cite">Copy a citation</button>
    </div>`;
  document.body.appendChild(root);
  if (location.hash !== '#sources') history.replaceState(null, '', '#sources');

  const el = root;
  const $ = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const canvas = $<HTMLCanvasElement>('canvas'), ctx = canvas.getContext('2d')!;
  const tip = $('.src-tip'), yearEl = $('.src-year'), list = $('.src-list');
  const cards = [...el.querySelectorAll<HTMLElement>('.src-card:not(.bark)')];
  const barkCards = [...el.querySelectorAll<HTMLElement>('.src-card.bark')];

  // ---- geometry
  let S = 0, c = 0, rPith = 0, rBark = 0, barkW = 0, rHalo = 0, dpr = 1;
  const GAP = 0.022;
  const wedge = (i: number) => {
    const w = (Math.PI * 2) / SOURCES.length;
    const a = -Math.PI / 2 + i * w;
    return [a + GAP / 2, a + w - GAP / 2];
  };
  const R = (y: number) => y <= NOW + 1
    ? rPith + ((y - Y0) / (NOW + 1 - Y0)) * (rBark - rPith)
    : rBark + barkW + ((y - NOW - 1) / (FUT - NOW)) * (rHalo - rBark - barkW);
  const yearAtR = (r: number) => r <= rBark
    ? Math.floor(Y0 + ((r - rPith) / (rBark - rPith)) * (NOW + 1 - Y0))
    : Math.floor(NOW + 1 + ((r - rBark - barkW) / (rHalo - rBark - barkW)) * (FUT - NOW));

  // a seeded wobble so the wood grain is the same on every redraw
  const rand = d3.randomLcg(42);
  const grain = d3.range(Y0, NOW + 1).map(() => rand());
  const barkNoise = d3.range(240).map(() => rand());

  const wood = document.createElement('canvas'), glow = document.createElement('canvas');
  let hatch: Record<string, CanvasPattern> = {};

  function resize() {
    const box = canvas.parentElement!.getBoundingClientRect();
    // closing (or a hidden parent) reports an empty box; keep the last size rather than draw with negative radii
    if (Math.min(box.width, box.height || box.width) < 80) return;
    S = Math.floor(Math.min(box.width, box.height || box.width));
    dpr = Math.min(2, devicePixelRatio || 1);
    for (const k of [canvas, wood, glow]) { k.width = S * dpr; k.height = S * dpr; }
    canvas.style.width = canvas.style.height = `${S}px`;
    c = S / 2;
    labelsOn = S > 520;
    const labels = labelsOn ? 34 : 8;
    rHalo = c - labels;
    rBark = rHalo * 0.8;
    barkW = Math.max(6, rHalo * 0.035);
    rPith = rHalo * 0.045;
    hatch = {};
    paintWood();
    scene = null;
  }

  function pattern(color: string) {
    if (hatch[color]) return hatch[color];
    const p = document.createElement('canvas');
    p.width = p.height = 8 * dpr;
    const g = p.getContext('2d')!;
    g.strokeStyle = color; g.lineWidth = 2.2 * dpr;
    g.beginPath(); g.moveTo(0, 8 * dpr); g.lineTo(8 * dpr, 0); g.moveTo(-4 * dpr, 4 * dpr); g.lineTo(4 * dpr, -4 * dpr); g.moveTo(4 * dpr, 12 * dpr); g.lineTo(12 * dpr, 4 * dpr); g.stroke();
    return (hatch[color] = ctx.createPattern(p, 'repeat')!);
  }

  function paintWood() {
    const g = wood.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    // heartwood to sapwood
    const fill = g.createRadialGradient(c, c, 0, c, c, rBark);
    fill.addColorStop(0, '#3a2414'); fill.addColorStop(0.55, '#2a190e'); fill.addColorStop(0.92, '#20140c'); fill.addColorStop(1, '#2c1d12');
    g.fillStyle = fill;
    g.beginPath(); g.arc(c, c, rBark, 0, Math.PI * 2); g.fill();
    // one ring per year: a dark latewood line, stronger each decade
    for (let y = Y0 + 1; y <= NOW; y++) {
      const r = R(y), k = grain[y - Y0];
      g.strokeStyle = y % 10 === 0 ? 'rgba(255, 214, 170, 0.13)' : `rgba(8, 4, 2, ${0.25 + k * 0.35})`;
      g.lineWidth = y % 10 === 0 ? 1 : 0.5 + k * 0.8;
      g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
    }
    // bark, with a rough outer edge
    g.beginPath();
    for (let i = 0; i <= barkNoise.length; i++) {
      const a = (i / barkNoise.length) * Math.PI * 2, r = rBark + barkW * (0.75 + barkNoise[i % barkNoise.length] * 0.5);
      i ? g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r) : g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    g.arc(c, c, rBark, 0, Math.PI * 2, true);
    g.fillStyle = '#4a3020'; g.fill('evenodd');
    // drying checks between the wedges
    g.strokeStyle = 'rgba(6, 9, 16, 0.95)'; g.lineWidth = 2;
    for (let i = 0; i < SOURCES.length; i++) {
      const a = wedge(i)[0] - GAP / 2;
      g.beginPath(); g.moveTo(c + Math.cos(a) * rPith * 1.6, c + Math.sin(a) * rPith * 1.6); g.lineTo(c + Math.cos(a) * (rBark + barkW), c + Math.sin(a) * (rBark + barkW)); g.stroke();
    }
    // the future, not grown yet
    g.setLineDash([2, 5]); g.strokeStyle = 'rgba(180, 191, 210, 0.22)'; g.lineWidth = 1;
    for (const y of [2050, FUT]) { g.beginPath(); g.arc(c, c, R(y), 0, Math.PI * 2); g.stroke(); }
    g.setLineDash([]);
  }

  // ---- scene: wood + glowing rings up to `upTo`, halo faded by `halo`
  let scene: HTMLCanvasElement | null = null;
  function paintScene(upTo: number, halo: number) {
    const g = glow.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    SOURCES.forEach((s, i) => {
      const [a0, a1] = wedge(i);
      for (const [ys, ring] of Object.entries(rings[i])) {
        const y = +ys;
        if (ring.proj ? halo <= 0 : y > upTo) continue;
        const r0 = R(y), r1 = y === NOW ? rBark + barkW : R(y + 1) - (y > NOW ? 0.6 : 0.25);
        g.beginPath(); g.arc(c, c, r1, a0, a1); g.arc(c, c, Math.max(rPith, r0), a1, a0, true); g.closePath();
        if (ring.proj) {
          g.globalAlpha = halo * (0.35 + 0.65 * ring.v);
          g.fillStyle = pattern(s.color);
        } else {
          const climate = s.id === 'climate';
          g.globalAlpha = climate ? 0.95 : 0.12 + 0.88 * ring.v;
          g.fillStyle = climate ? climateDiv(ring.v) : s.color;
        }
        g.fill();
      }
    });
    g.globalAlpha = 1;
    const out = document.createElement('canvas');
    out.width = out.height = S * dpr;
    const o = out.getContext('2d')!;
    o.drawImage(wood, 0, 0);
    o.globalCompositeOperation = 'lighter';
    o.filter = `blur(${7 * dpr}px)`; o.globalAlpha = 0.75; o.drawImage(glow, 0, 0);
    o.filter = 'none'; o.globalAlpha = 0.9; o.drawImage(glow, 0, 0);
    return out;
  }

  // ---- interaction state
  type Hit = { i: number; y: number } | { b: number } | null;
  let hover: Hit = null;
  let pinned: number | null = null;
  let labelsOn = true;

  function draw() {
    if (!scene) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(scene, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const active = hover && 'i' in hover ? hover.i : pinned;
    // dim every wedge but the active one
    if (active != null) {
      ctx.fillStyle = 'rgba(4, 7, 13, 0.62)';
      SOURCES.forEach((_, i) => {
        if (i === active) return;
        const [a0, a1] = wedge(i);
        ctx.beginPath(); ctx.arc(c, c, rHalo, a0 - GAP / 2, a1 + GAP / 2); ctx.arc(c, c, rPith * 0.9, a1 + GAP / 2, a0 - GAP / 2, true); ctx.closePath(); ctx.fill();
      });
    }
    // the hovered year, across every source
    if (hover && 'y' in hover) {
      const r = (R(hover.y) + R(hover.y + 1)) / 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke();
    }
    if (hover && 'b' in hover) {
      const w = (Math.PI * 2) / BARK.length, a0 = -Math.PI / 2 + hover.b * w;
      ctx.strokeStyle = '#ffd9a8'; ctx.lineWidth = barkW + 4;
      ctx.beginPath(); ctx.arc(c, c, rBark + barkW / 2, a0, a0 + w); ctx.stroke();
    }
    // year ticks up the top check
    ctx.font = '500 10px JetBrains Mono, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const y of [1925, 1950, 1975, 2000, NOW, 2050, FUT]) {
      const r = y === NOW ? rBark + barkW / 2 : R(y), t = y === NOW ? 'today' : String(y);
      ctx.fillStyle = 'rgba(6, 10, 18, 0.8)';
      ctx.fillRect(c + 5, c - r - 7, ctx.measureText(t).width + 8, 14);
      ctx.fillStyle = y > NOW ? '#b4bfd2' : '#e9eef7';
      ctx.fillText(t, c + 9, c - r);
    }
    // source names around the rim
    if (labelsOn) {
      ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
      SOURCES.forEach((s, i) => {
        const [a0, a1] = wedge(i), a = (a0 + a1) / 2;
        const flip = Math.sin(a) > 0.05;
        ctx.save();
        ctx.translate(c + Math.cos(a) * (rHalo + 16), c + Math.sin(a) * (rHalo + 16));
        ctx.rotate(a + (flip ? -Math.PI / 2 : Math.PI / 2));
        ctx.fillStyle = active == null || active === i ? s.color : 'rgba(180, 191, 210, 0.35)';
        ctx.fillText(s.name, 0, 0);
        ctx.restore();
      });
    }
  }

  function pick(ev: PointerEvent): Hit {
    const b = canvas.getBoundingClientRect();
    const x = ev.clientX - b.left - c, y = ev.clientY - b.top - c;
    const r = Math.hypot(x, y);
    let a = Math.atan2(y, x) + Math.PI / 2;
    if (a < 0) a += Math.PI * 2;
    if (r >= rBark && r <= rBark + barkW + 2) return { b: Math.floor(a / ((Math.PI * 2) / BARK.length)) };
    if (r < rPith || r > rHalo) return null;
    return { i: Math.min(SOURCES.length - 1, Math.floor(a / ((Math.PI * 2) / SOURCES.length))), y: yearAtR(r) };
  }

  function showTip(ev: PointerEvent) {
    if (!hover) { tip.hidden = true; return; }
    let html: string;
    if ('b' in hover) {
      const b = BARK[hover.b];
      html = `<b>${b.name}</b> · the bark<br>${esc(b.owner)}`;
    } else {
      const s = SOURCES[hover.i], ring = rings[hover.i][hover.y];
      html = `<b style="color:${s.color}">${s.name}</b> · ${hover.y}<br>${ring ? esc(ring.label) : '<span class="dim">no record this year</span>'}`;
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const b = canvas.parentElement!.getBoundingClientRect();
    const x = ev.clientX - b.left, y = ev.clientY - b.top;
    tip.style.transform = `translate(${Math.min(x + 14, b.width - tip.offsetWidth - 4)}px, ${y + 16}px)`;
  }

  const focusCard = (card: HTMLElement | undefined) => {
    if (!card) return;
    el.querySelectorAll('.src-card.on').forEach((k) => k.classList.remove('on'));
    card.classList.add('on');
    card.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'nearest' });
  };

  canvas.addEventListener('pointermove', (ev) => {
    hover = pick(ev);
    canvas.style.cursor = hover ? 'pointer' : 'default';
    showTip(ev);
    draw();
  });
  canvas.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; draw(); });
  canvas.addEventListener('click', (ev) => {
    const h = pick(ev as PointerEvent);
    if (!h) { pinned = null; el.querySelectorAll('.src-card.on').forEach((k) => k.classList.remove('on')); draw(); return; }
    if ('b' in h) { pinned = null; focusCard(barkCards[h.b]); }
    else { pinned = h.i; focusCard(cards[h.i]); }
    draw();
  });
  cards.forEach((card, i) => {
    card.addEventListener('pointerenter', () => { pinned = i; draw(); });
    card.addEventListener('focus', () => { pinned = i; draw(); });
  });
  barkCards.forEach((card, i) => card.addEventListener('pointerenter', () => { hover = { b: i }; draw(); }));
  list.addEventListener('pointerleave', () => { if (hover && 'b' in hover) hover = null; draw(); });
  el.querySelectorAll<HTMLButtonElement>('.src-go').forEach((btn) => btn.addEventListener('click', () => { closeSources(); opts.onShow(btn.dataset.id!); }));
  $('.close-x').addEventListener('click', closeSources);
  const cite = $<HTMLButtonElement>('.src-cite');
  cite.addEventListener('click', async () => {
    const text = `Living Skies Atlas: Saskatchewan in open data (${NOW}). Compiled from ${[...owners].join(', ')}. ${licences.map(([l]) => l).join('; ')}. Accessed ${new Date().toLocaleDateString('en-CA')}.`;
    try { await navigator.clipboard.writeText(text); cite.textContent = 'Citation copied'; } catch { cite.textContent = text; }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeSources(); }
    if (e.key === 'Enter' && (e.target as HTMLElement).matches('.src-card')) (e.target as HTMLElement).querySelector<HTMLAnchorElement>('.src-title')?.click();
  });

  // ---- growth: the round grows from the pith to today, then the halo of projections appears
  const counters = [...el.querySelectorAll<HTMLElement>('[data-count]')];
  const count = (p: number) => counters.forEach((k) => (k.textContent = fmt.int(+k.dataset.count! * p)));
  const ro = new ResizeObserver(() => { resize(); if (grown) { scene = paintScene(NOW, 1); draw(); } });
  let grown = false;
  resize();
  ro.observe(canvas.parentElement!);
  const GROW = calm ? 0 : 2600, HALO = calm ? 0 : 900, t0 = performance.now();
  const ease = d3.easeCubicOut;
  const step = (now: number) => {
    if (root !== el) { ro.disconnect(); return; }
    const t = now - t0;
    const g = GROW ? ease(Math.min(1, t / GROW)) : 1;
    const h = HALO ? Math.max(0, Math.min(1, (t - GROW) / HALO)) : 1;
    const y = Math.floor(Y0 + g * (NOW - Y0));
    scene = paintScene(y, h);
    draw();
    count(g);
    yearEl.textContent = h < 1 ? String(y) : '';
    yearEl.classList.toggle('done', g >= 1);
    if (g < 1 || h < 1) requestAnimationFrame(step);
    else grown = true;
  };
  requestAnimationFrame(step);
  el.querySelector<HTMLElement>('.close-x')!.focus({ preventScroll: true });
}

