// Camping & rec: the province's parks, recreation sites and regional parks (Ministry of Parks, Culture and Sport), the
// campgrounds in them and around them (Parks Canada, OpenStreetMap), and the drive from each place to its nearest
// campground. A static layer.
import * as d3 from 'd3';
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { Camp, Park, Trip, fmt, km, lowerBound } from './data';
import { esc, safeUrl } from './html';
import { rampCSS } from './charts';
import { ADDITIVE, AtlasLayer, NO_DEPTH, heroStats, kicker, mk, rgb, sourceLine, townColumns } from './layers';
import type { Data } from './data';

export const PARK_TYPES: Record<Park['type'], { label: string; plural: string; color: string }> = {
  national: { label: 'National park', plural: 'national parks', color: '#7bd389' },
  provincial: { label: 'Provincial park', plural: 'provincial parks', color: '#3fb68b' },
  recreation: { label: 'Recreation site', plural: 'recreation sites', color: '#b5d96a' },
  regional: { label: 'Regional park', plural: 'regional parks', color: '#4fc3c9' },
  historic: { label: 'Historic site', plural: 'historic sites and parks', color: '#d9a35e' },
};
export const CAMP_KINDS: Record<Camp['kind'], { label: string; color: string }> = {
  campground: { label: 'Campground', color: '#9be564' },
  group: { label: 'Group campground', color: '#9be564' },
  rv: { label: 'RV park', color: '#ffc06b' },
  backcountry: { label: 'Backcountry campsite', color: '#3f8f5a' },
};

/** A place's nearest campground you can drive to, with the trip there. */
export function nearestCamp(data: Data, key: string): (Trip & { camp: Camp }) | null {
  const C = data.camping;
  const t = C?.towns[key]?.[0];
  return C && t ? { ...t, camp: C.camps[t.f] } : null;
}

