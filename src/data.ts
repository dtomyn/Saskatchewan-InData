// Loads the pre-built JSON files in public/data and shapes them for rendering.

/** A place in the atlas: a city, town or northern village. `rd` is a coarse region (South, Central, North). */
export type Muni = {
  key: string; name: string; rd: string; kind: string; lon: number; lat: number;
  note?: string; areas?: { crime?: string; pop?: string };
};

/** lon, lat, t (fractional year), hectares, cause (0 lightning, 1 human, 2 unknown), name (big fires only) */
export type FirePoint = [number, number, number, number, number, string?];
/** lon, lat, t, Fujita (null unrated), end lon, end lat, track m, width m, deaths, injuries, damage $K, nearest community */
/** …, source (0 ECCC 1980–2009 on the Fujita scale, 1 Northern Tornadoes Project 2017 → on the Enhanced Fujita scale), flags (bit 0 default EF0, bit 1 estimated end point) */
export type TornadoRow = [number, number, number, number | null, number | null, number | null, number | null, number | null, number, number, number | null, string | null, 0 | 1, number];

export type RiverStation = {
  id: string; name: string; lon: number; lat: number; area: number; median: number;
  peaks: Record<string, number>; peakDates: Record<string, string>;
};
export type ClimateStation = {
  id: string; name: string; lon: number; lat: number; baseline: number;
  temp: Record<string, number>; precip: Record<string, number>;
};
/** One station's 30-year climate normals (annual values; fields missing where the station doesn't report them). */
export type NormalsStation = {
  id: string; name: string; lon: number; lat: number; yrs: number;
  sun?: number; wetDays?: number; frostDays?: number; snow?: number; precip?: number;
  tMean?: number; tJan?: number; tJul?: number; wet?: [number, number];
};
export type PopSeries = { pop: Record<string, number> };
/** A health facility. `hospital`: a hospital proper, not a health centre or clinic; `type` is the source's own label. */
export type Facility = { name: string; city: string; lon: number; lat: number; hospital: boolean; ed: null; hours: null; type?: string };
/** One place -> facility trip: facility index, drive minutes (null if straight-line only), km, road line. */
export type Trip = { f: number; min: number | null; km: number; ferry?: boolean; line?: [number, number][] };

export type CrimeSeries = { csi?: Record<string, number>; vcsi?: Record<string, number>; nvcsi?: Record<string, number>; clear?: Record<string, number> };
export type Crime = {
  source: string; services: number;
  prov: CrimeSeries; munis: Record<string, CrimeSeries>;
  /** the police service each place's series comes from: its own municipal service, or a rural RCMP detachment */
  service: Record<string, { level: 'municipal' | 'rural'; rcmp: boolean; name: string }>;
};

export type JusticeSite = { kind: 'court' | 'police' | 'corrections'; name: string; op: string | null; rcmp: boolean; city: string | null; lon: number; lat: number; osm: string; web?: string };
export type Justice = {
  source: string; routing: string; routingSource: string | null; asOf: string;
  sites: JusticeSite[];
  towns: Record<string, { court: Trip[]; police: Trip[] }>;
};

export type Treaty = { name: string; label: string; year: number; end: number | null; polys: [number, number][][][] };
export type Reserve = { name: string; c: [number, number]; km2: number; polys: [number, number][][][] };

export type Data = {
  outline: GeoJSON.Feature | null;
  munis: Muni[];
  fires: { points: FirePoint[]; source: string } | null;
  tornadoes: { rows: TornadoRow[]; source: string; sources?: { name: string; from: number; to: number; scale: string }[] } | null;
  rivers: { stations: RiverStation[]; source: string } | null;
  climate: { stations: ClimateStation[]; source: string; baselinePeriod: string } | null;
  normals: { stations: NormalsStation[]; source: string; period: string } | null;
  population: { munis: Record<string, PopSeries>; source: string } | null;
  crime: Crime | null;
  hospitals: { facilities: Facility[]; towns: Record<string, Trip[]>; source: string; routing: string; routingSource: string | null } | null;
  justice: Justice | null;
  treaties: { treaties: Treaty[]; reserves: Reserve[]; source: string } | null;
  manifest: Record<string, { ok: boolean; updated?: string; lastError?: string }>;
};

const base = import.meta.env.BASE_URL;

async function load<T>(name: string): Promise<T | null> {
  try {
    const res = await fetch(`${base}data/${name}.json`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadAll(): Promise<Data> {
  const [outline, munis, fires, tornadoes, rivers, climate, normals, population, crime, hospitals, justice, treaties, manifest] = await Promise.all([
    load<GeoJSON.Feature>('province'),
    load<Muni[]>('municipalities'),
    load<Data['fires']>('fires'),
    load<Data['tornadoes']>('tornadoes'),
    load<Data['rivers']>('rivers'),
    load<Data['climate']>('climate'),
    load<Data['normals']>('normals'),
    load<Data['population']>('population'),
    load<Crime>('crime'),
    load<Data['hospitals']>('hospitals'),
    load<Justice>('justice'),
    load<Data['treaties']>('treaties'),
    load<Data['manifest']>('manifest'),
  ]);
  return {
    outline,
    munis: munis ?? [],
    fires: fires?.points?.length ? fires : null,
    tornadoes: tornadoes?.rows?.length ? tornadoes : null,
    rivers: rivers?.stations?.length ? rivers : null,
    climate: climate?.stations?.length ? climate : null,
    normals: normals?.stations?.length ? normals : null,
    population: population && Object.keys(population.munis ?? {}).length ? population : null,
    // crime is only useful if at least one place matched
    crime: crime && Object.keys(crime.munis ?? {}).length ? crime : null,
    hospitals: hospitals?.facilities?.length ? hospitals : null,
    justice: justice?.sites?.length ? justice : null,
    treaties: treaties?.treaties?.length || treaties?.reserves?.length ? treaties : null,
    manifest: manifest ?? {},
  };
}

// ---------------------------------------------------------------------------------------------
// shared helpers

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function km(aLon: number, aLat: number, bLon: number, bLat: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** First index i with get(arr[i]) >= v, for arrays sorted ascending by get. */
export function lowerBound<T>(arr: T[], v: number, get: (d: T) => number) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (get(arr[mid]) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Linear interpolation inside a sparse {year: value} series; null outside its range. */
export function interpYearly(series: Record<string, number> | undefined, t: number, { hold = 0.999 } = {}): number | null {
  if (!series) return null;
  const y0 = Math.floor(t);
  const a = series[y0];
  const b = series[y0 + 1];
  if (a != null && b != null) return a + (b - a) * (t - y0);
  if (a != null && t - y0 <= hold) return a;
  return null;
}

export const fmt = {
  int: (v: number) => Math.round(v).toLocaleString('en-CA'),
  money: (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1000)}K`),
  ha: (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)}M ha` : v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K ha` : `${Math.round(v)} ha`),
  pct: (v: number) => `${(v * 100).toFixed(1)}%`,
  signed: (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`,
};

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
