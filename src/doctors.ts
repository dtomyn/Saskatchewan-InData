// DOCTORS & CLINICS — where to see a family doctor or nurse outside an emergency department, and where to fill a
// prescription: the Saskatchewan Health Authority's clinics and primary health care centres (Statistics Canada's ODHF)
// and the medical clinics, doctors' offices and pharmacies mapped in OpenStreetMap; with the drive from each place to the
// nearest clinic and pharmacy, and how many are in town. A static layer.
import * as d3 from 'd3';
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { Data, DoctorSite, Trip } from './data';
import { esc, safeUrl } from './html';
import { rampCSS } from './charts';
import { AtlasLayer, NO_DEPTH, heroStats, kicker, mk, rgb, sourceLine, townColumns } from './layer-kit';

export const DOCTORS_COLOR = '#ff8fab';

export const SITE_KINDS: Record<DoctorSite['k'], { label: string; plural: string; color: string }> = {
  md: { label: 'Medical clinic or doctor’s office', plural: 'medical clinics and doctors’ offices', color: DOCTORS_COLOR },
  phc: { label: 'Primary health care or health centre', plural: 'primary health care and health centres', color: '#ffa94d' },
  np: { label: 'Nurse practitioner or nurse', plural: 'nurse sites', color: '#c3a6ff' },
  rx: { label: 'Pharmacy', plural: 'pharmacies', color: '#4ee6d6' },
};

/** The two errands each place gets a drive for, in the order of the panel's chips. */
const TARGETS = [
  { id: 'c', label: 'Clinic', short: 'clinic or doctor’s office', color: DOCTORS_COLOR },
  { id: 'p', label: 'Pharmacy', short: 'pharmacy', color: SITE_KINDS.rx.color },
] as const;
type TargetId = (typeof TARGETS)[number]['id'];

export type DoctorTrip = { name: string; city: string | null; min: number | null; km: number; note: string; line?: [number, number][]; lon: number; lat: number; inferred?: boolean };
/** Per place: the nearest clinic and pharmacy by road, and how many of each are in town. */
export type PlaceDoctors = { c: DoctorTrip | null; p: DoctorTrip | null; nc: number; np: number };

export const siteNote = (s: DoctorSite) => `${s.k === 'rx' ? 'Pharmacy' : SITE_KINDS[s.k].label}${s.w ? ' · walk-in' : ''} · ${s.src === 'o' ? 'OpenStreetMap' : 'SHA site (ODHF)'}${s.approx ? ' · placed at the town centre' : ''}`;

export function placeDoctors(data: Data, key: string): PlaceDoctors | null {
  const D = data.doctors;
  const t = D?.towns[key];
  if (!D || !t) return null;
  const trip = (tr?: Trip): DoctorTrip | null => {
    if (!tr) return null;
    const s = D.sites[tr.f];
    return { name: s.n, city: s.city ?? null, min: tr.min, km: tr.km, line: tr.line, lon: s.lon, lat: s.lat, note: siteNote(s) };
  };
  // INFERRED: no clinic mapped in town, but a hospital is; its doctors usually practise at or beside it
  const c = t.h ? { name: t.h.n, city: null, min: t.h.min, km: t.h.km, lon: t.h.lon, lat: t.h.lat, inferred: true, note: 'Inferred: no clinic is mapped in town, but it has a hospital, where its doctors usually practise' } : trip(t.c);
  return { c, p: trip(t.p), nc: t.nc, np: t.np };
}

export const doctorTripText = (t: DoctorTrip) => (t.min != null ? `${t.min} min` : `${Math.round(t.km)} km`);

