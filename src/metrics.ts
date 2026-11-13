// Derived, per-place statistics shared by the Town Report and the Town Finder.
import { Data, Muni, NormalsStation, TaxPlace, km } from './data';
import { nearestJustice } from './justice';
import { nearestCamp } from './camping';
import { PlaceNeeds, placeNeeds } from './needs';
import { placeRegion, topIndustries } from './jobs';
import { PlaceSchools, placeSchools } from './schools';
import { PlaceNet, placeNet } from './internet';
import { PlaceCommunity, placeCommunity } from './community';
import { PlaceNewcomer, placeNewcomer } from './newcomer';
import { PlaceDoctors, placeDoctors } from './doctors';
import { PlaceChildcare, placeChildcare } from './childcare';
import { PlaceSmoke, placeSmoke } from './smoke';
import { PlaceHail, placeHail } from './hail';
import { PlaceDrought, placeDrought } from './drought';
import { PlaceIndustry, placeIndustry } from './industry';
import { PlaceWater, placeWater } from './water';
import { PlaceRadon, placeRadon } from './radon';
import { PlaceLight, placeLight } from './light';
import { PlaceTransit, placeTransit } from './transit';

/** A climate-normal value borrowed from the nearest station that reports it. */
export type NormalPick = { v: number; name: string; dist: number };
export type NormalVar = 'sun' | 'wetDays' | 'frostDays' | 'snow';
// Few Saskatchewan stations measure sunshine, so allow a longer reach for it than for the others.
const NORMAL_REACH: Record<NormalVar, number> = { sun: 150, wetDays: 80, frostDays: 80, snow: 80 };

/** A trip by road to a hospital, courthouse or police station; `min` is null when only straight-line distance is known. */
export type CareTrip = { name: string; city: string | null; min: number | null; km: number; inferred?: boolean };

