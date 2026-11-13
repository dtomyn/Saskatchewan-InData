// The Data & sources catalogue: every source the atlas reads, how many records it gave and the rings it draws on the
// tree-ring round (src/sources.ts), the bark (what everything sits on) and what the atlas worked out itself.
import * as d3 from 'd3';
import { Data, fmt } from './data';
import { provinceAnomalies } from './metrics';
import { ago } from './now';

export type Ring = { v: number; label: string; proj?: boolean };
export type Source = {
  id: string; key: string; name: string; color: string; group: string;
  owner: string; title: string; url: string; endpoint: string; licence: string;
  gives: string; read: (d: Data) => { n: number; what: string } | null;
  rings: (d: Data) => Record<number, Ring>;
};
export type BarkSource = { name: string; key?: string; owner: string; title: string; url: string; licence: string; gives: string; read?: (d: Data) => string };

export const Y0 = 1900;
export const NOW = new Date().getFullYear();
export const FUT = 2070;
const OGL_CA = 'OGL – Canada';

const norm = (rows: Record<number, number>, f: (v: number, max: number) => number) => {
  const max = Math.max(...Object.values(rows), 1e-9);
  return (y: number) => Math.max(0, Math.min(1, f(rows[y], max)));
};
export const span = (rings: Record<number, Ring>) => {
  const ys = Object.keys(rings).map(Number);
  return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
};
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const climateDiv = d3.scaleLinear<string>().domain([-1.5, -0.4, 0, 0.4, 1.5]).range(['#2b6cb0', '#7fb3e6', '#9aa3b2', '#f4a08a', '#e0312b']).clamp(true);