export function campingLayer(data: Data): AtlasLayer {
  const color = '#59d18c';
  const C = data.camping;
  const parks: Park[] = C?.parks ?? [];
  const camps: Camp[] = C?.camps ?? [];
  const routed = !!C && C.routing !== 'straight-line';
  const unit = routed ? 'min' : 'km';
  const val = (key: string) => { const n = nearestCamp(data, key); return n ? n.min ?? n.km : null; };
  const ramp = d3.scaleLinear<string>().domain([5, 30, 90]).range(['#e6ffe9', color, '#e0457b']).interpolate(d3.interpolateRgb).clamp(true);
  const height = (v: number) => 3600 + Math.min(v, 200) * 700;
  type Poly = { p: Park; poly: [number, number][][] };
  // biggest first, so small sites inside a big park draw (and pick) on top
  const pPolys: Poly[] = parks.flatMap((p) => p.polys.map((poly) => ({ p, poly })));
  const labelled = parks.filter((p) => (p.type === 'national' || p.type === 'provincial') && p.sub !== 'historic');
  const parkOf = (c: Camp) => (c.p != null ? parks[c.p] : null);
  const campLabel = (c: Camp) => CAMP_KINDS[c.kind].label;
  const trip = (t: { min: number | null; km: number }) => (t.min != null ? `${t.min} min` : `${Math.round(t.km)} km`);

  type Row = { t: Trip; path: [number, number][]; cum: number[] };
  let memoKey: string | null = null;
  let memoRows: Row[] = [];
  const rowsFor = (key: string | null) => {
    if (key === memoKey) return memoRows;
    memoKey = key;
    const m = data.munis.find((x) => x.key === key);
    memoRows = !m || !C ? [] : (C.towns[m.key] ?? []).slice(0, 1).map((t) => {
      const c = camps[t.f];
      const path: [number, number][] = t.line ?? [[m.lon, m.lat], [c.lon, c.lat]];
      const cum = [0];
      for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], (path[k][1] - path[k - 1][1]) * 1.5));
      return { t, path, cum };
    });
    return memoRows;
  };
  const along = (r: Row, q: number): [number, number] => {
    const d = q * r.cum[r.cum.length - 1];
    const k = Math.max(1, lowerBound(r.cum, d, (c) => c));
    if (k >= r.path.length) return r.path[r.path.length - 1];
    const f = (d - r.cum[k - 1]) / (r.cum[k] - r.cum[k - 1] || 1);
    return [r.path[k - 1][0] + (r.path[k][0] - r.path[k - 1][0]) * f, r.path[k - 1][1] + (r.path[k][1] - r.path[k - 1][1]) * f];
  };

  const l: AtlasLayer = {
    id: 'camping',
    name: 'Camping & rec',
    icon: '⛺',
    color,
    range: [2025, 2025.99],
    static: true,
    period: 'parks and campgrounds today',
    available: parks.length > 0 || camps.length > 0,
    unavailable: 'The park boundary, Parks Canada or OpenStreetMap services could not be reached when this copy of the data was built. Run <code>npm run data camping</code>, then reload.',
    build({ selected, hovered, focusedId, clock }) {
      const focused = focusedId === 'camping';
      const out: Layer[] = [
        new PolygonLayer<Poly>({
          id: 'camping-parks',
          data: pPolys,
          getPolygon: (d) => d.poly,
          getFillColor: (d) => rgb(PARK_TYPES[d.p.type].color, focused ? 70 : 45),
          getLineColor: (d) => rgb(PARK_TYPES[d.p.type].color, 220),
          lineWidthUnits: 'pixels',
          getLineWidth: 1.2,
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
      ];
      if (focused) out.push(...townColumns('camping', data.munis, (m) => val(m.key), height, (v) => rgb(ramp(v), 235), 0, selected));

      const rows = rowsFor(hovered ?? selected);
      if (rows.length) {
        const q = (clock % 2600) / 2600;
        out.push(
          new PathLayer<Row>({
            id: 'camping-trips', data: rows, getPath: (r) => r.path,
            getColor: rgb('#ffffff', 235), getWidth: 3.5, widthUnits: 'pixels', capRounded: true, jointRounded: true,
            parameters: NO_DEPTH,
          } as any),
          new ScatterplotLayer<Row>({
            id: 'camping-pulse', data: rows, getPosition: (r) => along(r, q), getRadius: 2600, radiusMinPixels: 3,
            getFillColor: rgb(color, 240), updateTriggers: { getPosition: q }, parameters: ADDITIVE,
          }),
          new TextLayer<Row>({
            id: 'camping-mins', data: rows, getPosition: (r) => r.path[r.path.length - 1],
            getText: (r) => `${trip(r.t)}\n${camps[r.t.f].name}`, getSize: 12, getColor: [255, 255, 255, 255], getPixelOffset: [0, -14], getAlignmentBaseline: 'bottom',
            fontFamily: 'Inter, sans-serif', fontWeight: 700, characterSet: 'auto', outlineWidth: 3, outlineColor: [6, 10, 18, 230], fontSettings: { sdf: true },
            parameters: { depthCompare: 'always' },
          } as any),
        );
      }
      if (focused)
        out.push(new TextLayer<Park>({
          id: 'camping-labels', data: labelled, getPosition: (p) => p.c,
          getText: (p) => p.name.replace(/ (Provincial|National) Park$/, ''), getSize: 12,
          getColor: (p) => rgb(PARK_TYPES[p.type].color, 255),
          fontFamily: 'Inter, sans-serif', fontWeight: 700, characterSet: 'auto', outlineWidth: 4, outlineColor: [6, 10, 18, 235], fontSettings: { sdf: true },
          parameters: { depthCompare: 'always' },
        } as any));
      out.push(new ScatterplotLayer<Camp>({
        id: 'camping-camps', data: camps, getPosition: (c) => [c.lon, c.lat],
        getRadius: (c) => (c.kind === 'backcountry' ? 1200 : 2200), radiusMinPixels: (c: Camp) => (c.kind === 'backcountry' ? 2.5 : focused ? 4.5 : 3.5), radiusMaxPixels: 11,
        getFillColor: (c) => (c.kind === 'backcountry' ? rgb(CAMP_KINDS.backcountry.color, 235) : c.kind === 'rv' ? rgb(CAMP_KINDS.rv.color, 240) : [245, 255, 240, 255]),
        stroked: true, getLineColor: (c) => (c.kind === 'campground' || c.kind === 'group' ? rgb(color) : [6, 10, 18, 255]), lineWidthMinPixels: 1.5,
        pickable: true, parameters: { depthCompare: 'always' },
      } as any));
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Camping & recreation · parks and campgrounds')}
        <h2>Where to camp</h2>`;
      if (!C) {
        el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable}</div>`);
        return { update() {} };
      }
      const n = (t: Park['type']) => parks.filter((p) => p.type === t).length;
      const drive = camps.filter((c) => c.kind !== 'backcountry');
      const pcSites = d3.sum(camps.filter((c) => c.src === 'pc'), (c) => c.sites ?? 0);
      el.insertAdjacentHTML('beforeend', `<p class="lede">Saskatchewan’s ${n('provincial')} provincial parks, ${n('recreation')} recreation sites and ${n('regional')} regional parks as the province maps them, its two national parks, and ${fmt.int(drive.length)} campgrounds and RV parks in and around them. Column height shows the ${routed ? '<b>typical drive</b>' : '<b>straight-line distance</b>'} from each town centre to its nearest campground. Hover or click a town to see the route.</p>`);
      const hero = heroStats(el, 4);
      const rows = data.munis.flatMap((m) => { const v = val(m.key), c = nearestCamp(data, m.key); return v != null && c ? [{ m, v, c }] : []; }).sort((a, b) => a.v - b.v);
      hero(0, String(n('provincial') + n('recreation') + n('regional') + n('national')), 'parks & rec sites');
      hero(1, fmt.int(drive.length), 'campgrounds & RV parks');
      hero(2, fmt.int(pcSites), 'Parks Canada campsites');
      hero(3, `${Math.round(d3.median(rows, (r) => r.v) ?? 0)} ${unit}`, 'median drive to a campground');
      const max = d3.max(rows, (r) => r.v) ?? 1;
      const list = el.appendChild(mk('div'));
      list.innerHTML = `<h3>${routed ? 'Drive' : 'Distance'} to the nearest campground</h3>
        <ol class="rank-list">${rows.map((r, i) => `<li data-key="${r.m.key}"><span class="rk">${i + 1}</span><span><span class="nm">${r.m.name}</span><br><span class="rd">${esc(r.c.camp.name)}${parkOf(r.c.camp) ? ` · ${esc(parkOf(r.c.camp)!.name)}` : ''} · ${Math.round(r.c.km)} km</span></span><span><div class="bar"><i style="width:${Math.round((r.v / max) * 100)}%;background:${ramp(r.v)}"></i></div><div class="bar-v">${Math.round(r.v)}</div></span></li>`).join('')}</ol>
        <div class="ramp" style="background:${rampCSS((t) => ramp(5 + t * 85))}"></div>
        <div class="ramp-labels"><span>5 ${unit}</span><span>30</span><span>90+ ${unit}</span></div>`;
      list.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });
      const big = parks.filter((p) => p.type !== 'historic').slice(0, 8);
      el.insertAdjacentHTML('beforeend', `
        <h3>On the map</h3>
        <div class="legend" style="display:grid;gap:6px">${(Object.keys(PARK_TYPES) as Park['type'][]).filter((t) => n(t)).map((t) => `<span><i class="sw" style="background:${PARK_TYPES[t].color}"></i>${n(t)} ${PARK_TYPES[t].plural}</span>`).join('')}</div>
        <div class="legend"><span><i class="sw" style="background:#f5fff0;box-shadow:0 0 0 2px ${color}"></i>campground</span><span><i class="sw" style="background:${CAMP_KINDS.rv.color}"></i>RV park</span><span><i class="sw" style="background:${CAMP_KINDS.backcountry.color}"></i>backcountry site</span></div>
        <h3>Largest parks</h3>
        <ol class="rank-list">${big.map((p, i) => `<li><span class="rk">${i + 1}</span><span><span class="nm">${esc(p.name)}</span><br><span class="rd">${PARK_TYPES[p.type].label}${p.sub ? ` · ${esc(p.sub)}` : ''}</span></span><span><div class="bar"><i style="width:${Math.round((p.ha / big[0].ha) * 100)}%;background:${PARK_TYPES[p.type].color}"></i></div><div class="bar-v">${fmt.int(p.ha / 100)} km²</div></span></li>`).join('')}</ol>
        <p class="note">Park and recreation site boundaries are the province’s; regional parks that have been dissolved are left out. Parks Canada lists every campsite in Prince Albert and Grasslands national parks, grouped here into campgrounds. The rest of the campgrounds are OpenStreetMap’s, mapped by volunteers: some are missing, and site counts, power and fees are only shown where a mapper recorded them. Seasons, closures and bookings change every year (some campgrounds in parks burned in 2025 stayed closed in 2026): check Saskatchewan Parks or the operator before you go. ${routed ? 'Drive times are the OSRM router’s free-flow estimate on OpenStreetMap roads, to the campground’s mapped point.' : 'No routing service was reachable, so these are straight-line distances.'}</p>
        ${sourceLine(`${C.source}, ${C.asOf}. ${C.routingSource ?? 'Straight-line distances.'}`)}`);
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      const o: any = info.object;
      if (!o || !id.startsWith('camping')) return null;
      if (id === 'camping-camps') {
        const c = o as Camp, p = parkOf(c);
        return `<b>${esc(c.name)}</b><br><span class="tk">${campLabel(c)}${p ? ` · ${esc(p.name)}` : ''}</span>${c.sites ? `<br><span class="tk">Sites</span> <span class="tv">${fmt.int(c.sites)}</span>` : ''}${c.op ? `<br><span class="tk">Run by</span> <span class="tv">${esc(c.op)}</span>` : ''}`;
      }
      if (id === 'camping-parks') {
        const p = o.p as Park;
        return `<b>${esc(p.name)}</b><br><span class="tk">${PARK_TYPES[p.type].label}${p.sub ? ` · ${esc(p.sub)}` : ''}</span> <span class="tv">${p.ha >= 100 ? `${fmt.int(p.ha / 100)} km²` : `${fmt.int(p.ha)} ha`}</span>`;
      }
      if (!o.m) return null;
      const c = nearestCamp(data, o.m.key);
      return `<b>${o.m.name}</b>${c ? `<br><span class="tk">Nearest campground</span> <span class="tv">${trip(c)}</span><br><span class="tk">${esc(c.camp.name)} · ${Math.round(c.km)} km by ${c.min != null ? 'road' : 'straight line'}</span>` : ''}<br><span class="tk">Click for town report</span>`;
    },
    describe(info) {
      const id = info.layer?.id;
      if (id === 'camping-camps') {
        const c = info.object as Camp, p = parkOf(c);
        const near = data.munis.filter((m) => { const n = nearestCamp(data, m.key); return n && n.camp === c; });
        const web = safeUrl(c.web);
        const stats = [
          ...(c.sites ? [{ v: fmt.int(c.sites), l: c.src === 'pc' ? 'campsites (Parks Canada)' : 'sites (as mapped)' }] : []),
          ...(c.otentik ? [{ v: String(c.otentik), l: 'oTENTik tent-cabins' }] : []),
          ...(c.power != null ? [{ v: c.power ? 'Yes' : 'No', l: 'electrical hook-ups' }] : []),
          ...(c.fee != null ? [{ v: c.fee ? 'Yes' : 'Free', l: 'fee' }] : []),
        ];
        return {
          layer: 'camping', kind: campLabel(c), lon: c.lon, lat: c.lat, zoom: 11,
          title: c.name,
          body: `${campLabel(c)}${p ? ` in ${p.name}` : ''}${c.op ? `, run by ${c.op}` : ''}.${near.length ? ` It is the nearest campground by road for ${near.map((m) => m.name).join(', ')}.` : ''}`,
          stats,
          sources: [
            ...(c.src === 'pc' ? [{ label: 'Parks Canada open data', url: 'https://open.canada.ca/data/en/dataset/74054d44-68cf-41af-8919-5f09f80dcd02' }] : []),
            ...(c.osm ? [{ label: 'OpenStreetMap', url: `https://www.openstreetmap.org/${c.osm}` }] : []),
            ...(web ? [{ label: 'Website', url: web }] : []),
          ],
        };
      }
      if (id === 'camping-parks') {
        const p = (info.object as { p: Park }).p;
        const inside = camps.filter((c) => c.p != null && parks[c.p] === p);
        const town = data.munis.map((m) => ({ m, d: km(p.c[0], p.c[1], m.lon, m.lat) })).sort((a, b) => a.d - b.d)[0];
        const web = safeUrl(p.web);
        return {
          layer: 'camping', kind: PARK_TYPES[p.type].label, lon: p.c[0], lat: p.c[1], zoom: p.ha > 50000 ? 8 : p.ha > 2000 ? 10 : 12,
          title: p.name,
          body: `${PARK_TYPES[p.type].label}${p.sub ? ` (${p.sub})` : ''}${p.by ? `, run by ${p.by}` : ''}${town ? `, about ${Math.round(town.d)} km from ${town.m.name}` : ''}.${inside.length ? ` ${inside.length} campground${inside.length > 1 ? 's' : ''} and campsite${inside.length > 1 ? 's are' : ' is'} mapped inside it.` : ' No campground is mapped inside its boundary.'}`,
          stats: [
            { v: p.ha >= 100 ? `${fmt.int(p.ha / 100)} km²` : `${fmt.int(p.ha)} ha`, l: 'area' },
            ...(inside.length ? [{ v: String(inside.filter((c) => c.kind !== 'backcountry').length), l: 'campgrounds' }] : []),
            ...(inside.some((c) => c.kind === 'backcountry') ? [{ v: String(inside.filter((c) => c.kind === 'backcountry').length), l: 'backcountry sites' }] : []),
          ],
          sources: [
            { label: 'Saskatchewan GeoHub: park boundaries', url: 'https://open.canada.ca/data/en/dataset/65f14e41-c6c7-512e-e231-aa1079978b12' },
            ...(web ? [{ label: 'Park website', url: web }] : []),
          ],
        };
      }
      return null;
    },
  };
  return l;
}
