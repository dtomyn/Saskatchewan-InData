// Camping & rec: the province's parks, recreation sites and regional parks (Ministry of Parks, Culture and Sport), the
// campgrounds in them and around them (Parks Canada, OpenStreetMap), and how far they are by road. A static layer.
//
// Three things make it more than dots on a map:
//  • every campground is a campfire, flickering on its own rhythm and as big as its number of sites;
//  • Weekend Reach: pick a place and an ignition wave rolls out from it, lighting each campground at the moment the
//    drive gets there (real OSRM drive times to every campground within four hours), counted live against the median place;
//  • each park opens as a report card: its campgrounds, the closest place by road, its wildfire history and its climate.
import * as d3 from 'd3';
import { ArcLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { Camp, FirePoint, Muni, Park, Trip, fmt, km, lowerBound } from './data';
import { esc, safeUrl } from './html';
import { lineChart, rampCSS, ChartHandle } from './charts';
import { ADDITIVE, AtlasEvent, AtlasLayer, NO_DEPTH, detailBars, heroStats, kicker, mk, rgb, sourceLine, townColumns } from './layers';
import type { Data } from './data';

export const PARK_TYPES: Record<Park['type'], { label: string; plural: string; color: string }> = {
  national: { label: 'National park', plural: 'national parks', color: '#7bd389' },
  provincial: { label: 'Provincial park', plural: 'provincial parks', color: '#3fb68b' },
  recreation: { label: 'Recreation site', plural: 'recreation sites', color: '#b5d96a' },
  regional: { label: 'Regional park', plural: 'regional parks', color: '#4fc3c9' },
  historic: { label: 'Historic site', plural: 'historic sites and parks', color: '#d9a35e' },
};
export const CAMP_KINDS: Record<Camp['kind'], { label: string; color: string }> = {
  campground: { label: 'Campground', color: '#ffb347' },
  group: { label: 'Group campground', color: '#ffb347' },
  rv: { label: 'RV park', color: '#ffd66b' },
  backcountry: { label: 'Backcountry campsite', color: '#ff7a3d' },
};
const FIRE = '#ffb347';
/** Timeline speed of the ignition wave: milliseconds of animation per minute of driving. */
const MS_PER_MIN = 22;
const LIMITS = [60, 120, 180, 240];
const hm = (min: number) => (min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} h${Math.round(min % 60) ? ` ${String(Math.round(min % 60)).padStart(2, '0')}` : ''}`);

/** A place's nearest campground you can drive to, with the trip there. */
export function nearestCamp(data: Data, key: string): (Trip & { camp: Camp }) | null {
  const C = data.camping;
  const t = C?.towns[key]?.[0];
  return C && t ? { ...t, camp: C.camps[t.f] } : null;
}
/** How many campgrounds a place can drive to within `min` minutes. */
export function campsWithin(data: Data, key: string, min: number) {
  const r = data.camping?.reach?.[key];
  return r ? lowerBound(r, min + 0.5, (x) => x[1]) : null;
}
/** Light the campfires from a place: opens Camping & rec and starts the Weekend Reach wave there. */
export const startReach = (key: string) => window.dispatchEvent(new CustomEvent('atlas:reach', { detail: key }));

// point in polygon (even-odd), for fires inside parks
const inRing = (x: number, y: number, ring: [number, number][]) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const inPark = (p: Park, x: number, y: number) => p.polys.some((poly) => inRing(x, y, poly[0]) && !poly.slice(1).some((h) => inRing(x, y, h)));

export function campingLayer(data: Data): AtlasLayer {
  const color = '#59d18c';
  const C = data.camping;
  const parks: Park[] = C?.parks ?? [];
  const camps: Camp[] = C?.camps ?? [];
  const reach = C?.reach ?? {};
  const routed = !!C && C.routing !== 'straight-line';
  const unit = routed ? 'min' : 'km';
  const val = (key: string) => { const n = nearestCamp(data, key); return n ? n.min ?? n.km : null; };
  const ramp = d3.scaleLinear<string>().domain([5, 30, 90]).range(['#e6ffe9', color, '#e0457b']).interpolate(d3.interpolateRgb).clamp(true);
  const height = (v: number) => 3600 + Math.min(v, 200) * 700;
  type Poly = { p: Park; poly: [number, number][][] };
  const pPolys: Poly[] = parks.flatMap((p) => p.polys.map((poly) => ({ p, poly })));
  const labelled = parks.filter((p) => (p.type === 'national' || p.type === 'provincial') && p.sub !== 'historic');
  const parkOf = (c: Camp) => (c.p != null ? parks[c.p] : null);
  const campLabel = (c: Camp) => CAMP_KINDS[c.kind].label;
  const trip = (t: { min: number | null; km: number }) => (t.min != null ? `${t.min} min` : `${Math.round(t.km)} km`);
  const munis = [...data.munis].sort((a, b) => a.name.localeCompare(b.name));
  const muni = (k: string | null) => data.munis.find((m) => m.key === k) ?? null;
  // every campfire flickers on its own phase
  const phase = camps.map((_, i) => ((i * 2654435761) % 1000) / 1000 * Math.PI * 2);
  const campIndex = new Map(camps.map((c, i) => [c, i]));
  const glowR = (c: Camp) => (c.kind === 'backcountry' ? 900 : 1700 + Math.sqrt(c.sites ?? 12) * 260);

  // ---- wildfire history inside each park (fires that started inside the boundary), worked out once when first needed
  let fireMemo: Map<Park, FirePoint[]> | null = null;
  const parkFires = () => {
    if (fireMemo) return fireMemo;
    fireMemo = new Map(parks.map((p) => [p, []]));
    const boxes = parks.map((p) => {
      const pts = p.polys.flatMap((poly) => poly[0]);
      return [d3.min(pts, (q) => q[0])!, d3.min(pts, (q) => q[1])!, d3.max(pts, (q) => q[0])!, d3.max(pts, (q) => q[1])!];
    });
    for (const f of data.fires?.points ?? []) {
      parks.forEach((p, i) => {
        const b = boxes[i];
        if (f[0] >= b[0] && f[0] <= b[2] && f[1] >= b[1] && f[1] <= b[3] && inPark(p, f[0], f[1])) fireMemo!.get(p)!.push(f);
      });
    }
    return fireMemo;
  };
  const NOW = new Date().getFullYear();
  const RECENT = NOW - 10;

  // ---- Weekend Reach state
  let reachKey: string | null = null;
  let reachLimit = 120;
  let waveStart = -1e9;
  const waveMin = (clock: number) => Math.min(reachLimit, Math.max(0, (clock - waveStart) / MS_PER_MIN));
  const reachRows = () => (reachKey ? reach[reachKey] ?? [] : []);
  /** For each minute 0…240, how many campgrounds the median place can reach. */
  const medianCurve = d3.range(0, 241, 5).map((x) => ({ x, y: d3.median(Object.keys(reach), (k) => lowerBound(reach[k], x + 0.5, (r) => r[1])) ?? 0 }));
  const flyToReach = () => {
    const m = muni(reachKey);
    if (!m) return;
    const pts = reachRows().filter((r) => r[1] <= reachLimit).map((r) => camps[r[0]]);
    const xs = [m.lon, ...pts.map((c) => c.lon)], ys = [m.lat, ...pts.map((c) => c.lat)];
    window.dispatchEvent(new CustomEvent('atlas:fly', { detail: { bounds: [[d3.min(xs)!, d3.min(ys)!], [d3.max(xs)!, d3.max(ys)!]] } }));
  };
  const ignite = (key: string | null) => {
    reachKey = key && reach[key] ? key : null;
    waveStart = performance.now();
    if (reachKey) flyToReach();
  };
  window.addEventListener('atlas:reach', (e) => {
    const k = (e as CustomEvent).detail as string;
    if (!reach[k]) return;
    reachKey = k;
    // hold the wave at zero until it starts, so the full reach doesn't flash up first
    waveStart = performance.now() + 1e6;
    window.dispatchEvent(new CustomEvent('atlas:layer', { detail: 'camping' }));
    // let the panel and camera settle on the layer before the wave rolls
    setTimeout(() => ignite(k), 450);
  });

  // ---- the hovered or selected town's road to its nearest campground
  type Row = { t: Trip; path: [number, number][]; cum: number[] };
  let memoKey: string | null = null;
  let memoRows: Row[] = [];
  const rowsFor = (key: string | null) => {
    if (key === memoKey) return memoRows;
    memoKey = key;
    const m = muni(key);
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

  // ---- a park's report card
  const parkEvent = (p: Park): AtlasEvent => {
    const inside = camps.filter((c) => c.p != null && parks[c.p] === p);
    const front = inside.filter((c) => c.kind !== 'backcountry');
    const sites = d3.sum(inside, (c) => c.sites ?? 0);
    const area = p.ha >= 100 ? `${fmt.int(p.ha / 100)} km²` : `${fmt.int(p.ha)} ha`;
    // the place that reaches one of its campgrounds soonest by road
    const ids = new Set(front.map((c) => campIndex.get(c)!));
    let best: { m: Muni; min: number } | null = null;
    for (const m of data.munis) for (const [i, min] of reach[m.key] ?? []) if (ids.has(i)) { if (!best || min < best.min) best = { m, min }; break; }
    const near = data.munis.map((m) => ({ m, d: km(p.c[0], p.c[1], m.lon, m.lat) })).sort((a, b) => a.d - b.d)[0];
    const fires = parkFires().get(p) ?? [];
    const burned = (from: number) => d3.sum(fires.filter((f) => f[2] >= from), (f) => f[3]);
    const byYear = d3.rollup(fires.filter((f) => f[2] >= 1980), (v) => d3.sum(v, (f) => f[3]), (f) => Math.floor(f[2]));
    const worst = [...byYear].sort((a, b) => b[1] - a[1])[0];
    const ns = (data.normals?.stations ?? []).filter((s) => s.tJul != null).map((s) => ({ s, d: km(p.c[0], p.c[1], s.lon, s.lat) })).sort((a, b) => a.d - b.d)[0];
    const clim = ns && ns.d <= 100 ? ns : null;
    const web = safeUrl(p.web);
    const sections: { title: string; text: string }[] = [];
    if (fires.length)
      sections.push({ title: 'Fire', text: `${fmt.int(fires.length)} wildfires have started inside the park since records began, burning ${fmt.ha(d3.sum(fires, (f) => f[3]))} in all${burned(RECENT) ? `, ${fmt.ha(burned(RECENT))} of it since ${RECENT}` : ''}.${worst && worst[1] >= 100 ? ` The worst year since 1980 was ${worst[0]}, with ${fmt.ha(worst[1])}.` : ''} A fire is counted where it started, so fires that burned in from outside are not included.` });
    if (clim)
      sections.push({ title: 'Weather', text: `At ${clim.s.name}, ${Math.round(clim.d)} km away, July averages ${clim.s.tJul!.toFixed(1)} °C${clim.s.sun ? `, with ${fmt.int(clim.s.sun)} hours of bright sunshine a year` : ''}${clim.s.frostDays ? ` and ${Math.round(clim.s.frostDays)} frost days` : ''} (30-year normals).` });
    return {
      layer: 'camping', kind: PARK_TYPES[p.type].label, lon: p.c[0], lat: p.c[1], zoom: p.ha > 50000 ? 8 : p.ha > 2000 ? 10 : 12,
      title: p.name,
      body: `${PARK_TYPES[p.type].label}${p.sub ? ` (${p.sub})` : ''}${p.by ? `, run by ${p.by}` : ''}${near ? `; its centre is about ${Math.round(near.d)} km from ${near.m.name}` : ''}. ${front.length ? `${front.length} campground${front.length > 1 ? 's are' : ' is'} mapped inside it${inside.length > front.length ? `, plus ${inside.length - front.length} backcountry site${inside.length - front.length > 1 ? 's' : ''}` : ''}.` : inside.length ? `${inside.length} backcountry site${inside.length > 1 ? 's are' : ' is'} mapped inside it.` : 'No campground is mapped inside its boundary.'}`,
      stats: [
        { v: area, l: 'area' },
        ...(front.length ? [{ v: String(front.length), l: front.length > 1 ? 'campgrounds' : 'campground' }] : []),
        ...(sites ? [{ v: fmt.int(sites), l: 'campsites counted' }] : []),
        ...(best ? [{ v: hm(best.min), l: `from ${best.m.name}, the closest place by road` }] : []),
        ...(fires.length ? [{ v: fmt.ha(burned(RECENT)), l: `burned inside since ${RECENT}` }] : []),
        ...(clim ? [{ v: `${clim.s.tJul!.toFixed(1)} °C`, l: 'July average nearby' }] : []),
      ],
      sections,
      detail: fires.length ? detailBars('Area burned inside the park, by year', d3.range(1980, NOW + 1).map((x) => ({ x, y: byYear.get(x) ?? 0 })), FIRE, (v) => d3.format('~s')(v), (d) => `<b>${d.x}</b><br>${fmt.ha(d.y)} burned`) : undefined,
      sources: [
        { label: 'Saskatchewan GeoHub: park boundaries', url: 'https://open.canada.ca/data/en/dataset/65f14e41-c6c7-512e-e231-aa1079978b12' },
        ...(web ? [{ label: 'Park website', url: web }] : []),
      ],
      layers: fires.length ? ['camping', 'fires'] : ['camping'],
    };
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
      const live = focused && !!reachKey;
      const w = live ? waveMin(clock) : 0;
      // minutes from the wave's origin to each campground, for the current reach
      const lit = new Map<number, number>();
      if (live) for (const [i, min] of reachRows()) { if (min > w) break; lit.set(i, min); }
      const out: Layer[] = [
        new PolygonLayer<Poly>({
          id: 'camping-parks',
          data: pPolys,
          getPolygon: (d) => d.poly,
          getFillColor: (d) => rgb(PARK_TYPES[d.p.type].color, live ? 30 : focused ? 70 : 45),
          getLineColor: (d) => rgb(PARK_TYPES[d.p.type].color, live ? 120 : 220),
          lineWidthUnits: 'pixels',
          getLineWidth: 1.2,
          updateTriggers: { getFillColor: [live, focused], getLineColor: live },
          pickable: true,
          parameters: NO_DEPTH,
        } as any),
      ];
      if (focused && !live) out.push(...townColumns('camping', data.munis, (m) => val(m.key), height, (v) => rgb(ramp(v), 235), 0, selected));

      const rows = live ? [] : rowsFor(hovered ?? selected);
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
            getFillColor: rgb(FIRE, 240), updateTriggers: { getPosition: q }, parameters: ADDITIVE,
          }),
          new TextLayer<Row>({
            id: 'camping-mins', data: rows, getPosition: (r) => r.path[r.path.length - 1],
            getText: (r) => `${trip(r.t)}\n${camps[r.t.f].name}`, getSize: 12, getColor: [255, 255, 255, 255], getPixelOffset: [0, -14], getAlignmentBaseline: 'bottom',
            fontFamily: 'Inter, sans-serif', fontWeight: 700, characterSet: 'auto', outlineWidth: 3, outlineColor: [6, 10, 18, 230], fontSettings: { sdf: true },
            parameters: { depthCompare: 'always' },
          } as any),
        );
      }

      // the ignition wave: a ring rolling out from the place, an arc to every campground as the drive reaches it
      const origin = live ? muni(reachKey) : null;
      if (origin) {
        const igniting = reachRows().filter(([, min]) => min <= w);
        const lead = (clock - waveStart) / MS_PER_MIN;
        out.push(
          new ScatterplotLayer<Muni>({
            id: 'camping-wave', data: [origin], getPosition: (m) => [m.lon, m.lat],
            // a ring that moves at about 70 km/h as the crow flies: only a hint of the wave, the arcs are the drive times
            getRadius: Math.max(1, w * 1150), stroked: true, filled: false, lineWidthMinPixels: 2,
            getLineColor: rgb(FIRE, w >= reachLimit ? 70 : 200),
            updateTriggers: { getRadius: w, getLineColor: w >= reachLimit }, parameters: NO_DEPTH,
          } as any),
          new ArcLayer<[number, number]>({
            id: 'camping-arcs', data: igniting,
            getSourcePosition: () => [origin.lon, origin.lat],
            getTargetPosition: (r) => [camps[r[0]].lon, camps[r[0]].lat],
            getSourceColor: [255, 245, 220, 150],
            getTargetColor: (r) => rgb(FIRE, 230 - Math.min(140, r[1])),
            getWidth: (r) => (lead - r[1] < 6 ? 3 : 1.4),
            getHeight: 0.35, greatCircle: false, widthUnits: 'pixels',
            updateTriggers: { getWidth: Math.floor(lead) },
            parameters: ADDITIVE,
          } as any),
          new ScatterplotLayer<Muni>({
            id: 'camping-origin', data: [origin], getPosition: (m) => [m.lon, m.lat],
            getRadius: 2600, radiusMinPixels: 6, getFillColor: [255, 255, 255, 255], stroked: true, getLineColor: rgb(FIRE), lineWidthMinPixels: 3,
            parameters: { depthCompare: 'always' },
          } as any),
          new TextLayer<Muni>({
            id: 'camping-clock', data: [origin], getPosition: (m) => [m.lon, m.lat],
            getText: (m) => `${m.name}\n${hm(w)} · ${lit.size} campgrounds`, getSize: 14, getColor: [255, 255, 255, 255], getPixelOffset: [0, -20], getAlignmentBaseline: 'bottom',
            fontFamily: 'Inter, sans-serif', fontWeight: 800, characterSet: 'auto', outlineWidth: 4, outlineColor: [6, 10, 18, 235], fontSettings: { sdf: true },
            updateTriggers: { getText: [Math.floor(w), lit.size] }, parameters: { depthCompare: 'always' },
          } as any),
        );
      }

      if (focused && !live)
        out.push(new TextLayer<Park>({
          id: 'camping-labels', data: labelled, getPosition: (p) => p.c,
          getText: (p) => p.name.replace(/ (Provincial|National) Park$/, ''), getSize: 12,
          getColor: (p) => rgb(PARK_TYPES[p.type].color, 255),
          fontFamily: 'Inter, sans-serif', fontWeight: 700, characterSet: 'auto', outlineWidth: 4, outlineColor: [6, 10, 18, 235], fontSettings: { sdf: true },
          parameters: { depthCompare: 'always' },
        } as any));

      // campfires: a soft flickering glow and a hot core; in Weekend Reach, unlit ones are cold embers and each one
      // flares as the wave reaches it
      const t = clock / 1000;
      const lead = (clock - waveStart) / MS_PER_MIN;
      const flare = (i: number) => { const m = lit.get(i); if (m == null) return 0; const a = (lead - m) / 10; return a < 1 ? (1 - a) ** 2 : 0; };
      const flick = (i: number) => 0.82 + 0.12 * Math.sin(t * 7.1 + phase[i]) + 0.06 * Math.sin(t * 17.3 + phase[i] * 2.3);
      const cold = (i: number) => live && !lit.has(i);
      out.push(
        new ScatterplotLayer<Camp>({
          id: 'camping-glow', data: camps, getPosition: (c) => [c.lon, c.lat],
          getRadius: (c) => { const i = campIndex.get(c)!; return glowR(c) * (cold(i) ? 0.5 : flick(i) * (1 + 2.2 * flare(i))); },
          radiusMinPixels: 3, radiusMaxPixels: 60,
          getFillColor: (c) => { const i = campIndex.get(c)!; return cold(i) ? [120, 120, 130, 20] : rgb(c.kind === 'rv' ? CAMP_KINDS.rv.color : c.kind === 'backcountry' ? CAMP_KINDS.backcountry.color : FIRE, Math.round(70 + 120 * flare(i) + 30 * flick(i))); },
          updateTriggers: { getRadius: [t, live, lit.size], getFillColor: [t, live, lit.size] },
          parameters: ADDITIVE,
        } as any),
        new ScatterplotLayer<Camp>({
          id: 'camping-camps', data: camps, getPosition: (c) => [c.lon, c.lat],
          getRadius: (c) => (c.kind === 'backcountry' ? 500 : 900), radiusMinPixels: (c: Camp) => (c.kind === 'backcountry' ? 1.5 : focused ? 2.6 : 2), radiusMaxPixels: 7,
          getFillColor: (c) => (cold(campIndex.get(c)!) ? [110, 116, 130, 200] : c.kind === 'backcountry' ? [255, 170, 110, 255] : [255, 244, 214, 255]),
          updateTriggers: { getFillColor: [live, lit.size] },
          pickable: true, parameters: { depthCompare: 'always' },
        } as any),
      );
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
      el.insertAdjacentHTML('beforeend', `<p class="lede">Saskatchewan’s ${n('provincial')} provincial parks, ${n('recreation')} recreation sites and ${n('regional')} regional parks, its two national parks, and ${fmt.int(drive.length)} campgrounds and RV parks, each one a campfire on the map. Columns show the ${routed ? '<b>drive</b>' : '<b>straight-line distance</b>'} from each place to its nearest campground; click a park for its report card.</p>`);
      const hero = heroStats(el, 4);
      const rows = data.munis.flatMap((m) => { const v = val(m.key), c = nearestCamp(data, m.key); return v != null && c ? [{ m, v, c }] : []; }).sort((a, b) => a.v - b.v);
      hero(0, String(n('provincial') + n('recreation') + n('regional') + n('national')), 'parks & rec sites');
      hero(1, fmt.int(drive.length), 'campgrounds & RV parks');
      hero(2, fmt.int(pcSites), 'Parks Canada campsites');
      hero(3, `${Math.round(d3.median(rows, (r) => r.v) ?? 0)} ${unit}`, 'median drive to a campground');

      // ---- Weekend Reach
      const W = el.appendChild(mk('div', 'reach'));
      W.innerHTML = `<h3>Weekend Reach</h3>
        <p class="note" style="margin-top:0">Pick a place and light the campfires: each campground ignites when the ${C.reachRouted ? 'drive' : 'rough straight-line estimate'} from it gets there.</p>
        <div class="reach-row">
          <select class="reach-town" aria-label="Start from">${munis.map((m) => `<option value="${m.key}">${m.name}</option>`).join('')}</select>
          <button class="reach-go" type="button" style="--c:${FIRE}">🔥 Light the campfires</button>
        </div>
        <div class="chips" style="margin:8px 0 4px">${LIMITS.map((x) => `<button class="chip" data-lim="${x}" style="--c:${FIRE}">${x / 60} h</button>`).join('')}</div>
        <div class="reach-live" aria-live="polite"></div>
        <div class="reach-chart"></div>
        <ol class="rank-list reach-parks"></ol>`;
      const sel = W.querySelector<HTMLSelectElement>('.reach-town')!;
      sel.value = reachKey ?? (reach.saskatoon ? 'saskatoon' : munis[0]?.key ?? '');
      const liveEl = W.querySelector<HTMLElement>('.reach-live')!;
      const parksEl = W.querySelector<HTMLElement>('.reach-parks')!;
      const chartEl = W.querySelector<HTMLElement>('.reach-chart')!;
      let chart: ChartHandle | null = null;
      let drawnFor = '';
      const drawChart = () => {
        const k = sel.value;
        const r = reach[k] ?? [];
        drawnFor = `${k}:${reachLimit}`;
        chartEl.innerHTML = '';
        const xs = d3.range(0, reachLimit + 1, 5);
        chart = lineChart(chartEl, {
          height: 120, xDomain: [0, reachLimit], yFormat: (v) => String(v), valueFormat: (v) => `${Math.round(v)} campgrounds`,
          series: [
            { key: 'here', label: muni(k)?.name ?? k, color: FIRE, width: 2.5, values: xs.map((x) => ({ x, y: lowerBound(r, x + 0.5, (q) => q[1]) })) },
            { key: 'median', label: 'Median place', color: '#9aa3b2', dashed: true, muted: true, values: medianCurve.filter((p) => p.x <= reachLimit) },
          ],
        });
      };
      W.querySelectorAll<HTMLButtonElement>('[data-lim]').forEach((b) => b.classList.toggle('on', +b.dataset.lim! === reachLimit));
      W.querySelector('.chips')!.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-lim]');
        if (!b) return;
        reachLimit = +b.dataset.lim!;
        W.querySelectorAll<HTMLButtonElement>('[data-lim]').forEach((x) => x.classList.toggle('on', x === b));
        ignite(sel.value);
      });
      W.querySelector('.reach-go')!.addEventListener('click', () => ignite(sel.value));
      sel.addEventListener('change', () => ignite(sel.value));
      parksEl.addEventListener('click', (e) => {
        const i = (e.target as HTMLElement).closest<HTMLElement>('li')?.dataset.park;
        if (i != null) window.dispatchEvent(new CustomEvent('atlas:event', { detail: parkEvent(parks[+i]) }));
      });
      let lastShown = '';
      const showReach = (clock: number) => {
        const k = reachKey ?? sel.value;
        const r = reach[k] ?? [];
        const w = reachKey ? waveMin(clock) : reachLimit;
        if (drawnFor !== `${k}:${reachLimit}` || !chart) requestAnimationFrame(drawChart);
        chart?.setPlayhead(w);
        const sig = `${k}:${reachLimit}:${Math.floor(w)}`;
        if (sig === lastShown) return;
        lastShown = sig;
        const got = r.filter((x) => x[1] <= w);
        const inPark = d3.rollup(got.filter(([i]) => camps[i].p != null), (v) => ({ n: v.length, min: d3.min(v, (x) => x[1])! }), ([i]) => camps[i].p!);
        const sites = d3.sum(got, ([i]) => camps[i].sites ?? 0);
        const med = medianCurve.find((p) => p.x >= w)?.y ?? 0;
        const name = muni(k)?.name ?? '';
        liveEl.innerHTML = `<div class="reach-big"><b>${fmt.int(got.length)}</b> campgrounds within <b>${hm(w)}</b> of ${esc(name)}</div>
          <div class="rd">${inPark.size} parks and rec sites${sites ? ` · ${fmt.int(sites)} counted sites` : ''} · the median place reaches ${Math.round(med)}${got.length && med ? ` (${got.length >= med ? `${(got.length / Math.max(1, med)).toFixed(1)}×` : `${Math.round((got.length / med) * 100)}%`})` : ''}</div>`;
        const top = [...inPark].map(([pi, v]) => ({ p: parks[pi], pi, ...v })).filter((x) => x.p.type !== 'historic').sort((a, b) => b.p.ha - a.p.ha).slice(0, 6);
        parksEl.innerHTML = top.length ? top.map((x, i) => `<li data-park="${x.pi}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(x.p.name)}</span><br><span class="rd">${PARK_TYPES[x.p.type].label} · ${x.n} campground${x.n > 1 ? 's' : ''}</span></span><span><div class="bar-v">${hm(x.min)}</div></span></li>`).join('') : '';
      };

      // ---- nearest campground ranking
      const max = d3.max(rows, (r) => r.v) ?? 1;
      const list = el.appendChild(mk('div'));
      list.innerHTML = `<h3>${routed ? 'Drive' : 'Distance'} to the nearest campground</h3>
        <ol class="rank-list">${rows.map((r, i) => `<li data-key="${r.m.key}"><span class="rk">${i + 1}</span><span><span class="nm">${r.m.name}</span><br><span class="rd">${esc(r.c.camp.name)}${parkOf(r.c.camp) ? ` · ${esc(parkOf(r.c.camp)!.name)}` : ''} · ${Math.round(r.c.km)} km</span></span><span><div class="bar"><i style="width:${Math.round((r.v / max) * 100)}%;background:${ramp(r.v)}"></i></div><div class="bar-v">${Math.round(r.v)}</div></span></li>`).join('')}</ol>
        <div class="ramp" style="background:${rampCSS((t) => ramp(5 + t * 85))}"></div>
        <div class="ramp-labels"><span>5 ${unit}</span><span>30</span><span>90+ ${unit}</span></div>`;
      list.addEventListener('click', (e) => { const k = (e.target as HTMLElement).closest('li')?.dataset.key; if (k) window.dispatchEvent(new CustomEvent('atlas:town', { detail: k })); });

      // ---- fire and camping: the parks that burned most in the last ten years
      const fireBox = el.appendChild(mk('div'));
      if (data.fires) {
        const pf = parkFires();
        const ranked = parks.filter((p) => p.type !== 'historic').map((p, ) => ({ p, ha: d3.sum((pf.get(p) ?? []).filter((f) => f[2] >= RECENT), (f) => f[3]) })).filter((x) => x.ha >= 50).sort((a, b) => b.ha - a.ha);
        const fires10 = (data.fires.points ?? []).filter((f) => f[2] >= RECENT && f[3] >= 1000);
        const scorched = drive.filter((c) => fires10.some((f) => Math.abs(f[1] - c.lat) < 0.1 && km(c.lon, c.lat, f[0], f[1]) <= 10)).length;
        if (ranked.length) {
          const top = ranked[0].ha;
          fireBox.innerHTML = `<h3>Fire country</h3>
            <div class="callout" style="--c:${FIRE}">Since ${RECENT}, wildfires that started inside parks burned <b>${fmt.ha(d3.sum(ranked, (x) => x.ha))}</b> of them, and <b>${scorched}</b> campgrounds had a fire of 1,000 ha or more start within 10 km.</div>
            <ol class="rank-list">${ranked.slice(0, 6).map((x, i) => `<li data-park="${parks.indexOf(x.p)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(x.p.name)}</span><br><span class="rd">${PARK_TYPES[x.p.type].label}</span></span><span><div class="bar"><i style="width:${Math.round((x.ha / top) * 100)}%;background:${FIRE}"></i></div><div class="bar-v">${fmt.ha(x.ha)}</div></span></li>`).join('')}</ol>`;
          fireBox.addEventListener('click', (e) => {
            const i = (e.target as HTMLElement).closest<HTMLElement>('li')?.dataset.park;
            if (i != null) window.dispatchEvent(new CustomEvent('atlas:event', { detail: parkEvent(parks[+i]) }));
          });
        }
      }

      const big = parks.filter((p) => p.type !== 'historic').slice(0, 8);
      el.insertAdjacentHTML('beforeend', `
        <h3>On the map</h3>
        <div class="legend" style="display:grid;gap:6px">${(Object.keys(PARK_TYPES) as Park['type'][]).filter((t) => n(t)).map((t) => `<span><i class="sw" style="background:${PARK_TYPES[t].color}"></i>${n(t)} ${PARK_TYPES[t].plural}</span>`).join('')}</div>
        <div class="legend"><span><i class="sw" style="background:#fff4d6;box-shadow:0 0 6px 3px ${FIRE}"></i>campground (glow grows with its sites)</span><span><i class="sw" style="background:#fff4d6;box-shadow:0 0 6px 3px ${CAMP_KINDS.rv.color}"></i>RV park</span><span><i class="sw" style="background:#ffaa6e"></i>backcountry site</span></div>
        <h3>Largest parks</h3>
        <ol class="rank-list big-parks">${big.map((p, i) => `<li data-park="${parks.indexOf(p)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(p.name)}</span><br><span class="rd">${PARK_TYPES[p.type].label}${p.sub ? ` · ${esc(p.sub)}` : ''}</span></span><span><div class="bar"><i style="width:${Math.round((p.ha / big[0].ha) * 100)}%;background:${PARK_TYPES[p.type].color}"></i></div><div class="bar-v">${fmt.int(p.ha / 100)} km²</div></span></li>`).join('')}</ol>
        <p class="note">Park and recreation site boundaries are the province’s; regional parks that have been dissolved are left out. Parks Canada lists every campsite in Prince Albert and Grasslands national parks, grouped here into campgrounds. The rest of the campgrounds are OpenStreetMap’s, mapped by volunteers: some are missing, and site counts, power and fees are only shown where a mapper recorded them. A campfire’s glow grows with its number of sites where that is known. Weekend Reach uses ${C.reachRouted ? 'the OSRM router’s free-flow drive time from the town centre to each campground within four hours' : 'a rough estimate (80 km/h along a road 1.3 times the straight line), as no routing service was reachable'}; its rolling ring is only a guide, the arcs are the drive times. Fires are counted where they started. Seasons, closures and bookings change every year (some campgrounds in parks burned in 2025 stayed closed in 2026): check Saskatchewan Parks or the operator before you go.</p>
        ${sourceLine(`${C.source}, ${C.asOf}. ${C.routingSource ?? 'Straight-line distances.'}`)}`);
      el.querySelector('.big-parks')!.addEventListener('click', (e) => {
        const i = (e.target as HTMLElement).closest<HTMLElement>('li')?.dataset.park;
        if (i != null) window.dispatchEvent(new CustomEvent('atlas:event', { detail: parkEvent(parks[+i]) }));
      });
      return { update({ clock }) { showReach(clock); } };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      const o: any = info.object;
      if (!o || !id.startsWith('camping')) return null;
      if (id === 'camping-camps') {
        const c = o as Camp, p = parkOf(c);
        const i = campIndex.get(c)!;
        const r = reachKey ? reach[reachKey]?.find((x) => x[0] === i) : null;
        return `<b>${esc(c.name)}</b><br><span class="tk">${campLabel(c)}${p ? ` · ${esc(p.name)}` : ''}</span>${c.sites ? `<br><span class="tk">Sites</span> <span class="tv">${fmt.int(c.sites)}</span>` : ''}${c.op ? `<br><span class="tk">Run by</span> <span class="tv">${esc(c.op)}</span>` : ''}${r ? `<br><span class="tk">From ${esc(muni(reachKey)!.name)}</span> <span class="tv">${hm(r[1])}</span>` : ''}`;
      }
      if (id === 'camping-parks') {
        const p = o.p as Park;
        return `<b>${esc(p.name)}</b><br><span class="tk">${PARK_TYPES[p.type].label}${p.sub ? ` · ${esc(p.sub)}` : ''}</span> <span class="tv">${p.ha >= 100 ? `${fmt.int(p.ha / 100)} km²` : `${fmt.int(p.ha)} ha`}</span><br><span class="tk">Click for its report card</span>`;
      }
      if (!o.m) return null;
      const c = nearestCamp(data, o.m.key);
      const two = campsWithin(data, o.m.key, 120);
      return `<b>${o.m.name}</b>${c ? `<br><span class="tk">Nearest campground</span> <span class="tv">${trip(c)}</span><br><span class="tk">${esc(c.camp.name)} · ${Math.round(c.km)} km by ${c.min != null ? 'road' : 'straight line'}</span>` : ''}${two != null ? `<br><span class="tk">Campgrounds within 2 h</span> <span class="tv">${two}</span>` : ''}<br><span class="tk">Click for town report</span>`;
    },
    describe(info) {
      const id = info.layer?.id;
      if (id === 'camping-camps') {
        const c = info.object as Camp, p = parkOf(c);
        const near = data.munis.filter((m) => { const n = nearestCamp(data, m.key); return n && n.camp === c; });
        const i = campIndex.get(c)!;
        const from = data.munis.map((m) => ({ m, r: reach[m.key]?.find((x) => x[0] === i) })).filter((x) => x.r).sort((a, b) => a.r![1] - b.r![1]);
        const web = safeUrl(c.web);
        const stats = [
          ...(c.sites ? [{ v: fmt.int(c.sites), l: c.src === 'pc' ? 'campsites (Parks Canada)' : 'sites (as mapped)' }] : []),
          ...(c.otentik ? [{ v: String(c.otentik), l: 'oTENTik tent-cabins' }] : []),
          ...(from.length ? [{ v: hm(from[0].r![1]), l: `from ${from[0].m.name}, the closest place by road` }] : []),
          ...(from.length ? [{ v: String(from.length), l: 'of the atlas’s places within 4 h' }] : []),
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
      if (id === 'camping-parks') return parkEvent((info.object as { p: Park }).p);
      return null;
    },
  };
  return l;
}