export function doctorsLayer(data: Data): AtlasLayer {
  const color = DOCTORS_COLOR;
  const D = data.doctors;
  const sites = D?.sites ?? [];
  const routed = !!D && D.routing !== 'straight-line';
  const unit = routed ? 'min' : 'km';
  let target: TargetId = 'c';
  const places = new Map(data.munis.map((m) => [m.key, placeDoctors(data, m.key)]));
  const tripOf = (key: string, k: TargetId) => places.get(key)?.[k] ?? null;
  const val = (key: string) => { const t = tripOf(key, target); return t ? t.min ?? t.km : null; };
  const ramp = d3.scaleLinear<string>().domain([2, 30, 120]).range(['#fff0f4', color, '#8b5cf6']).interpolate(d3.interpolateRgb).clamp(true);
  const height = (v: number) => 2600 + Math.min(v, 300) * 600;
  const tcol = (k: TargetId) => TARGETS.find((g) => g.id === k)!.color;

  type Row = { k: TargetId; t: DoctorTrip; path: [number, number][] };
  let memoKey: string | null = null;
  let memo: Row[] = [];
  const rowsFor = (key: string | null) => {
    if (key === memoKey) return memo;
    memoKey = key;
    const m = data.munis.find((x) => x.key === key);
    memo = !m ? [] : TARGETS.flatMap((g) => {
      const t = tripOf(m.key, g.id);
      return t ? [{ k: g.id, t, path: t.line ?? [[m.lon, m.lat], [t.lon, t.lat]] }] : [];
    });
    return memo;
  };

  const l: AtlasLayer = {
    id: 'doctors',
    name: 'Doctors & clinics',
    icon: '🩺',
    color,
    range: [new Date().getFullYear(), new Date().getFullYear() + 0.99],
    static: true,
    period: 'clinics listed today',
    available: sites.length > 0,
    unavailable: 'The clinic and pharmacy lists could not be built when this copy of the data was made. Run <code>npm run data doctors</code>, then reload.',
    build({ selected, hovered, focusedId }) {
      const focused = focusedId === 'doctors';
      const out: Layer[] = [];
      if (focused) out.push(...townColumns('doctors', data.munis, (m) => val(m.key), height, (v) => rgb(ramp(v), 235), 0, `${selected}${target}`));
      const rows = rowsFor(hovered ?? selected);
      if (rows.length) {
        out.push(
          new PathLayer<Row>({
            id: 'doctors-trips', data: rows, getPath: (r) => r.path,
            getColor: (r) => rgb(tcol(r.k), r.k === target ? 240 : 150), getWidth: (r) => (r.k === target ? 4 : 2.5),
            widthUnits: 'pixels', capRounded: true, jointRounded: true, parameters: NO_DEPTH, updateTriggers: { getColor: target, getWidth: target },
          } as any),
          new TextLayer<Row>({
            id: 'doctors-mins', data: rows, getPosition: (r) => r.path[r.path.length - 1],
            getText: (r) => `${TARGETS.find((g) => g.id === r.k)!.label}: ${doctorTripText(r.t)}\n${r.t.name}`,
            getSize: (r) => (r.k === target ? 13 : 11), getColor: (r) => rgb(tcol(r.k), 245),
            getPixelOffset: (r) => [0, r.k === 'c' ? -14 : 14], getAlignmentBaseline: (r) => (r.k === 'c' ? 'bottom' : 'top'),
            fontFamily: 'Inter, sans-serif', fontWeight: 700, characterSet: 'auto', outlineWidth: 3, outlineColor: [6, 10, 18, 230],
            fontSettings: { sdf: true }, parameters: { depthCompare: 'always' }, updateTriggers: { getSize: target },
          } as any),
        );
      }
      out.push(new ScatterplotLayer<DoctorSite>({
        id: 'doctors-sites', data: sites, getPosition: (s) => [s.lon, s.lat],
        getRadius: (s) => (s.k === 'rx' ? 220 : 500), radiusMinPixels: focused ? 3.2 : 2.4, radiusMaxPixels: 10,
        getFillColor: (s) => rgb(SITE_KINDS[s.k].color, s.approx ? 140 : 235),
        stroked: true, getLineColor: (s) => (s.w ? [255, 255, 255, 255] : [6, 10, 18, 255]), getLineWidth: (s) => (s.w ? 2 : 0.8), lineWidthUnits: 'pixels',
        pickable: true, parameters: { depthCompare: 'always' },
      } as any));
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Health · Statistics Canada ODHF · OpenStreetMap')}
        <h2>Where can I see a doctor?</h2>`;
      if (!D) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const clinics = sites.filter((s) => s.k !== 'rx');
      el.insertAdjacentHTML('beforeend', `<p class="lede">Family doctors are short across Saskatchewan, and shortest in small towns. Dots are the ${clinics.length} clinics and health centres where a doctor or nurse practitioner may see patients outside an emergency department (pink: medical clinics and doctors’ offices; amber: the health authority’s primary health care and health centres; white ring: walk-in) and ${sites.length - clinics.length} pharmacies (teal). Column height is the ${routed ? '<b>typical drive</b>' : '<b>straight-line distance</b>'} from each place to the nearest one you pick; hover or click a place for its routes.</p>
        <div class="chips" style="margin:2px 0 10px">${TARGETS.map((g) => `<button class="chip${g.id === target ? ' on' : ''}" data-k="${g.id}" style="--c:${g.color}">${g.label}</button>`).join('')}</div>`);
      const hero = heroStats(el, 4);
      const body = el.appendChild(mk('div'));
      const draw = () => {
        el.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.classList.toggle('on', b.dataset.k === target));
        const g = TARGETS.find((x) => x.id === target)!;
        const rows = data.munis.flatMap((m) => { const t = tripOf(m.key, target); return t ? [{ m, t, v: t.min ?? t.km, n: places.get(m.key)?.[target === 'c' ? 'nc' : 'np'] ?? 0 }] : []; }).sort((a, b) => a.v - b.v);
        const inTown = rows.filter((r) => r.n > 0).length;
        hero(0, String(target === 'c' ? clinics.length : sites.length - clinics.length), target === 'c' ? 'clinics and health centres' : 'pharmacies mapped');
        hero(1, `${inTown} of ${rows.length}`, `places with a ${g.short} in town`);
        hero(2, `${Math.round(d3.median(rows, (r) => r.v) ?? 0)} ${unit}`, `median place to the nearest ${g.short}`);
        hero(3, `${rows.filter((r) => r.v > 30).length}`, `places more than 30 ${unit} away`);
        const max = d3.max(rows, (r) => r.v) ?? 1;
        body.innerHTML = `<h3>${routed ? 'Drive' : 'Distance'} to the nearest ${esc(g.short)}</h3>
          <ol class="rank-list">${rows.map((r, i) => `<li data-key="${esc(r.m.key)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.m.name)}</span><br><span class="rd">${esc(r.t.name)}${r.t.city ? `, ${esc(r.t.city)}` : ''} · ${Math.round(r.t.km)} km · ${r.n} in town</span></span><span><div class="bar"><i style="width:${Math.round((r.v / max) * 100)}%;background:${ramp(r.v)}"></i></div><div class="bar-v">${Math.round(r.v)}</div></span></li>`).join('')}</ol>
          <div class="ramp" style="background:${rampCSS((t) => ramp(2 + t * 118))}"></div>
          <div class="ramp-labels"><span>2 ${unit}</span><span>30</span><span>120+ ${unit}</span></div>`;
      };
      body.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k as TargetId | undefined;
        if (k) { target = k; draw(); }
      });
      draw();
      const n = (k: DoctorSite['k']) => sites.filter((s) => s.k === k).length;
      const disrupt = safeUrl(D.disruptionsUrl);
      el.insertAdjacentHTML('beforeend', `
        <div class="legend">${(Object.keys(SITE_KINDS) as DoctorSite['k'][]).map((k) => `<span><i class="sw" style="background:${SITE_KINDS[k].color}"></i>${SITE_KINDS[k].label} (${n(k)})</span>`).join('')}<span><i class="sw" style="background:${color};box-shadow:0 0 0 2px #fff"></i>Walk-in (${sites.filter((s) => s.w).length})</span></div>
        <div class="callout" style="--c:${color}"><b>A clinic on the map is not a doctor taking new patients.</b> Many clinics have closed their lists, rural clinics may open only on certain days, and some sites are staffed by a nurse practitioner rather than a doctor. Call the clinic before you count on it.</div>
        <p class="note">Clinics are the Saskatchewan Health Authority’s clinics and primary health care centres in Statistics Canada’s Open Database of Healthcare Facilities (a 2020 list; ${sites.filter((s) => s.approx).length} with no point in the file are shown at their town’s centre), joined with the medical clinics, doctors’ offices and nurses mapped in OpenStreetMap. Imaging, labs, dental, eye, chiropractic, mental-health, public-health and specialist clinics are left out, and so are hospitals (see Hospital access). Pharmacies are OpenStreetMap only, counted as in Daily needs; Daily needs’ clinic count is OpenStreetMap only too, so this layer may find more. Neither list has most private family practices, so even a regional centre can show none: a place with no clinic mapped but a hospital in town is <b>inferred</b> to have doctors there (its doctors usually practise at or beside the hospital), and its report says so.</p>
        <p class="note">The Saskatchewan Health Authority posts temporary emergency-department and service disruptions only as notices on ${disrupt ? `<a href="${disrupt}" target="_blank" rel="noopener">its service disruptions page</a>` : 'its service disruptions page'}, not as data, so they are not on the map: check it before you rely on a rural site.</p>
        ${sourceLine(`${D.source}; ${D.osmSource}. ${D.routingSource ?? 'Straight-line distances.'} Built ${D.asOf}.`)}`);
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('doctors')) return null;
      if (id === 'doctors-sites') {
        const s = info.object as DoctorSite;
        return `<b>${esc(s.n)}</b><br><span class="tk">${esc(siteNote(s))}${s.city ? ` · ${esc(s.city)}` : ''}</span>`;
      }
      const o: any = info.object;
      if (!o.m) return null;
      const p = places.get(o.m.key);
      if (!p) return null;
      return `<b>${esc(o.m.name)}</b>${TARGETS.map((g) => { const t = p[g.id]; return `<br><span class="tk">${g.label}</span> <span class="tv">${t ? doctorTripText(t) : 'n/a'}</span>`; }).join('')}<br><span class="tk">${p.nc} clinics, ${p.np} pharmacies in town</span><br><span class="tk">Click for town report</span>`;
    },
    describe(info) {
      if (info.layer?.id !== 'doctors-sites') return null;
      const s = info.object as DoctorSite;
      return {
        layer: 'doctors', kind: SITE_KINDS[s.k].label, lon: s.lon, lat: s.lat, zoom: 14, title: s.n,
        body: `${s.city ? `${s.city}. ` : ''}${s.w ? 'A walk-in clinic. ' : ''}${s.approx ? 'No location in the source: shown at the town centre, not the building. ' : ''}${s.k === 'rx' ? '' : 'A clinic on the map is not a doctor taking new patients: call first.'}`,
        stats: [],
        sources: [
          ...(s.src !== 'o' ? [{ label: 'Statistics Canada: ODHF', url: 'https://www.statcan.gc.ca/en/lode/databases/odhf' }] : []),
          ...(s.osm ? [{ label: 'OpenStreetMap', url: `https://www.openstreetmap.org/${s.osm}` }] : []),
        ],
      };
    },
  };
  return l;
}