export type TownMetrics = {
  muni: Muni;
  pop: number | null;
  popYear: number | null;
  popGrowth5y: number | null;
  csi: number | null;
  vcsi: number | null;
  clear: number | null;
  csiYear: string | null;
  police: { name: string; rural: boolean } | null; // the police service behind the crime figures
  court: CareTrip | null; // nearest courthouse by road (OpenStreetMap)
  policeStation: CareTrip | null; // nearest police station or detachment by road
  hospital: CareTrip | null; // nearest hospital proper by road
  camp: CareTrip | null; // nearest campground you can drive to (Parks Canada or OpenStreetMap)
  parks50km: number; // parks, recreation sites and regional parks whose centre is within 50 km
  fires25km: number; // fires started within 25 km since 1990
  burnedHa50km: number; // area burned by fires that started within 50 km since 1990
  tornadoes50km: number; // tornadoes on record within 50 km (ECCC 1980–2009, Northern Tornadoes Project 2017 →)
  treaty: string | null; // the numbered treaty area the town centre is in
  climate: { name: string; dist: number; meanTemp: number; precip: number | null; trend: number | null } | null;
  hail: PlaceHail | null; // Northern Hail Project storms (radar swaths 2022–2024, research database) passing within 50 km, and the largest hail among them
  drought: PlaceDrought | null; // Canadian Drought Monitor: months at D2 (severe) or worse in the last ten years of monthly maps, and the latest month's category, at the town centre's 10 km cell
  smoke: PlaceSmoke | null; // smoke days a year (24 h PM2.5 > 25 µg/m³), last ten years, borrowed from the nearest NAPS station within 150 km
  river: { name: string; dist: number; floodShare: number; record: { year: string; ratio: number } } | null;
  feels: Record<NormalVar, NormalPick | null>;
  // home costs: Census 2021 for the place's own census subdivision, CMHC's survey for the centre named after it
  homeValue: number | null; // median value of owned dwellings ($)
  ownCost: number | null; // median monthly shelter cost, owners ($)
  rentCost: number | null; // median monthly shelter cost, renters ($)
  stir30: number | null; // % of households spending 30 %+ of income on shelter
  rent30: number | null; // % of renter households doing so
  marketRent: { r2: number; r1: number | null; vac: number | null; year: number; centre: string } | null; // CMHC, latest year
  propTax: (TaxPlace & { year: number; edu: number }) | null; // Mill Rate Survey row (latest year) and the indicative tax on the census median home
  needs: PlaceNeeds | null; // everyday services in town (OpenStreetMap, inside the municipal limits or just outside)
  // jobs & income: the Labour Force Survey region the place lies in (latest year), and Census 2021 for the place itself
  jobsRegion: { name: string; ur: number; year: number; combined: boolean } | null;
  income: number | null; // median total household income, 2020 ($)
  censusUnemp: number | null; // unemployment rate in census week, May 2021 (%)
  industries: { name: string; pct: number }[]; // top three NAICS sectors by share of the labour force
  internet: PlaceNet | null; // fixed speed tiers offered to homes in town, LTE and mobile networks (ISED National Broadband Data)
  community: PlaceCommunity | null; // who lives here: immigrants, birthplaces, home languages, French, Indigenous identity (Census 2021); places of worship in town (OpenStreetMap)
  newcomer: PlaceNewcomer | null; // nearest settlement agency, English classes, Service Canada office and SGI issuer by road (IRCC; OpenStreetMap)
  childcare: PlaceChildcare | null; // nearest licensed child care centre and licensed care of any kind by road; centres and family homes in town (Ministry of Education)
  doctors: PlaceDoctors | null; // nearest clinic and pharmacy by road, and how many are in town (ODHF; OpenStreetMap)
  industry: PlaceIndustry | null; // wells and oil & gas facilities within 5 km of the town limits, pipelines within 2 km, the nearest NPRI site, a producing mine within 25 km (Ministry of Energy and Resources; NPRI; OpenStreetMap)
  water: PlaceWater | null; // drinking water advisories in effect on the town water system and within 25 km of the town centre (Water Security Agency; Saskatchewan Health Authority; Indigenous Services Canada)
  radon: PlaceRadon | null; // share of tested homes at or above 200 Bq/m³ in the place's 2007 health region and its own postal areas (Health Canada survey, 2009–2011)
  light: PlaceLight | null; // daylight on Dec 21 / Mar 20 / Jun 21 and civil twilight (computed from latitude), geomagnetic latitude and aurora band (IGRF-14 dipole, NOAA SWPC Kp rule), drive to the nearest campground in a RASC dark-sky preserve
  transit: PlaceTransit | null; // drive to the nearest airport with scheduled flights (OurAirports; OSRM), VIA and intercity bus stops in town (OpenStreetMap), city buses (GTFS; OpenStreetMap)
  schools: PlaceSchools | null; // nearest elementary, high, French and post-secondary by road; schools in town (Ministry of Education)
};

function nearestNormal(stations: NormalsStation[], m: Muni, k: NormalVar, also: NormalVar[] = []): NormalPick | null {
  let best: NormalPick | null = null;
  for (const s of stations) {
    const v = s[k];
    if (v == null || also.some((a) => s[a] == null)) continue;
    const d = km(m.lon, m.lat, s.lon, s.lat);
    if (d <= NORMAL_REACH[k] && (!best || d < best.dist)) best = { v, name: s.name, dist: d };
  }
  return best;
}

export function latestYear(series?: Record<string, number>, maxYear = Infinity) {
  if (!series) return null;
  const ys = Object.keys(series).map(Number).filter((y) => y <= maxYear).sort((a, b) => a - b);
  return ys.length ? ys[ys.length - 1] : null;
}

export function slope(points: [number, number][]) {
  const n = points.length;
  if (n < 10) return null;
  const mx = points.reduce((a, p) => a + p[0], 0) / n;
  const my = points.reduce((a, p) => a + p[1], 0) / n;
  let num = 0, den = 0;
  for (const [x, y] of points) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
  return den ? num / den : null;
}

/** The province-wide temperature anomaly: the mean of every station's difference from its own baseline. */
export function provinceAnomalies(data: Data) {
  const out: Record<number, number> = {};
  if (!data.climate) return out;
  const acc: Record<number, number[]> = {};
  for (const s of data.climate.stations) for (const [y, v] of Object.entries(s.temp)) (acc[+y] ??= []).push(v - s.baseline);
  for (const [y, arr] of Object.entries(acc)) if (arr.length >= 3) out[+y] = arr.reduce((a, b) => a + b, 0) / arr.length;
  return out;
}

