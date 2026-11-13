// SCHOOLS & LEARNING — where the K-12 schools are (the Ministry of Education's list: public, separate (Catholic),
// Fransaskois and First Nations band schools), which offer French, where the universities, Saskatchewan Polytechnic and
// regional colleges are, and the drive from each place to the nearest of each. A static layer.
import * as d3 from 'd3';
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { Data, PostSec, School, Trip } from './data';
import { esc } from './html';
import { rampCSS } from './charts';
import { AtlasLayer, NO_DEPTH, heroStats, kicker, mk, rgb, sourceLine, townColumns } from './layer-kit';

export const SECTORS: Record<School['s'], { label: string; plural: string; color: string }> = {
  pub: { label: 'Public', plural: 'public', color: '#5aa9ff' },
  sep: { label: 'Separate (Catholic)', plural: 'separate (Catholic)', color: '#c084fc' },
  fr: { label: 'Fransaskois', plural: 'Fransaskois', color: '#ff7aa8' },
  fn: { label: 'First Nations', plural: 'First Nations band', color: '#7ee081' },
  ind: { label: 'Independent', plural: 'independent', color: '#b0b8c8' },
  osm: { label: 'Not on the ministry list', plural: 'OpenStreetMap-only', color: '#e8e2cf' },
};
export const PSE_KINDS: Record<PostSec['k'], { label: string; color: string }> = {
  uni: { label: 'University or college', color: '#ffffff' },
  poly: { label: 'Polytechnic or technical institute', color: '#ff9f43' },
  col: { label: 'Regional college', color: '#ffd166' },
};
/** The four trips each place gets, in the order the panel's chips show them. */
export const TARGETS = [
  { id: 'h', label: 'High school', color: '#ffb703' },
  { id: 'e', label: 'Elementary', color: '#9ad8ff' },
  { id: 'f', label: 'French', color: '#ff7aa8' },
  { id: 'p', label: 'Post-secondary', color: '#ffffff' },
] as const;
type TargetId = (typeof TARGETS)[number]['id'];

const GRADES: Record<School['g'], string> = { e: 'Elementary or middle school', h: 'High school', k: 'K-12 school', '?': 'Grades not stated' };
/** What a school teaches, in words, saying when it is read from the name or inferred. */
export const gradesText = (s: School) =>
  s.gr ? `Grades ${s.gr}` : s.gi ? 'Grades not stated: counted as K-12 (no high school nearby)' : s.g === 'e' || s.g === 'h' ? `${GRADES[s.g]} (from its name)` : GRADES[s.g];
/** The French a school offers, or null. */
export const frenchText = (s: School) => (s.fr ? 'French-language school (Fransaskois)' : s.imm?.includes('French') ? 'French immersion program' : null);
const isOpen = (s: School) => !s.col && s.s !== 'fn' && s.s !== 'ind';

/** A trip from a place to a school or campus, in the shape the Town Report and Finder use for every trip. */
export type SchoolTrip = { name: string; city: string | null; min: number | null; km: number; note: string; line?: [number, number][]; lon: number; lat: number };
export type PlaceSchools = { n: number; e: SchoolTrip | null; h: SchoolTrip | null; f: SchoolTrip | null; p: SchoolTrip | null };

export function placeSchools(data: Data, key: string): PlaceSchools | null {
  const S = data.schools;
  const t = S?.towns[key];
  if (!S || !t) return null;
  const sch = (tr?: Trip): SchoolTrip | null => {
    if (!tr) return null;
    const s = S.schools[tr.f];
    return { name: s.n, city: null, min: tr.min, km: tr.km, line: tr.line, lon: s.lon, lat: s.lat, note: [SECTORS[s.s].label, gradesText(s), frenchText(s)].filter(Boolean).join(' · ') };
  };
  const ps = (tr?: Trip): SchoolTrip | null => {
    if (!tr) return null;
    const p = S.pse[tr.f];
    return { name: p.n, city: p.city, min: tr.min, km: tr.km, line: tr.line, lon: p.lon, lat: p.lat, note: `${PSE_KINDS[p.k].label}${p.campus ? ` · ${p.campus}` : ''}` };
  };
  return { n: t.n, e: sch(t.e), h: sch(t.h), f: sch(t.f), p: ps(t.p) };
}

