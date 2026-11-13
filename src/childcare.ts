// CHILDCARE — the Ministry of Education's regulated child care: centres where they are, and licensed family child care
// homes counted by community (never placed at a home). For each place: the drive to the nearest centre and to the
// nearest licensed care of any kind, and how many are in town. Licensed is not the same as a space being open. Static.
import * as d3 from 'd3';
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { ChildcareCentre, ChildcareHomes, Data } from './data';
import { esc, safeUrl } from './html';
import { rampCSS } from './charts';
import { AtlasLayer, NO_DEPTH, heroStats, kicker, mk, rgb, sourceLine, townColumns } from './layers';

export const CHILDCARE_COLOR = '#ffc4a3';
const HOMES_COLOR = '#b9a7ff';
/** $10/day: parent fees for regulated child care for children under six since 1 April 2023 (Government of Saskatchewan news release, 6 March 2023). */
export const TEN_A_DAY_URL = 'https://www.saskatchewan.ca/government/news-and-media/2023/march/06/saskatchewan-to-achieve-$10-a-day-child-care-by-april-2023';

/** The two drives each place gets, in the order of the panel's chips. */
const TARGETS = [
  { id: 'c', label: 'Centre', short: 'licensed child care centre', color: CHILDCARE_COLOR },
  { id: 'a', label: 'Any licensed care', short: 'licensed centre or family child care home', color: HOMES_COLOR },
] as const;
type TargetId = (typeof TARGETS)[number]['id'];

export type ChildcareTrip = { name: string; city: string | null; min: number | null; km: number; note: string; line?: [number, number][]; lon: number; lat: number };
/** Per place: the nearest centre and nearest licensed care of any kind by road; centres, homes and infant care in town. */
export type PlaceChildcare = { c: ChildcareTrip | null; a: ChildcareTrip | null; nc: number; nh: number; ni: number };

const centreNote = (s: ChildcareCentre) => ['Licensed centre', s.i ? 'takes infants' : '', s.f ? 'francophone' : '', s.x ? 'extended or 24-hour care' : '', s.t ? 'teen parent centre' : '', s.approx ? 'shown at the town centre' : ''].filter(Boolean).join(' · ');
const homesName = (h: ChildcareHomes) => `${h.n} family child care ${h.n === 1 ? 'home' : 'homes'}${h.city ? `, ${h.city}` : ''}`;
const homesNote = (h: ChildcareHomes) => `Licensed family child care ${h.n === 1 ? 'home' : 'homes'}${h.g ? ` (${h.g} group)` : ''}${h.i ? ` · ${h.i} take infants` : ''} · shown at the community, not the home`;

export function placeChildcare(data: Data, key: string): PlaceChildcare | null {
  const D = data.childcare;
  const t = D?.towns[key];
  if (!D || !t) return null;
  const c = t.c ? D.centres[t.c.f] : null;
  const a = t.a ? (t.a.h ? D.homes[t.a.f] : D.centres[t.a.f]) : null;
  return {
    c: t.c && c ? { name: c.n, city: c.city, min: t.c.min, km: t.c.km, line: t.c.line, lon: c.lon, lat: c.lat, note: centreNote(c) } : null,
    a: t.a && a ? ('n' in a && typeof a.n === 'number'
      ? { name: homesName(a as ChildcareHomes), city: null, min: t.a.min, km: t.a.km, line: t.a.line, lon: a.lon, lat: a.lat, note: homesNote(a as ChildcareHomes) }
      : { name: (a as ChildcareCentre).n, city: a.city, min: t.a.min, km: t.a.km, line: t.a.line, lon: a.lon, lat: a.lat, note: centreNote(a as ChildcareCentre) }) : null,
    nc: t.nc, nh: t.nh, ni: t.ni,
  };
}