/** Ray-casting point-in-polygon over a polygon's rings (holes count as outside). */
function inPoly(lon: number, lat: number, poly: [number, number][][]) {
  let inside = false;
  for (const ring of poly)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}

// ---------------------------------------------------------------------------------------------
// The viewer's workplace ("I work in…"): one setting shared by Workday Reach and the Finder's Short commute,
// remembered in this browser.

const WORK_KEY = 'living-skies-atlas:work';
export const COMMUTE_LIMITS = [15, 30, 45, 60];
export type Work = { key: string | null; limit: number };
let work: Work = { key: null, limit: 45 };
try {
  const w = JSON.parse(localStorage.getItem(WORK_KEY) ?? 'null');
  if (w && typeof w === 'object') work = { key: typeof w.key === 'string' ? w.key : null, limit: COMMUTE_LIMITS.includes(w.limit) ? w.limit : 45 };
} catch { /* storage unavailable */ }
export const getWork = (): Work => work;
/** Sets the workplace or the commute limit, remembers it, and tells the map and panels. */
export function setWork(w: Partial<Work>) {
  work = { ...work, ...w };
  try { localStorage.setItem(WORK_KEY, JSON.stringify(work)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('atlas:work', { detail: work }));
}

let driveIdx: { data: Data; at: Map<string, number> } | null = null;
/** The drive in minutes from one place's centre to another's (Workday Reach's OSRM table), or null. */
export function driveMin(data: Data, from: string, to: string): number | null {
  const C = data.commute;
  if (!C) return null;
  if (driveIdx?.data !== data) driveIdx = { data, at: new Map(C.keys.map((k, i) => [k, i])) };
  const i = driveIdx.at.get(from), j = driveIdx.at.get(to);
  return i == null || j == null ? null : C.min[i][j];
}
/** The workplace, if one is set and is one of the atlas's places. */
export const workplace = (data: Data) => (work.key && data.commute && data.munis.some((m) => m.key === work.key) ? work.key : null);

let cache: TownMetrics[] | null = null;
let cacheData: Data | null = null;

export function townMetrics(data: Data): TownMetrics[] {
  if (cache) return cache;
  cacheData = data;
  const nowYear = new Date().getFullYear();
  cache = data.munis.map((m) => {
    // population
    const ps = data.population?.munis[m.key];
    let pop: number | null = null, popYear: number | null = null, popGrowth5y: number | null = null;
    if (ps) {
      const est = latestYear(ps.pop);
      if (est) {
        pop = ps.pop[est]; popYear = est;
        const p5 = ps.pop[est - 5];
        if (p5) popGrowth5y = pop / p5 - 1;
      }
    }
    // crime: ignore series that stopped years ago (a detachment that closed or merged)
    const cs = data.crime?.munis[m.key];
    const cyAny = latestYear(cs?.csi);
    const cy = cyAny && cyAny >= nowYear - 4 ? cyAny : null;
    const svc = data.crime?.service?.[m.key];

    // hazards
    let fires25km = 0, burnedHa50km = 0, tornadoes50km = 0;
    for (const p of data.fires?.points ?? []) {
      if (p[2] < 1990) continue;
      const d = km(m.lon, m.lat, p[0], p[1]);
      if (d <= 25) fires25km++;
      if (d <= 50) burnedHa50km += p[3];
    }
    for (const r of data.tornadoes?.rows ?? []) if (km(m.lon, m.lat, r[0], r[1]) <= 50) tornadoes50km++;
    const treaty = data.treaties?.treaties.find((t) => t.polys.some((p) => inPoly(m.lon, m.lat, p)))?.name ?? null;

    // nearest long-record climate station with recent data
    let climate: TownMetrics['climate'] = null;
    if (data.climate) {
      let best: { s: (typeof data.climate.stations)[number]; d: number } | null = null;
      for (const s of data.climate.stations) {
        if (Object.keys(s.temp).filter((y) => +y >= 2000).length < 8) continue;
        const d = km(m.lon, m.lat, s.lon, s.lat);
        if (!best || d < best.d) best = { s, d };
      }
      if (best) {
        const s = best.s;
        const recentYears = Object.keys(s.temp).map(Number).filter((y) => y >= 1991);
        const meanTemp = recentYears.reduce((a, y) => a + s.temp[y], 0) / recentYears.length;
        const pYears = Object.keys(s.precip).map(Number).filter((y) => y >= 1981);
        const precip = pYears.length >= 5 ? pYears.reduce((a, y) => a + s.precip[y], 0) / pYears.length : null;
        const tr = slope(Object.entries(s.temp).filter(([y]) => +y >= 1950).map(([y, v]) => [+y, v]));
        climate = { name: s.name, dist: best.d, meanTemp, precip, trend: tr == null ? null : tr * 10 };
      }
    }

    // nearest gauged river within 25 km
    let river: TownMetrics['river'] = null;
    if (data.rivers) {
      let best: { s: (typeof data.rivers.stations)[number]; d: number } | null = null;
      for (const s of data.rivers.stations) {
        const d = km(m.lon, m.lat, s.lon, s.lat);
        if (d <= 25 && (!best || d < best.d)) best = { s, d };
      }
      if (best) {
        const vals = Object.entries(best.s.peaks);
        const high = vals.filter(([, v]) => v >= 1.5 * best!.s.median).length;
        const rec = vals.reduce((a, b) => (b[1] > a[1] ? b : a));
        river = { name: best.s.name, dist: best.d, floodShare: high / vals.length, record: { year: rec[0], ratio: rec[1] / best.s.median } };
      }
    }

    const ns = data.normals?.stations ?? [];
    const feels: TownMetrics['feels'] = {
      sun: nearestNormal(ns, m, 'sun'),
      wetDays: nearestNormal(ns, m, 'wetDays'),
      frostDays: nearestNormal(ns, m, 'frostDays', ['snow']),
      snow: nearestNormal(ns, m, 'snow', ['frostDays']),
    };

    const jt = (kind: 'court' | 'police'): CareTrip | null => { const n = nearestJustice(data, m.key, kind); return n ? { name: n.site.name, city: n.site.city, min: n.min, km: n.km, inferred: n.inferred } : null; };
    const fac = data.hospitals?.facilities ?? [];
    const htrip = data.hospitals?.towns[m.key]?.[0];
    const ct = nearestCamp(data, m.key);
    const cpark = ct?.camp.p != null ? data.camping!.parks[ct.camp.p].name : null;
    const parks50km = (data.camping?.parks ?? []).filter((p) => p.type !== 'historic' && km(m.lon, m.lat, p.c[0], p.c[1]) <= 50).length;

    const hc = data.housing?.census[m.key];
    const rs = data.housing?.rent[m.key];
    const ry = latestYear(rs?.r2);
    const marketRent = rs && ry ? { r2: rs.r2[ry], r1: rs.r1[ry] ?? null, vac: rs.vac?.[ry] ?? null, year: ry, centre: rs.centre } : null;

    const pr = placeRegion(data, m.key);
    const jt2 = data.jobs?.towns[m.key];

    return {
      muni: m, pop, popYear, popGrowth5y,
      jobsRegion: pr && pr.ur != null && pr.year != null ? { name: pr.region.name, ur: pr.ur, year: pr.year, combined: pr.region.combined } : null,
      income: jt2?.inc ?? null, censusUnemp: jt2?.cur ?? null, industries: data.jobs ? topIndustries(data.jobs, jt2?.ind) : [],
      homeValue: hc?.value ?? null, ownCost: hc?.ownCost ?? null, rentCost: hc?.rentCost ?? null, stir30: hc?.stir30 ?? null, rent30: hc?.rent30 ?? null, marketRent,
      propTax: data.tax?.places[m.key] ? { ...data.tax.places[m.key], year: data.tax.year, edu: data.tax.edu } : null,
      csi: cy ? cs!.csi![cy] : null, vcsi: cy ? cs?.vcsi?.[cy] ?? null : null, clear: cy ? cs?.clear?.[cy] ?? null : null, csiYear: cy ? String(cy) : null,
      police: svc ? { name: svc.name, rural: svc.level === 'rural' } : null,
      court: jt('court'),
      policeStation: jt('police'),
      hospital: htrip ? { name: fac[htrip.f].name, city: fac[htrip.f].city, min: htrip.min, km: htrip.km } : null,
      camp: ct ? { name: ct.camp.name, city: cpark, min: ct.min, km: ct.km } : null,
      parks50km,
      needs: placeNeeds(data, m.key),
      schools: placeSchools(data, m.key),
      internet: placeNet(data, m.key),
      community: placeCommunity(data, m.key),
      newcomer: placeNewcomer(data, m.key),
      doctors: placeDoctors(data, m.key),
      childcare: placeChildcare(data, m.key),
      industry: placeIndustry(data, m.key),
      water: placeWater(data, m.key),
      radon: placeRadon(data, m.key),
      light: placeLight(data, m.key),
      transit: placeTransit(data, m.key),
      fires25km, burnedHa50km, tornadoes50km, treaty, climate, river, feels,
      smoke: placeSmoke(data, m),
      hail: placeHail(data, m),
      drought: placeDrought(data, m.key),
    };
  });
  return cache;
}

// ---------------------------------------------------------------------------------------------
// Town Finder scoring

export type Criterion = {
  id: string;
  label: string;
  hint: string;
  value: (t: TownMetrics) => number | null;
  higherIsBetter: boolean;
  defaultWeight: number;
};

const mins = (t: CareTrip | null) => (t ? t.min ?? t.km : null);

export const CRITERIA: Criterion[] = [
  { id: 'safety', label: 'Low crime', hint: 'Lower Crime Severity Index (latest year, own police service)', value: (t) => t.csi, higherIsBetter: false, defaultWeight: 3 },
  { id: 'violent', label: 'Low violent crime', hint: 'Lower Violent Crime Severity Index', value: (t) => t.vcsi, higherIsBetter: false, defaultWeight: 2 },
  { id: 'solved', label: 'Crimes get solved', hint: 'Higher weighted clearance rate: the share of crime police solve, weighted by seriousness', value: (t) => t.clear, higherIsBetter: true, defaultWeight: 1 },
  { id: 'police', label: 'Police nearby', hint: 'Shorter drive to the nearest police station or RCMP detachment', value: (t) => mins(t.policeStation), higherIsBetter: false, defaultWeight: 1 },
  { id: 'court', label: 'Court nearby', hint: 'Shorter drive to the nearest courthouse (circuit court points not counted)', value: (t) => mins(t.court), higherIsBetter: false, defaultWeight: 1 },
  { id: 'hospital', label: 'Close to a hospital', hint: 'Shorter drive to the nearest hospital', value: (t) => mins(t.hospital), higherIsBetter: false, defaultWeight: 3 },
  { id: 'camping', label: 'Close to camping', hint: 'Shorter drive to the nearest campground (provincial, national, regional or private)', value: (t) => mins(t.camp), higherIsBetter: false, defaultWeight: 0 },
  { id: 'buy', label: 'Affordable to buy', hint: 'Lower median value of owned dwellings (Census 2021)', value: (t) => t.homeValue, higherIsBetter: false, defaultWeight: 0 },
  { id: 'tax', label: 'Lower property tax', hint: 'Lower indicative annual property tax on the place’s 2021 census median home: value × 80 % × (residential municipal + education mill rate) ÷ 1000, from the latest Mill Rate Survey. Base tax, minimum tax and library levies are left out', value: (t) => t.propTax?.tax ?? null, higherIsBetter: false, defaultWeight: 0 },
  { id: 'rent', label: 'Affordable to rent', hint: 'Lower median monthly shelter cost paid by renters (Census 2021: rent plus utilities)', value: (t) => t.rentCost, higherIsBetter: false, defaultWeight: 0 },
  { id: 'jobs', label: 'Jobs nearby', hint: 'Lower unemployment in the place’s Labour Force Survey region (latest year; only five regions, so many places tie)', value: (t) => t.jobsRegion?.ur ?? null, higherIsBetter: false, defaultWeight: 0 },
  { id: 'income', label: 'Higher income', hint: 'Higher median household income (Census 2021, 2020 incomes)', value: (t) => t.income, higherIsBetter: true, defaultWeight: 0 },
  { id: 'fire', label: 'Low wildfire exposure', hint: 'Fewer fires started within 25 km since 1990', value: (t) => t.fires25km, higherIsBetter: false, defaultWeight: 1 },
  { id: 'smoke', label: 'Fewer smoke days', hint: 'Fewer days a year when wildfire smoke (24-hour PM2.5 above 25 µg/m³) fouled the air, last ten years, at the nearest of Saskatchewan’s six air-monitoring stations within 150 km (borrowed: places farther away are left out)', value: (t) => t.smoke?.avg ?? null, higherIsBetter: false, defaultWeight: 0 },
  { id: 'hail', label: 'Less hail', hint: 'Fewer hailstorms on record whose swath passed within 50 km (Northern Hail Project radar swaths 2022–2024 and its research database; only three summers, and counts depend on radar coverage and who reported)', value: (t) => t.hail?.n ?? null, higherIsBetter: false, defaultWeight: 0 },
  { id: 'drought', label: 'Fewer drought months', hint: 'Fewer months in severe drought or worse (D2+) on the Canadian Drought Monitor’s monthly maps over the last ten years, at the 10 km map cell the town centre is in (a consensus map, not a measurement)', value: (t) => t.drought?.d2 ?? null, higherIsBetter: false, defaultWeight: 0 },
  { id: 'tornado', label: 'Fewer tornadoes', hint: 'Fewer tornadoes on record within 50 km (1980–2009 and 2017 on; counts depend on who or what was there to spot them)', value: (t) => t.tornadoes50km, higherIsBetter: false, defaultWeight: 0 },
  { id: 'warm', label: 'Milder', hint: 'Higher mean annual temperature (1991+, nearest long-record station)', value: (t) => t.climate?.meanTemp ?? null, higherIsBetter: true, defaultWeight: 1 },
  { id: 'sun', label: 'Sunnier', hint: 'More bright-sunshine hours a year (nearest station that measures it, within 150 km)', value: (t) => t.feels.sun?.v ?? null, higherIsBetter: true, defaultWeight: 1 },
  { id: 'snow', label: 'Less snow & frost', hint: 'Fewer frost days + cm of snowfall a year (30-yr normals)', value: (t) => (t.feels.frostDays && t.feels.snow ? t.feels.frostDays.v + t.feels.snow.v : null), higherIsBetter: false, defaultWeight: 0 },
  { id: 'growth', label: 'Growing', hint: 'Faster population growth over the last five years', value: (t) => t.popGrowth5y, higherIsBetter: true, defaultWeight: 2 },
  { id: 'commute', label: 'Short commute', hint: 'Shorter drive to the place you work (set “I work in…” above; off until you do)', value: (t) => { const w = cacheData && workplace(cacheData); return w ? driveMin(cacheData!, t.muni.key, w) : null; }, higherIsBetter: false, defaultWeight: 0 },
  { id: 'school', label: 'School nearby', hint: 'Shorter drive to the nearest high school (or K-12 school) any family can attend (Ministry of Education list)', value: (t) => mins(t.schools?.h ?? null), higherIsBetter: false, defaultWeight: 0 },
  { id: 'french', label: 'French schooling', hint: 'Shorter drive to the nearest Fransaskois school or school with a French immersion program', value: (t) => mins(t.schools?.f ?? null), higherIsBetter: false, defaultWeight: 0 },
  { id: 'internet', label: 'Fast internet', hint: 'More of the homes in town offered fixed internet at 50/10 Mbps or better, wired or fixed wireless (ISED National Broadband Data: offered, not measured)', value: (t) => t.internet?.f50 ?? null, higherIsBetter: true, defaultWeight: 0 },
  { id: 'diverse', label: 'Diverse community', hint: 'More of the people in town are immigrants (Census 2021: immigrants as a share of people in private households), so a newcomer is more likely to find others who made the same move. It measures where people were born, nothing else', value: (t) => t.community?.immShare ?? null, higherIsBetter: true, defaultWeight: 0 },
  { id: 'newcomer', label: 'Newcomer services nearby', hint: 'Shorter drive to the nearest settlement agency (IRCC-funded, or on the province’s settlement list): free help to settle, find work and get credentials recognised', value: (t) => mins(t.newcomer?.s ?? null), higherIsBetter: false, defaultWeight: 0 },
  { id: 'clinic', label: 'Clinic nearby', hint: 'Shorter drive to the nearest medical clinic, doctor’s office or primary health care centre (Saskatchewan Health Authority sites in Statistics Canada’s ODHF, and OpenStreetMap). A clinic nearby is not a doctor taking new patients', value: (t) => (t.doctors?.c ? t.doctors.c.min ?? t.doctors.c.km : null), higherIsBetter: false, defaultWeight: 0 },
  { id: 'childcare', label: 'Childcare nearby', hint: 'Shorter drive to the nearest licensed child care centre (Ministry of Education list). Licensed is not the same as a space being open: waitlists are common', value: (t) => (t.childcare?.c ? t.childcare.c.min ?? t.childcare.c.km : null), higherIsBetter: false, defaultWeight: 0 },
  { id: 'industry', label: 'Fewer industrial neighbours', hint: 'Fewer oil and gas wells (active, suspended or abandoned) and oil and gas facilities within 5 km of the town limits, industrial sites reporting to the National Pollutant Release Inventory within 5 km, licensed pipelines within 2 km and producing mines within 25 km, one count each. Neutral: these are also where many of the jobs are', value: (t) => t.industry?.score ?? null, higherIsBetter: false, defaultWeight: 0 },
  { id: 'radon', label: 'Lower radon', hint: 'Fewer of the tested homes in the place’s health region at or above Canada’s radon guideline, 200 Bq/m³ (Health Canada survey, 2009–2011; 2007 health regions, so neighbouring places tie). A regional odds, not a property’s: every home should get a long-term test', value: (t) => t.radon?.region.pct ?? null, higherIsBetter: false, defaultWeight: 0 },
  { id: 'winterday', label: 'Longer winter days', hint: 'More hours from sunrise to sunset on December 21, the shortest day (computed from latitude: the farther south, the longer; under an hour and a half between the far north and the border)', value: (t) => t.light?.d[0] ?? null, higherIsBetter: true, defaultWeight: 0 },
  { id: 'airport', label: 'Near an airport', hint: 'Shorter drive to the nearest airport with scheduled passenger flights (OurAirports’ flag; Regina and Saskatoon have the most routes, the smaller ones a few flights a day or week)', value: (t) => (t.transit?.air ? t.transit.air.min ?? t.transit.air.km : null), higherIsBetter: false, defaultWeight: 0 },
  { id: 'carfree', label: 'Can live without a car', hint: 'What is mapped in town to get around without driving: a city bus (2), an intercity bus stop (1), a VIA Rail stop (1). Intercity bus is only what OpenStreetMap has (partial), and it says nothing about how often anything runs', value: (t) => t.transit?.carFree ?? null, higherIsBetter: true, defaultWeight: 0 },
  { id: 'needs', label: 'Daily needs in town', hint: 'More of eight everyday services mapped in town (OpenStreetMap): grocery store, pharmacy, school, bank or credit union, gas station, library, post office, clinic', value: (t) => t.needs?.met ?? null, higherIsBetter: true, defaultWeight: 2 },
];

export type Ranked = { t: TownMetrics; score: number; parts: Record<string, number | null> };

/** Percentile-rank each criterion across places (robust to outliers), then weight-average. */
export function rankTowns(towns: TownMetrics[], weights: Record<string, number>): Ranked[] {
  const parts: Record<string, Map<string, number>> = {};
  for (const c of CRITERIA) {
    const vals = towns.map((t) => ({ k: t.muni.key, v: c.value(t) })).filter((x) => x.v != null) as { k: string; v: number }[];
    vals.sort((a, b) => a.v - b.v);
    const m = new Map<string, number>();
    vals.forEach((x, i) => {
      let j = i;
      while (j + 1 < vals.length && vals[j + 1].v === x.v) j++;
      let s = i;
      while (s > 0 && vals[s - 1].v === x.v) s--;
      const r = vals.length > 1 ? (s + j) / 2 / (vals.length - 1) : 0.5;
      m.set(x.k, c.higherIsBetter ? r : 1 - r);
    });
    parts[c.id] = m;
  }
  return towns
    .map((t) => {
      let sum = 0, wsum = 0;
      const p: Record<string, number | null> = {};
      for (const c of CRITERIA) {
        const s = parts[c.id].get(t.muni.key);
        p[c.id] = s ?? null;
        const w = weights[c.id] ?? 0;
        if (s != null && w > 0) { sum += s * w; wsum += w; }
      }
      return { t, score: wsum ? sum / wsum : 0, parts: p };
    })
    .sort((a, b) => b.score - a.score);
}