export const ALL_SOURCES: Source[] = [
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
    id: 'nbac', key: 'fires', name: 'Burn outlines', color: '#c8553d', group: 'Hazards',
    owner: 'Natural Resources Canada · Canadian Forest Service', title: 'National Burned Area Composite (NBAC): mapped burn perimeters', url: 'https://cwfis.cfs.nrcan.gc.ca/ha/nbac',
    endpoint: 'cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs · typeName=public:nbac, WFS 1.0.0 in EPSG:4326, one Saskatchewan year at a time', licence: OGL_CA,
    gives: 'The mapped outline of each burn, from satellite imagery and agency mapping: Wildfires draws these for fires of 200 ha or more, and a circle for the rest.',
    read: (d) => d.fires?.perimeters?.length ? { n: d.fires.perimeters.length, what: `${fmt.int(d.fires.perimeters.length)} burn outlines, ${d.fires.perimeterYears?.[0]}–${d.fires.perimeterYears?.[1]}` } : null,
    rings: (d) => {
      const ha: Record<number, number> = {};
      for (const b of d.fires?.perimeters ?? []) ha[b[0]] = (ha[b[0]] ?? 0) + b[1];
      const f = norm(ha, (v, m) => Math.log1p(v ?? 0) / Math.log1p(m));
      return Object.fromEntries(Object.keys(ha).map((y) => [y, { v: f(+y), label: `${fmt.ha(ha[+y])} inside mapped outlines` }]));
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
    id: 'crops', key: 'crops', name: 'What grows here', color: '#c9d65b', group: 'Climate',
    owner: 'Agriculture and Agri-Food Canada', title: 'Annual Crop Inventory: 30 m crop and land cover map', url: 'https://open.canada.ca/data/en/dataset/ba2645d5-4458-414d-b196-6303ac06c1c9',
    endpoint: 'agriculture.canada.ca/imagery-images/rest/services/annual_crop_inventory/<year>/ImageServer · exportImage as raw categories, sampled at 500 m, each 3 km cell its most common class', licence: OGL_CA,
    gives: 'What grew on the farm belt each year since 2009 (cereals, canola, pulses, pasture, grassland, forest and more), and the land within 25 km of each place.',
    read: (d) => d.crops && { n: d.crops.years.length, what: `${d.crops.years.length} yearly maps, ${d.crops.years[0]}–${d.crops.years.at(-1)}` },
    rings: (d) => Object.fromEntries((d.crops?.years ?? []).map((y, i) => [y, { v: Math.max(0.15, Math.min(1, d.crops!.share[i][1] / 20)), label: `${d.crops!.share[i][1].toFixed(0)}% canola, ${d.crops!.share[i][0].toFixed(0)}% cereals` }])),
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
    id: 'rivers', key: 'floods', name: 'Flood-prone land', color: '#3c8ceb', group: 'Hazards',
    owner: 'Water Security Agency', title: 'Flood Hazard (Flood Damage Reduction Program floodway and fringe) and 1:500 Year Flood mapping', url: 'https://geohub-wsask.hub.arcgis.com',
    endpoint: 'services1.arcgis.com/7MBdlVpjqbfBhQer · 1_500yr_Flood/FeatureServer/2, Flood_Hazard_All/FeatureServer/33', licence: 'Government of Saskatchewan Standard Unrestricted Use Data Licence v2.0',
    gives: 'The land a 1:500-year flood would cover in the communities the agency has studied, as it modelled it, with the floodway and flood fringe where mapped. A published hazard map, not a forecast.',
    read: (d) => d.floods && { n: d.floods.zones.length, what: `${d.floods.zones.length} flood-hazard areas in ${new Set(d.floods.zones.map((z) => z.place)).size} communities` },
    rings: () => ({}),
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
    id: 'climate', key: 'projections', name: 'Climate projections', color: '#e0312b', group: 'Climate',
    owner: 'Environment and Climate Change Canada', title: 'Statistically downscaled climate scenarios from CMIP6 global climate models (CanDCS-U6): 30-year averages of projected annual anomalies', url: 'https://open.canada.ca/data/en/dataset/f73d6939-912a-4add-a291-c233fc5d1946',
    endpoint: 'api.weather.gc.ca/collections/climate:candcsu6:projected:annual:P30Y-Avg/coverage · one grid per window, scenario and percentile', licence: 'ECCC Data Servers End-use Licence',
    gives: 'Model projections, not a record: the change in mean temperature, daily highs and lows and precipitation from 1971–2000, for 2021–2050, 2041–2070 and 2071–2100, under low (SSP1-2.6) and high (SSP5-8.5) emissions, as the median and 10th–90th percentile of 26 models at each place.',
    read: (d) => d.projections && { n: Object.keys(d.projections.towns).length, what: `projections for ${Object.keys(d.projections.towns).length} places, ${d.projections.windows.length} windows to 2100` },
    rings: (d) => Object.fromEntries((d.projections?.windows ?? []).map((w) => [w + 15, { v: 0.45, label: `projection, ${w}–${w + 29} average (not a record)` }])),
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
    id: 'power', key: 'power', name: 'Power grid', color: '#b4c6ff', group: 'People & places',
    owner: 'OpenStreetMap contributors', title: 'power=line, power=substation, power=plant', url: 'https://wiki.openstreetmap.org/wiki/Power_networks',
    endpoint: 'overpass-api.de (and mirrors) · ways and outlines inside ISO3166-2 CA-SK', licence: 'OSM ODbL',
    gives: 'The high-voltage lines, substations and generating stations mappers have drawn (partial: SaskPower publishes no open grid map), and how near each place they run.',
    read: (d) => d.power && { n: d.power.subs.length + d.power.plants.length, what: `${fmt.int(sum(Object.values(d.power.totals.km)))} km of line, ${d.power.subs.length} substations, ${d.power.plants.length} generating stations` },
    rings: (d) => (d.power ? { [NOW]: { v: 1, label: `as mapped on ${d.power.asOf}` } } : {}),
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
  // ---- right now: live readings, refreshed about hourly; one ring, this year's
  {
    id: 'rivers', key: 'now-rivers', name: 'Rivers now', color: '#4cc9f0', group: 'Right now',
    owner: 'Environment and Climate Change Canada', title: 'Real-time hydrometric data (provisional)', url: 'https://wateroffice.ec.gc.ca/',
    endpoint: 'api.weather.gc.ca/collections/hydrometric-realtime', licence: OGL_CA,
    gives: 'The latest level and flow at each river gauge, compared with the river’s normal annual peak. Provisional, and flagged when ice-affected or estimated.',
    read: (d) => d.now.rivers && { n: d.now.rivers.rows.length, what: `${d.now.rivers.rows.length} gauges reporting in the past day, read ${ago(d.now.rivers.asOf)}` },
    rings: (d) => (d.now.rivers ? { [NOW]: { v: 1, label: `live: read ${ago(d.now.rivers.asOf)}` } } : {}),
  },
  {
    id: 'fires', key: 'now-fires', name: 'Hotspots now', color: '#ff8a3d', group: 'Right now',
    owner: 'Natural Resources Canada', title: 'CWFIS satellite hotspots (last 24 hours) and fire perimeters estimated from them', url: 'https://cwfis.cfs.nrcan.gc.ca/maps/fm3',
    endpoint: 'cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs · public:hotspots_last24hrs, public:m3_polygons_current', licence: OGL_CA,
    gives: 'Heat seen from satellites in the last day: not confirmed fires (flares and farm burning show up too), with the perimeters CWFIS estimates from them.',
    read: (d) => d.now.fires && { n: d.now.fires.hotspots.length, what: `${d.now.fires.hotspots.length} hotspot${d.now.fires.hotspots.length === 1 ? '' : 's'} and ${d.now.fires.perimeters.length} estimated perimeter${d.now.fires.perimeters.length === 1 ? '' : 's'}, read ${ago(d.now.fires.asOf)}` },
    rings: (d) => (d.now.fires ? { [NOW]: { v: 1, label: `live: read ${ago(d.now.fires.asOf)}` } } : {}),
  },
  {
    id: 'smoke', key: 'now-air', name: 'Air now', color: '#e8a87c', group: 'Right now',
    owner: 'Environment and Climate Change Canada', title: 'Air Quality Health Index: real-time observations and forecasts', url: 'https://weather.gc.ca/airquality/pages/provincial_summary/sk_e.html',
    endpoint: 'api.weather.gc.ca/collections/aqhi-observations-realtime · aqhi-forecasts-realtime', licence: OGL_CA,
    gives: 'The latest hourly AQHI and the forecast’s highest value at each community, borrowed by places within 150 km. An index of three pollutants, not the smoke-day count.',
    read: (d) => d.now.air && { n: d.now.air.communities.length, what: `${d.now.air.communities.length} communities, read ${ago(d.now.air.asOf)}` },
    rings: (d) => (d.now.air ? { [NOW]: { v: 1, label: `live: read ${ago(d.now.air.asOf)}` } } : {}),
  },
  {
    id: 'rivers', key: 'now-alerts', name: 'Weather alerts', color: '#ffd166', group: 'Right now',
    owner: 'Environment and Climate Change Canada', title: 'Public weather alerts', url: 'https://weather.gc.ca/?province=sk',
    endpoint: 'api.weather.gc.ca/collections/weather-alerts', licence: OGL_CA,
    gives: 'Warnings, watches, advisories and statements in effect over Saskatchewan, with the forecast regions they cover; shown on the hazard layers at Now and in the Town Report.',
    read: (d) => d.now.alerts && { n: d.now.alerts.alerts.length, what: `${d.now.alerts.alerts.length} alerts in effect, read ${ago(d.now.alerts.asOf)}` },
    rings: (d) => (d.now.alerts ? { [NOW]: { v: 1, label: `live: read ${ago(d.now.alerts.asOf)}` } } : {}),
  },
];

export const BARK: BarkSource[] = [
  { name: 'Province outline', key: 'province', owner: 'Statistics Canada', title: '2021 Census cartographic boundary file: provinces and territories', url: 'https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm', licence: 'Statistics Canada Open Licence', gives: 'The outline every layer is clipped to.' },
  { name: 'Place names', key: 'places', owner: 'Natural Resources Canada', title: 'Canadian Geographical Names Database (geonames API)', url: 'https://natural-resources.canada.ca/earth-sciences/geography/geographical-names-board-canada', licence: OGL_CA, gives: 'Where each of the atlas’s places is. The list of names itself is typed into scripts/places.mjs.', read: (d) => `${d.munis.length} places located` },
  { name: 'Census subdivisions', key: 'subdivisions', owner: 'Statistics Canada', title: '2021 Census cartographic boundary file: census subdivisions, with Census Profile 2021 population and dwellings', url: 'https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm', licence: 'Statistics Canada Open Licence', gives: 'Every city, town, village, rural municipality and reserve: the province-wide census tint on Home costs, Jobs & income and Who lives here, and the census report for places beyond the atlas’s own.', read: (d) => (d.subdivisions ? `${d.subdivisions.csds.length} subdivisions` : 'not built') },
  { name: 'Census tracts', key: 'tracts', owner: 'Statistics Canada', title: '2021 Census cartographic boundary file: census tracts, with Census Profile 2021 by census tract', url: 'https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm', licence: 'Statistics Canada Open Licence', gives: 'The neighbourhood map at the top of the Regina and Saskatoon Town Reports: home value, income, renters, shelter costs, immigrants and Indigenous identity by tract.', read: (d) => (d.tracts ? `${d.tracts.tracts.filter((t) => !t.out).length} tracts inside the two cities` : 'not built') },
  { name: 'Roads', key: 'hospitals', owner: 'OpenStreetMap contributors · OSRM', title: 'OSRM demo router on OpenStreetMap roads', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL', gives: 'The road routes and free-flow drive times to the nearest hospital, courthouse, police station, campground and school.' },
  { name: 'Basemap', owner: 'CARTO · OpenStreetMap contributors', title: 'Dark Matter vector basemap', url: 'https://carto.com/attributions', licence: 'ODbL / CARTO terms', gives: 'The dark map, place names and roads under every layer.' },
  { name: 'Terrain', owner: 'Mapzen · AWS Open Data', title: 'Terrain Tiles (terrarium)', url: 'https://registry.opendata.aws/terrain-tiles/', licence: 'Open, with attribution', gives: 'The shaded relief: the Cypress Hills, the Missouri Coteau, the river valleys and the Shield.' },
];

export const DERIVED = [
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
