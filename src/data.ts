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

/** lon, lat (swath start or storm point), t, largest hail mm (radar MESH for swaths; null when not given), source (0 Northern Hail Project radar swath,
 * 1 its research database), place name, swath centre line, swath length km, widest km, size word ("golfball"), confirmed with an expert */
export type HailRow = [number, number, number, number | null, 0 | 1, string | null, [number, number][] | null, number | null, number | null, string | null, 0 | 1];

export type RiverStation = {
  id: string; name: string; lon: number; lat: number; area: number; median: number;
  peaks: Record<string, number>; peakDates: Record<string, string>;
};
export type ClimateStation = {
  id: string; name: string; lon: number; lat: number; baseline: number;
  temp: Record<string, number>; precip: Record<string, number>;
};

/** One air-monitoring site (stations in the same city merged); per year: smoke days, valid days, the worst day's 24 h mean PM2.5 and its date. Only years passing the completeness rules are present. */
export type SmokeStation = {
  name: string; ids: string[]; lon: number; lat: number;
  days: Record<string, number>; valid: Record<string, number>; peak: Record<string, number>; peakDate: Record<string, string>;
  /** smoke days by calendar month, all counted years together */
  months: number[];
};
export type Smoke = {
  source: string; sourceUrl: string; licence: string; licenceUrl: string;
  /** a smoke day's 24 h mean PM2.5 is above this (µg/m³) */
  limit: number; minHours: number; minShare: number;
  /** the latest year with a published hourly PM2.5 file */
  filesTo: number | null;
  stations: SmokeStation[];
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

/** A park or recreation site boundary (Saskatchewan Ministry of Parks, Culture and Sport). `sub`: a provincial park's class. */
export type Park = {
  name: string; type: 'national' | 'provincial' | 'recreation' | 'historic' | 'regional'; sub?: string | null; by?: string; web?: string;
  c: [number, number]; ha: number; polys: [number, number][][][];
};
/**
 * A campground: Parks Canada's campsites grouped into campgrounds (`src` 'pc', `sites` counted) or an OpenStreetMap camp site
 * (`src` 'osm', `sites` only where mappers gave a capacity). `p`: index of the park it lies in.
 */
export type Camp = {
  name: string; kind: 'campground' | 'backcountry' | 'group' | 'rv'; sites?: number; otentik?: number;
  op?: string; power?: boolean; fee?: boolean; web?: string; lon: number; lat: number; src: 'pc' | 'osm'; osm?: string; p?: number;
};
export type Camping = {
  source: string; routing: string; routingSource: string | null; asOf: string;
  parks: Park[]; camps: Camp[];
  /** each place's nearest campground you can drive to (not backcountry) */
  towns: Record<string, Trip[]>;
  /** Weekend Reach: per place, [camp index, drive minutes] for every drivable campground within `reachMax`, nearest first */
  reach: Record<string, [number, number][]>;
  reachRouted: boolean; reachMax: number;
};

/** Census 2021 home costs for one census subdivision (fields missing where Statistics Canada suppressed them). */
export type CensusHousing = {
  csd?: string;
  /** median value of owned dwellings ($) */ value?: number;
  /** median monthly shelter costs, owners and renters ($) */ ownCost?: number; rentCost?: number;
  /** % of all, owner and tenant households spending 30 %+ of income on shelter */ stir30?: number; own30?: number; rent30?: number;
  /** households assessed for affordability; owner and renter households */ hh?: number; owners?: number; renters?: number;
};
/** CMHC Rental Market Survey for a surveyed centre (its CMA or CA): average 1- and 2-bedroom rents and the vacancy rate (%) by year. */
export type RentSeries = { centre: string; r1: Record<string, number>; r2: Record<string, number>; vac?: Record<string, number>; vacArea?: string };
export type Housing = { source: string; rentSource: string; prov: CensusHousing; census: Record<string, CensusHousing>; rent: Record<string, RentSeries> };
/** One place's row in the Mill Rate Survey: its name and status there (C, T, NT, NV), uniform municipal mill rate, residential
 *  mill rate factor (if not 1), factored residential rate, residential school levy ÷ assessment (mills), base / minimum tax in
 *  use, and (when the census gives a median home value) that value and the indicative annual tax on it. `x`: not comparable. */
export type TaxPlace = { n: string; s: string; mr: number; f?: number; r: number; e: number | null; bt?: boolean; mt?: boolean; v?: number; tax?: number; x?: 1 };
/** Property tax: the survey year, the residential education mill rate (province), the residential percentage of value. */
export type Tax = { source: string; sourceUrl: string; year: number; edu: number; pov: number; povSource: string; places: Record<string, TaxPlace> };

/** An everyday service mapped in OpenStreetMap: lon, lat, index into `Needs.kinds`, name (null if unnamed), OSM id ("n123", "w45", "r6"). */
export type NeedSite = [number, number, number, string | null, string];
/**
 * Daily needs per place: `n` counts each kind inside the place's municipal limits (its census subdivision, `how` 'csd')
 * or up to `slackKm` outside them; a place with no census subdivision uses a `fallbackKm` radius (`how` 'radius').
 */
export type Needs = {
  source: string; areaSource: string; asOf: string; kinds: string[]; slackKm: number; fallbackKm: number;
  sites: NeedSite[];
  towns: Record<string, { n: number[]; how: 'csd' | 'radius'; csd?: string; r?: number }>;
  /** the municipal limits each place was counted in */
  areas: Record<string, [number, number][][][]>;
};

/** Census 2021 work and income for a place (or the province): median total household income (2020 incomes, $), the
 * unemployment rate in census week (May 2021, %), the labour force with an industry, and its top three NAICS sectors as
 * [index into `Jobs.naics`, % of that labour force]. */
export type CensusJobs = { inc?: number; cur?: number; lf?: number; ind?: [number, number][] };
/** A Labour Force Survey region: one economic region, or several that the LFS publishes only together. Rates are % by year. */
export type JobsRegion = { name: string; ers: string[]; combined: boolean; ur: Record<string, number>; er: Record<string, number>; pr: Record<string, number>; c: [number, number]; polys: [number, number][][][] };
export type Jobs = {
  source: string; censusSource: string; areaSource: string; naics: string[];
  prov: CensusJobs & { ur: Record<string, number>; er: Record<string, number>; pr: Record<string, number> };
  regions: JobsRegion[];
  /** per place: `r` its LFS region (index into `regions`), `csd` the census subdivision behind the census figures */
  towns: Record<string, CensusJobs & { r: number | null; csd?: string }>;
};

/** Workday Reach: the drive between every pair of places. `min[i][j]` is minutes from place `keys[i]` to place `keys[j]`. */
export type Commute = { source: string; routed: boolean; asOf: string; keys: string[]; min: (number | null)[][]; km: (number | null)[][] };

/**
 * A K-12 school from the Ministry of Education's list. `s` sector: public, separate (Catholic), Fransaskois (Conseil des
 * écoles fransaskoises), First Nations (band school) or independent. `g` grades: 'e' elementary or middle, 'h' high school,
 * 'k' K-12 (stated), '?' not stated; `s` 'osm': an OpenStreetMap school the ministry list lacks, sector not stated; for provincial schools 'e'/'h' come from the school's name. `gi`: grades not stated
 * but counted as K-12 because no school stating high-school grades is within `Schools.inferKm`. `imm`: immersion programs
 * the ministry lists ("French", "Cree", "Ukrainian"). `col`: Hutterite colony school. `gr`: a band school's grade span.
 */
export type School = {
  n: string; s: 'pub' | 'sep' | 'fr' | 'fn' | 'ind' | 'osm'; g: 'e' | 'h' | 'k' | '?'; gi?: 1; lon: number; lat: number;
  div: string | null; imm?: string[]; fr?: 1; col?: 1; e?: number; gr?: string; at?: string;
  /** set for a school missing from the ministry list, taken from OpenStreetMap ("way/123"); sector 'osm' = not stated */
  osm?: string;
};
/** A post-secondary site: a university or college ('uni'), polytechnic or technical institute ('poly') or regional college ('col'). */
export type PostSec = { n: string; k: 'uni' | 'poly' | 'col'; city: string | null; campus?: string | null; lon: number; lat: number; src: 'ae' | 'osm'; osm?: string };
export type Schools = {
  source: string; pseSource: string; routing: string; routingSource: string | null; asOf: string; inferKm: number;
  schools: School[]; pse: PostSec[];
  /** per place: `n` schools any family can attend inside the town limits (as Daily needs counts them); the nearest by road
   * elementary (`e`), high (`h`) and French-language or French immersion (`f`) school (`f` indexes `schools`), and
   * post-secondary site (`p`, indexes `pse`) */
  towns: Record<string, { n: number; e?: Trip; h?: Trip; f?: Trip; p?: Trip }>;
};

/**
 * Internet & mobile (ISED National Broadband Data). Speed tiers index `Internet.tiers`: 0 none, 1 under 5/1, 2 5/1, 3 10/2,
 * 4 25/5, 5 50/10 Mbps (down/up) or better. A hexagon is [lon, lat, households, % offered 50/10 by any fixed service, % by
 * wire, % reached by LTE, mobile carriers]; the shares are null where no one lives.
 */
export type NetHex = [number, number, number, number | null, number | null, number | null, number];
export type NetTown = {
  /** households and ISED pseudo-household points inside the town limits */ hh: number; n: number;
  /** % of households by the top tier offered (index = tier), any fixed service (wired or fixed wireless) and by wire alone */ comb: number[]; wired: number[];
  /** % of households reached by LTE */ lte: number | null;
  /** the best tier offered anywhere in town, any fixed and by wire; the tiers and LTE (1/0) at the point nearest the centre */ best: number; bestW: number; centre: [number, number, number];
  /** mobile carriers, technologies ('fibre' | 'cable' | 'dsl' | 'fw' | 'sat' | 'mob') and fixed providers [name, technologies] serving the town's hexagons */
  mob: string[]; tech: string[]; isp: [string, string[]][];
};
export type Internet = {
  source: string; licence: string; asOf: string; tiers: string[];
  prov: { hh: number; f50: number | null; w50: number | null; lte: number | null };
  hexes: NetHex[]; towns: Record<string, NetTown>;
};

/**
 * Who lives here (Census 2021 profile per place). Counts are as published, randomly rounded to a multiple of 5; a missing
 * key was suppressed. `hhPop` people in private households (base for immigrants and Indigenous identity), `imm` immigrants,
 * `rec` of them arrived 2016–2021, `npr` non-permanent residents; `homeTot`/`nonOff` language spoken most often at home
 * (all / a non-official language, single responses); `mtTot`/`frMT` mother tongue (all / French); `knTot`/`frKn` knowledge
 * of official languages (all / can speak French); `indTot`/`ind` Indigenous identity. `birth` and `lang` the top five named
 * places of birth of immigrants and non-official home languages, [name, people].
 */
export type CommunityCensus = {
  hhPop?: number; imm?: number; rec?: number; npr?: number; homeTot?: number; nonOff?: number; mtTot?: number; frMT?: number;
  knTot?: number; frKn?: number; indTot?: number; ind?: number; birth: [string, number][]; lang: [string, number][];
};
/** A place of worship: [lon, lat, index into `Community.religions`, name, denomination, OSM id ("n123"), place key]. */
export type WorshipSite = [number, number, number, string | null, string | null, string, string];
export type Community = {
  source: string; worshipSource: string; asOf: string; religions: string[]; slackKm: number;
  prov: CommunityCensus;
  /** per place: the census profile, its census subdivision, and places of worship in town by religion (`pw`, by `religions`) */
  towns: Record<string, Partial<CommunityCensus> & { csd?: string; pw: number[] }>;
  sites: WorshipSite[];
};

/**
 * A settlement or language office: IRCC's list (`src: 'ircc'`) or the province's typed list (`'sk'`, at its town's centre:
 * `approx`). `sv` holds IRCC's service flags, one letter each: g general settlement, n needs assessment and referrals, c
 * community connections, j job search, p help with professions and credentials, a language assessment, e English classes, f
 * French classes, w job-specific language training, z citizenship test prep, F francophone services, y youth, W women,
 * r help for government-assisted refugees. `g` = on the province's list of settlement services (Regional Newcomer Gateways).
 */
export type NewcomerAgency = { n: string; city: string | null; addr: string | null; tel: string | null; web: string | null; sv: string; lon: number; lat: number; src: 'ircc' | 'sk'; g?: 1; approx?: 1 };
/** A government office from OpenStreetMap: a Service Canada Centre (`sc`) or scheduled outreach site (`so`), a named SGI office or licence issuer (`sgi`), or another insurance broker (`ins`: most are SGI motor licence issuers; inferred). */
export type NewcomerOffice = { n: string; k: 'sc' | 'so' | 'sgi' | 'ins'; city: string | null; addr: string | null; note: string | null; hours: string | null; lon: number; lat: number; osm: string };
export type Newcomer = {
  source: string; provSource: string; provUrl: string; provAsOf: string; officeSource: string; routing: string; routingSource: string | null; asOf: string;
  agencies: NewcomerAgency[]; offices: NewcomerOffice[];
  /** per place, the nearest by road: settlement help (`s`) and English classes (`l`) index `agencies`; Service Canada (`c`) and an SGI issuer (`g`) index `offices` */
  towns: Record<string, { s?: Trip; l?: Trip; c?: Trip; g?: Trip }>;
};

/**
 * A place to see a family doctor or nurse (`k`: `md` medical clinic or doctor's office, `phc` primary health care or
 * health centre, `np` nurse practitioner or nurse) or a pharmacy (`rx`). `src`: `s` the Saskatchewan Health Authority's
 * sites in Statistics Canada's ODHF, `o` OpenStreetMap, `os` both. `w` walk-in; `approx` at its town's centre (no point in the ODHF).
 */
export type DoctorSite = { n: string; city?: string; k: 'md' | 'phc' | 'np' | 'rx'; src: 's' | 'o' | 'os'; lon: number; lat: number; osm?: string; w?: 1; approx?: 1 };
export type Doctors = {
  source: string; osmSource: string; areaSource: string | null; routing: string; routingSource: string | null; asOf: string;
  disruptions: null; disruptionsUrl: string; slackKm: number; fallbackKm: number;
  sites: DoctorSite[];
  /** per place: clinics (`nc`) and pharmacies (`np`) in town; the nearest clinic (`c`) and pharmacy (`p`) by road, indexing `sites`; `h`: no clinic mapped in town but a hospital is (inferred: its doctors practise there) */
  towns: Record<string, { nc: number; np: number; c?: Trip; p?: Trip; h?: { n: string; min: number | null; km: number; lon: number; lat: number } }>;
};

/**
 * A regulated child care centre on the Ministry of Education's list (`i` takes infants, `f` francophone, `x` extended or
 * 24-hour care, `t` teen parent centre). Points are the ministry's own, which it calls approximate; `approx`: its point was
 * outside the atlas place its address names (or missing), so it sits at that place's centre.
 */
export type ChildcareCentre = { n: string; city: string | null; lon: number; lat: number; i?: 1; f?: 1; x?: 1; t?: 1; approx?: 1 };
/** Licensed family child care homes in one community: `n` homes, `g` of them group homes, `i` taking infants; the point is rounded to 0.02°, never a home. */
export type ChildcareHomes = { city: string | null; lon: number; lat: number; n: number; g: number; i: number };
export type Childcare = {
  source: string; sourceUrl: string; licence: string; licenceUrl: string; areaSource: string | null; routing: string; routingSource: string | null;
  spaces: null; asOf: string; slackKm: number; fallbackKm: number;
  centres: ChildcareCentre[]; homes: ChildcareHomes[];
  /** per place: centres (`nc`), homes (`nh`) and facilities taking infants (`ni`) in town; the nearest centre (`c`, indexing `centres`) and the nearest licensed care of any kind (`a`: `h` 1 indexes `homes`, else `centres`) */
  towns: Record<string, { nc: number; nh: number; ni: number; c?: Trip; a?: Trip & { h: 0 | 1 } }>;
};

/** A ~4 km hexagon: [lon, lat, active wells, suspended wells, abandoned wells, oil & gas facilities]. */
export type WellHex = [number, number, number, number, number, number];
/** A line in use: provincial lines index their licensee in `owners` (`o`); federal (OpenStreetMap) lines name their operator. */
export type IndustryLine = { n: string | null; o: number | string; s: 'sour' | 'gas' | 'oil' | 'water' | 'co2' | 'other'; p: [number, number][][] };
export type NpriSite = { n: string; c: string; city: string; lon: number; lat: number; k: string; t: number; ns: number; top: [string, number] | null };
export type Mine = { n: string; cm: string; g: 'potash' | 'uranium' | 'coal' | 'metal' | 'other'; lon: number; lat: number; src: 'smdi' | 'npri'; url: string | null };
export type Industry = {
  source: string; licence: string; licenceUrl: string; npriUrl: string; asOf: string; npriYear: number;
  wellKm: number; pipeKm: number; mineKm: number; npriKm: number; hexKm: number; fallbackKm: number;
  totals: { wells: [number, number, number]; facilities: number; pipes: number; oldPipes: number; sour: number };
  hexes: WellHex[]; pipes: IndustryLine[]; owners: string[]; fed: IndustryLine[]; npri: NpriSite[]; mines: Mine[];
  /** per place, from its town limits: wells within wellKm by class (`w`), facilities (`f`), live provincial pipelines within pipeKm (`pl`, `sour` of them sour gas), federal lines (`fed`, indexing `fed`), the nearest NPRI facility (`np`, indexing `npri`) and how many within npriKm (`n5`), the nearest producing mine within mineKm (`mn`) */
  towns: Record<string, { w: [number, number, number]; f: number; pl: number; sour: number; fed: number[]; np: { i: number; km: number } | null; n5: number; mn: { i: number; km: number } | null }>;
};

/** A drinking water advisory in effect. `src`: Water Security Agency / Ministry of Environment (`wsa`), Saskatchewan
 * Health Authority (`sha`) or Indigenous Services Canada (`isc`, `lt` = long-term). `k`: precautionary advisory,
 * boil water order or advisory, do not consume (or use). `loc` says how it was placed: its own name is a place
 * (`name`), a place named in its name or title (`text`, at `at`), a named lake's centre (`lake`), or its First Nation
 * community (`fn`). `part`: the part of the system affected, when the list says so. */
export type WaterSite = {
  n: string; src: 'wsa' | 'sha' | 'isc'; lt?: boolean; k: 'pdwa' | 'boil' | 'dnc'; d: string | null; t: string | null; why: string | null;
  reg: string | null; pop?: string | null; part: string | null; lon: number; lat: number; loc: 'name' | 'text' | 'lake' | 'fn'; at?: string | null;
};
export type Water = {
  source: string; licence: string; licenceUrl: string; pageUrl: string; wsaUrl: string; shaUrl: string; iscUrl: string; iscLtUrl: string; wellUrl: string;
  asOf: string; provAsOf: string; stAsOf: string; nearKm: number;
  sites: WaterSite[]; unplaced: Omit<WaterSite, 'lon' | 'lat' | 'loc' | 'at'>[];
  /** per place: advisories on the town's own water system (`sys`, indexing `sites`; `su` more that could not be placed), and every advisory within nearKm of the town centre (`nb`: [index, km]) */
  towns: Record<string, { sys: number[]; nb: [number, number][]; su?: number }>;
};

/** A radon survey area: a 2007 health region (`name`, label point `c`) or a postal FSA (`urban`, and `hr`, the health
 * region most of its tests are in). `n` homes tested, `hi` at or above the guideline, `vhi` at or above the old one,
 * `med` the median result (Bq/m³). */
export type RadonArea = { id: string; name?: string; n: number; hi: number; vhi: number; med: number | null; c?: [number, number]; hr?: string | null; urban?: boolean; polys: [number, number][][][] };
export type Radon = {
  source: string; licence: string; areaSource: string; url: string; reportUrl: string; testUrl: string;
  guide: number; oldGuide: number; few: number; years: string;
  prov: { n: number; hi: number; vhi: number; med: number | null };
  regions: RadonArea[]; fsas: RadonArea[];
  /** per place: its health region (`r`, indexing `regions`), its postal areas (`f`) and their pooled tests (`fn`, `fhi` at or above the guideline) */
  towns: Record<string, { r: number; f: string[]; fn?: number; fhi?: number }>;
};

/** Light & dark (computed): day length per place on three dates (`d`: sunrise to sunset; `c`: civil dawn to dusk, hours),
 * geomagnetic latitude `ml` (IGRF dipole), the Kp at which the auroral oval reaches overhead (`kp`) and its band `a`,
 * and the drive `dk` to the nearest campground in a dark-sky preserve (`f` indexes `targets`). */
export type LightTown = { d: number[]; c: number[]; ml: number; kp: number; a: 'often' | 'sometimes' | 'rarely'; dk?: { f: number; min: number | null; km: number } };
export type LightPreserve = { name: string; full: string; year: number | null; type: string; info: string; prov: string; parks: { name: string; c: [number, number]; ha: number; polys: [number, number][][][] }[] };
export type Light = {
  source: string; year: number; dates: { id: string; label: string }[]; solarUrl: string; routing: string;
  igrf: { model: string; epoch: number; g10: number; g11: number; h11: number; poleLat: number; poleLon: number; url: string };
  kp: { k0: number; perKp: number; url: string };
  rasc: { url: string; sites: { name: string; prov: string; year: number | null; type: string; info: string }[] };
  preserves: LightPreserve[];
  unmapped: { name: string; prov: string; year: number | null; type: string; info: string }[];
  targets: { name: string; lon: number; lat: number; k: number }[];
  /** 0.25° latitude rows clipped to the province: south, north, west, east, day length and civil span on each date */
  rows: { s: number; n: number; w: number; e: number; d: number[]; c: number[] }[];
  /** aurora cells: [west, south, east, north, geomagnetic latitude] */
  cells: [number, number, number, number, number][];
  /** a year of day length (one value a week from 1 January) at each whole degree of latitude */
  curves: { lat: number; y: number[] }[];
  towns: Record<string, LightTown>;
};

/** An airport with scheduled passenger service (OurAirports' flag), placed by OpenStreetMap; `road` 0 = fly-in (not a drive target); `size` 2 large, 1 medium, 0 small. */
export type TransitAirport = { n: string; iata: string; icao: string; city: string | null; prov: string; size: number; lon: number; lat: number; osm: string | null; wiki: string | null; road: number };
/** A VIA Rail station or flag stop (`halt`) in OpenStreetMap, and the VIA line it is on. */
export type TransitStation = { n: string; k: 'station' | 'halt'; lon: number; lat: number; osm: string; line: string | null };
/** A city's buses: from its GTFS feed (`gtfs`: stop count, Wednesday trips per route, timetable end date) or OpenStreetMap (`osm`). */
export type TransitSystem = {
  key: string; n: string; src: 'gtfs' | 'osm'; url: string; licence: string; licUrl: string; stops: number | null; end: string | null;
  routes: { s: string | null; n: string; c: string | null; trips: number | null; path: [number, number][] }[];
};
export type Transit = {
  airSource: string; railSource: string; busSource: string; transitSource: string; routing: string; routingSource: string | null; asOf: string;
  airports: TransitAirport[]; stations: TransitStation[];
  railLines: { n: string; paths: [number, number][][] }[];
  busRoutes: { op: string | null; names: string[]; web: string | null; paths: [number, number][][] }[];
  busStops: { n: string | null; op: string | null; lon: number; lat: number; osm: string }[];
  systems: TransitSystem[];
  /** per place: the drive to the nearest airport with scheduled service (`f` indexes `airports`), VIA stops and intercity bus stops in town (indexes), its transit system */
  towns: Record<string, { air?: Trip; rail?: number[]; bus?: number[]; sys?: number }>;
};

/** AAFC Canadian Drought Monitor, monthly, on a 10 km Web Mercator grid over Saskatchewan. `maps[i]` is run-length text (an optional count, then a letter: a none, b–f D0–D4, n not analyzed), rows from the top; `share[i]` is the % of the province at D0+, D1+, D2+, D3+, D4 and not analyzed; `towns[key]` has one letter a month. */
export type Drought = {
  source: string; sourceUrl: string; serviceUrl: string; licence: string; licenceUrl: string;
  grid: { x0: number; y1: number; px: number; w: number; h: number; bounds: number[] };
  months: string[]; maps: string[]; share: number[][]; towns: Record<string, string>;
};

// ---- Right now: the live files in public/data/now/ (not committed; rebuilt hourly by .github/workflows/live.yml).
// Times are ISO strings in UTC. `asOf` is the newest reading (for lists of what is in effect, when the list was read).
type NowBase = { asOf: string; fetched: string; source: string; sourceUrl: string; licence: string; licenceUrl: string };
/** gauge id (in rivers.json), time, level m, discharge m³/s, discharge ÷ the gauge's median annual peak, flag */
export type NowRiverRow = [string, string, number | null, number | null, number | null, 'ice' | 'est' | 'dry' | 'other' | null];
export type NowRivers = NowBase & { rows: NowRiverRow[] };
/** lon, lat, time seen, fire radiative power (MW), sensor */
export type Hotspot = [number, number, string, number | null, string | null];
/** a perimeter CWFIS estimates from hotspots: first and last heat seen, hectares, hotspots counted */
export type FirePerimeter = { first: string; last: string; ha: number; n: number; polys: [number, number][][][] };
export type NowFires = NowBase & { hours: number; keepDays: number; hotspots: Hotspot[]; perimeters: FirePerimeter[] };
/** An AQHI community: the latest observation (`t`, `v`) and the newest forecast's highest value from now (`fv` at `ft`, the forecast running to `fto`). `out`: outside Saskatchewan. */
export type AqhiCommunity = { id: string; name: string; lon: number; lat: number; t: string; v: number; fv?: number; ft?: string; fto?: string; pub?: string; out?: true };
/** `towns[key]`: [index into communities, km] for the nearest community within `reachKm` */
export type NowAir = NowBase & { reachKm: number; communities: AqhiCommunity[]; towns: Record<string, [number, number]> };
export type WeatherAlert = {
  code: string; type: string; name: string; short: string | null; colour: string | null; status: string | null;
  issued: string; ends: string | null; expires: string | null; text: string;
  /** forecast regions the alert covers; the atlas's places inside them */
  areas: string[]; places: string[]; polys: [number, number][][][];
};
export type NowAlerts = NowBase & { alerts: WeatherAlert[] };
/** `skipped`: live readings were deliberately not loaded (the film), so the app shows no trace of them, not even the dashed box. */
/**
 * Short-range outlooks (plan 3c), each a published forecast with its issue and valid times: thunderstorm outlook areas
 * (MSC; `places` inside each), today's fire danger class per place (CWFIS, 0 low … 4 extreme), and the next day's highest
 * wildfire-smoke PM2.5 per place (RAQDPS, µg/m³). A part that could not be read is absent.
 */
export type NowOutlooks = {
  asOf: string; fetched: string;
  sources: { name: string; by: string; url: string; licence: string }[];
  thunder?: { items: { issued: string; valid: string; expires: string | null; thunder: string | null; severity: string | null; risk: string | null; tornado: boolean; hail: string | null; gust: string | null; places: string[] }[] };
  fire?: { valid: string; model: string; towns: Record<string, number> };
  smoke?: { issued: string; valid: string; towns: Record<string, number> };
};
export type Now = { rivers: NowRivers | null; fires: NowFires | null; air: NowAir | null; alerts: NowAlerts | null; outlooks: NowOutlooks | null; skipped: boolean };

export type Data = {
  outline: GeoJSON.Feature | null;
  munis: Muni[];
  fires: { points: FirePoint[]; source: string } | null;
  tornadoes: { rows: TornadoRow[]; source: string; sources?: { name: string; from: number; to: number; scale: string }[] } | null;
  hail: { rows: HailRow[]; source: string; sources?: { name: string; from: number; to: number }[] } | null;
  rivers: { stations: RiverStation[]; source: string } | null;
  climate: { stations: ClimateStation[]; source: string; baselinePeriod: string } | null;
  smoke: Smoke | null;
  drought: Drought | null;
  normals: { stations: NormalsStation[]; source: string; period: string } | null;
  projections: Projections | null;
  floods: Floods | null;
  population: { munis: Record<string, PopSeries>; source: string } | null;
  crime: Crime | null;
  hospitals: { facilities: Facility[]; towns: Record<string, Trip[]>; source: string; routing: string; routingSource: string | null } | null;
  justice: Justice | null;
  treaties: { treaties: Treaty[]; reserves: Reserve[]; source: string } | null;
  camping: Camping | null;
  housing: Housing | null;
  tax: Tax | null;
  jobs: Jobs | null;
  needs: Needs | null;
  commute: Commute | null;
  schools: Schools | null;
  internet: Internet | null;
  community: Community | null;
  newcomer: Newcomer | null;
  doctors: Doctors | null;
  childcare: Childcare | null;
  industry: Industry | null;
  water: Water | null;
  radon: Radon | null;
  light: Light | null;
  transit: Transit | null;
  /** live readings; all null when public/data/now/ is absent, or with ?film (unless ?now is also given) */
  now: Now;
  manifest: Record<string, { ok: boolean; updated?: string; lastError?: string }>;
};

/**
 * Flood-prone land (plan 3d): the Water Security Agency's published flood mapping. `500`: the 1:500-year flood extent;
 * `floodway` and `fringe`: its deep, fast part and the rest, where the Flood Damage Reduction Program mapped them;
 * `protected`: land behind dikes. Polygons are rings of [lon, lat].
 */
export type FloodZone = { kind: '500' | 'floodway' | 'fringe' | 'protected'; place: string; water?: string | null; year?: number | null; program?: string | null; pdf?: string | null; polys: [number, number][][][] };
export type Floods = { source: string; sourceUrl: string; licence: string; returnPeriod: number; asOf: string; zones: FloodZone[] };

/** A projection's variable and scenario keys (ECCC CanDCS-U6): mean temperature, daily high, daily low, precipitation. */
export type ProjVar = 'tg' | 'tx' | 'tn' | 'pr';
export type ProjScen = 'ssp126' | 'ssp585';
/** One 30-year window's change from 1971–2000: [window start, median, 10th, 90th percentile of the models]. */
export type ProjWindow = [number, number, number, number];
/** Climate projections per place (plan 3b): model output, never a record. Per variable and scenario, each window's change. */
export type Projections = {
  source: string; sourceUrl: string; licence: string; asOf: string; baseline: string; windowYears: number; percentiles: [number, number];
  vars: Record<ProjVar, { label: string; unit: string }>;
  scenarios: Record<ProjScen, string>;
  windows: number[];
  towns: Record<string, Record<ProjVar, Record<ProjScen, ProjWindow[]>>>;
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
  const [outline, munis, fires, tornadoes, hail, rivers, floods, climate, smoke, drought, normals, projections, population, crime, hospitals, justice, treaties, camping, housing, tax, jobs, needs, commute, schools, internet, community, newcomer, doctors, childcare, industry, water, radon, light, transit, manifest] = await Promise.all([
    load<GeoJSON.Feature>('province'),
    load<Muni[]>('municipalities'),
    load<Data['fires']>('fires'),
    load<Data['tornadoes']>('tornadoes'),
    load<Data['hail']>('hail'),
    load<Data['rivers']>('rivers'),
    load<Floods>('floods'),
    load<Data['climate']>('climate'),
    load<Smoke>('smoke'),
    load<Drought>('drought'),
    load<Data['normals']>('normals'),
    load<Projections>('projections'),
    load<Data['population']>('population'),
    load<Crime>('crime'),
    load<Data['hospitals']>('hospitals'),
    load<Justice>('justice'),
    load<Data['treaties']>('treaties'),
    load<Camping>('camping'),
    load<Housing>('housing'),
    load<Tax>('tax'),
    load<Jobs>('jobs'),
    load<Needs>('needs'),
    load<Commute>('commute'),
    load<Schools>('schools'),
    load<Internet>('internet'),
    load<Community>('community'),
    load<Newcomer>('newcomer'),
    load<Doctors>('doctors'),
    load<Childcare>('childcare'),
    load<Industry>('industry'),
    load<Water>('water'),
    load<Radon>('radon'),
    load<Light>('light'),
    load<Transit>('transit'),
    load<Data['manifest']>('manifest'),
  ]);
  // the explainer film stays repeatable: it never loads live readings unless asked to (?film&now)
  const q = new URLSearchParams(location.search);
  const live = !q.has('film') || q.has('now');
  const [nRivers, nFires, nAir, nAlerts, nOutlooks, nManifest] = live
    ? await Promise.all([load<NowRivers>('now/rivers'), load<NowFires>('now/fires'), load<NowAir>('now/air'), load<NowAlerts>('now/alerts'), load<NowOutlooks>('now/outlooks'), load<Data['manifest']>('now/manifest')])
    : [null, null, null, null, null, null];
  return {
    outline,
    munis: munis ?? [],
    fires: fires?.points?.length ? fires : null,
    tornadoes: tornadoes?.rows?.length ? tornadoes : null,
    hail: hail?.rows?.length ? hail : null,
    rivers: rivers?.stations?.length ? rivers : null,
    climate: climate?.stations?.length ? climate : null,
    smoke: smoke?.stations?.length ? smoke : null,
    drought: drought?.months?.length && drought.maps?.length === drought.months.length ? drought : null,
    normals: normals?.stations?.length ? normals : null,
    projections: projections && Object.keys(projections.towns ?? {}).length ? projections : null,
    floods: floods?.zones?.length ? floods : null,
    population: population && Object.keys(population.munis ?? {}).length ? population : null,
    // crime is only useful if at least one place matched
    crime: crime && Object.keys(crime.munis ?? {}).length ? crime : null,
    hospitals: hospitals?.facilities?.length ? hospitals : null,
    justice: justice?.sites?.length ? justice : null,
    treaties: treaties?.treaties?.length || treaties?.reserves?.length ? treaties : null,
    camping: camping?.parks?.length || camping?.camps?.length ? camping : null,
    housing: housing && Object.keys(housing.census ?? {}).length ? housing : null,
    tax: tax && Object.keys(tax.places ?? {}).length ? tax : null,
    jobs: jobs?.regions?.length ? jobs : null,
    needs: needs && Object.keys(needs.towns ?? {}).length ? needs : null,
    commute: commute?.keys?.length && commute.min?.length === commute.keys.length ? commute : null,
    schools: schools?.schools?.length ? schools : null,
    internet: internet?.hexes?.length ? internet : null,
    community: community && Object.keys(community.towns ?? {}).length ? community : null,
    newcomer: newcomer?.agencies?.length ? newcomer : null,
    doctors: doctors?.sites?.length ? doctors : null,
    childcare: childcare?.centres?.length ? childcare : null,
    industry: industry?.hexes?.length ? industry : null,
    water: water?.sites ? water : null,
    radon: radon?.regions?.length ? radon : null,
    light: light && Object.keys(light.towns ?? {}).length ? light : null,
    transit: transit?.airports?.length ? transit : null,
    now: {
      rivers: nRivers?.asOf && Array.isArray(nRivers.rows) ? nRivers : null,
      fires: nFires?.asOf && Array.isArray(nFires.hotspots) ? nFires : null,
      air: nAir?.asOf && Array.isArray(nAir.communities) ? nAir : null,
      alerts: nAlerts?.asOf && Array.isArray(nAlerts.alerts) ? nAlerts : null,
      outlooks: nOutlooks?.asOf && Array.isArray(nOutlooks.sources) ? nOutlooks : null,
      skipped: !live,
    },
    manifest: { ...(manifest ?? {}), ...(nManifest ?? {}) },
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

// ---------------------------------------------------------------------------------------------
// history: the daily record of the live feeds (public/data/history/, from the data-history branch; scripts/history.mjs).
// Never loaded by loadAll(): fetched when the timeline first enters a layer's recent span, or the sources view opens.

/** Month file header: runs[dd] = Saskatchewan hours a run was counted; backfilled = days read back from the feed's archive. */
type HistoryBase = { feed: string; month: string; source: string; licence: string; first: string | null; last: string | null; runs: Record<string, number[]>; backfilled: string[] };
/** per gauge: [day of month, min, max, mean discharge m³/s, readings, flag] */
export type RiversHistory = HistoryBase & { stations: Record<string, [number, number, number, number, number, string | null][]> };
/** per community: [day of month, highest AQHI, hours reported] */
export type AirHistory = HistoryBase & { communities: Record<string, { name: string; lon: number; lat: number; out?: true }>; days: Record<string, [number, number, number][]> };
/** per day of month: [lon, lat, fire radiative power, minute of the Saskatchewan day] */
export type FiresHistory = HistoryBase & { days: Record<string, [number, number, number | null, number][]> };
export type AlertsHistory = HistoryBase & { alerts: { key: string; code: string; type: string; name: string; colour: string | null; start: string; seen: string; ends: string | null; areas: number; places: string[] }[] };
export type WaterHistory = HistoryBase & { advisories: { key: string; n: string; src: string; k: string; d: string | null; reg: string | null; lon?: number; lat?: number; first: string; last: string }[] };
export type HistoryFeed = 'rivers' | 'air' | 'fires' | 'alerts' | 'water';
export type HistoryIndex = {
  updated: string; fewRuns: number;
  feeds: Partial<Record<HistoryFeed, { months: string[]; first: string; last: string; days: number; gaps: number; gapDays: string[]; few: number; kb: number }>>;
};

const historyMemo = new Map<string, Promise<unknown>>();
const liveAllowed = () => { const q = new URLSearchParams(location.search); return !q.has('film') || q.has('now'); };
/** The history index, or null (no history in this copy, or the film). */
export function loadHistoryIndex(): Promise<HistoryIndex | null> {
  if (!liveAllowed()) return Promise.resolve(null);
  if (!historyMemo.has('index')) historyMemo.set('index', load<HistoryIndex>('history/index'));
  return historyMemo.get('index') as Promise<HistoryIndex | null>;
}
/** One feed's month file ('YYYY-MM'), or null. Each is fetched once. */
export function loadHistory<T>(feed: HistoryFeed, month: string): Promise<T | null> {
  if (!liveAllowed()) return Promise.resolve(null);
  const k = `${feed}/${month}`;
  if (!historyMemo.has(k)) historyMemo.set(k, load<T>(`history/${k}`));
  return historyMemo.get(k) as Promise<T | null>;
}
