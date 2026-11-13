// SMALL COMMUNITIES (tier 2) — every city, town, village, resort village and northern community beyond the atlas's 62
// places (municipalities.json, `tier: 2`). The stages that cover them write a `small` table beside their `towns`;
// `smallView` merges those (and each one's census subdivision figures) into a copy of the data, so townMetrics, the
// place helpers and the Finder treat a small community like any other place. The 62 places' own tables never change.
//
// Honesty rules (principle 4): what a small community lacks is skipped, never penalized, and its report says why for
// every missing row. Its trips are straight lines (no road routing for small communities in this build), so they read
// "km in a straight line", never minutes, and the Finder leaves them out of every drive-time criterion.
import { Data, Muni, Subdivision, fmt } from './data';
import { esc } from './html';
import { TownMetrics, townMetrics } from './metrics';
import { csdReport } from './subdivisions';

const viewMemo = new WeakMap<Data, Data>();
const merge = <T>(towns: Record<string, T> | undefined, small: Record<string, T> | undefined) => ({ ...(towns ?? {}), ...(small ?? {}) });

/** The data with the tier-2 communities folded in as places (munis), their stage tables and census figures merged. */
export function smallView(data: Data): Data {
  let v = viewMemo.get(data);
  if (v) return v;
  const csdOf = (m: Muni): Subdivision | undefined => (m.csd ? subdivisionById(data, m.csd) : undefined);
  const byKey = <T>(get: (m: Muni, s: Subdivision) => T | null | undefined) => {
    const o: Record<string, T> = {};
    for (const m of data.small) { const s = csdOf(m); const x = s ? get(m, s) : null; if (x != null) o[m.key] = x; }
    return o;
  };
  const d = data;
  v = {
    ...d,
    munis: [...d.munis, ...d.small],
    // population: the 2016 and 2021 census counts of its census subdivision (the 62 have annual estimates)
    population: d.population ? { ...d.population, munis: { ...d.population.munis, ...byKey((_, s) => (s.pop != null ? { pop: { ...(s.pop16 != null ? { 2016: s.pop16 } : {}), 2021: s.pop } } : null)) } } : d.population,
    housing: d.housing ? { ...d.housing, census: { ...d.housing.census, ...byKey((_, s) => d.housing!.csd?.[s.id]) } } : d.housing,
    jobs: d.jobs ? { ...d.jobs, towns: { ...d.jobs.towns, ...byKey((m, s) => ({ r: d.jobs!.small?.[m.key]?.r ?? null, ...(d.jobs!.csd?.[s.id] ?? {}) })) } } : d.jobs,
    community: d.community ? { ...d.community, towns: { ...d.community.towns, ...byKey((_, s) => (d.community!.csd?.[s.id] ? { ...d.community!.csd![s.id], pw: [] } : null)) } } : d.community,
    needs: d.needs ? { ...d.needs, towns: merge(d.needs.towns, d.needs.small) as typeof d.needs.towns } : d.needs,
    justice: d.justice ? { ...d.justice, towns: merge(d.justice.towns, d.justice.small) } : d.justice,
    hospitals: d.hospitals ? { ...d.hospitals, towns: merge(d.hospitals.towns, d.hospitals.small) } : d.hospitals,
    schools: d.schools ? { ...d.schools, towns: merge(d.schools.towns, d.schools.small) } : d.schools,
    internet: d.internet ? { ...d.internet, towns: merge(d.internet.towns, d.internet.small) } : d.internet,
    doctors: d.doctors ? { ...d.doctors, towns: merge(d.doctors.towns, d.doctors.small) } : d.doctors,
    childcare: d.childcare ? { ...d.childcare, towns: merge(d.childcare.towns, d.childcare.small) } : d.childcare,
    radon: d.radon ? { ...d.radon, towns: merge(d.radon.towns, d.radon.small) } : d.radon,
    light: d.light ? { ...d.light, towns: merge(d.light.towns, d.light.small) } : d.light,
    drought: d.drought ? { ...d.drought, towns: merge(d.drought.towns, d.drought.small) } : d.drought,
  };
  viewMemo.set(data, v);
  return v;
}

let subIdx: { data: Data; by: Map<string, Subdivision> } | null = null;
export function subdivisionById(data: Data, id: string) {
  if (subIdx?.data !== data) subIdx = { data, by: new Map((data.subdivisions?.csds ?? []).map((s) => [s.id, s])) };
  return subIdx.by.get(id);
}

