// NEWCOMER SERVICES — where someone new to Saskatchewan goes in the first weeks: a settlement agency (free help to
// settle, find work and get credentials recognised; the province's Regional Newcomer Gateways among them), English
// classes, a Service Canada office for a Social Insurance Number, and an SGI motor licence issuer for a driver's licence
// and plates; with the drive from each place to the nearest of each. Settlement offices are IRCC's own list (plus the
// province's typed list); government offices are as mapped in OpenStreetMap. A static layer.
import * as d3 from 'd3';
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { Data, NewcomerAgency, NewcomerOffice, Trip } from './data';
import { esc, safeUrl } from './html';
import { rampCSS } from './charts';
import { AtlasLayer, NO_DEPTH, heroStats, kicker, mk, rgb, sourceLine, townColumns } from './layer-kit';

export const NEWCOMER_COLOR = '#4fd1c5';

/** The four errands each place gets a drive for, in the order of the panel's chips. */
export const ERRANDS = [
  { id: 's', label: 'Settlement help', short: 'settlement agency', color: NEWCOMER_COLOR },
  { id: 'l', label: 'English classes', short: 'English classes', color: '#ffd166' },
  { id: 'c', label: 'Service Canada', short: 'Service Canada office', color: '#ff6b6b' },
  { id: 'g', label: 'SGI issuer', short: 'SGI motor licence issuer', color: '#9be564' },
] as const;
type ErrandId = (typeof ERRANDS)[number]['id'];

const OFFICE_KINDS: Record<NewcomerOffice['k'], { label: string; color: string; alpha: number }> = {
  sc: { label: 'Service Canada Centre', color: '#ff6b6b', alpha: 240 },
  so: { label: 'Service Canada scheduled outreach (certain days)', color: '#ff6b6b', alpha: 140 },
  sgi: { label: 'SGI office or motor licence issuer', color: '#9be564', alpha: 240 },
  ins: { label: 'Insurance broker (most are SGI issuers: inferred)', color: '#9be564', alpha: 130 },
};

/** IRCC's service flags, in words (see `NewcomerAgency.sv`). */
const SERVICES: [string, string][] = [
  ['g', 'general settlement help'], ['n', 'needs assessment and referrals'], ['c', 'community connections'], ['j', 'job search'],
  ['p', 'help with professions and credentials'], ['a', 'language assessment'], ['e', 'English classes'], ['f', 'French classes'],
  ['w', 'job-specific language training'], ['z', 'citizenship test prep'], ['F', 'services in French'], ['y', 'youth'], ['W', 'women'],
  ['r', 'help for government-assisted refugees'],
];
export const servicesText = (a: NewcomerAgency) => SERVICES.filter(([k]) => a.sv.includes(k)).map(([, v]) => v).join(', ');

/** A trip from a place to an office, in the shape the Town Report uses. */
export type NewcomerTrip = { name: string; city: string | null; min: number | null; km: number; note: string; line?: [number, number][]; lon: number; lat: number };
export type PlaceNewcomer = Record<ErrandId, NewcomerTrip | null>;

export function placeNewcomer(data: Data, key: string): PlaceNewcomer | null {
  const N = data.newcomer;
  const t = N?.towns[key];
  if (!N || !t) return null;
  const ag = (tr?: Trip): NewcomerTrip | null => {
    if (!tr) return null;
    const a = N.agencies[tr.f];
    return { name: a.n, city: a.city, min: tr.min, km: tr.km, line: tr.line, lon: a.lon, lat: a.lat, note: `${a.g ? 'on the province’s settlement list' : 'IRCC-funded'}${a.approx ? ' · placed at the town centre' : ''}` };
  };
  const of = (tr?: Trip): NewcomerTrip | null => {
    if (!tr) return null;
    const o = N.offices[tr.f];
    return { name: o.n, city: o.city, min: tr.min, km: tr.km, line: tr.line, lon: o.lon, lat: o.lat, note: OFFICE_KINDS[o.k].label };
  };
  return { s: ag(t.s), l: ag(t.l), c: of(t.c), g: of(t.g) };
}

export const tripText = (t: NewcomerTrip) => (t.min != null ? `${t.min} min` : `${Math.round(t.km)} km`);