/** A centre whose point was moved to its town's centre is "In town", not a drive. */
export const childcareTripText = (t: ChildcareTrip) => (t.km === 0 ? 'In town' : t.min != null ? `${t.min} min` : `${Math.round(t.km)} km`);

export function childcareLayer(data: Data): AtlasLayer {
  const color = CHILDCARE_COLOR;
  const D = data.childcare;
  const centres = D?.centres ?? [];
  const homes = D?.homes ?? [];
  const routed = !!D && D.routing !== 'straight-line';
  const unit = routed ? 'min' : 'km';
  let target: TargetId = 'c';
  const places = new Map(data.munis.map((m) => [m.key, placeChildcare(data, m.key)]));
  const tripOf = (key: string, k: TargetId) => places.get(key)?.[k] ?? null;
  const val = (key: string) => { const t = tripOf(key, target); return t ? t.min ?? t.km : null; };
  const ramp = d3.scaleLinear<string>().domain([2, 30, 120]).range(['#fff4ec', color, '#e0567a']).interpolate(d3.interpolateRgb).clamp(true);
  const height = (v: number) => 2600 + Math.min(v, 300) * 600;
  const tcol = (k: TargetId) => TARGETS.find((g) => g.id === k)!.color;

  type Row = { k: TargetId; t: ChildcareTrip; path: [number, number][] };
  let memoKey: string | null = null;
  let memo: Row[] = [];
  const rowsFor = (key: string | null) => {
    if (key === memoKey) return memo;
    memoKey = key;
    const m = data.munis.find((x) => x.key === key);
    memo = !m ? [] : TARGETS.flatMap((g) => {
      const t = tripOf(m.key, g.id);
      // the same site for both: draw it once
      if (!t || (g.id === 'a' && tripOf(m.key, 'c')?.name === t.name)) return [];
      return [{ k: g.id, t, path: t.line ?? [[m.lon, m.lat], [t.lon, t.lat]] }];
    });
    return memo;
  };

  const l: AtlasLayer = {
    id: 'childcare',
    name: 'Childcare',
    icon: '🧸',
    color,
    range: [new Date().getFullYear(), new Date().getFullYear() + 0.99],
    static: true,
    period: 'licensed facilities listed today',
    available: centres.length > 0,
    unavailable: 'The licensed child care list could not be built when this copy of the data was made. Run <code>npm run data childcare</code>, then reload.',
    build({ selected, hovered, focusedId }) {
      const focused = focusedId === 'childcare';
      const out: Layer[] = [];
      if (focused) out.push(...townColumns('childcare', data.munis, (m) => val(m.key), height, (v) => rgb(ramp(v), 235), 0, `${selected}${target}`));
      const rows = rowsFor(hovered ?? selected);
      if (rows.length) {
        out.push(
          new PathLayer<Row>({
            id: 'childcare-trips', data: rows, getPath: (r) => r.path,
            getColor: (r) => rgb(tcol(r.k), r.k === target ? 240 : 150), getWidth: (r) => (r.k === target ? 4 : 2.5),
            widthUnits: 'pixels', capRounded: true, jointRounded: true, parameters: NO_DEPTH, updateTriggers: { getColor: target, getWidth: target },
          } as any),
          new TextLayer<Row>({
            id: 'childcare-mins', data: rows, getPosition: (r) => r.path[r.path.length - 1],
            getText: (r) => `${TARGETS.find((g) => g.id === r.k)!.label}: ${childcareTripText(r.t)}\n${r.t.name}`,
            getSize: (r) => (r.k === target ? 13 : 11), getColor: (r) => rgb(tcol(r.k), 245),
            getPixelOffset: (r) => [0, r.k === 'c' ? -14 : 14], getAlignmentBaseline: (r) => (r.k === 'c' ? 'bottom' : 'top'),
            fontFamily: 'Inter, sans-serif', fontWeight: 700, characterSet: 'auto', outlineWidth: 3, outlineColor: [6, 10, 18, 230],
            fontSettings: { sdf: true }, parameters: { depthCompare: 'always' }, updateTriggers: { getSize: target },
          } as any),
        );
      }
      out.push(
        new ScatterplotLayer<ChildcareHomes>({
          id: 'childcare-homes', data: homes, getPosition: (h) => [h.lon, h.lat],
          getRadius: (h) => 500 + Math.sqrt(h.n) * 450, radiusMinPixels: focused ? 3 : 2.2, radiusMaxPixels: 16,
          getFillColor: rgb(HOMES_COLOR, 110), stroked: true, getLineColor: rgb(HOMES_COLOR, 230), getLineWidth: 1, lineWidthUnits: 'pixels',
          pickable: true, parameters: { depthCompare: 'always' },
        } as any),
        new ScatterplotLayer<ChildcareCentre>({
          id: 'childcare-centres', data: centres, getPosition: (s) => [s.lon, s.lat],
          getRadius: 450, radiusMinPixels: focused ? 3.2 : 2.4, radiusMaxPixels: 9,
          getFillColor: (s) => rgb(color, s.approx ? 140 : 235),
          stroked: true, getLineColor: (s) => (s.i ? [255, 255, 255, 255] : [6, 10, 18, 255]), getLineWidth: (s) => (s.i ? 1.6 : 0.8), lineWidthUnits: 'pixels',
          pickable: true, parameters: { depthCompare: 'always' },
        } as any),
      );
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Settling in · Ministry of Education')}
        <h2>Is there child care near you?</h2>`;
      if (!D) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const nHomes = d3.sum(homes, (h) => h.n);
      const ten = safeUrl(TEN_A_DAY_URL);
      el.insertAdjacentHTML('beforeend', `<p class="lede">Regulated child care in Saskatchewan costs ${ten ? `<a href="${ten}" target="_blank" rel="noopener">$10 a day</a>` : '$10 a day'} for children under six (since April 2023), but only in a regulated space. Apricot dots are the ${centres.length} licensed centres (white ring: takes infants); lavender circles count the ${nHomes} licensed family child care homes in each community, never at the home itself. Column height is the ${routed ? '<b>typical drive</b>' : '<b>straight-line distance</b>'} from each place to the nearest one you pick; hover or click a place for its routes.</p>
        <div class="chips" style="margin:2px 0 10px">${TARGETS.map((g) => `<button class="chip${g.id === target ? ' on' : ''}" data-k="${g.id}" style="--c:${g.color}">${g.label}</button>`).join('')}</div>`);
      const hero = heroStats(el, 4);
      const body = el.appendChild(mk('div'));
      const draw = () => {
        el.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.classList.toggle('on', b.dataset.k === target));
        const g = TARGETS.find((x) => x.id === target)!;
        const rows = data.munis.flatMap((m) => { const t = tripOf(m.key, target); const p = places.get(m.key); return t && p ? [{ m, t, v: t.min ?? t.km, n: target === 'c' ? p.nc : p.nc + p.nh }] : []; }).sort((a, b) => a.v - b.v);
        hero(0, String(target === 'c' ? centres.length : centres.length + nHomes), target === 'c' ? 'licensed centres' : 'licensed centres and homes');
        hero(1, `${rows.filter((r) => r.n > 0).length} of ${rows.length}`, `places with a ${g.short} in town`);
        hero(2, `${Math.round(d3.median(rows, (r) => r.v) ?? 0)} ${unit}`, `median place to the nearest ${target === 'c' ? 'centre' : 'licensed care'}`);
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
      const src = safeUrl(D.sourceUrl), lic = safeUrl(D.licenceUrl);
      el.insertAdjacentHTML('beforeend', `
        <div class="legend"><span><i class="sw" style="background:${color}"></i>Licensed centre (${centres.length})</span><span><i class="sw" style="background:${color};box-shadow:0 0 0 2px #fff"></i>Takes infants (${centres.filter((s) => s.i).length})</span><span><i class="sw" style="background:${HOMES_COLOR}"></i>Family child care homes, by community (${nHomes}, ${d3.sum(homes, (h) => h.g)} group homes)</span></div>
        <div class="callout" style="--c:${color}"><b>Licensed does not mean a space is open.</b> Waitlists of a year or more are common, especially for infants, and $10 a day applies only to regulated spaces. Call the centre or home, and add your name to waitlists early.</div>
        <p class="note">Every centre and family child care home the Ministry of Education regulates, as listed on ${src ? `<a href="${src}" target="_blank" rel="noopener">saskatchewan.ca’s child care finder</a>` : 'saskatchewan.ca’s child care finder'}, with the ministry’s own points (it calls them approximate). The list gives no licensed capacity, so spaces are not shown, only how many facilities there are. Family child care homes are people’s homes: only how many there are in each community is kept, shown at a point rounded to about 2 km. The ministry’s points are approximate and some are far off: a facility whose point lies outside the atlas place its address names is shown faded at that place’s centre. A listing with no type is counted as a centre or a home by its name (inferred). Unlicensed care, preschools and school-age programs not on the list are not shown. “In town” uses Daily needs’ town limits and ${D.slackKm} km slack.</p>
        ${sourceLine(`${D.source}; ${lic ? `<a href="${lic}" target="_blank" rel="noopener">Crown copyright</a>` : 'Crown copyright'}, reproduced for non-commercial use. ${D.routingSource ?? 'Straight-line distances.'} Read ${D.asOf}.`)}`);
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('childcare')) return null;
      if (id === 'childcare-centres') {
        const s = info.object as ChildcareCentre;
        return `<b>${esc(s.n)}</b><br><span class="tk">${esc(centreNote(s))}${s.city ? ` · ${esc(s.city)}` : ''}</span>`;
      }
      if (id === 'childcare-homes') {
        const h = info.object as ChildcareHomes;
        return `<b>${esc(homesName(h))}</b><br><span class="tk">${esc(homesNote(h))}</span>`;
      }
      const o: any = info.object;
      if (!o.m) return null;
      const p = places.get(o.m.key);
      if (!p) return null;
      return `<b>${esc(o.m.name)}</b>${TARGETS.map((g) => { const t = p[g.id]; return `<br><span class="tk">${g.label}</span> <span class="tv">${t ? childcareTripText(t) : 'n/a'}</span>`; }).join('')}<br><span class="tk">${p.nc} centres, ${p.nh} family homes in town</span><br><span class="tk">Click for town report</span>`;
    },
    describe(info) {
      const id = info.layer?.id;
      if (id !== 'childcare-centres' && id !== 'childcare-homes') return null;
      const src = { label: 'saskatchewan.ca: find a child care provider', url: D?.sourceUrl ?? '' };
      if (id === 'childcare-homes') {
        const h = info.object as ChildcareHomes;
        return {
          layer: 'childcare', kind: 'Family child care homes', lon: h.lon, lat: h.lat, zoom: 11, title: homesName(h),
          body: `${homesNote(h)}. Family child care homes are people’s homes, so the atlas shows only how many there are in a community; the province’s finder lists each with its phone number. Licensed is not the same as a space being open.`,
          stats: [], sources: [src],
        };
      }
      const s = info.object as ChildcareCentre;
      return {
        layer: 'childcare', kind: 'Licensed child care centre', lon: s.lon, lat: s.lat, zoom: 14, title: s.n,
        body: `${s.city ? `${s.city}. ` : ''}${centreNote(s)}. ${s.approx ? 'The ministry’s point for it was outside its town, so it is shown at the town centre, not the building. ' : 'The ministry’s point is approximate. '}Licensed is not the same as a space being open: call, and expect a waitlist.`,
        stats: [], sources: [src],
      };
    },
  };
  return l;
}