/** One small community's metrics (from the merged view), or null. */
export function smallMetrics(data: Data, key: string): TownMetrics | null {
  if (!data.small.some((m) => m.key === key)) return null;
  return townMetrics(smallView(data)).find((t) => t.muni.key === key) ?? null;
}

const STRAIGHT = 'in a straight line (small communities get no road routing in this build)';
const kmText = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} km`;

/** The report for a tier-2 community: every row present, an absent value saying why. */
export function renderSmallReport(el: HTMLElement, data: Data, key: string, opts: { onClose: () => void; onTown: (key: string) => void }) {
  const t = smallMetrics(data, key);
  if (!t) return;
  const m = t.muni;
  const s = m.csd ? subdivisionById(data, m.csd) : undefined;
  const why = (text: string) => `<span style="color:var(--ink-3)">${text}</span>`;
  const row = (label: string, v: string, sub: string) => `<div class="metric"><div class="mk">${esc(label)}</div><div class="mv">${v}</div><div class="ms">${sub}</div></div>`;
  const absent = (label: string, reason: string) => row(label, why('—'), reason);
  const trip = (label: string, tr: { name: string; city?: string | null; km: number; inferred?: boolean } | null | undefined, none: string) =>
    tr ? row(label, `~${kmText(tr.km)}`, `${esc(tr.name)}${tr.city ? `, ${esc(tr.city)}` : ''} · ${tr.inferred ? 'inferred · ' : ''}${STRAIGHT}`) : absent(label, none);
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  const big = data.munis.length;
  const nearest = [...data.munis].map((x) => ({ x, d: Math.hypot((x.lon - m.lon) * Math.cos((m.lat * Math.PI) / 180), x.lat - m.lat) * 111 })).sort((a, b) => a.d - b.d).slice(0, 3);

  el.innerHTML = `<button class="close-x" aria-label="Close report">×</button>
    <div class="kicker" style="--c:#9ad8ff">${esc(m.kind)} · small community · ${esc(m.rd)}</div>
    <h2>${esc(m.name)}</h2>
    <p class="lede">One of ${data.small.length} smaller communities beyond the atlas’s ${big} places. It gets census figures, what is mapped in town, hazards by location and the nearest services in a straight line; crime, drive times, camping, transit and commutes are worked out for the ${big} places only, and each row below says when a value is missing and why.</p>
    <div class="metric-grid">
      ${t.pop != null ? row('Population', fmt.int(t.pop), `Census ${t.popYear}${t.popGrowth5y != null ? ` · ${t.popGrowth5y >= 0 ? '+' : '−'}${Math.abs(t.popGrowth5y * 100).toFixed(1)}% since 2016` : ''}`) : absent('Population', s?.ne ? 'not enumerated in 2021' : 'not published by Statistics Canada')}
      ${absent('Crime', 'no police-reported crime series of its own: Statistics Canada publishes by police service, and the RCMP detachment that covers it reports for a wider area')}
    </div>
    <h3>Nearest services</h3>
    <div class="metric-grid">
      ${trip('Hospital', t.hospital, data.hospitals ? 'no hospital in the data' : 'hospital data not built')}
      ${trip('Police', t.policeStation, data.justice ? 'no police station mapped' : 'justice data not built')}
      ${trip('Courthouse', t.court, data.justice ? 'no courthouse mapped' : 'justice data not built')}
      ${trip('Clinic', t.doctors?.c, t.doctors ? 'no clinic mapped' : 'clinic data not built')}
      ${trip('Pharmacy', t.doctors?.p, t.doctors ? 'no pharmacy mapped' : 'clinic data not built')}
      ${trip('Child care centre', t.childcare?.c, t.childcare ? 'no licensed centre listed' : 'childcare data not built')}
      ${trip('Elementary school', t.schools?.e, t.schools ? 'none listed' : 'school data not built')}
      ${trip('High school', t.schools?.h, t.schools ? 'none listed' : 'school data not built')}
    </div>
    <h3>In town</h3>
    <div class="metric-grid">
      ${t.needs ? row('Daily needs', `${t.needs.met} of ${t.needs.of}`, `everyday services mapped in OpenStreetMap ${t.needs.how === 'csd' ? 'inside its limits or within 1 km' : `within ${t.needs.r} km of its centre`}; a ✗ can mean not mapped`) : absent('Daily needs', 'not counted (needs data not built)')}
      ${t.schools ? row('Schools', String(t.schools.n), 'open K-12 schools in town (Ministry of Education; its points can be off by kilometres, and only the 62 places get schools added from OpenStreetMap)') : absent('Schools', 'school data not built')}
      ${t.doctors ? row('Clinics', String(t.doctors.nc), `${n(t.doctors.np, 'pharmacy', 'pharmacies')} too; a clinic is not a doctor taking new patients`) : absent('Clinics', 'clinic data not built')}
      ${t.childcare ? row('Licensed child care', String(t.childcare.nc), `centres, plus ${n(t.childcare.nh, 'family home', 'family homes')}`) : absent('Licensed child care', 'childcare data not built')}
      ${t.internet ? row('Fast internet', `${t.internet.f50}%`, `of homes offered 50/10 Mbps or better (offered, not measured; ISED) · mobile ${t.internet.mobile}`) : absent('Fast internet', 'no ISED pseudo-households inside its limits')}
      ${absent('Places of worship', `counted for the ${big} places only`)}
    </div>
    <h3>Hazards and climate, by location</h3>
    <div class="metric-grid">
      ${row('Wildfires', String(t.fires25km), `fires started within 25 km since 1990 · ${fmt.ha(t.burnedHa50km)} burned from fires starting within 50 km`)}
      ${row('Tornadoes', String(t.tornadoes50km), 'on record within 50 km')}
      ${t.hail ? row('Hail', String(t.hail.n), `storms whose swath passed within 50 km, ${t.hail.from}–${t.hail.to}`) : absent('Hail', 'hail data not built')}
      ${t.drought ? row('Drought', String(t.drought.d2), `months at severe drought or worse, ${t.drought.from}–${t.drought.to} (its 10 km map cell)`) : absent('Drought', 'drought data not built')}
      ${t.smoke ? row('Smoke days', t.smoke.avg.toFixed(1), `a year, borrowed from ${esc(t.smoke.name)} (${Math.round(t.smoke.dist)} km)`) : absent('Smoke days', 'no air-monitoring station within 150 km')}
      ${t.radon ? row('Radon', `${t.radon.region.pct.toFixed(0)}%`, `of tested homes at or above 200 Bq/m³ in its health region (${esc(t.radon.region.name)}); test your own home`) : absent('Radon', 'radon data not built')}
      ${t.climate ? row('Mean temperature', `${t.climate.meanTemp.toFixed(1)} °C`, `1991 on, borrowed from ${esc(t.climate.name)} (${Math.round(t.climate.dist)} km)`) : absent('Mean temperature', 'no long-record station')}
      ${t.light ? row('Shortest day', `${t.light.d[0].toFixed(1)} h`, `daylight on December 21 (computed) · aurora ${t.light.a}`) : absent('Shortest day', 'light data not built')}
      ${t.river ? row('River gauge', esc(t.river.name), `${Math.round(t.river.dist)} km away`) : absent('River gauge', 'no gauge within 25 km')}
      ${t.treaty ? row('Treaty', esc(t.treaty), 'the numbered treaty area it is in') : absent('Treaty', 'outside the numbered treaty areas drawn')}
    </div>
    <h3>Worked out for the ${big} places only</h3>
    <p class="note">Drive times by road, closure scenarios, camping, airports and transit, Workday Reach, CMHC market rents and vacancy, property tax, crops, industrial neighbours, drinking water advisories, newcomer services and climate projections. The public routing server the atlas uses cannot take several hundred more places, so distances here are straight lines and the Town Finder leaves small communities out of its drive-time criteria.</p>
    ${nearest.length ? `<div class="tr-falls" style="margin-top:8px">${nearest.map((x) => `<button class="tr-fall" data-town="${esc(x.x.key)}" type="button">${esc(x.x.name)}, ~${Math.round(x.d)} km: full report ›</button>`).join('')}</div>` : ''}
    <div class="sm-census"></div>`;
  el.querySelector('.close-x')!.addEventListener('click', opts.onClose);
  el.querySelectorAll<HTMLButtonElement>('[data-town]').forEach((b) => b.addEventListener('click', () => opts.onTown(b.dataset.town!)));
  // the census picture, as in the census-only report
  if (s) csdReport(data, s, 'housing').detail?.(el.querySelector<HTMLElement>('.sm-census')!);
  else el.querySelector('.sm-census')!.innerHTML = `<p class="note">${why('No census subdivision matched, so no census figures.')}</p>`;
}
