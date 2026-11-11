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
    id: 'tornadoes', key: 'tornadoes', name: 'Tornadoes', color: '#9ad8ff', group: 'Hazards',
    owner: 'Environment and Climate Change Canada', title: 'Canadian National Tornado Database: Verified Events (1980–2009)', url: 'https://open.canada.ca/data/en/dataset/fd3355a7-ae34-4df7-b477-07306182db69',
    endpoint: 'data-donnees.az.ec.gc.ca/api/file · GIS_CAN_VerifiedTornadoes_1980-2009.csv', licence: OGL_CA,
    gives: 'Every verified tornado: where and when it touched down, its Fujita rating, deaths, injuries and damage.',
    read: (d) => d.tornadoes && { n: d.tornadoes.rows.length, what: `${fmt.int(d.tornadoes.rows.length)} Saskatchewan tornadoes` },
    rings: (d) => {
      const n: Record<number, number> = {};
      for (const r of d.tornadoes?.rows ?? []) { const y = Math.floor(r[2]); n[y] = (n[y] ?? 0) + 1; }
      const f = norm(n, (v, m) => Math.sqrt(v / m));
      return Object.fromEntries(Object.keys(n).map((y) => [y, { v: f(+y), label: `${n[+y]} tornado${n[+y] === 1 ? '' : 'es'}` }]));
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
    id: 'hospitals', key: 'hospitals', name: 'Hospital access', color: '#6c8cff', group: 'People & places',
    owner: 'Statistics Canada · OSRM', title: 'Open Database of Healthcare Facilities (ODHF v1)', url: 'https://open.canada.ca/data/en/dataset/a1bcd4ee-8e57-499b-9c6f-94f6902fdf32',
    endpoint: 'ftp.maps.canada.ca … ODHF_BDOES/odhf_bdoes_v1.csv · router.project-osrm.org', licence: `${OGL_CA}; routes ODbL`,
    gives: 'Where the hospitals are, and how long the drive is from each place.',
    read: (d) => d.hospitals && { n: d.hospitals.facilities.length + sum(Object.values(d.hospitals.towns).map((t) => t.length)), what: `${d.hospitals.facilities.length} facilities, ${fmt.int(sum(Object.values(d.hospitals.towns).map((t) => t.length)))} routed drives` },
    rings: (d) => (d.hospitals ? { 2020: { v: 1, label: `${d.hospitals.facilities.length} facilities as compiled in 2020` } } : {}),
  },
];

const BARK: BarkSource[] = [
  { name: 'Province outline', key: 'province', owner: 'Statistics Canada', title: '2021 Census cartographic boundary file: provinces and territories', url: 'https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm', licence: 'Statistics Canada Open Licence', gives: 'The outline every layer is clipped to.' },
  { name: 'Place names', key: 'places', owner: 'Natural Resources Canada', title: 'Canadian Geographical Names Database (geonames API)', url: 'https://natural-resources.canada.ca/earth-sciences/geography/geographical-names-board-canada', licence: OGL_CA, gives: 'Where each of the atlas’s places is. The list of names itself is typed into scripts/places.mjs.', read: (d) => `${d.munis.length} places located` },
  { name: 'Roads', key: 'hospitals', owner: 'OpenStreetMap contributors · OSRM', title: 'OSRM demo router on OpenStreetMap roads', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL', gives: 'The road routes and free-flow drive times to the nearest hospital, courthouse and police station.' },
  { name: 'Basemap', owner: 'CARTO · OpenStreetMap contributors', title: 'Dark Matter vector basemap', url: 'https://carto.com/attributions', licence: 'ODbL / CARTO terms', gives: 'The dark map, place names and roads under every layer.' },
  { name: 'Terrain', owner: 'Mapzen · AWS Open Data', title: 'Terrain Tiles (terrarium)', url: 'https://registry.opendata.aws/terrain-tiles/', licence: 'Open, with attribution', gives: 'The shaded relief: the Cypress Hills, the Missouri Coteau, the river valleys and the Shield.' },
];

const DERIVED = [
  ['Provincial warming', 'the climate anomaly is the average of every station’s difference from its own 1961–90 baseline.'],
  ['Fire scars', 'are circles with the same area as each fire’s reported size, centred where it started; they are not the fire’s real shape.'],
  ['Crime by place', 'uses each place’s own police service; northern villages with no municipal series use their rural RCMP detachment, which covers a wider area, and the report says so.'],
  ['Police in town', 'OpenStreetMap misses many police buildings here, so a place Statistics Canada lists with its own municipal police service (a city force or a municipal RCMP detachment) counts as having police in town when none is mapped within 6 km of its centre.'],
  ['Hospitals', 'are the ODHF rows whose type or name says hospital; health centres and clinics are shown but not counted as the nearest hospital.'],
  ['Borrowed stations', 'a place without its own sunshine or climate station uses the nearest one (sunshine within 150 km), and its report names it.'],
  ['Treaty of a place', 'is the treaty area its centre falls in, as Indigenous Services Canada maps it.'],
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