export function newcomerLayer(data: Data): AtlasLayer {
  const color = NEWCOMER_COLOR;
  const N = data.newcomer;
  const agencies = N?.agencies ?? [];
  const offices = N?.offices ?? [];
  const routed = !!N && N.routing !== 'straight-line';
  const unit = routed ? 'min' : 'km';
  let target: ErrandId = 's';
  const places = new Map(data.munis.map((m) => [m.key, placeNewcomer(data, m.key)]));
  const tripOf = (key: string, k: ErrandId) => places.get(key)?.[k] ?? null;
  const val = (key: string) => { const t = tripOf(key, target); return t ? t.min ?? t.km : null; };
  const ramp = d3.scaleLinear<string>().domain([2, 45, 180]).range(['#d9fff9', color, '#e0457b']).interpolate(d3.interpolateRgb).clamp(true);
  const height = (v: number) => 2600 + Math.min(v, 300) * 520;
  const ecol = (k: ErrandId) => ERRANDS.find((g) => g.id === k)!.color;

  type Row = { k: ErrandId; t: NewcomerTrip; path: [number, number][] };
  let memoKey: string | null = null;
  let memo: Row[] = [];
  const rowsFor = (key: string | null) => {
    if (key === memoKey) return memo;
    memoKey = key;
    const m = data.munis.find((x) => x.key === key);
    memo = !m ? [] : ERRANDS.flatMap((g) => {
      const t = tripOf(m.key, g.id);
      return t ? [{ k: g.id, t, path: t.line ?? [[m.lon, m.lat], [t.lon, t.lat]] }] : [];
    });
    return memo;
  };

  const l: AtlasLayer = {
    id: 'newcomer',
    name: 'Newcomer services',
    icon: '🧭',
    color,
    range: [new Date().getFullYear(), new Date().getFullYear() + 0.99],
    static: true,
    period: 'offices listed today',
    available: agencies.length > 0,
    unavailable: 'IRCC’s list of newcomer services could not be downloaded when this copy of the data was built. Run <code>npm run data newcomer</code>, then reload.',
    build({ selected, hovered, focusedId }) {
      const focused = focusedId === 'newcomer';
      const out: Layer[] = [];
      if (focused) out.push(...townColumns('newcomer', data.munis, (m) => val(m.key), height, (v) => rgb(ramp(v), 235), 0, `${selected}${target}`));
      const rows = rowsFor(hovered ?? selected);
      if (rows.length) {
        out.push(
          new PathLayer<Row>({
            id: 'newcomer-trips', data: rows, getPath: (r) => r.path,
            getColor: (r) => rgb(ecol(r.k), r.k === target ? 240 : 150), getWidth: (r) => (r.k === target ? 4 : 2.5),
            widthUnits: 'pixels', capRounded: true, jointRounded: true, parameters: NO_DEPTH, updateTriggers: { getColor: target, getWidth: target },
          } as any),
          new TextLayer<Row>({
            id: 'newcomer-mins', data: rows, getPosition: (r) => r.path[r.path.length - 1],
            getText: (r) => `${ERRANDS.find((g) => g.id === r.k)!.label}: ${tripText(r.t)}\n${r.t.name}`,
            getSize: (r) => (r.k === target ? 13 : 11), getColor: (r) => rgb(ecol(r.k), 245),
            getPixelOffset: (r) => [0, r.k === 's' || r.k === 'c' ? -14 : 14], getAlignmentBaseline: (r) => (r.k === 's' || r.k === 'c' ? 'bottom' : 'top'),
            fontFamily: 'Inter, sans-serif', fontWeight: 700, characterSet: 'auto', outlineWidth: 3, outlineColor: [6, 10, 18, 230],
            fontSettings: { sdf: true }, parameters: { depthCompare: 'always' }, updateTriggers: { getSize: target },
          } as any),
        );
      }
      out.push(
        new ScatterplotLayer<NewcomerOffice>({
          id: 'newcomer-offices', data: offices, getPosition: (o) => [o.lon, o.lat],
          getRadius: 220, radiusMinPixels: focused ? 3 : 2.4, radiusMaxPixels: 9,
          getFillColor: (o) => rgb(OFFICE_KINDS[o.k].color, OFFICE_KINDS[o.k].alpha),
          stroked: true, getLineColor: [6, 10, 18, 255], lineWidthMinPixels: 0.8,
          pickable: true, parameters: { depthCompare: 'always' },
        } as any),
        new ScatterplotLayer<NewcomerAgency>({
          id: 'newcomer-agencies', data: agencies, getPosition: (a) => [a.lon, a.lat],
          getRadius: 900, radiusMinPixels: focused ? 4.5 : 3.6, radiusMaxPixels: 12,
          getFillColor: rgb(color, 235), stroked: true,
          getLineColor: (a) => (a.g ? [255, 255, 255, 255] : [6, 10, 18, 255]), getLineWidth: (a) => (a.g ? 2 : 0.8), lineWidthUnits: 'pixels',
          pickable: true, parameters: { depthCompare: 'always' },
        } as any),
      );
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Settling in · IRCC · OpenStreetMap')}
        <h2>Where do I get help settling in?</h2>`;
      if (!N) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const gate = agencies.filter((a) => a.g).length;
      el.insertAdjacentHTML('beforeend', `<p class="lede">The first weeks in a new province are errands: a settlement agency for free help finding a home, work and a family doctor and getting your credentials recognised; English classes; a Service Canada office for your Social Insurance Number; and an SGI motor licence issuer to swap your licence and register a car. Teal dots are the ${agencies.length} settlement and language offices IRCC funds in Saskatchewan (white ring: on the province’s own settlement list, the Regional Newcomer Gateways); red dots are Service Canada, green dots SGI issuers. Column height is the ${routed ? '<b>typical drive</b>' : '<b>straight-line distance</b>'} from each place to the nearest one you pick; hover or click a place for its routes.</p>
        <div class="chips" style="margin:2px 0 10px">${ERRANDS.map((g) => `<button class="chip${g.id === target ? ' on' : ''}" data-k="${g.id}" style="--c:${g.color}">${g.label}</button>`).join('')}</div>`);
      const hero = heroStats(el, 4);
      const body = el.appendChild(mk('div'));
      const draw = () => {
        el.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.classList.toggle('on', b.dataset.k === target));
        const g = ERRANDS.find((x) => x.id === target)!;
        const rows = data.munis.flatMap((m) => { const t = tripOf(m.key, target); return t ? [{ m, t, v: t.min ?? t.km }] : []; }).sort((a, b) => a.v - b.v);
        const near = 30;
        hero(0, String(agencies.length), 'IRCC-funded settlement and language offices');
        hero(1, String(gate), 'on the province’s settlement list');
        hero(2, `${Math.round(d3.median(rows, (r) => r.v) ?? 0)} ${unit}`, `median place to the nearest ${g.short}`);
        hero(3, `${rows.filter((r) => r.v <= near).length} of ${rows.length}`, `places within ${near} ${unit}`);
        const max = d3.max(rows, (r) => r.v) ?? 1;
        body.innerHTML = `<h3>${routed ? 'Drive' : 'Distance'} to the nearest ${esc(g.short)}</h3>
          <ol class="rank-list">${rows.map((r, i) => `<li data-key="${esc(r.m.key)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.m.name)}</span><br><span class="rd">${esc(r.t.name)}${r.t.city ? `, ${esc(r.t.city)}` : ''} · ${Math.round(r.t.km)} km</span></span><span><div class="bar"><i style="width:${Math.round((r.v / max) * 100)}%;background:${ramp(r.v)}"></i></div><div class="bar-v">${Math.round(r.v)}</div></span></li>`).join('')}</ol>
          <div class="ramp" style="background:${rampCSS((t) => ramp(2 + t * 178))}"></div>
          <div class="ramp-labels"><span>2 ${unit}</span><span>45</span><span>180+ ${unit}</span></div>`;
      };
      body.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
      el.querySelector('.chips')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k as ErrandId | undefined;
        if (k) { target = k; draw(); }
      });
      draw();
      const n = (k: NewcomerOffice['k']) => offices.filter((o) => o.k === k).length;
      el.insertAdjacentHTML('beforeend', `
        <div class="legend"><span><i class="sw" style="background:${color}"></i>Settlement or language office</span><span><i class="sw" style="background:${color};box-shadow:0 0 0 2px #fff"></i>On the province’s list</span>${(Object.keys(OFFICE_KINDS) as NewcomerOffice['k'][]).map((k) => `<span><i class="sw" style="background:${OFFICE_KINDS[k].color};opacity:${OFFICE_KINDS[k].alpha / 255}"></i>${OFFICE_KINDS[k].label} (${n(k)})</span>`).join('')}</div>
        <p class="note">Settlement and language offices are IRCC’s “Find free newcomer services near you” list: offices that serve people in person, with the services IRCC says each offers. Many regional-college sites teach English classes only. Settlement help counts offices that give general settlement help, needs assessments or community connections. IRCC-funded services are for permanent residents and some temporary residents; check eligibility with the office. The province’s list of settlement services is published only as a web page, so it is typed into the build script (as read on ${esc(N.provAsOf)}); an organisation on it that IRCC does not list is placed at its town’s centre.</p>
        <p class="note">Service Canada offices and SGI issuers come from OpenStreetMap, as neither list is published as open data. Scheduled outreach sites open only on certain days. SGI works through nearly 400 motor licence issuers, mostly insurance brokers, and OpenStreetMap maps only some of them: brokers are counted as issuers (most are, but this is inferred), so the nearest issuer may well be closer than shown. A Saskatchewan health card is applied for online, by mail, or in person at eHealth Saskatchewan in Regina only, so it is not mapped.</p>
        ${sourceLine(`${N.source}; ${N.provSource}; ${N.officeSource}. ${N.routingSource ?? 'Straight-line distances.'} Listed ${N.asOf}.`)}`);
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('newcomer')) return null;
      if (id === 'newcomer-agencies') {
        const a = info.object as NewcomerAgency;
        return `<b>${esc(a.n)}</b><br><span class="tk">${a.city ? esc(a.city) : ''}${a.g ? ' · on the province’s settlement list' : ''}</span>${a.sv ? `<br><span class="tk">${esc(servicesText(a))}</span>` : ''}`;
      }
      if (id === 'newcomer-offices') {
        const o = info.object as NewcomerOffice;
        return `<b>${esc(o.n)}</b><br><span class="tk">${OFFICE_KINDS[o.k].label}${o.city ? ` · ${esc(o.city)}` : ''}</span>${o.hours ? `<br><span class="tk">${esc(o.hours)}</span>` : ''}`;
      }
      const o: any = info.object;
      if (!o.m) return null;
      const p = places.get(o.m.key);
      if (!p) return null;
      return `<b>${esc(o.m.name)}</b>${ERRANDS.map((g) => { const t = p[g.id]; return `<br><span class="tk">${g.label}</span> <span class="tv">${t ? tripText(t) : 'n/a'}</span>`; }).join('')}<br><span class="tk">Click for town report</span>`;
    },
    describe(info) {
      const id = info.layer?.id;
      if (id === 'newcomer-agencies') {
        const a = info.object as NewcomerAgency;
        const web = a.web ? safeUrl(a.web) : null;
        return {
          layer: 'newcomer', kind: a.g ? 'Settlement service (provincial list)' : 'Settlement or language office', lon: a.lon, lat: a.lat, zoom: 13, title: a.n,
          body: `${a.addr ? `${a.addr}${a.city ? `, ${a.city}` : ''}.` : ''}${a.tel ? ` Phone ${a.tel}.` : ''}${a.sv ? ` Offers: ${servicesText(a)}.` : ''}${a.approx ? ' Not in IRCC’s list; shown at the town centre, not the office.' : ''}`,
          stats: [],
          sources: [
            a.src === 'ircc' ? { label: 'IRCC: Find free newcomer services', url: 'https://ircc.canada.ca/english/newcomers/services/index.asp' } : { label: 'Saskatchewan: Find immigration services near you', url: N!.provUrl },
            ...(web ? [{ label: 'Website', url: web }] : []),
          ],
        };
      }
      if (id === 'newcomer-offices') {
        const o = info.object as NewcomerOffice;
        return {
          layer: 'newcomer', kind: OFFICE_KINDS[o.k].label, lon: o.lon, lat: o.lat, zoom: 14, title: o.n,
          body: `${o.addr ? `${o.addr}${o.city ? `, ${o.city}` : ''}.` : o.city ? `${o.city}.` : ''}${o.note ? ` ${o.note}.` : ''}${o.hours ? ` Hours: ${o.hours}.` : ''}${o.k === 'ins' ? ' An insurance broker: most in Saskatchewan are SGI motor licence issuers, but check before you go.' : ''}${o.k === 'so' ? ' Open on certain days only.' : ''}`,
          stats: [],
          sources: [{ label: 'OpenStreetMap', url: `https://www.openstreetmap.org/${o.osm}` }],
        };
      }
      return null;
    },
  };
  return l;
}