export function schoolsLayer(data: Data): AtlasLayer {
  const color = '#ffb703';
  const S = data.schools;
  const schools = S?.schools ?? [];
  const pse = S?.pse ?? [];
  const routed = !!S && S.routing !== 'straight-line';
  const unit = routed ? 'min' : 'km';
  let target: TargetId = 'h';
  const places = new Map(data.munis.map((m) => [m.key, placeSchools(data, m.key)]));
  const tripOf = (key: string, k: TargetId) => places.get(key)?.[k] ?? null;
  const val = (key: string) => { const t = tripOf(key, target); return t ? t.min ?? t.km : null; };
  const ramp = d3.scaleLinear<string>().domain([2, 30, 120]).range(['#fff3c4', color, '#e0457b']).interpolate(d3.interpolateRgb).clamp(true);
  const height = (v: number) => 2600 + Math.min(v, 240) * 650;
  const tripText = (t: SchoolTrip) => (t.min != null ? `${t.min} min` : `${Math.round(t.km)} km`);

  type Row = { k: TargetId; t: SchoolTrip; path: [number, number][] };
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
  const tcol = (k: TargetId) => TARGETS.find((g) => g.id === k)!.color;

  const l: AtlasLayer = {
    id: 'schools',
    name: 'Schools & learning',
    icon: '🎓',
    color,
    range: [new Date().getFullYear(), new Date().getFullYear() + 0.99],
    static: true,
    period: 'schools listed today',
    available: schools.length > 0,
    unavailable: 'The Saskatchewan GeoHub’s school list could not be downloaded when this copy of the data was built. Run <code>npm run data schools</code>, then reload.',
    build({ selected, hovered, focusedId }) {
      const focused = focusedId === 'schools';
      const out: Layer[] = [];
      if (focused) out.push(...townColumns('schools', data.munis, (m) => val(m.key), height, (v) => rgb(ramp(v), 235), 0, `${selected}${target}`));
      const rows = rowsFor(hovered ?? selected);
      if (rows.length) {
        out.push(
          new PathLayer<Row>({
            id: 'schools-trips', data: rows, getPath: (r) => r.path,
            getColor: (r) => rgb(tcol(r.k), r.k === target ? 240 : 150), getWidth: (r) => (r.k === target ? 4 : 2.5),
            widthUnits: 'pixels', capRounded: true, jointRounded: true, parameters: NO_DEPTH, updateTriggers: { getColor: target, getWidth: target },
          } as any),
          new TextLayer<Row>({
            id: 'schools-mins', data: rows, getPosition: (r) => r.path[r.path.length - 1],
            getText: (r) => `${TARGETS.find((g) => g.id === r.k)!.label}: ${tripText(r.t)}\n${r.t.name}`,
            getSize: (r) => (r.k === target ? 13 : 11), getColor: (r) => rgb(tcol(r.k), 245),
            getPixelOffset: (r) => [0, r.k === 'h' || r.k === 'f' ? -14 : 14], getAlignmentBaseline: (r) => (r.k === 'h' || r.k === 'f' ? 'bottom' : 'top'),
            fontFamily: 'Inter, sans-serif', fontWeight: 700, characterSet: 'auto', outlineWidth: 3, outlineColor: [6, 10, 18, 230],
            fontSettings: { sdf: true }, parameters: { depthCompare: 'always' }, updateTriggers: { getSize: target },
          } as any),
        );
      }
      out.push(
        new ScatterplotLayer<School>({
          id: 'schools-sites', data: schools, getPosition: (s) => [s.lon, s.lat],
          getRadius: 220, radiusMinPixels: focused ? 2.8 : 2.2, radiusMaxPixels: 9,
          getFillColor: (s) => rgb(SECTORS[s.s].color, s.col ? 120 : 235),
          stroked: true, getLineColor: (s) => (frenchText(s) ? rgb('#ff7aa8') : [6, 10, 18, 255]), getLineWidth: (s) => (frenchText(s) ? 2 : 0.8),
          lineWidthUnits: 'pixels', pickable: true, parameters: { depthCompare: 'always' },
        } as any),
        new ScatterplotLayer<PostSec>({
          id: 'schools-pse', data: pse, getPosition: (p) => [p.lon, p.lat],
          getRadius: 1600, radiusMinPixels: focused ? 5.5 : 4.5, radiusMaxPixels: 14,
          getFillColor: [16, 22, 38, 235], stroked: true, getLineColor: (p) => rgb(PSE_KINDS[p.k].color), lineWidthMinPixels: 2.5,
          pickable: true, parameters: { depthCompare: 'always' },
        } as any),
      );
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Places & living · Ministry of Education')}
        <h2>How far to school?</h2>`;
      if (!S) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const nFrench = schools.filter((s) => frenchText(s)).length;
      el.insertAdjacentHTML('beforeend', `<p class="lede">The province’s ${schools.length} K-12 schools, coloured by who runs them, and ${pse.length} university, polytechnic and regional-college sites. A pink ring marks the ${nFrench} schools that teach in French. Column height is the ${routed ? '<b>typical drive</b>' : '<b>straight-line distance</b>'} from each place to the nearest school of the kind you pick; hover or click a place for its routes.</p>
        <div class="chips" style="margin:2px 0 10px">${TARGETS.map((g) => `<button class="chip${g.id === target ? ' on' : ''}" data-k="${g.id}" style="--c:${g.color}">${g.label}</button>`).join('')}</div>`);
      const hero = heroStats(el, 4);
      const body = el.appendChild(mk('div'));
      const draw = () => {
        el.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.classList.toggle('on', b.dataset.k === target));
        const g = TARGETS.find((x) => x.id === target)!;
        const rows = data.munis.flatMap((m) => { const t = tripOf(m.key, target); return t ? [{ m, t, v: t.min ?? t.km }] : []; }).sort((a, b) => a.v - b.v);
        const near = 10;
        hero(0, String(schools.filter(isOpen).length), 'schools open to any family');
        hero(1, String(nFrench), 'teach in French (Fransaskois or immersion)');
        hero(2, `${Math.round(d3.median(rows, (r) => r.v) ?? 0)} ${unit}`, `median place to the nearest ${g.label.toLowerCase()}${target === 'f' ? ' school' : ''}`);
        hero(3, `${rows.filter((r) => r.v <= near).length} of ${rows.length}`, `places within ${near} ${unit}`);
        const max = d3.max(rows, (r) => r.v) ?? 1;
        body.innerHTML = `<h3>${routed ? 'Drive' : 'Distance'} to the nearest ${g.label.toLowerCase()}${target === 'f' ? ' school' : ''}</h3>
          <ol class="rank-list">${rows.map((r, i) => `<li data-key="${esc(r.m.key)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.m.name)}</span><br><span class="rd">${esc(r.t.name)}${r.t.city ? `, ${esc(r.t.city)}` : ''} · ${Math.round(r.t.km)} km</span></span><span><div class="bar"><i style="width:${Math.round((r.v / max) * 100)}%;background:${ramp(r.v)}"></i></div><div class="bar-v">${Math.round(r.v)}</div></span></li>`).join('')}</ol>
          <div class="ramp" style="background:${rampCSS((t) => ramp(2 + t * 118))}"></div>
          <div class="ramp-labels"><span>2 ${unit}</span><span>30</span><span>120+ ${unit}</span></div>`;
      };
      body.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k as TargetId | undefined;
        if (k) { target = k; draw(); }
      });
      draw();
      const inferred = schools.filter((s) => s.gi).length;
      el.insertAdjacentHTML('beforeend', `
        <div class="legend">${Object.values(SECTORS).map((s) => `<span><i class="sw" style="background:${s.color}"></i>${s.label}</span>`).join('')}<span><i class="sw" style="background:#101626;box-shadow:0 0 0 2px #ff7aa8"></i>French</span></div>
        <div class="legend">${Object.values(PSE_KINDS).map((k) => `<span><i class="sw" style="background:#101626;box-shadow:0 0 0 2px ${k.color}"></i>${k.label}</span>`).join('')}</div>
        <p class="note">The ministry’s list gives grades only for band schools. A provincial school is counted as elementary or high from its name (“Elementary”, “Middle”, “Junior” or “High”, “Collegiate”, “Composite”, “Comprehensive”); one whose name says neither counts as elementary, and also as a K-12 school when no school that says it teaches high school is within ${S.inferKm} km — true of most one-school towns, but inferred (${inferred} schools). Check grades with the school division.</p>
        <p class="note">The ministry’s map layer puts many rural schools kilometres from the building and misses others (Estevan has none on it). Listed schools are moved to the OpenStreetMap school of the same name where there is one, and ${schools.filter((s) => s.osm).length} OpenStreetMap schools inside the atlas’s towns fill the gaps (named or not; one may repeat a listed school still misplaced); their sector is not stated unless OpenStreetMap says Catholic, and they never count as French. Drives count only schools any family can use: public, separate (Catholic: they also enrol non-Catholic students), Fransaskois and these OpenStreetMap schools, not Hutterite colony, band or independent schools. Fransaskois schools are for children with French-language education rights (a parent whose first language is French, or who was schooled in French); immersion programs may cover only some grades. Daily needs counts schools from OpenStreetMap alone, so its count and this layer’s “schools in town” can differ.</p>
        ${sourceLine(`${S.source}; ${S.pseSource}. ${S.routingSource ?? 'Straight-line distances.'} Listed ${S.asOf}.`)}`);
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('schools')) return null;
      if (id === 'schools-sites') {
        const s = info.object as School;
        const fr = frenchText(s);
        return `<b>${esc(s.n)}</b><br><span class="tk">${SECTORS[s.s].label}${s.col ? ' · Hutterite colony school' : ''}${s.div ? ` · ${esc(s.div)}` : ''}</span><br><span class="tk">${esc(gradesText(s))}</span>${fr ? `<br><span class="tk">${fr}</span>` : ''}${s.e ? `<br><span class="tk">Students</span> <span class="tv">${s.e}</span>` : ''}`;
      }
      if (id === 'schools-pse') {
        const p = info.object as PostSec;
        return `<b>${esc(p.n)}</b><br><span class="tk">${PSE_KINDS[p.k].label}${p.city ? ` · ${esc(p.city)}` : ''}</span>${p.campus ? `<br><span class="tk">${esc(p.campus)}</span>` : ''}`;
      }
      const o: any = info.object;
      if (!o.m) return null;
      const ps = places.get(o.m.key);
      if (!ps) return null;
      return `<b>${esc(o.m.name)}</b>${TARGETS.map((g) => { const t = ps[g.id]; return `<br><span class="tk">${g.label}</span> <span class="tv">${t ? tripText(t) : 'n/a'}</span>`; }).join('')}<br><span class="tk">Click for town report</span>`;
    },
    describe(info) {
      const id = info.layer?.id;
      if (id === 'schools-sites') {
        const s = info.object as School;
        const fr = frenchText(s);
        return {
          layer: 'schools', kind: `${SECTORS[s.s].label} school`, lon: s.lon, lat: s.lat, zoom: 12, title: s.n,
          body: `${gradesText(s)}.${s.div ? ` ${s.s === 'fn' ? 'Band partner' : 'School division'}: ${s.div}.` : ''}${s.at ? ` At ${s.at}.` : ''}${fr ? ` ${fr}.` : ''}${s.imm?.filter((x) => x !== 'French').map((x) => ` ${x} immersion program.`).join('') ?? ''}${s.col ? ' A Hutterite colony school, for the colony’s children.' : ''}`,
          stats: s.e ? [{ v: String(s.e), l: 'students, K-12' }] : [],
          sources: [s.osm ? { label: 'OpenStreetMap', url: `https://www.openstreetmap.org/${s.osm}` } : { label: 'Saskatchewan GeoHub: K-12 schools', url: 'https://gis.saskatchewan.ca/arcgis/rest/services/Education/SchoolsAndDivisions/MapServer' }],
        };
      }
      if (id === 'schools-pse') {
        const p = info.object as PostSec;
        return {
          layer: 'schools', kind: PSE_KINDS[p.k].label, lon: p.lon, lat: p.lat, zoom: 12, title: p.n,
          body: `${p.campus ? `${p.campus}, ` : ''}${p.city ? `in ${p.city}` : ''}${p.src === 'osm' ? ' (campus mapped in OpenStreetMap; the ministry list does not include it).' : '.'}`,
          stats: [],
          sources: [p.osm ? { label: 'OpenStreetMap', url: `https://www.openstreetmap.org/${p.osm}` } : { label: 'Saskatchewan GeoHub: post-secondary institutions', url: 'https://gis.saskatchewan.ca/arcgis/rest/services/Education/AdvancedEducation/MapServer' }],
        };
      }
      return null;
    },
  };
  return l;
}
